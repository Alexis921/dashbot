"""
BOT SUNAT - Backend API
FastAPI + Playwright para automatizar el buzón de SUNAT
"""
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from dotenv import load_dotenv

load_dotenv()

from app.database import get_db, init_db, Notification, SyncLog
from app.scraper import scrape_sunat_notifications, get_demo_notifications
from app.email_service import send_email_summary
from app.ai_summary import generate_ai_summary

app = FastAPI(title="BOT SUNAT", version="1.0.0")

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "*"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sesiones en memoria (no persistimos credenciales en DB)
_sessions: dict = {}


# ── Modelos Pydantic ──────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    ruc: str
    usuario: str
    password: str
    demo_mode: bool = False


class SyncRequest(BaseModel):
    session_id: str


class EmailRequest(BaseModel):
    session_id: str
    to_email: str


class MarkReadRequest(BaseModel):
    session_id: str
    notification_ids: List[str]


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    init_db()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.post("/api/login")
async def login(req: LoginRequest):
    """Valida credenciales y crea sesión temporal."""
    if len(req.ruc) != 11 or not req.ruc.isdigit():
        raise HTTPException(400, "RUC inválido. Debe tener 11 dígitos numéricos.")
    if not req.usuario.strip():
        raise HTTPException(400, "Usuario requerido.")
    if not req.password.strip():
        raise HTTPException(400, "Contraseña requerida.")

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "ruc": req.ruc,
        "usuario": req.usuario,
        "password": req.password,
        "demo_mode": req.demo_mode,
        "created_at": datetime.utcnow(),
        "last_sync": None,
    }

    return {
        "session_id": session_id,
        "ruc": req.ruc,
        "message": "Sesión iniciada. Use /api/sync para obtener notificaciones.",
    }


@app.post("/api/sync")
async def sync_notifications(req: SyncRequest, db: Session = Depends(get_db)):
    """Accede al buzón SUNAT y sincroniza notificaciones."""
    session = _sessions.get(req.session_id)
    if not session:
        raise HTTPException(401, "Sesión no válida o expirada.")

    ruc = session["ruc"]

    # Ejecutar scraper
    if session.get("demo_mode"):
        result = await get_demo_notifications(ruc)
    else:
        result = await scrape_sunat_notifications(
            ruc, session["usuario"], session["password"]
        )
        # Si SUNAT no responde, usar demo automáticamente
        if not result["success"]:
            result = await get_demo_notifications(ruc)
            result["fallback"] = True
            result["fallback_reason"] = "SUNAT no disponible en este momento. Mostrando datos de ejemplo."

    # Guardar notificaciones en DB
    new_count = 0
    for n in result["notifications"]:
        existing = db.query(Notification).filter(Notification.id == n["id"]).first()
        if not existing:
            date_val = None
            if n.get("date_received"):
                try:
                    date_val = datetime.fromisoformat(n["date_received"])
                except Exception:
                    date_val = datetime.utcnow()

            notif = Notification(
                id=n["id"],
                ruc=ruc,
                subject=n.get("subject", ""),
                sender=n.get("sender", "SUNAT"),
                date_received=date_val or datetime.utcnow(),
                reference_number=n.get("reference_number", ""),
                status=n.get("status", "nuevo"),
                body_text=n.get("body_text", ""),
                has_attachment=n.get("has_attachment", False),
                attachment_name=n.get("attachment_name", ""),
                is_urgent=n.get("is_urgent", False),
            )
            db.add(notif)
            new_count += 1

    log = SyncLog(ruc=ruc, status="ok", count_new=new_count)
    db.add(log)
    db.commit()

    session["last_sync"] = datetime.utcnow()

    # Generar resumen IA
    ai_summary = await generate_ai_summary(result["notifications"])

    return {
        "success": True,
        "ruc": ruc,
        "new_count": new_count,
        "total": len(result["notifications"]),
        "notifications": result["notifications"],
        "ai_summary": ai_summary,
        "synced_at": datetime.utcnow().isoformat(),
        "is_demo": result.get("demo", False) or result.get("fallback", False),
        "fallback_reason": result.get("fallback_reason"),
    }


@app.get("/api/notifications/{ruc}")
async def get_notifications(ruc: str, db: Session = Depends(get_db)):
    """Retorna notificaciones guardadas para un RUC."""
    notifs = (
        db.query(Notification)
        .filter(Notification.ruc == ruc)
        .order_by(Notification.date_received.desc())
        .all()
    )
    return {
        "ruc": ruc,
        "count": len(notifs),
        "notifications": [
            {
                "id": n.id,
                "subject": n.subject,
                "sender": n.sender,
                "date_received": n.date_received.isoformat() if n.date_received else None,
                "reference_number": n.reference_number,
                "status": n.status,
                "body_text": n.body_text,
                "has_attachment": n.has_attachment,
                "attachment_name": n.attachment_name,
                "is_urgent": n.is_urgent,
                "synced_at": n.synced_at.isoformat() if n.synced_at else None,
            }
            for n in notifs
        ],
    }


@app.post("/api/send-email")
async def send_email(req: EmailRequest, db: Session = Depends(get_db)):
    """Envía resumen por correo electrónico."""
    session = _sessions.get(req.session_id)
    if not session:
        raise HTTPException(401, "Sesión no válida.")

    ruc = session["ruc"]
    notifs = (
        db.query(Notification)
        .filter(Notification.ruc == ruc)
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

    result = await send_email_summary(req.to_email, notif_dicts, ruc)
    if not result["success"]:
        raise HTTPException(500, f"Error al enviar correo: {result.get('error')}")

    return {"success": True, "message": f"Resumen enviado a {req.to_email}"}


@app.post("/api/mark-read")
async def mark_read(req: MarkReadRequest, db: Session = Depends(get_db)):
    """Marca notificaciones como leídas (solo si usuario confirma)."""
    session = _sessions.get(req.session_id)
    if not session:
        raise HTTPException(401, "Sesión no válida.")

    updated = 0
    for notif_id in req.notification_ids:
        notif = db.query(Notification).filter(Notification.id == notif_id).first()
        if notif:
            notif.status = "leido"
            updated += 1

    db.commit()
    return {"success": True, "updated": updated}


@app.get("/api/last-sync/{ruc}")
async def last_sync(ruc: str, db: Session = Depends(get_db)):
    log = (
        db.query(SyncLog)
        .filter(SyncLog.ruc == ruc, SyncLog.status == "ok")
        .order_by(SyncLog.synced_at.desc())
        .first()
    )
    if not log:
        return {"last_sync": None}
    return {"last_sync": log.synced_at.isoformat(), "count_new": log.count_new}


@app.delete("/api/session/{session_id}")
async def logout(session_id: str):
    """Elimina sesión y borra credenciales de memoria."""
    _sessions.pop(session_id, None)
    return {"success": True}
