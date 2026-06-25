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

from app.database import get_db, init_db, User, Empresa, Notification, SyncLog
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


# ── Startup ────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    init_db()


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


# ── Sincronización del buzón de una empresa ──────────────────────────────────
@app.post("/api/empresas/{empresa_id}/sync")
async def sync_empresa(
    empresa_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa = _get_owned_empresa(empresa_id, user, db)

    try:
        sol_password = decrypt_secret(empresa.sol_password_enc)
    except Exception:
        raise HTTPException(500, "No se pudo descifrar las credenciales. Re-registra la empresa.")

    result = await scrape_with_playwright(empresa.ruc, empresa.sol_usuario, sol_password)

    if not result.get("success"):
        empresa.estado = "error"
        db.commit()
        return {
            "success": False,
            "empresa_id": empresa_id,
            "error": result.get("error", "No se pudo conectar a SUNAT."),
            "error_type": result.get("error_type", "sunat_no_disponible"),
            "notifications": [],
        }

    # Confirmar razón social desde SUNAT si la teníamos vacía
    if result.get("razon_social") and not empresa.razon_social:
        empresa.razon_social = result["razon_social"][:300]

    # Guardar cookies de sesión en memoria para descargar PDFs
    _sunat_sessions[empresa_id] = {
        "cookies": result.get("cookies", []),
        "buzon_url": result.get("buzon_url", ""),
        "ts": datetime.utcnow(),
    }

    # Persistir notificaciones
    new_count = 0
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
                id=n["id"], empresa_id=empresa_id, ruc=empresa.ruc,
                subject=n.get("subject", ""), sender=n.get("sender", "SUNAT"),
                date_received=date_val, reference_number=n.get("reference_number", ""),
                status=n.get("status", "nuevo"), body_text=n.get("body_text", ""),
                category=n.get("category", ""),
                has_attachment=n.get("has_attachment", False),
                attachment_name=n.get("attachment_name", ""),
                is_urgent=n.get("is_urgent", False),
            ))
            new_count += 1

    empresa.estado = "activa"
    empresa.last_login = datetime.utcnow()
    empresa.last_sync = datetime.utcnow()
    db.add(SyncLog(ruc=empresa.ruc, empresa_id=empresa_id, status="ok", count_new=new_count))
    db.commit()

    ai_summary = await generate_ai_summary_expert(result["notifications"])

    return {
        "success": True,
        "empresa_id": empresa_id,
        "razon_social": empresa.razon_social,
        "new_count": new_count,
        "total": len(result["notifications"]),
        "notifications": result["notifications"],
        "ai_summary": ai_summary,
        "synced_at": datetime.utcnow().isoformat(),
    }


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
