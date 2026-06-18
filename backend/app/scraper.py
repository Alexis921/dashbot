"""
Scraper de buzón SUNAT usando Playwright.
Navega el portal SOL (Operaciones en Línea) y extrae notificaciones.
"""
import asyncio
import base64
import re
from datetime import datetime
from typing import Optional
from playwright.async_api import async_playwright, TimeoutError as PwTimeout


SUNAT_LOGIN_URL = "https://www.sunat.gob.pe/sol.html"
BUZON_URL = "https://www.sunat.gob.pe/ol-ti-itbuzonelectronico/bin/ejecBuzon.do"

URGENT_KEYWORDS = [
    "multa", "infracción", "cobranza coactiva", "embargo", "sanción",
    "baja", "cierre", "fiscalización", "requerimiento", "notificación de deuda",
    "vencimiento", "plazo", "urgente"
]


def _is_urgent(subject: str) -> bool:
    subject_lower = subject.lower()
    return any(kw in subject_lower for kw in URGENT_KEYWORDS)


async def scrape_sunat_notifications(ruc: str, usuario: str, password: str) -> dict:
    """
    Accede al buzón SUNAT y retorna lista de notificaciones.
    Returns: {"success": bool, "notifications": [...], "error": str|None}
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"]
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800}
        )
        page = await context.new_page()

        try:
            # ── 1. Login en SOL ──────────────────────────────────────────────
            await page.goto(SUNAT_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)

            # Rellenar formulario de login
            await _fill_login_form(page, ruc, usuario, password)

            # ── 2. Esperar redirección post-login ────────────────────────────
            await page.wait_for_load_state("networkidle", timeout=20000)
            await asyncio.sleep(2)

            # Verificar login exitoso
            if "error" in page.url.lower() or "autenticar" in page.url.lower():
                return {"success": False, "notifications": [], "error": "Credenciales incorrectas"}

            # ── 3. Navegar al Buzón ──────────────────────────────────────────
            notifications = await _navigate_to_buzon(page, context)

            await browser.close()
            return {"success": True, "notifications": notifications, "error": None}

        except PwTimeout:
            await browser.close()
            return {"success": False, "notifications": [], "error": "Tiempo de espera agotado. SUNAT puede estar lento."}
        except Exception as e:
            await browser.close()
            return {"success": False, "notifications": [], "error": str(e)}


async def _fill_login_form(page, ruc: str, usuario: str, password: str):
    """Rellena el formulario de login de SUNAT SOL."""
    # Intentar múltiples selectores según versión del portal
    selectors = {
        "ruc": ["#txtRuc", "input[name='txtRuc']", "input[id*='ruc' i]", "#numRuc"],
        "usuario": ["#txtUsuario", "input[name='txtUsuario']", "input[id*='usuario' i]"],
        "password": ["#txtContrasena", "input[type='password']", "input[name='txtContrasena']"],
        "submit": ["#btnAceptar", "input[type='submit']", "button[type='submit']", "#btnIngresar"]
    }

    for sel in selectors["ruc"]:
        try:
            await page.fill(sel, ruc, timeout=3000)
            break
        except Exception:
            continue

    for sel in selectors["usuario"]:
        try:
            await page.fill(sel, usuario, timeout=3000)
            break
        except Exception:
            continue

    for sel in selectors["password"]:
        try:
            await page.fill(sel, password, timeout=3000)
            break
        except Exception:
            continue

    for sel in selectors["submit"]:
        try:
            await page.click(sel, timeout=3000)
            break
        except Exception:
            continue


async def _navigate_to_buzon(page, context) -> list:
    """Navega al buzón y extrae notificaciones."""
    notifications = []

    # Intentar acceso directo al buzón
    try:
        await page.goto(BUZON_URL, wait_until="domcontentloaded", timeout=20000)
        await asyncio.sleep(3)
    except Exception:
        pass

    # Buscar frames con el buzón
    all_frames = page.frames
    buzon_frame = None

    for frame in all_frames:
        try:
            content = await frame.content()
            if "buzon" in content.lower() or "notificaci" in content.lower():
                buzon_frame = frame
                break
        except Exception:
            continue

    target = buzon_frame if buzon_frame else page

    # Extraer filas de notificaciones
    notifications = await _extract_notifications_from_frame(target)

    # Si no encontró nada, buscar en iframes anidados
    if not notifications:
        for frame in page.frames:
            try:
                rows = await _extract_notifications_from_frame(frame)
                if rows:
                    notifications = rows
                    break
            except Exception:
                continue

    return notifications


async def _extract_notifications_from_frame(frame) -> list:
    """Extrae notificaciones de una tabla en el frame dado."""
    notifications = []

    try:
        # Buscar tabla de notificaciones
        rows = await frame.query_selector_all("table tr")
        if len(rows) < 2:
            return []

        for i, row in enumerate(rows[1:], 1):  # skip header
            try:
                cells = await row.query_selector_all("td")
                if len(cells) < 3:
                    continue

                texts = []
                for cell in cells:
                    t = await cell.inner_text()
                    texts.append(t.strip())

                if not texts[0]:
                    continue

                # Detectar fecha en las celdas
                date_val = None
                subject = ""
                reference = ""

                for text in texts:
                    if re.search(r'\d{2}/\d{2}/\d{4}', text):
                        try:
                            date_val = datetime.strptime(
                                re.search(r'\d{2}/\d{2}/\d{4}', text).group(), "%d/%m/%Y"
                            )
                        except Exception:
                            pass

                subject = texts[0] if texts else "Sin asunto"
                reference = texts[1] if len(texts) > 1 else ""

                # ¿Tiene adjunto?
                attachment_el = await row.query_selector("a[href*='pdf'], a[href*='adjunto'], img[src*='clip']")
                has_attachment = attachment_el is not None
                attachment_name = ""
                if has_attachment and attachment_el:
                    attachment_name = await attachment_el.get_attribute("href") or "adjunto.pdf"

                notif_id = f"SUNAT-{i}-{hash(subject)}"

                notifications.append({
                    "id": notif_id,
                    "subject": subject,
                    "reference_number": reference,
                    "date_received": date_val.isoformat() if date_val else datetime.utcnow().isoformat(),
                    "sender": "SUNAT",
                    "status": "nuevo",
                    "body_text": " | ".join(texts),
                    "has_attachment": has_attachment,
                    "attachment_name": attachment_name,
                    "is_urgent": _is_urgent(subject),
                })

            except Exception:
                continue

    except Exception:
        pass

    return notifications


# ── Datos demo para desarrollo sin conexión real ─────────────────────────────
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
    """Retorna datos de demostración cuando SUNAT no está disponible."""
    notifs = [dict(n, ruc=ruc) for n in DEMO_NOTIFICATIONS]
    return {"success": True, "notifications": notifs, "error": None, "demo": True}
