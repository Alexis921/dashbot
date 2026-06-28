"""
BOT SUNAT / Dashbot - Backend API
Plataforma multiempresa: usuarios con cuenta propia (JWT) que registran
varias empresas con credenciales SOL cifradas.
"""
import os
import uuid
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from dotenv import load_dotenv

load_dotenv()

import asyncio
import json
from datetime import date
from app.database import (
    get_db, init_db, User, Empresa, Notification, SyncLog,
    Programacion, Configuracion, Obligacion, ObligacionEvento,
)
from app.auth import (
    hash_password, verify_password, create_token, get_current_user,
    encrypt_secret, decrypt_secret,
)
from app.ruc_lookup import lookup_ruc
from app.cronograma import get_vencimientos
from app.obligaciones import (
    generar_desde_cronograma, obligacion_dict, ESTADOS, ESTADOS_LABEL,
    evento_dict, log_actividad, chat_obligacion,
)
from app.document_ai import analizar_documento
from app.scraper import get_demo_notifications
from app.playwright_scraper import scrape_with_playwright, download_pdf_with_cookies
from app.email_service import send_email_summary
from app.ai_summary import (
    generate_ai_summary_expert, generate_notification_interpretation,
)
from app.scheduler import schedule_loop, run_due_schedules, compute_next_run
from app.whatsapp_service import send_whatsapp, build_alert_message
from app.recordatorios import run_recordatorios

CRON_TOKEN = os.getenv("CRON_TOKEN", "dashbot-cron-2026")

app = FastAPI(title="Dashbot API", version="2.0.0")

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cookies de sesión SUNAT en memoria, por empresa (para descargar PDFs)
_sunat_sessions: dict = {}


# ── Modelos Pydantic ──────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    nombre: str
    apellido: str
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class EmpresaCreate(BaseModel):
    ruc: str
    razon_social: Optional[str] = ""
    alias: Optional[str] = ""
    sol_usuario: str
    sol_password: str


class InterpretRequest(BaseModel):
    notification: dict


class EmailRequest(BaseModel):
    to_email: str


class ProgramacionUpdate(BaseModel):
    activo: bool = False
    frecuencia: str = "cada_x_horas"
    hora_inicio: str = "08:00"
    repetir_cada: int = 6
    zona_horaria: str = "America/Lima"
    correo_envio: Optional[str] = ""
    fuente_sol: bool = True
    fuente_sunafil: bool = False


class ConfiguracionUpdate(BaseModel):
    whatsapp_activo: bool = False
    whatsapp_numero: Optional[str] = ""
    whatsapp_apikey: Optional[str] = ""
    whatsapp_nivel: str = "urgentes"
    recordatorios_activo: bool = False
    recordatorio_dias: Optional[str] = "7,3,1,0"
    recordatorio_wsp: bool = True
    recordatorio_email: bool = False
    recordatorio_email_dest: Optional[str] = ""


class TestWhatsappRequest(BaseModel):
    whatsapp_numero: str
    whatsapp_apikey: str


class ObligacionCreate(BaseModel):
    empresa_id: Optional[int] = None
    tipo: str = "otro"
    titulo: str
    descripcion: Optional[str] = ""
    periodo: Optional[str] = ""
    fecha_vencimiento: str          # "YYYY-MM-DD"
    prioridad: str = "media"
    responsable: Optional[str] = ""
    monto: Optional[str] = ""


class ObligacionUpdate(BaseModel):
    estado: Optional[str] = None
    prioridad: Optional[str] = None
    titulo: Optional[str] = None
    descripcion: Optional[str] = None
    responsable: Optional[str] = None
    monto: Optional[str] = None
    fecha_vencimiento: Optional[str] = None
    observaciones: Optional[str] = None
    checklist: Optional[list] = None


class ComentarioReq(BaseModel):
    texto: str


class ChatReq(BaseModel):
    pregunta: str
    historial: Optional[list] = None


# ── Startup ────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    init_db()
    # Lanzar el worker de extracción programada en segundo plano
    asyncio.create_task(schedule_loop())


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


# ── Autenticación ──────────────────────────────────────────────────────────
def _user_dict(u: User) -> dict:
    return {
        "id": u.id, "nombre": u.nombre, "apellido": u.apellido,
        "username": u.username, "plan": u.plan, "max_empresas": u.max_empresas,
    }


@app.post("/api/auth/register")
async def register(req: RegisterRequest, db: Session = Depends(get_db)):
    username = req.username.strip().lower()
    if len(username) < 3:
        raise HTTPException(400, "El usuario debe tener al menos 3 caracteres.")
    if len(req.password) < 6:
        raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres.")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(409, "Ese nombre de usuario ya está registrado.")

    user = User(
        nombre=req.nombre.strip(),
        apellido=req.apellido.strip(),
        username=username,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_token(user.id, user.username)
    return {"token": token, "user": _user_dict(user)}


@app.post("/api/auth/login")
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    username = req.username.strip().lower()
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Usuario o contraseña incorrectos.")
    token = create_token(user.id, user.username)
    return {"token": token, "user": _user_dict(user)}


@app.get("/api/auth/me")
async def me(user: User = Depends(get_current_user)):
    return {"user": _user_dict(user)}


# ── Consulta de RUC ─────────────────────────────────────────────────────────
@app.get("/api/ruc/{ruc}")
async def consulta_ruc(ruc: str, user: User = Depends(get_current_user)):
    return await lookup_ruc(ruc)


# ── Empresas (multiempresa) ──────────────────────────────────────────────────
def _empresa_dict(e: Empresa) -> dict:
    return {
        "id": e.id, "ruc": e.ruc, "razon_social": e.razon_social,
        "alias": e.alias, "sol_usuario": e.sol_usuario, "estado": e.estado,
        "last_login": e.last_login.isoformat() if e.last_login else None,
        "last_sync": e.last_sync.isoformat() if e.last_sync else None,
        "estado_ruc": e.estado_ruc or "", "condicion": e.condicion or "",
        "tipo_contrib": e.tipo_contrib or "", "actividad_economica": e.actividad_economica or "",
        "direccion": e.direccion or "", "ubicacion": e.ubicacion or "",
        "padrones": e.padrones or "",
        "ruc_sync_at": e.ruc_sync_at.isoformat() if e.ruc_sync_at else None,
    }


@app.get("/api/empresas")
async def list_empresas(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    empresas = db.query(Empresa).filter(Empresa.user_id == user.id).order_by(Empresa.created_at).all()
    return {
        "empresas": [_empresa_dict(e) for e in empresas],
        "count": len(empresas),
        "max": user.max_empresas,
    }


@app.post("/api/empresas")
async def create_empresa(
    req: EmpresaCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(req.ruc) != 11 or not req.ruc.isdigit():
        raise HTTPException(400, "RUC inválido. Debe tener 11 dígitos.")
    if not req.sol_usuario.strip() or not req.sol_password.strip():
        raise HTTPException(400, "Usuario y clave SOL son obligatorios.")

    count = db.query(Empresa).filter(Empresa.user_id == user.id).count()
    if count >= user.max_empresas:
        raise HTTPException(403, f"Alcanzaste el límite de {user.max_empresas} empresas de tu plan.")

    existing = db.query(Empresa).filter(
        Empresa.user_id == user.id, Empresa.ruc == req.ruc
    ).first()
    if existing:
        raise HTTPException(409, "Ya registraste esa empresa.")

    razon = (req.razon_social or "").strip()
    if not razon:
        info = await lookup_ruc(req.ruc)
        if info.get("success"):
            razon = info.get("razon_social", "")

    empresa = Empresa(
        user_id=user.id,
        ruc=req.ruc,
        razon_social=razon,
        alias=(req.alias or "").strip(),
        sol_usuario=req.sol_usuario.strip(),
        sol_password_enc=encrypt_secret(req.sol_password),
        estado="pendiente",
    )
    db.add(empresa)
    db.commit()
    db.refresh(empresa)
    return {"success": True, "empresa": _empresa_dict(empresa)}


@app.delete("/api/empresas/{empresa_id}")
async def delete_empresa(
    empresa_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa = db.query(Empresa).filter(
        Empresa.id == empresa_id, Empresa.user_id == user.id
    ).first()
    if not empresa:
        raise HTTPException(404, "Empresa no encontrada.")
    db.delete(empresa)
    db.commit()
    _sunat_sessions.pop(empresa_id, None)
    return {"success": True}


def _get_owned_empresa(empresa_id: int, user: User, db: Session) -> Empresa:
    empresa = db.query(Empresa).filter(
        Empresa.id == empresa_id, Empresa.user_id == user.id
    ).first()
    if not empresa:
        raise HTTPException(404, "Empresa no encontrada.")
    return empresa


async def _maybe_send_whatsapp_alert(empresa: Empresa, nuevas: list, db: Session):
    """Envía alerta WhatsApp si el usuario la tiene activa y aplica al nivel elegido."""
    cfg = db.query(Configuracion).filter(Configuracion.user_id == empresa.user_id).first()
    if not cfg or not cfg.whatsapp_activo or not cfg.whatsapp_numero or not cfg.whatsapp_apikey:
        return
    mensaje = build_alert_message(
        empresa.alias or empresa.razon_social, empresa.ruc, nuevas, cfg.whatsapp_nivel
    )
    if not mensaje:
        return  # nivel "urgentes" pero no hay urgentes nuevas
    await send_whatsapp(cfg.whatsapp_numero, cfg.whatsapp_apikey, mensaje)


# ── Sincronización del buzón de una empresa ──────────────────────────────────
async def sync_empresa_core(empresa: Empresa, db: Session, want_ai: bool = True) -> dict:
    """Lógica central de sincronización. Reutilizada por el endpoint y el scheduler."""
    try:
        sol_password = decrypt_secret(empresa.sol_password_enc)
    except Exception:
        return {"success": False, "empresa_id": empresa.id, "notifications": [],
                "error": "No se pudo descifrar las credenciales.", "error_type": "decrypt_error"}

    result = await scrape_with_playwright(empresa.ruc, empresa.sol_usuario, sol_password)

    if not result.get("success"):
        empresa.estado = "error"
        db.commit()
        return {
            "success": False, "empresa_id": empresa.id,
            "error": result.get("error", "No se pudo conectar a SUNAT."),
            "error_type": result.get("error_type", "sunat_no_disponible"),
            "notifications": [],
        }

    if result.get("razon_social") and not empresa.razon_social:
        empresa.razon_social = result["razon_social"][:300]

    _sunat_sessions[empresa.id] = {
        "cookies": result.get("cookies", []),
        "buzon_url": result.get("buzon_url", ""),
        "ts": datetime.utcnow(),
    }

    new_count = 0
    nuevas = []  # notificaciones recién agregadas (para alertas WhatsApp)
    for n in result["notifications"]:
        existing = db.query(Notification).filter(Notification.id == n["id"]).first()
        if not existing:
            date_val = datetime.utcnow()
            if n.get("date_received"):
                try:
                    date_val = datetime.fromisoformat(n["date_received"])
                except Exception:
                    pass
            db.add(Notification(
                id=n["id"], empresa_id=empresa.id, ruc=empresa.ruc,
                subject=n.get("subject", ""), sender=n.get("sender", "SUNAT"),
                date_received=date_val, reference_number=n.get("reference_number", ""),
                status=n.get("status", "nuevo"), body_text=n.get("body_text", ""),
                category=n.get("category", ""),
                has_attachment=n.get("has_attachment", False),
                attachment_name=n.get("attachment_name", ""),
                is_urgent=n.get("is_urgent", False),
            ))
            new_count += 1
            nuevas.append(n)

    empresa.estado = "activa"
    empresa.last_login = datetime.utcnow()
    empresa.last_sync = datetime.utcnow()
    db.add(SyncLog(ruc=empresa.ruc, empresa_id=empresa.id, status="ok", count_new=new_count))
    db.commit()

    # Alerta por WhatsApp si el usuario la tiene activa y hay notificaciones nuevas
    if nuevas:
        try:
            await _maybe_send_whatsapp_alert(empresa, nuevas, db)
        except Exception as e:
            print(f"[whatsapp] error: {str(e)[:120]}")

    ai_summary = await generate_ai_summary_expert(result["notifications"]) if want_ai else ""

    return {
        "success": True,
        "empresa_id": empresa.id,
        "razon_social": empresa.razon_social,
        "new_count": new_count,
        "total": len(result["notifications"]),
        "notifications": result["notifications"],
        "ai_summary": ai_summary,
        "synced_at": datetime.utcnow().isoformat(),
    }


@app.post("/api/empresas/{empresa_id}/sync")
async def sync_empresa(
    empresa_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa = _get_owned_empresa(empresa_id, user, db)
    return await sync_empresa_core(empresa, db, want_ai=True)


@app.post("/api/empresas/{empresa_id}/sync-ruc")
async def sync_ruc(
    empresa_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Consulta los datos públicos del RUC (estado, condición, dirección...) y los guarda."""
    empresa = _get_owned_empresa(empresa_id, user, db)
    info = await lookup_ruc(empresa.ruc)
    if not info.get("success"):
        raise HTTPException(503, info.get("error", "No se pudo consultar el RUC en este momento."))

    if info.get("razon_social"):
        empresa.razon_social = info["razon_social"][:300]
    empresa.estado_ruc = (info.get("estado") or "")[:40]
    empresa.condicion = (info.get("condicion") or "")[:40]
    empresa.tipo_contrib = (info.get("tipo") or "")[:120]
    empresa.actividad_economica = (info.get("actividad_economica") or "")[:300]
    empresa.direccion = (info.get("direccion") or "")[:400]
    empresa.ubicacion = (info.get("ubicacion") or "")[:200]
    empresa.ruc_sync_at = datetime.utcnow()
    db.commit()
    db.refresh(empresa)
    return {"success": True, "empresa": _empresa_dict(empresa)}


@app.get("/api/empresas/{empresa_id}/vencimientos")
async def empresa_vencimientos(
    empresa_id: int,
    year: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cronograma oficial SUNAT (declaración) + vencimiento SIRE para la empresa."""
    empresa = _get_owned_empresa(empresa_id, user, db)
    anio = year or datetime.utcnow().year
    data = await get_vencimientos(empresa.ruc, anio, db)
    data["ruc"] = empresa.ruc
    data["razon_social"] = empresa.razon_social
    return data


# ── Agenda Tributaria: Obligaciones ──────────────────────────────────────────
def _empresa_nombre_map(user: User, db: Session) -> dict:
    return {
        e.id: (e.alias or e.razon_social or f"RUC {e.ruc}")
        for e in db.query(Empresa).filter(Empresa.user_id == user.id).all()
    }


@app.get("/api/obligaciones")
async def list_obligaciones(
    empresa_id: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Obligacion).filter(Obligacion.user_id == user.id)
    if empresa_id:
        q = q.filter(Obligacion.empresa_id == empresa_id)
    obligaciones = q.order_by(Obligacion.fecha_vencimiento).all()
    nombres = _empresa_nombre_map(user, db)
    return {
        "obligaciones": [obligacion_dict(o, nombres.get(o.empresa_id, "")) for o in obligaciones],
        "estados": [{"key": k, "label": ESTADOS_LABEL[k]} for k in ESTADOS],
    }


@app.post("/api/empresas/{empresa_id}/obligaciones/generar")
async def generar_obligaciones(
    empresa_id: int,
    year: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa = _get_owned_empresa(empresa_id, user, db)
    anio = year or datetime.utcnow().year
    return await generar_desde_cronograma(empresa, anio, db)


@app.post("/api/obligaciones")
async def create_obligacion(
    req: ObligacionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not req.titulo.strip():
        raise HTTPException(400, "El título es obligatorio.")
    try:
        fv = datetime.fromisoformat(req.fecha_vencimiento)
    except Exception:
        raise HTTPException(400, "Fecha de vencimiento inválida (use YYYY-MM-DD).")
    if req.empresa_id:
        _get_owned_empresa(req.empresa_id, user, db)

    o = Obligacion(
        user_id=user.id, empresa_id=req.empresa_id, clave=f"man-{uuid.uuid4().hex[:16]}",
        tipo=req.tipo, titulo=req.titulo.strip(), descripcion=(req.descripcion or "").strip(),
        periodo=(req.periodo or "").strip(), fecha_vencimiento=fv,
        estado="pendiente", prioridad=req.prioridad if req.prioridad in ("alta", "media", "baja") else "media",
        responsable=(req.responsable or "").strip(), monto=(req.monto or "").strip(),
        origen="manual",
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    log_actividad(db, o.id, f"Obligación creada ({o.origen})", autor=user.nombre or user.username)
    db.commit()
    nombres = _empresa_nombre_map(user, db)
    return {"success": True, "obligacion": obligacion_dict(o, nombres.get(o.empresa_id, ""))}


@app.patch("/api/obligaciones/{obligacion_id}")
async def update_obligacion(
    obligacion_id: int,
    req: ObligacionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    o = db.query(Obligacion).filter(
        Obligacion.id == obligacion_id, Obligacion.user_id == user.id
    ).first()
    if not o:
        raise HTTPException(404, "Obligación no encontrada.")

    autor = user.nombre or user.username
    if req.estado is not None:
        if req.estado not in ESTADOS:
            raise HTTPException(400, "Estado inválido.")
        if req.estado != o.estado:
            log_actividad(db, o.id, f"Estado: {ESTADOS_LABEL.get(o.estado, o.estado)} → {ESTADOS_LABEL.get(req.estado, req.estado)}", autor)
        o.estado = req.estado
        o.completed_at = datetime.utcnow() if req.estado in ("pagado", "declarado", "archivado") else None
    if req.prioridad is not None and req.prioridad in ("alta", "media", "baja"):
        o.prioridad = req.prioridad
    if req.titulo is not None:
        o.titulo = req.titulo.strip()
    if req.descripcion is not None:
        o.descripcion = req.descripcion.strip()
    if req.responsable is not None:
        o.responsable = req.responsable.strip()
    if req.monto is not None:
        o.monto = req.monto.strip()
    if req.observaciones is not None:
        o.observaciones = req.observaciones
    if req.checklist is not None:
        limpio = [{"texto": str(i.get("texto", "")).strip(), "done": bool(i.get("done"))}
                  for i in req.checklist if str(i.get("texto", "")).strip()]
        o.checklist = json.dumps(limpio, ensure_ascii=False)
    if req.fecha_vencimiento:
        try:
            o.fecha_vencimiento = datetime.fromisoformat(req.fecha_vencimiento)
        except Exception:
            raise HTTPException(400, "Fecha inválida.")
    o.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(o)
    nombres = _empresa_nombre_map(user, db)
    return {"success": True, "obligacion": obligacion_dict(o, nombres.get(o.empresa_id, ""))}


@app.delete("/api/obligaciones/{obligacion_id}")
async def delete_obligacion(
    obligacion_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    o = db.query(Obligacion).filter(
        Obligacion.id == obligacion_id, Obligacion.user_id == user.id
    ).first()
    if not o:
        raise HTTPException(404, "Obligación no encontrada.")
    db.query(ObligacionEvento).filter(ObligacionEvento.obligacion_id == o.id).delete()
    db.delete(o)
    db.commit()
    return {"success": True}


# ── Página tipo Notion: detalle, comentarios, archivos, chat ─────────────────
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads")


def _get_owned_obligacion(obligacion_id: int, user: User, db: Session) -> Obligacion:
    o = db.query(Obligacion).filter(
        Obligacion.id == obligacion_id, Obligacion.user_id == user.id
    ).first()
    if not o:
        raise HTTPException(404, "Obligación no encontrada.")
    return o


@app.get("/api/obligaciones/{obligacion_id}/detalle")
async def obligacion_detalle(
    obligacion_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    o = _get_owned_obligacion(obligacion_id, user, db)
    nombres = _empresa_nombre_map(user, db)
    eventos = (
        db.query(ObligacionEvento)
        .filter(ObligacionEvento.obligacion_id == o.id)
        .order_by(ObligacionEvento.created_at.desc())
        .all()
    )
    return {
        "obligacion": obligacion_dict(o, nombres.get(o.empresa_id, "")),
        "comentarios": [evento_dict(e) for e in eventos if e.tipo == "comentario"],
        "actividad": [evento_dict(e) for e in eventos if e.tipo == "actividad"],
        "archivos": [evento_dict(e) for e in eventos if e.tipo == "archivo"],
    }


@app.post("/api/obligaciones/{obligacion_id}/comentario")
async def add_comentario(
    obligacion_id: int,
    req: ComentarioReq,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    o = _get_owned_obligacion(obligacion_id, user, db)
    if not req.texto.strip():
        raise HTTPException(400, "El comentario no puede estar vacío.")
    e = ObligacionEvento(obligacion_id=o.id, tipo="comentario",
                         texto=req.texto.strip(), autor=user.nombre or user.username)
    db.add(e)
    db.commit()
    db.refresh(e)
    return {"success": True, "comentario": evento_dict(e)}


@app.post("/api/obligaciones/{obligacion_id}/archivo")
async def upload_archivo(
    obligacion_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    o = _get_owned_obligacion(obligacion_id, user, db)
    contenido = await file.read()
    if len(contenido) > 15 * 1024 * 1024:
        raise HTTPException(413, "El archivo supera los 15 MB.")
    carpeta = os.path.join(UPLOAD_DIR, str(o.id))
    try:
        os.makedirs(carpeta, exist_ok=True)
        nombre = (file.filename or "archivo")[:200]
        ruta = os.path.join(carpeta, f"{uuid.uuid4().hex[:8]}_{nombre}")
        with open(ruta, "wb") as f:
            f.write(contenido)
    except Exception as e:
        raise HTTPException(500, f"No se pudo guardar el archivo: {str(e)[:120]}")
    ev = ObligacionEvento(obligacion_id=o.id, tipo="archivo", texto=nombre,
                          autor=user.nombre or user.username,
                          archivo_nombre=nombre, archivo_path=ruta)
    db.add(ev)
    log_actividad(db, o.id, f"Adjuntó archivo: {nombre}", user.nombre or user.username)
    db.commit()
    db.refresh(ev)
    return {"success": True, "archivo": evento_dict(ev)}


@app.get("/api/obligaciones/{obligacion_id}/archivo/{evento_id}")
async def download_archivo(
    obligacion_id: int,
    evento_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_obligacion(obligacion_id, user, db)
    ev = db.query(ObligacionEvento).filter(
        ObligacionEvento.id == evento_id,
        ObligacionEvento.obligacion_id == obligacion_id,
        ObligacionEvento.tipo == "archivo",
    ).first()
    if not ev or not ev.archivo_path or not os.path.exists(ev.archivo_path):
        raise HTTPException(404, "Archivo no encontrado.")
    with open(ev.archivo_path, "rb") as f:
        data = f.read()
    return StreamingResponse(
        iter([data]),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{ev.archivo_nombre}"'},
    )


@app.post("/api/obligaciones/{obligacion_id}/chat")
async def chat_obligacion_endpoint(
    obligacion_id: int,
    req: ChatReq,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    o = _get_owned_obligacion(obligacion_id, user, db)
    if not req.pregunta.strip():
        raise HTTPException(400, "Escribe una pregunta.")
    nombres = _empresa_nombre_map(user, db)
    respuesta = await chat_obligacion(o, nombres.get(o.empresa_id, ""), req.pregunta.strip(), req.historial)
    return {"success": True, "respuesta": respuesta}


# ── IA de Documentos (Fase 3) ────────────────────────────────────────────────
_MIME_OK = {"application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"}


@app.post("/api/documentos/analizar")
async def analizar_doc(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """OCR + extracción con IA de un comprobante; devuelve datos + obligación sugerida."""
    contenido = await file.read()
    if len(contenido) > 12 * 1024 * 1024:
        raise HTTPException(413, "El archivo supera los 12 MB.")

    mime = (file.content_type or "").lower()
    if mime not in _MIME_OK:
        name = (file.filename or "").lower()
        if name.endswith(".pdf"):
            mime = "application/pdf"
        elif name.endswith((".jpg", ".jpeg")):
            mime = "image/jpeg"
        elif name.endswith(".png"):
            mime = "image/png"
        else:
            raise HTTPException(400, "Formato no soportado. Sube PDF, JPG o PNG.")

    result = await analizar_documento(contenido, mime)
    if not result.get("success"):
        raise HTTPException(502, result.get("error", "No se pudo analizar el documento."))
    return result


@app.get("/api/empresas/{empresa_id}/notifications")
async def empresa_notifications(
    empresa_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_empresa(empresa_id, user, db)
    notifs = (
        db.query(Notification)
        .filter(Notification.empresa_id == empresa_id)
        .order_by(Notification.date_received.desc())
        .all()
    )
    return {
        "count": len(notifs),
        "notifications": [
            {
                "id": n.id, "subject": n.subject, "sender": n.sender,
                "date_received": n.date_received.isoformat() if n.date_received else None,
                "reference_number": n.reference_number, "status": n.status,
                "body_text": n.body_text, "category": n.category,
                "has_attachment": n.has_attachment, "attachment_name": n.attachment_name,
                "is_urgent": n.is_urgent,
            }
            for n in notifs
        ],
    }


# ── Descarga de PDF ──────────────────────────────────────────────────────────
@app.get("/api/empresas/{empresa_id}/notifications/{notif_id}/pdf")
async def download_pdf(
    empresa_id: int,
    notif_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa = _get_owned_empresa(empresa_id, user, db)
    sess = _sunat_sessions.get(empresa_id)
    if not sess or not sess.get("cookies"):
        raise HTTPException(503, "Sesión SUNAT no disponible. Sincroniza la empresa primero.")

    sunat_msg_id = notif_id.split("-")[-1]
    if not sunat_msg_id.isdigit():
        raise HTTPException(404, "No se pudo identificar el adjunto.")

    result = await download_pdf_with_cookies(
        sess["cookies"], empresa.ruc, sunat_msg_id, sess.get("buzon_url", "")
    )
    if not result.get("success"):
        raise HTTPException(503, result.get("error", "No se pudo descargar el PDF."))

    filename = result.get("filename") or f"sunat_{sunat_msg_id}.pdf"
    return StreamingResponse(
        iter([result["data"]]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Programación de extracción automática ────────────────────────────────────
def _prog_dict(p: Programacion) -> dict:
    return {
        "activo": p.activo,
        "frecuencia": p.frecuencia,
        "hora_inicio": p.hora_inicio,
        "repetir_cada": p.repetir_cada,
        "zona_horaria": p.zona_horaria,
        "correo_envio": p.correo_envio or "",
        "fuente_sol": p.fuente_sol,
        "fuente_sunafil": p.fuente_sunafil,
        "last_run": p.last_run.isoformat() if p.last_run else None,
        "next_run": p.next_run.isoformat() if p.next_run else None,
    }


@app.get("/api/programacion")
async def get_programacion(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    prog = db.query(Programacion).filter(Programacion.user_id == user.id).first()
    if not prog:
        return {"programacion": {
            "activo": False, "frecuencia": "cada_x_horas", "hora_inicio": "08:00",
            "repetir_cada": 6, "zona_horaria": "America/Lima", "correo_envio": "",
            "fuente_sol": True, "fuente_sunafil": False, "last_run": None, "next_run": None,
        }}
    return {"programacion": _prog_dict(prog)}


@app.put("/api/programacion")
async def save_programacion(
    req: ProgramacionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repetir = max(1, int(req.repetir_cada or 6))
    prog = db.query(Programacion).filter(Programacion.user_id == user.id).first()
    if not prog:
        prog = Programacion(user_id=user.id)
        db.add(prog)

    prog.activo = req.activo
    prog.frecuencia = req.frecuencia
    prog.hora_inicio = req.hora_inicio
    prog.repetir_cada = repetir
    prog.zona_horaria = req.zona_horaria
    prog.correo_envio = (req.correo_envio or "").strip()
    prog.fuente_sol = req.fuente_sol
    prog.fuente_sunafil = req.fuente_sunafil
    prog.updated_at = datetime.utcnow()
    prog.next_run = compute_next_run(req.hora_inicio, repetir, req.zona_horaria) if req.activo else None
    db.commit()
    db.refresh(prog)
    return {"success": True, "programacion": _prog_dict(prog)}


@app.post("/api/cron/tick")
async def cron_tick(token: str = ""):
    """Dispara extracciones vencidas + recordatorios. Protegido por token (cron externo)."""
    if token != CRON_TOKEN:
        raise HTTPException(403, "Token inválido.")
    extracciones = await run_due_schedules()
    recordatorios = await run_recordatorios()
    return {"extracciones": extracciones, "recordatorios": recordatorios}


# ── Configuración (alertas WhatsApp) ─────────────────────────────────────────
def _config_dict(c: Configuracion) -> dict:
    return {
        "whatsapp_activo": c.whatsapp_activo,
        "whatsapp_numero": c.whatsapp_numero or "",
        "whatsapp_apikey": c.whatsapp_apikey or "",
        "whatsapp_nivel": c.whatsapp_nivel or "urgentes",
        "recordatorios_activo": bool(c.recordatorios_activo),
        "recordatorio_dias": c.recordatorio_dias or "7,3,1,0",
        "recordatorio_wsp": c.recordatorio_wsp if c.recordatorio_wsp is not None else True,
        "recordatorio_email": bool(c.recordatorio_email),
        "recordatorio_email_dest": c.recordatorio_email_dest or "",
    }


_CONFIG_DEFAULT = {
    "whatsapp_activo": False, "whatsapp_numero": "", "whatsapp_apikey": "",
    "whatsapp_nivel": "urgentes", "recordatorios_activo": False,
    "recordatorio_dias": "7,3,1,0", "recordatorio_wsp": True,
    "recordatorio_email": False, "recordatorio_email_dest": "",
}


@app.get("/api/configuracion")
async def get_configuracion(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = db.query(Configuracion).filter(Configuracion.user_id == user.id).first()
    if not cfg:
        return {"configuracion": dict(_CONFIG_DEFAULT)}
    return {"configuracion": _config_dict(cfg)}


@app.put("/api/configuracion")
async def save_configuracion(
    req: ConfiguracionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cfg = db.query(Configuracion).filter(Configuracion.user_id == user.id).first()
    if not cfg:
        cfg = Configuracion(user_id=user.id)
        db.add(cfg)
    cfg.whatsapp_activo = req.whatsapp_activo
    cfg.whatsapp_numero = (req.whatsapp_numero or "").strip()
    cfg.whatsapp_apikey = (req.whatsapp_apikey or "").strip()
    cfg.whatsapp_nivel = req.whatsapp_nivel if req.whatsapp_nivel in ("urgentes", "todas") else "urgentes"
    cfg.recordatorios_activo = req.recordatorios_activo
    cfg.recordatorio_dias = (req.recordatorio_dias or "7,3,1,0").strip()
    cfg.recordatorio_wsp = req.recordatorio_wsp
    cfg.recordatorio_email = req.recordatorio_email
    cfg.recordatorio_email_dest = (req.recordatorio_email_dest or "").strip()
    cfg.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(cfg)
    return {"success": True, "configuracion": _config_dict(cfg)}


@app.post("/api/configuracion/test-whatsapp")
async def test_whatsapp(
    req: TestWhatsappRequest,
    user: User = Depends(get_current_user),
):
    msg = (
        "✅ *Dashbot* - Mensaje de prueba\n\n"
        "¡Tus alertas por WhatsApp están funcionando! "
        "Aquí recibirás avisos de notificaciones nuevas de SUNAT."
    )
    result = await send_whatsapp(req.whatsapp_numero, req.whatsapp_apikey, msg)
    if not result.get("success"):
        raise HTTPException(400, result.get("error", "No se pudo enviar el WhatsApp de prueba."))
    return {"success": True, "message": "Mensaje de prueba enviado. Revisa tu WhatsApp."}


# ── IA: interpretar una notificación ─────────────────────────────────────────
@app.post("/api/interpret")
async def interpret(req: InterpretRequest, user: User = Depends(get_current_user)):
    interpretation = await generate_notification_interpretation(req.notification)
    return {"success": True, "interpretation": interpretation}


# ── Envío de resumen por correo ──────────────────────────────────────────────
@app.post("/api/empresas/{empresa_id}/send-email")
async def send_email(
    empresa_id: int,
    req: EmailRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa = _get_owned_empresa(empresa_id, user, db)
    notifs = (
        db.query(Notification)
        .filter(Notification.empresa_id == empresa_id)
        .order_by(Notification.date_received.desc())
        .limit(50)
        .all()
    )
    notif_dicts = [
        {
            "subject": n.subject,
            "date_received": n.date_received.isoformat() if n.date_received else "",
            "reference_number": n.reference_number,
            "has_attachment": n.has_attachment,
            "is_urgent": n.is_urgent,
        }
        for n in notifs
    ]
    result = await send_email_summary(req.to_email, notif_dicts, empresa.ruc)
    if not result["success"]:
        raise HTTPException(500, f"Error al enviar correo: {result.get('error')}")
    return {"success": True, "message": f"Resumen enviado a {req.to_email}"}


# ── Modo DEMO (sin autenticación) ────────────────────────────────────────────
@app.post("/api/demo/sync")
async def demo_sync():
    result = await get_demo_notifications("20603448308")
    ai_summary = await generate_ai_summary_expert(result["notifications"])
    return {
        "success": True,
        "razon_social": "EMPRESA DEMO S.A.C.",
        "new_count": len(result["notifications"]),
        "total": len(result["notifications"]),
        "notifications": result["notifications"],
        "ai_summary": ai_summary,
        "synced_at": datetime.utcnow().isoformat(),
        "is_demo": True,
    }
