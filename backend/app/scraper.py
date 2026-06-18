"""
Scraper de buzón SUNAT usando httpx (sin Playwright).
Accede al portal SOL via HTTP con sesión de cookies.
"""
import asyncio
import re
import uuid
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup


SUNAT_SOL_BASE = "https://api-sol.sunat.gob.pe"
SUNAT_WEB_BASE = "https://www.sunat.gob.pe"

URGENT_KEYWORDS = [
    "multa", "infracción", "cobranza coactiva", "embargo", "sanción",
    "baja", "cierre", "fiscalización", "requerimiento", "deuda",
    "vencimiento", "plazo", "urgente", "citación",
]


def _is_urgent(subject: str) -> bool:
    subject_lower = subject.lower()
    return any(kw in subject_lower for kw in URGENT_KEYWORDS)


async def scrape_sunat_notifications(ruc: str, usuario: str, password: str) -> dict:
    """
    Intenta acceder al buzón SUNAT vía HTTP.
    Si falla, retorna datos demo indicando el motivo.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "es-PE,es;q=0.9",
        "Origin": "https://www.sunat.gob.pe",
        "Referer": "https://www.sunat.gob.pe/sol.html",
    }

    try:
        async with httpx.AsyncClient(
            headers=headers,
            follow_redirects=True,
            timeout=30.0,
            verify=False,
        ) as client:
            # Intentar login via API SOL
            login_resp = await client.post(
                f"{SUNAT_SOL_BASE}/v1/clientesol/login",
                json={"numRuc": ruc, "usuario": usuario, "acceso": password},
            )

            if login_resp.status_code == 200:
                data = login_resp.json()
                token = data.get("token") or data.get("access_token")
                if token:
                    return await _fetch_buzon_with_token(client, token, ruc)

            # Intentar login web clásico
            return await _try_web_login(client, ruc, usuario, password)

    except Exception as e:
        return {
            "success": False,
            "notifications": [],
            "error": f"No se pudo conectar a SUNAT: {str(e)[:200]}",
        }


async def _fetch_buzon_with_token(client: httpx.AsyncClient, token: str, ruc: str) -> dict:
    """Obtiene notificaciones usando token JWT de SOL."""
    try:
        resp = await client.get(
            f"{SUNAT_SOL_BASE}/v1/buzon/notificaciones",
            headers={"Authorization": f"Bearer {token}"},
            params={"numRuc": ruc, "estado": "0"},
        )
        if resp.status_code == 200:
            data = resp.json()
            notifs = _parse_api_notifications(data, ruc)
            return {"success": True, "notifications": notifs, "error": None}
    except Exception:
        pass
    return {"success": False, "notifications": [], "error": "No se pudo obtener notificaciones"}


async def _try_web_login(client: httpx.AsyncClient, ruc: str, usuario: str, password: str) -> dict:
    """Intenta login en el portal web de SUNAT."""
    try:
        # GET login page para obtener cookies/tokens CSRF
        await client.get(f"{SUNAT_WEB_BASE}/sol.html")

        # POST credenciales
        resp = await client.post(
            f"{SUNAT_WEB_BASE}/ol-ti-itconsultaunificadalibre/consultaUnificadaLibre/action/cargarFichaRuc",
            data={"numRuc": ruc, "txtUsuario": usuario, "txtContrasena": password},
        )

        if resp.status_code in (200, 302):
            # Intentar acceder al buzón
            buzon_resp = await client.get(
                f"{SUNAT_WEB_BASE}/ol-ti-itbuzonelectronico/bin/ejecBuzon.do"
            )
            if buzon_resp.status_code == 200:
                notifs = _parse_html_notifications(buzon_resp.text, ruc)
                if notifs:
                    return {"success": True, "notifications": notifs, "error": None}

    except Exception:
        pass

    return {
        "success": False,
        "notifications": [],
        "error": (
            "SUNAT requiere verificación adicional. "
            "Use el modo demo para ver cómo funciona el sistema."
        ),
    }


def _parse_api_notifications(data: dict, ruc: str) -> list:
    """Parsea respuesta JSON de la API de SUNAT."""
    notifications = []
    items = data if isinstance(data, list) else data.get("notificaciones", data.get("data", []))
    for i, item in enumerate(items):
        subject = item.get("asunto") or item.get("subject") or item.get("descripcion") or "Sin asunto"
        date_str = item.get("fechaNotificacion") or item.get("fecha") or ""
        try:
            date_val = datetime.fromisoformat(date_str.replace("/", "-"))
        except Exception:
            date_val = datetime.utcnow()

        notifications.append({
            "id": item.get("id") or item.get("idNotificacion") or f"S-{ruc}-{i}",
            "subject": subject,
            "reference_number": item.get("numeroReferencia") or item.get("referencia") or "",
            "date_received": date_val.isoformat(),
            "sender": item.get("remitente") or "SUNAT",
            "status": "nuevo",
            "body_text": item.get("cuerpo") or item.get("descripcion") or subject,
            "has_attachment": bool(item.get("adjunto") or item.get("urlAdjunto")),
            "attachment_name": item.get("nombreAdjunto") or "",
            "is_urgent": _is_urgent(subject),
        })
    return notifications


def _parse_html_notifications(html: str, ruc: str) -> list:
    """Parsea tabla HTML del buzón SUNAT."""
    notifications = []
    soup = BeautifulSoup(html, "html.parser")

    for i, row in enumerate(soup.find_all("tr")[1:], 1):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue
        texts = [c.get_text(strip=True) for c in cells]
        subject = texts[0] if texts else "Sin asunto"
        if not subject:
            continue

        date_val = datetime.utcnow()
        for text in texts:
            m = re.search(r"\d{2}/\d{2}/\d{4}", text)
            if m:
                try:
                    date_val = datetime.strptime(m.group(), "%d/%m/%Y")
                    break
                except Exception:
                    pass

        has_attachment = bool(row.find("a", href=re.compile(r"pdf|adjunto", re.I)))

        notifications.append({
            "id": f"S-{ruc}-{i}-{hash(subject) & 0xFFFFFF}",
            "subject": subject,
            "reference_number": texts[1] if len(texts) > 1 else "",
            "date_received": date_val.isoformat(),
            "sender": "SUNAT",
            "status": "nuevo",
            "body_text": " | ".join(texts),
            "has_attachment": has_attachment,
            "attachment_name": "adjunto.pdf" if has_attachment else "",
            "is_urgent": _is_urgent(subject),
        })

    return notifications


# ── Datos demo ────────────────────────────────────────────────────────────────
DEMO_NOTIFICATIONS = [
    {
        "id": "SUNAT-DEMO-001",
        "subject": "Comunicación de baja de inscripción de oficio provisional",
        "reference_number": "0730050023836",
        "date_received": "2024-01-15T09:30:00",
        "sender": "SUNAT - Intendencia Lima",
        "status": "nuevo",
        "body_text": (
            "Se le comunica que se ha procedido a dar de baja provisional su inscripción "
            "en el RUC por causal de oficio. Tiene 10 días hábiles para subsanar."
        ),
        "has_attachment": True,
        "attachment_name": "baja_inscripcion_provisional.pdf",
        "is_urgent": True,
    },
    {
        "id": "SUNAT-DEMO-002",
        "subject": "Esquela de citación - Verificación de obligaciones tributarias",
        "reference_number": "0730050023837",
        "date_received": "2024-01-14T11:00:00",
        "sender": "SUNAT - Div. Auditoría",
        "status": "nuevo",
        "body_text": (
            "Se le cita para el día 25/01/2024 a las 10:00 hrs en las oficinas de "
            "SUNAT para verificación de obligaciones tributarias del período 2023."
        ),
        "has_attachment": True,
        "attachment_name": "esquela_citacion.pdf",
        "is_urgent": True,
    },
    {
        "id": "SUNAT-DEMO-003",
        "subject": "Recordatorio de presentación de declaración mensual PDT 621",
        "reference_number": "0730050023838",
        "date_received": "2024-01-10T08:00:00",
        "sender": "SUNAT - Sistema Automático",
        "status": "leido",
        "body_text": (
            "Recuerde que el plazo para presentar su declaración mensual PDT 621 "
            "correspondiente a diciembre 2023 vence el 22/01/2024."
        ),
        "has_attachment": False,
        "attachment_name": "",
        "is_urgent": False,
    },
]


async def get_demo_notifications(ruc: str) -> dict:
    """Retorna datos de demostración."""
    notifs = [dict(n, ruc=ruc) for n in DEMO_NOTIFICATIONS]
    return {"success": True, "notifications": notifs, "error": None, "demo": True}
