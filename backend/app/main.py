"""
BOT SUNAT / Dashbot - Backend API
Plataforma multiempresa: usuarios con cuenta propia (JWT) que registran
varias empresas con credenciales SOL cifradas.
"""
import os
import uuid
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from dotenv import load_dotenv

load_dotenv()

import asyncio
from app.database import get_db, init_db, User, Empresa, Notification, SyncLog, Programacion, Configuracion
from app.auth import (
    hash_password, verify_password, create_token, get_current_user,
    encrypt_secret, decrypt_secret,
)
from app.ruc_lookup import lookup_ruc
from app.scraper import get_demo_notifications
from app.playwright_scraper import scrape_with_playwright, download_pdf_with_cookies
from app.email_service import send_email_summary
from app.ai_summary import (
    generate_ai_summary_expert, generate_notification_interpretation,
)
from app.scheduler import schedule_loop, run_due_schedules, compute_next_run
from app.whatsapp_service import send_whatsapp, build_alert_message

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


class TestWhatsappRequest(BaseModel):
    whatsapp_numero: str
    whatsapp_apikey: str


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
    """Dispara las extracciones vencidas. Protegido por token (para cron externo)."""
    if token != CRON_TOKEN:
        raise HTTPException(403, "Token inválido.")
    return await run_due_schedules()


# ── Configuración (alertas WhatsApp) ─────────────────────────────────────────
def _config_dict(c: Configuracion) -> dict:
    return {
        "whatsapp_activo": c.whatsapp_activo,
        "whatsapp_numero": c.whatsapp_numero or "",
        "whatsapp_apikey": c.whatsapp_apikey or "",
        "whatsapp_nivel": c.whatsapp_nivel or "urgentes",
    }


@app.get("/api/configuracion")
async def get_configuracion(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = db.query(Configuracion).filter(Configuracion.user_id == user.id).first()
    if not cfg:
        return {"configuracion": {
            "whatsapp_activo": False, "whatsapp_numero": "",
            "whatsapp_apikey": "", "whatsapp_nivel": "urgentes",
        }}
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
