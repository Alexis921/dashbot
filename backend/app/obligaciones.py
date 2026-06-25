"""
Dominio de Obligaciones Tributarias (Agenda Tributaria Inteligente).
Genera obligaciones automáticamente desde el cronograma oficial SUNAT.
"""
from datetime import datetime, date

from app.database import Obligacion
from app.cronograma import get_vencimientos

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
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }
