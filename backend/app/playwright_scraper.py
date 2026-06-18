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


async def _find_frame_with_login(page):
    """SUNAT usa frameset clásico — busca el frame que tiene el formulario de login."""
    # Primero intentar en la página principal
    try:
        el = page.locator("input[name='txtRuc'], #txtRuc")
        if await el.count() > 0:
            return page
    except Exception:
        pass

    # Buscar en todos los frames (iframes y framesets)
    for frame in page.frames:
        try:
            el = frame.locator("input[name='txtRuc'], #txtRuc")
            if await el.count() > 0:
                return frame
        except Exception:
            continue

    return None


async def _fill_login_form(frame_or_page, ruc: str, usuario: str, password: str):
    """Llena el formulario de login SOL de SUNAT."""
    await frame_or_page.locator("input[name='txtRuc'], #txtRuc").first.fill(ruc)
    await frame_or_page.locator("input[name='txtUsuario'], #txtUsuario").first.fill(usuario)
    # SUNAT usa txtContrasena como nombre del campo contraseña
    pwd_sel = "input[name='txtContrasena'], #txtContrasena, input[type='password']"
    await frame_or_page.locator(pwd_sel).first.fill(password)
    # Botón de ingreso
    btn_sel = (
        "input[name='btnAceptar'], #btnAceptar, "
        "input[value='Ingresar'], input[value='Iniciar'], "
        "input[type='submit'], button[type='submit']"
    )
    await frame_or_page.locator(btn_sel).first.click()


async def _do_login_and_scrape(page, ruc: str, usuario: str, password: str) -> dict:
    from playwright.async_api import TimeoutError as PWTimeout

    try:
        # 1. Ir a la página de autenticación de e-menu SUNAT
        await page.goto(SUNAT_LOGIN_URL, wait_until="domcontentloaded", timeout=25000)
        await page.wait_for_timeout(2000)  # Dejar que carguen los frames

        # 2. Buscar el frame/página que tiene el formulario de login
        login_frame = await _find_frame_with_login(page)

        if login_frame is None:
            # Si no encontró formulario, volcar el HTML para diagnóstico
            html_preview = (await page.content())[:500]
            return {
                "success": False,
                "notifications": [],
                "error": (
                    "No se encontró el formulario de login de SUNAT. "
                    "El portal puede haber cambiado su estructura. "
                    f"Vista previa HTML: {html_preview}"
                ),
                "error_type": "form_not_found",
            }

        # 3. Llenar y enviar el formulario
        await _fill_login_form(login_frame, ruc, usuario, password)
        await page.wait_for_load_state("domcontentloaded", timeout=15000)
        await page.wait_for_timeout(2000)

        # 4. Verificar error de credenciales (buscar en todos los frames)
        all_text = ""
        for frame in page.frames:
            try:
                all_text += (await frame.inner_text("body")).lower()
            except Exception:
                pass

        cred_errors = [
            "contraseña incorrecta", "datos incorrectos", "ruc o usuario",
            "usuario o contraseña", "acceso denegado", "no válido",
            "inválido", "error de autenticación", "incorrect",
        ]
        if any(e in all_text for e in cred_errors):
            return {
                "success": False,
                "notifications": [],
                "error": "Credenciales incorrectas. Verifica tu RUC, usuario SOL y contraseña SOL.",
                "error_type": "credenciales",
            }

        # 5. Manejar popup "Tiene notificaciones pendientes de lectura"
        await page.wait_for_timeout(1500)
        for frame in page.frames:
            try:
                buzon_btn = frame.locator(
                    "input[value*='Buz' i], input[value*='Ir al' i], "
                    "a:has-text('Buz'), button:has-text('Buz')"
                )
                if await buzon_btn.count() > 0:
                    await buzon_btn.first.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)
                    break
                later = frame.locator("input[value*='tarde' i], button:has-text('tarde')")
                if await later.count() > 0:
                    await later.first.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                    break
            except Exception:
                continue

        # 6. Navegar al buzón electrónico con la sesión activa
        await page.goto(SUNAT_BUZON_URL, wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(2000)

        # 7. Esperar tabla de notificaciones (buscar en todos los frames)
        buzon_frame = page
        for frame in page.frames:
            try:
                count = await frame.locator("table tr td").count()
                if count > 3:
                    buzon_frame = frame
                    break
            except Exception:
                continue

        # 8. Extraer notificaciones
        html = await buzon_frame.content()
        notifications = _parse_html(html, ruc)
        if not notifications:
            notifications = await _extract_dom(buzon_frame, ruc)

        # 9. Evaluar resultado
        if not notifications:
            # Revisar si llegamos al buzón aunque esté vacío
            buzon_text = ""
            for frame in page.frames:
                try:
                    buzon_text += (await frame.inner_text("body")).lower()
                except Exception:
                    pass

            if any(w in buzon_text for w in ["buzón", "notificaci", "bandeja", "buzon"]):
                return {
                    "success": True,
                    "notifications": [],
                    "error": None,
                    "note": "Buzón accedido correctamente. Sin notificaciones pendientes.",
                }

            return {
                "success": False,
                "notifications": [],
                "error": (
                    "Playwright llegó a SUNAT pero no pudo autenticarse completamente. "
                    "Verifica que el RUC, usuario SOL y contraseña SOL sean correctos."
                ),
                "error_type": "auth_incomplete",
            }

        return {"success": True, "notifications": notifications, "error": None}

    except PWTimeout as e:
        return {
            "success": False,
            "notifications": [],
            "error": f"SUNAT tardó demasiado en responder. Intenta de nuevo en unos minutos.",
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
            "error": f"Error navegando SUNAT: {err[:300]}",
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
