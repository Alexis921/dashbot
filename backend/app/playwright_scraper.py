"""
Scraper de buzón SUNAT usando Playwright (navegador real Chromium).
Maneja JavaScript, popups y la sesión completa de SOL.
"""
import asyncio
import re
import uuid
from datetime import datetime
from typing import Optional

URGENT_KEYWORDS = [
    "multa", "infracción", "cobranza coactiva", "embargo", "sanción",
    "baja", "cierre", "fiscalización", "requerimiento", "deuda",
    "vencimiento", "plazo", "urgente", "citación", "ejecución coactiva",
    "resolución de determinación", "resolución de multa", "orden de pago",
]

SUNAT_LOGIN_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
SUNAT_SOL_URL   = "https://www.sunat.gob.pe/sol.html"


def _is_urgent(subject: str) -> bool:
    s = subject.lower()
    return any(kw in s for kw in URGENT_KEYWORDS)


async def scrape_with_playwright(ruc: str, usuario: str, password: str) -> dict:
    """
    Usa Playwright + Chromium headless para acceder al buzón SUNAT SOL.
    Maneja el login, el popup de notificaciones pendientes y extrae los datos.
    """
    try:
        from playwright.async_api import async_playwright, TimeoutError as PWTimeout
    except ImportError:
        return {
            "success": False,
            "notifications": [],
            "error": "Playwright no instalado en el servidor.",
            "error_type": "playwright_not_installed",
        }

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-extensions",
                    "--disable-background-networking",
                ],
            )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                locale="es-PE",
            )
            page = await context.new_page()

            try:
                result = await _do_login_and_scrape(page, ruc, usuario, password)
            finally:
                await browser.close()

            return result

    except Exception as e:
        return {
            "success": False,
            "notifications": [],
            "error": f"Error de navegador: {str(e)[:200]}",
            "error_type": "browser_error",
        }


async def _do_login_and_scrape(page, ruc: str, usuario: str, password: str) -> dict:
    from playwright.async_api import TimeoutError as PWTimeout

    try:
        # 1. Ir a la página de login SOL
        await page.goto(SUNAT_SOL_URL, wait_until="domcontentloaded", timeout=30000)

        # 2. Buscar y llenar el formulario de login
        # SUNAT tiene varios formatos de login según la versión del portal
        login_success = False

        # Intentar con los selectores del formulario SOL
        try:
            # Esperar al campo RUC
            await page.wait_for_selector('input[name="txtRuc"], #txtRuc, input[id*="ruc" i]', timeout=10000)

            ruc_field = page.locator('input[name="txtRuc"], #txtRuc, input[id*="ruc" i]').first
            await ruc_field.fill(ruc)

            user_field = page.locator('input[name="txtUsuario"], #txtUsuario, input[id*="usuario" i]').first
            await user_field.fill(usuario)

            pass_field = page.locator('input[name="txtContrasena"], #txtContrasena, input[type="password"]').first
            await pass_field.fill(password)

            # Click en el botón de ingreso
            btn = page.locator('input[type="submit"], button[type="submit"], input[value*="ngres" i], button:has-text("Ingresar")').first
            await btn.click()
            await page.wait_for_load_state("domcontentloaded", timeout=15000)
            login_success = True
        except PWTimeout:
            # Intentar con e-menu directamente
            await page.goto(SUNAT_LOGIN_URL, wait_until="domcontentloaded", timeout=20000)
            login_success = True

        if not login_success:
            return {"success": False, "notifications": [], "error": "No se encontró el formulario de login en SUNAT.", "error_type": "form_not_found"}

        # 3. Verificar si hay error de credenciales
        current_url = page.url
        page_text = await page.inner_text("body")

        if any(err in page_text.lower() for err in ["contraseña incorrecta", "datos incorrectos", "usuario o contraseña", "invalid"]):
            return {"success": False, "notifications": [], "error": "Credenciales incorrectas. Verifica tu RUC, usuario SOL y contraseña.", "error_type": "credenciales"}

        # 4. Manejar el popup "Tiene notificaciones pendientes de lectura"
        try:
            popup_btn = page.locator('input[value*="Buzón" i], button:has-text("Buzón"), a:has-text("Buzón Electrónico"), input[value*="Ir al" i]')
            if await popup_btn.count() > 0:
                await popup_btn.first.click()
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            else:
                # Buscar botón "Ver más tarde" si no hay botón del buzón
                later_btn = page.locator('input[value*="tarde" i], button:has-text("más tarde")')
                if await later_btn.count() > 0:
                    await later_btn.first.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass  # Si no hay popup, continuar

        # 5. Navegar al buzón electrónico
        buzon_urls = [
            "https://e-menu.sunat.gob.pe/cl-ti-itbuzonelectronico/bin/ejecBuzon.do",
            "https://www.sunat.gob.pe/ol-ti-itbuzonelectronico/bin/ejecBuzon.do",
        ]

        for buzon_url in buzon_urls:
            try:
                await page.goto(buzon_url, wait_until="domcontentloaded", timeout=20000)
                buzon_text = await page.inner_text("body")
                if "buzón" in buzon_text.lower() or "notificaci" in buzon_text.lower() or "asunto" in buzon_text.lower():
                    break
            except Exception:
                continue

        # 6. Esperar que cargue la tabla de notificaciones
        try:
            await page.wait_for_selector("table, .notificacion, #listadoNotificaciones, tr", timeout=12000)
        except PWTimeout:
            pass

        # 7. Extraer notificaciones del HTML
        html_content = await page.content()
        notifications = _parse_buzon_html(html_content, ruc, page)

        # Si no hay notifs en HTML, intentar extraer del DOM directamente
        if not notifications:
            notifications = await _extract_from_dom(page, ruc)

        return {
            "success": True,
            "notifications": notifications,
            "error": None,
            "scraped_url": page.url,
        }

    except Exception as e:
        err_str = str(e)
        if "net::ERR_NAME_NOT_RESOLVED" in err_str or "ERR_NAME_NOT_RESOLVED" in err_str:
            return {
                "success": False,
                "notifications": [],
                "error": "No se puede resolver el DNS de SUNAT desde el servidor. SUNAT puede estar bloqueando IPs internacionales.",
                "error_type": "dns_error",
            }
        return {
            "success": False,
            "notifications": [],
            "error": f"Error navegando SUNAT: {err_str[:200]}",
            "error_type": "navigation_error",
        }


