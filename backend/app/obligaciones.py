"""
Dominio de Obligaciones Tributarias (Agenda Tributaria Inteligente).
Genera obligaciones automáticamente desde el cronograma oficial SUNAT.
"""
import os
import json
from datetime import datetime, date

import httpx

from app.database import Obligacion, ObligacionEvento
from app.cronograma import get_vencimientos

GROQ_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_TEXT_MODEL = os.getenv("GROQ_TEXT_MODEL", "llama-3.3-70b-versatile")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Estados del Kanban (en orden de flujo)
ESTADOS = [
    "pendiente", "por_revisar", "programado", "en_proceso",
    "pagado", "declarado", "archivado",
]
ESTADOS_LABEL = {
    "pendiente": "Pendiente", "por_revisar": "Por revisar", "programado": "Programado",
    "en_proceso": "En proceso", "pagado": "Pagado", "declarado": "Declarado",
    "archivado": "Archivado",
}


def _prioridad_por_dias(fecha: date) -> str:
    dias = (fecha - date.today()).days
    if dias <= 3:
        return "alta"
    if dias <= 10:
        return "media"
    return "baja"


async def generar_desde_cronograma(empresa, anio: int, db) -> dict:
    """Crea (idempotente) las obligaciones de Declaración y SIRE del año para una empresa."""
    data = await get_vencimientos(empresa.ruc, anio, db)
    if not data.get("success"):
        return {"success": False, "error": data.get("error", "No se pudo obtener el cronograma."), "creadas": 0}

    nombre = empresa.alias or empresa.razon_social or f"RUC {empresa.ruc}"
    creadas = 0

    for v in data["vencimientos"]:
        decl = date.fromisoformat(v["vencimiento_declaracion"])
        sire = date.fromisoformat(v["vencimiento_sire"])
        items = [
            ("declaracion_mensual", f"Declaración mensual IGV-Renta · {v['periodo']}",
             decl, f"Declaración jurada mensual (PDT 621 / IGV-Renta) de {nombre} — período {v['periodo']}."),
            ("sire", f"SIRE (Compras/Ventas) · {v['periodo']}",
             sire, f"Registro de Ventas e Ingresos / Compras Electrónico de {nombre} — período {v['periodo']}. Vence el día hábil anterior a la declaración."),
        ]
        for tipo, titulo, fecha, desc in items:
            clave = f"auto-{empresa.id}-{tipo}-{anio}-{v['periodo_mes']}"
            existe = db.query(Obligacion).filter(Obligacion.clave == clave).first()
            if existe:
                continue
            db.add(Obligacion(
                user_id=empresa.user_id, empresa_id=empresa.id, clave=clave,
                tipo=tipo, titulo=titulo, descripcion=desc, periodo=v["periodo"],
                fecha_vencimiento=datetime.combine(fecha, datetime.min.time()),
                estado="pendiente", prioridad=_prioridad_por_dias(fecha),
                origen="auto_cronograma",
            ))
            creadas += 1

    db.commit()
    return {"success": True, "creadas": creadas, "anio": anio}


def _load_checklist(raw):
    try:
        items = json.loads(raw) if raw else []
        return [{"texto": i.get("texto", ""), "done": bool(i.get("done"))} for i in items if i.get("texto")]
    except Exception:
        return []


def obligacion_dict(o: Obligacion, empresa_nombre: str = "") -> dict:
    fv = o.fecha_vencimiento
    dias = (fv.date() - date.today()).days if fv else None
    return {
        "id": o.id, "empresa_id": o.empresa_id, "empresa": empresa_nombre,
        "tipo": o.tipo, "titulo": o.titulo, "descripcion": o.descripcion or "",
        "periodo": o.periodo or "", "estado": o.estado, "prioridad": o.prioridad,
        "responsable": o.responsable or "", "monto": o.monto or "", "origen": o.origen,
        "fecha_vencimiento": fv.date().isoformat() if fv else None,
        "dias_restantes": dias,
        "observaciones": o.observaciones or "",
        "checklist": _load_checklist(o.checklist),
        "recordatorio_dias": o.recordatorio_dias or "",
        "recordatorio_wsp": o.recordatorio_wsp if o.recordatorio_wsp is not None else True,
        "recordatorio_email": bool(o.recordatorio_email),
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }


