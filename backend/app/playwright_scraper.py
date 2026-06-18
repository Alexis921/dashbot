"""
Scraper de buzón SUNAT usando Playwright (navegador real Chromium).
Maneja JavaScript, popups y la sesión completa de SOL.
"""
import asyncio
import re
from datetime import datetime

URGENT_KEYWORDS = [
    "multa", "infracción", "cobranza coactiva", "embargo", "sanción",
    "baja", "cierre", "fiscalización", "requerimiento", "deuda",
    "vencimiento", "plazo", "urgente", "citación", "ejecución coactiva",
    "resolución de determinación", "resolución de multa", "orden de pago",
]

SUNAT_LOGIN_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
SUNAT_BUZON_URL = "https://e-menu.sunat.gob.pe/cl-ti-itbuzonelectronico/bin/ejecBuzon.do"


def _is_urgent(subject: str) -> bool:
    s = subject.lower()
    return any(kw in s for kw in URGENT_KEYWORDS)


async def scrape_with_playwright(ruc: str, usuario: str, password: str) -> dict:
    """Usa Playwright + Chromium headless para acceder al buzón SUNAT SOL."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {
            "success": False,
            "notifications": [],
            "error": "Playwright no instalado.",
            "error_type": "playwright_not_installed",
        }

    try:
        result = await asyncio.wait_for(
            _run_playwright(ruc, usuario, password),
            timeout=50.0,
        )
        return result
    except asyncio.TimeoutError:
        return {
            "success": False,
            "notifications": [],
            "error": "SUNAT no respondió en 50 segundos. El portal puede estar bloqueando conexiones internacionales.",
            "error_type": "timeout",
        }
    except Exception as e:
        return {
            "success": False,
            "notifications": [],
            "error": f"Error de navegador: {str(e)[:200]}",
            "error_type": "browser_error",
        }


async def _run_playwright(ruc: str, usuario: str, password: str) -> dict:
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout

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


async def _do_login_and_scrape(page, ruc: str, usuario: str, password: str) -> dict:
    from playwright.async_api import TimeoutError as PWTimeout

    try:
        # 1. Ir directamente al formulario de login de e-menu SUNAT
        await page.goto(SUNAT_LOGIN_URL, wait_until="domcontentloaded", timeout=20000)

        # 2. Esperar y llenar el formulario (campos reales de SUNAT SOL)
        await page.wait_for_selector("#txtRuc, input[name='txtRuc']", timeout=10000)

        await page.locator("#txtRuc, input[name='txtRuc']").first.fill(ruc)
        await page.locator("#txtUsuario, input[name='txtUsuario']").first.fill(usuario)
        # SUNAT usa txtContrasena (no txtPassword)
        await page.locator(
            "#txtContrasena, input[name='txtContrasena'], input[type='password']"
        ).first.fill(password)

        # 3. Click en botón de ingreso
        await page.locator(
            "input[type='submit'][value*='ngres' i], "
            "button[type='submit'], "
            "#btnIngresar, "
            "input[name='btnAceptar']"
        ).first.click()

        await page.wait_for_load_state("domcontentloaded", timeout=15000)

        # 4. Detectar error de credenciales
        body_text = (await page.inner_text("body")).lower()
        cred_errors = [
            "contraseña incorrecta", "datos incorrectos",
            "ruc o usuario", "usuario o contraseña",
            "acceso denegado", "no válido", "inválido",
            "error de autenticación",
        ]
        if any(e in body_text for e in cred_errors):
            return {
                "success": False,
                "notifications": [],
                "error": "Credenciales incorrectas. Verifica tu RUC, usuario SOL y contraseña.",
                "error_type": "credenciales",
            }

        # 5. Manejar popup "Tiene notificaciones pendientes de lectura"
        #    Botones posibles: "Ir al Buzón Electrónico" o "Ver más tarde"
        try:
            await page.wait_for_timeout(2000)  # Esperar que aparezca el popup
            # Intentar hacer clic en "Ir al Buzón" primero
            buzon_btn = page.locator(
                "input[value*='Buz' i], "
                "button:has-text('Buz'), "
                "a:has-text('Buz'), "
                "input[value*='Ir al' i]"
            )
            if await buzon_btn.count() > 0:
                await buzon_btn.first.click()
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            else:
                # Cerrar popup con "Ver más tarde" y navegar manualmente al buzón
                later = page.locator(
                    "input[value*='tarde' i], button:has-text('tarde'), input[value*='omitir' i]"
                )
                if await later.count() > 0:
                    await later.first.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                # Navegar directamente al buzón
                await page.goto(SUNAT_BUZON_URL, wait_until="domcontentloaded", timeout=20000)
        except Exception:
            # Si falla el popup, ir directamente al buzón con la sesión activa
            await page.goto(SUNAT_BUZON_URL, wait_until="domcontentloaded", timeout=20000)

        # 6. Esperar que cargue la tabla del buzón
        try:
            await page.wait_for_selector(
                "table tr td, .lista-notificaciones, #tblNotificaciones",
                timeout=12000,
            )
        except PWTimeout:
            pass

        # 7. Extraer notificaciones del HTML
        html = await page.content()
        notifications = _parse_html(html, ruc)
        if not notifications:
            notifications = await _extract_dom(page, ruc)

        # 8. Evaluar resultado
        if not notifications:
            body_final = (await page.inner_text("body")).lower()
            # Si llegamos al buzón pero no hay notificaciones = buzón vacío
            if any(w in body_final for w in ["buzón", "notificaci", "bandeja", "buz"]):
                return {
                    "success": True,
                    "notifications": [],
                    "error": None,
                    "note": "Buzón accedido. Sin notificaciones pendientes.",
                }
            # Si no reconocemos la página = sesión no autenticada
            return {
                "success": False,
                "notifications": [],
                "error": (
                    "Playwright llegó a SUNAT pero el login no completó correctamente. "
                    "Verifica tus credenciales SOL (RUC + usuario SOL + contraseña SOL)."
                ),
                "error_type": "auth_incomplete",
            }

        return {"success": True, "notifications": notifications, "error": None}

    except PWTimeout as e:
        return {
            "success": False,
            "notifications": [],
            "error": f"SUNAT tardó demasiado en responder ({str(e)[:100]}). Intenta de nuevo en unos minutos.",
            "error_type": "timeout",
        }
    except Exception as e:
        err = str(e)
        if "ERR_NAME_NOT_RESOLVED" in err or "net::ERR_NAME" in err:
            return {
                "success": False,
                "notifications": [],
                "error": "No se puede resolver el dominio de SUNAT. Problema de red del servidor.",
                "error_type": "dns_error",
            }
        return {
            "success": False,
            "notifications": [],
            "error": f"Error navegando SUNAT: {err[:200]}",
            "error_type": "navigation_error",
        }


def _parse_html(html: str, ruc: str) -> list:
    from bs4 import BeautifulSoup
    notifications = []
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        for i, row in enumerate(rows[1:], 1):
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            texts = [c.get_text(strip=True) for c in cells]
            subject = texts[0]
            if not subject or len(subject) < 5:
                continue
            date_val = datetime.utcnow()
            for t in texts:
                m = re.search(r"\d{2}/\d{2}/\d{4}", t)
                if m:
                    try:
                        date_val = datetime.strptime(m.group(), "%d/%m/%Y")
                        break
                    except Exception:
                        pass
            has_attach = bool(row.find("a", href=re.compile(r"pdf|adjunto|descarg", re.I)))
            ref = next((t for t in texts[1:] if re.search(r"\d{8,}", t)), "")
            notifications.append({
                "id": f"S-{ruc}-{i}-{abs(hash(subject)) & 0xFFFFFF}",
                "subject": subject[:200],
                "reference_number": ref.strip()[:50],
                "date_received": date_val.isoformat(),
                "sender": next((t for t in texts if "sunat" in t.lower() or "intendencia" in t.lower()), "SUNAT"),
                "status": "nuevo",
                "body_text": " | ".join(t for t in texts if t)[:500],
                "has_attachment": has_attach,
                "attachment_name": "adjunto.pdf" if has_attach else "",
                "is_urgent": _is_urgent(subject),
                "ruc": ruc,
            })
    return notifications


async def _extract_dom(page, ruc: str) -> list:
    try:
        rows = await page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('tr').forEach((row, i) => {
                if (i === 0) return;
                const cells = [...row.querySelectorAll('td')].map(c => c.innerText.trim());
                if (cells.length >= 2 && cells[0].length > 5) {
                    out.push({ cells, hasLink: !!row.querySelector('a[href*="pdf"],a[href*="adjunto"]') });
                }
            });
            return out.slice(0, 100);
        }""")
        notifs = []
        for i, item in enumerate(rows or [], 1):
            cells = item.get("cells", [])
            subject = cells[0] if cells else ""
            if not subject:
                continue
            notifs.append({
                "id": f"S-{ruc}-{i}-{abs(hash(subject)) & 0xFFFFFF}",
                "subject": subject[:200],
                "reference_number": (cells[1] if len(cells) > 1 else "")[:50],
                "date_received": datetime.utcnow().isoformat(),
                "sender": "SUNAT",
                "status": "nuevo",
                "body_text": " | ".join(c for c in cells if c)[:500],
                "has_attachment": item.get("hasLink", False),
                "attachment_name": "adjunto.pdf" if item.get("hasLink") else "",
                "is_urgent": _is_urgent(subject),
                "ruc": ruc,
            })
        return notifs
    except Exception:
        return []