def _parse_buzon_html(html: str, ruc: str, page=None) -> list:
    """Parsea el HTML del buzón SUNAT para extraer notificaciones."""
    from bs4 import BeautifulSoup
    notifications = []
    soup = BeautifulSoup(html, "html.parser")

    # Buscar tablas con datos de notificaciones
    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        for i, row in enumerate(rows[1:], 1):
            cells = row.find_all("td")
            if len(cells) < 2:
                continue

            texts = [c.get_text(strip=True) for c in cells]
            subject = texts[0] if texts else ""
            if not subject or len(subject) < 5:
                continue

            # Detectar fecha
            date_val = datetime.utcnow()
            for text in texts:
                m = re.search(r"\d{2}/\d{2}/\d{4}", text)
                if m:
                    try:
                        date_val = datetime.strptime(m.group(), "%d/%m/%Y")
                        break
                    except Exception:
                        pass

            # Detectar adjuntos
            has_attach = bool(row.find("a", href=re.compile(r"pdf|adjunto|descarg", re.I)) or
                              row.find("img", src=re.compile(r"clip|attach|paper", re.I)))

            # Número de referencia
            ref = ""
            for text in texts[1:]:
                if re.search(r"\d{8,}", text):
                    ref = text.strip()
                    break

            notif_id = f"S-{ruc}-{i}-{abs(hash(subject)) & 0xFFFFFF}"

            notifications.append({
                "id": notif_id,
                "subject": subject[:200],
                "reference_number": ref,
                "date_received": date_val.isoformat(),
                "sender": _detect_sender(texts) or "SUNAT",
                "status": "nuevo",
                "body_text": " | ".join(t for t in texts if t)[:500],
                "has_attachment": has_attach,
                "attachment_name": "adjunto.pdf" if has_attach else "",
                "is_urgent": _is_urgent(subject),
                "ruc": ruc,
            })

    return notifications


async def _extract_from_dom(page, ruc: str) -> list:
    """Extrae notificaciones directamente del DOM via JavaScript."""
    try:
        rows_data = await page.evaluate("""
            () => {
                const results = [];
                const rows = document.querySelectorAll('tr, .notificacion-item, [class*="notif"]');
                rows.forEach((row, i) => {
                    const text = row.innerText.trim();
                    if (text.length > 20 && i > 0) {
                        const cells = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                        if (cells.length >= 2) {
                            results.push({
                                index: i,
                                cells: cells,
                                hasLink: row.querySelector('a[href*="pdf"], a[href*="adjunto"]') !== null
                            });
                        }
                    }
                });
                return results.slice(0, 50);
            }
        """)

        notifications = []
        for item in (rows_data or []):
            cells = item.get("cells", [])
            subject = cells[0] if cells else ""
            if not subject or len(subject) < 5:
                continue

            i = item.get("index", len(notifications))
            notif_id = f"S-{ruc}-{i}-{abs(hash(subject)) & 0xFFFFFF}"
            notifications.append({
                "id": notif_id,
                "subject": subject[:200],
                "reference_number": cells[1] if len(cells) > 1 else "",
                "date_received": datetime.utcnow().isoformat(),
                "sender": "SUNAT",
                "status": "nuevo",
                "body_text": " | ".join(c for c in cells if c)[:500],
                "has_attachment": item.get("hasLink", False),
                "attachment_name": "adjunto.pdf" if item.get("hasLink") else "",
                "is_urgent": _is_urgent(subject),
                "ruc": ruc,
            })
        return notifications
    except Exception:
        return []


def _detect_sender(texts: list) -> str:
    for t in texts:
        if "intendencia" in t.lower() or "sunat" in t.lower() or "división" in t.lower() or "div." in t.lower():
            return t.strip()[:80]
    return "SUNAT"