def evento_dict(e: ObligacionEvento) -> dict:
    return {
        "id": e.id, "tipo": e.tipo, "texto": e.texto or "",
        "autor": e.autor or "", "archivo_nombre": e.archivo_nombre or "",
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def log_actividad(db, obligacion_id: int, texto: str, autor: str = "Sistema"):
    db.add(ObligacionEvento(obligacion_id=obligacion_id, tipo="actividad",
                            texto=texto, autor=autor))


async def chat_obligacion(o: Obligacion, empresa_nombre: str, pregunta: str,
                          historial: list = None) -> str:
    """Responde una pregunta sobre la obligación usando Groq (gratis)."""
    if not GROQ_KEY:
        return "El chat IA no está disponible (falta configurar el proveedor)."
    contexto = (
        f"Obligación tributaria: {o.titulo}\n"
        f"Tipo: {o.tipo} | Estado: {o.estado} | Prioridad: {o.prioridad}\n"
        f"Empresa: {empresa_nombre} | Período: {o.periodo or '-'}\n"
        f"Vence: {o.fecha_vencimiento.date().isoformat() if o.fecha_vencimiento else '-'}\n"
        f"Descripción: {o.descripcion or '-'}\n"
        f"Observaciones: {o.observaciones or '-'}"
    )
    system = (
        "Eres un asesor tributario peruano experto (SUNAT). Responde de forma breve, "
        "clara y práctica sobre la obligación tributaria del contexto. Si te preguntan por "
        "plazos, montos o fundamentos, sé preciso y cita la norma cuando aplique. "
        "No inventes datos que no estén en el contexto."
    )
    mensajes = [{"role": "system", "content": system},
                {"role": "system", "content": f"CONTEXTO:\n{contexto}"}]
    for h in (historial or [])[-6:]:
        mensajes.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    mensajes.append({"role": "user", "content": pregunta})
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            r = await client.post(GROQ_URL, headers={"Authorization": f"Bearer {GROQ_KEY}"},
                                  json={"model": GROQ_TEXT_MODEL, "messages": mensajes,
                                        "temperature": 0.3, "max_tokens": 700})
            if r.status_code != 200:
                return f"No se pudo responder ahora (IA {r.status_code})."
            return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return f"Error en el chat IA: {str(e)[:120]}"


async def chat_general(nombre: str, pregunta: str, historial: list = None, contexto: str = "") -> str:
    """Asistente tributario general de Dashbot (Groq, gratis)."""
    if not GROQ_KEY:
        return "El asistente no está disponible por ahora."
    system = (
        "Eres Dashbot, un asistente tributario peruano experto en SUNAT, detracciones, "
        "IGV, renta, SIRE, cronogramas de vencimiento y obligaciones formales. "
        f"Te diriges al usuario ({nombre or 'contador'}) de forma cercana, clara y práctica. "
        "Das respuestas breves y accionables; cuando corresponde citas la norma (Código Tributario, "
        "resoluciones SUNAT). Si la pregunta excede tu alcance, sugieres verificar en SUNAT o con un "
        "especialista. No inventas datos específicos del usuario que no estén en el contexto."
    )
    mensajes = [{"role": "system", "content": system}]
    if contexto:
        mensajes.append({"role": "system", "content": f"CONTEXTO DEL USUARIO:\n{contexto}"})
    for h in (historial or [])[-6:]:
        mensajes.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    mensajes.append({"role": "user", "content": pregunta})
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            r = await client.post(GROQ_URL, headers={"Authorization": f"Bearer {GROQ_KEY}"},
                                  json={"model": GROQ_TEXT_MODEL, "messages": mensajes,
                                        "temperature": 0.4, "max_tokens": 800})
            if r.status_code != 200:
                return f"No se pudo responder ahora (IA {r.status_code})."
            return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return f"Error en el asistente: {str(e)[:120]}"
