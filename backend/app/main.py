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
from fastapi.responses import FileResponse, StreamingResponse
import httpx
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from dotenv import load_dotenv

load_dotenv()

from app.database import get_db, init_db, Notification, SyncLog
from app.scraper import scrape_sunat_notifications, get_demo_notifications
from app.playwright_scraper import scrape_with_playwright
from app.email_service import send_email_summary
from app.ai_summary import generate_ai_summary, generate_ai_summary_expert, generate_notification_interpretation

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


class InterpretRequest(BaseModel):
    session_id: str
    notification: dict


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
        # 1. Intentar con Playwright (navegador real)
        result = await scrape_with_playwright(
            ruc, session["usuario"], session["password"]
        )
        # 2. Si Playwright falla, intentar con httpx como fallback
        if not result["success"] and result.get("error_type") in ("playwright_not_installed", "browser_error"):
            result = await scrape_sunat_notifications(
                ruc, session["usuario"], session["password"]
            )

        if not result["success"]:
            error_type = result.get("error_type", "sunat_no_disponible")
            return {
                "success": False,
                "ruc": ruc,
                "new_count": 0,
                "total": 0,
                "notifications": [],
                "ai_summary": "",
                "synced_at": datetime.utcnow().isoformat(),
                "is_demo": False,
                "error": result.get("error", "No se pudo conectar a SUNAT."),
                "error_type": error_type,
            }

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

    # Generar resumen IA experto
    ai_summary = await generate_ai_summary_expert(result["notifications"])

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


@app.post("/api/interpret")
async def interpret_notification(req: InterpretRequest):
    """Interpreta una notificación SUNAT con IA."""
    session = _sessions.get(req.session_id)
    if not session:
        raise HTTPException(401, "Sesión no válida.")
    interpretation = await generate_notification_interpretation(req.notification)
    return {"success": True, "interpretation": interpretation}


@app.get("/api/notifications/{notif_id}/pdf")
async def download_pdf(notif_id: str, session_id: str, db: Session = Depends(get_db)):
    """Descarga el PDF adjunto de una notificación SUNAT."""
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(401, "Sesión no válida.")

    notif = db.query(Notification).filter(Notification.id == notif_id).first()
    if not notif:
        raise HTTPException(404, "Notificación no encontrada.")
    if not notif.has_attachment:
        raise HTTPException(404, "Esta notificación no tiene adjunto.")

    # Modo demo: no hay PDF real disponible
    if session.get("demo_mode") or notif_id.startswith("SUNAT-DEMO"):
        raise HTTPException(
            404,
            "PDF disponible solo con conexión real a SUNAT. "
            "Ingresa con tus credenciales SOL para descargar adjuntos."
        )

    # Intentar descargar el PDF de SUNAT usando la sesión activa
    # El ID de SUNAT generalmente está en el formato S-RUC-N
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            # Construir URL de descarga de SUNAT
            pdf_url = (
                f"https://www.sunat.gob.pe/ol-ti-itbuzonelectronico/bin/"
                f"descargarAdjunto.do?idNotificacion={notif_id}"
            )
            resp = await client.get(
                pdf_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
                    "Referer": "https://www.sunat.gob.pe/sol.html",
                },
            )
            if resp.status_code == 200 and b"PDF" in resp.content[:8]:
                filename = notif.attachment_name or f"sunat_{notif_id}.pdf"
                return StreamingResponse(
                    iter([resp.content]),
                    media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                )
    except Exception:
        pass

    raise HTTPException(
        503,
        "No se pudo descargar el PDF de SUNAT en este momento. "
        "Intenta descargarlo directamente desde el portal SOL."
    )


@app.delete("/api/session/{session_id}")
async def logout(session_id: str):
    """Elimina sesión y borra credenciales de memoria."""
    _sessions.pop(session_id, None)
    return {"success": True}
