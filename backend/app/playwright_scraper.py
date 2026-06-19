"""
Scraper de buzón SUNAT usando Playwright (Chromium headless).
Flujo real:
  1. sol.html → click "Ingresar" → OAuth en api-seguridad.sunat.gob.pe
  2. Llenar RUC + usuario SOL + contraseña → submit
  3. Manejar popup "Valida tus datos de contacto" (Finalizar → Continuar sin confirmar)
  4. Navegar al Buzón Electrónico
  5. Extraer notificaciones y links de PDF
"""
import asyncio
import re
from datetime import datetime

URGENT_KEYWORDS = [
    "multa", "infracción", "cobranza coactiva", "embargo", "sanción",
    "baja", "cierre", "fiscalización", "requerimiento", "deuda",
    "ejecución coactiva", "resolución de determinación", "resolución de multa",
    "orden de pago", "vencimiento", "urgente", "citación",
]

SUNAT_SOL_URL   = "https://www.sunat.gob.pe/sol.html"
SUNAT_MENU_URL  = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=*&agrupacion=*"
SUNAT_BUZON_URL = "https://e-menu.sunat.gob.pe/cl-ti-itbuzonelectronico/bin/ejecBuzon.do"
OAUTH_DOMAIN    = "api-seguridad.sunat.gob.pe"
# URL OAuth directa — client_id fijo de SUNAT SOL
SUNAT_OAUTH_URL = (
    "https://api-seguridad.sunat.gob.pe/v1/clientessol/"
    "4f3b88b3-d9d6-402a-b85d-6a0bc857746a/oauth2/loginMenuSol"
    "?lang=es-PE&showDni=true&showLanguages=false"
    "&originalUrl=https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
)


def _is_urgent(subject: str) -> bool:
    s = subject.lower()
    return any(kw in s for kw in URGENT_KEYWORDS)


async def scrape_with_playwright(ruc: str, usuario: str, password: str) -> dict:
    try:
        from playwright.async_api import async_playwright  # noqa
    except ImportError:
        return {"success": False, "notifications": [], "error": "Playwright no instalado.", "error_type": "playwright_not_installed"}

    try:
        result = await asyncio.wait_for(
            _run_playwright(ruc, usuario, password),
            timeout=90.0,  # 90s: OAuth + popup + buzón
        )
        return result
    except asyncio.TimeoutError:
        return {
            "success": False, "notifications": [],
            "error": "Tiempo de espera agotado (90 seg). SUNAT tardó demasiado en responder.",
            "error_type": "timeout",
        }
    except Exception as e:
        return {"success": False, "notifications": [], "error": f"Error de navegador: {str(e)[:200]}", "error_type": "browser_error"}


async def _run_playwright(ruc: str, usuario: str, password: str) -> dict:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
                  "--disable-gpu", "--disable-extensions"],
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
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
        # ── PASO 1: Ir directamente al formulario OAuth de SUNAT ─────────────
        # El client_id 4f3b88b3... es fijo de SUNAT SOL (no cambia)
        await page.goto(SUNAT_OAUTH_URL, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2000)

        # ── PASO 2: Llenar formulario OAuth ──────────────────────────────────
        if OAUTH_DOMAIN in page.url:
            # Detectar campos reales del formulario OAuth
            inputs = await page.evaluate("""() =>
                [...document.querySelectorAll('input')].map(el => ({
                    name: el.name, id: el.id, type: el.type,
                    placeholder: el.placeholder, visible: el.offsetParent !== null
                }))
            """)
            visible = [i for i in inputs if i.get("type") != "hidden" and i.get("visible")]

            # Buscar campo RUC
            ruc_field = next((i for i in visible if any(
                k in (i.get("name","") + i.get("id","") + i.get("placeholder","")).lower()
                for k in ["ruc", "txtRuc", "contribuyente"]
            )), None)

            # Buscar campo usuario
            usr_field = next((i for i in visible if any(
                k in (i.get("name","") + i.get("id","") + i.get("placeholder","")).lower()
                for k in ["usuario", "user", "login"]
            ) and i != ruc_field), None)

            # Buscar campo contraseña
            pwd_field = next((i for i in visible if
                i.get("type") == "password" or
                any(k in (i.get("name","") + i.get("id","")).lower() for k in ["contra", "pass", "pwd"])
            ), None)

            if ruc_field and pwd_field:
                # Portal con campos separados: RUC | usuario | contraseña
                await page.locator(f"#{ruc_field['id']}" if ruc_field.get("id") else f"input[name='{ruc_field['name']}']").first.fill(ruc)
                if usr_field:
                    await page.locator(f"#{usr_field['id']}" if usr_field.get("id") else f"input[name='{usr_field['name']}']").first.fill(usuario)
                pwd_sel = f"#{pwd_field['id']}" if pwd_field.get("id") else f"input[name='{pwd_field['name']}']"
                await page.locator(pwd_sel).first.fill(password)
            elif pwd_field:
                # Portal con campo único usuario: RUC+usuario concatenado
                usr_single = next((i for i in visible if i != pwd_field), None)
                if usr_single:
                    sel = f"#{usr_single['id']}" if usr_single.get("id") else f"input[name='{usr_single['name']}']"
                    await page.locator(sel).first.fill(ruc + usuario)
                pwd_sel = f"#{pwd_field['id']}" if pwd_field.get("id") else "input[type='password']"
                await page.locator(pwd_sel).first.fill(password)
            else:
                # Fallback: llenar por orden (1er visible=RUC, 2do=usuario, 3ro=contraseña)
                if len(visible) >= 1:
                    await page.locator(f"input[name='{visible[0]['name']}']").first.fill(ruc)
                if len(visible) >= 2:
                    await page.locator(f"input[name='{visible[1]['name']}']").first.fill(usuario)
                if len(visible) >= 3:
                    await page.locator(f"input[name='{visible[2]['name']}']").first.fill(password)

            # Submit del formulario OAuth
            submit = page.locator("button[type='submit'], input[type='submit'], button:has-text('Iniciar'), button:has-text('Ingresar')")
            if await submit.count() > 0:
                await submit.first.click()
            else:
                await page.keyboard.press("Enter")

            await page.wait_for_load_state("networkidle", timeout=20000)
            await page.wait_for_timeout(2000)
        else:
            # No llegamos al OAuth — diagnóstico
            inputs_info = await page.evaluate("""() =>
                [...document.querySelectorAll('input')].map(e => ({name:e.name,id:e.id,type:e.type}))
            """)
            all_links = await page.evaluate("""() =>
                [...document.querySelectorAll('a[href]')].slice(0,10).map(a => a.href)
            """)
            return {
                "success": False, "notifications": [],
                "error": f"URL: {page.url} | Inputs: {inputs_info[:6]} | Links: {all_links[:6]}",
                "error_type": "oauth_not_reached",
            }

        # ── PASO 4: Verificar credenciales incorrectas ────────────────────────
        all_text = await page.inner_text("body")
        if any(e in all_text.lower() for e in [
            "contraseña incorrecta", "datos incorrectos", "ruc o usuario",
            "acceso denegado", "incorrect", "inválido", "no válido",
        ]):
            return {
                "success": False, "notifications": [],
                "error": "Credenciales incorrectas. Verifica tu RUC, usuario SOL y contraseña SOL.",
                "error_type": "credenciales",
            }

        # ── PASO 5: Manejar popup "Valida tus datos de contacto" ─────────────
        # Primer modal "Informativo" → botón "Finalizar"
        await page.wait_for_timeout(2000)
        try:
            finalizar = page.locator("button:has-text('Finalizar'), input[value*='Finalizar']")
            if await finalizar.count() > 0:
                await finalizar.first.click()
                await page.wait_for_timeout(1500)
        except Exception:
            pass

        # Segundo modal o página → botón "Continuar sin confirmar"
        try:
            continuar = page.locator(
                "button:has-text('Continuar sin confirmar'), "
                "input[value*='Continuar'], a:has-text('Continuar')"
            )
            if await continuar.count() > 0:
                await continuar.first.click()
                await page.wait_for_load_state("networkidle", timeout=15000)
                await page.wait_for_timeout(1500)
        except Exception:
            pass

        # ── PASO 6: Navegar al Buzón Electrónico ─────────────────────────────
        # Intentar link "Buzón Electrónico" en el menú (busca en todos los frames)
        clicked_buzon = False
        for frame in page.frames:
            try:
                buzon_link = frame.locator(
                    "a:has-text('Buzón Electrónico'), "
                    "a:has-text('Buzon Electronico'), "
                    "a[href*='buzon' i], a[href*='Buzon' i]"
                )
                if await buzon_link.count() > 0:
                    await buzon_link.first.click()
                    await page.wait_for_load_state("networkidle", timeout=20000)
                    clicked_buzon = True
                    break
            except Exception:
                continue

        if not clicked_buzon:
            await page.goto(SUNAT_BUZON_URL, wait_until="networkidle", timeout=20000)

        await page.wait_for_timeout(4000)

        # ── PASO 7: Extraer notificaciones (buscar en todos los frames) ───────
        notifications = await _extract_buzon(page, ruc)

        if not notifications:
            # Verificar en todos los frames si estamos en el buzón
            all_text = ""
            for frame in page.frames:
                try:
                    all_text += (await frame.inner_text("body")).lower()
                except Exception:
                    pass

            if any(w in all_text for w in ["buzón", "buzon", "notificaci", "bandeja", "asunto"]):
                return {"success": True, "notifications": [], "error": None,
                        "note": "Buzón accedido. Sin notificaciones visibles."}

            # Diagnóstico de frames
            frame_info = [(f.url, ) for f in page.frames if f.url and "about:blank" not in f.url]
            return {
                "success": False, "notifications": [],
                "error": f"Llegamos al buzón pero no se encontraron notificaciones. URL: {page.url} | Frames: {frame_info}",
                "error_type": "buzon_empty_extract",
            }

        return {"success": True, "notifications": notifications, "error": None}

    except PWTimeout as e:
        return {"success": False, "notifications": [],
                "error": f"SUNAT no respondió a tiempo: {str(e)[:100]}",
                "error_type": "timeout"}
    except Exception as e:
        err = str(e)
        if "ERR_NAME_NOT_RESOLVED" in err:
            return {"success": False, "notifications": [],
                    "error": "No se puede resolver el dominio de SUNAT (problema de DNS).",
                    "error_type": "dns_error"}
        return {"success": False, "notifications": [],
                "error": f"Error: {err[:300]}", "error_type": "navigation_error"}


async def _extract_buzon(page, ruc: str) -> list:
    """Extrae notificaciones del buzón SUNAT buscando en todos los frames."""

    # Esperar contenido en la página principal o cualquier frame
    for frame in page.frames:
        try:
            await frame.wait_for_selector(
                "table tr td, li, .asunto, [class*='item'], [class*='mensaje']",
                timeout=8000,
            )
            break
        except Exception:
            continue

    # Intentar extracción en cada frame
    all_items = []
    for frame in page.frames:
        items = await _extract_frame_items(frame)
        all_items.extend(items)
        if len(all_items) >= 5:
            break

    return _build_notifications(all_items, ruc)


async def _extract_frame_items(frame) -> list:
    """Extrae items de notificaciones de un frame específico."""
    try:
        return await frame.evaluate("""() => {
            const results = [];

            // Tabla clásica
            document.querySelectorAll('table tr').forEach((row, idx) => {
                if (idx === 0) return;
                const cells = [...row.querySelectorAll('td')].map(c => c.innerText.trim());
                if (cells.length >= 2 && cells[0].length > 10) {
                    const link = row.querySelector('a[href]');
                    const pdfLink = row.querySelector('a[href*=".pdf"], a[href*="adjunto"], a[href*="constancia"]');
                    results.push({
                        subject: cells[0],
                        date: cells[1] || '',
                        extra: cells.slice(2).join(' | '),
                        pdfHref: pdfLink ? pdfLink.href : (link ? link.href : ''),
                        hasAttach: !!(row.querySelector('img[src*="clip"]') || pdfLink)
                    });
                }
            });

            // Lista de notificaciones nueva (div/li)
            if (results.length === 0) {
                document.querySelectorAll(
                    '.asunto, [class*="asunto"], [class*="subject"], ' +
                    'li[class*="item"], li[class*="mensaje"], .list-group-item'
                ).forEach(el => {
                    const text = el.innerText.trim();
                    if (text.length > 10) {
                        const pdfLink = el.querySelector('a[href*=".pdf"], a[href*="adjunto"], a[href*="constancia"]');
                        const anyLink = el.querySelector('a[href]') || el.closest('li, tr')?.querySelector('a[href]');
                        results.push({
                            subject: text.split('\\n')[0].trim(),
                            date: '',
                            extra: text,
                            pdfHref: pdfLink ? pdfLink.href : (anyLink ? anyLink.href : ''),
                            hasAttach: !!pdfLink
                        });
                    }
                });
            }

            return results.slice(0, 100);
        }""")
    except Exception:
        return []


def _build_notifications(items: list, ruc: str) -> list:
    notifications = []
    for i, item in enumerate(items or [], 1):
        subject = (item.get("subject") or "").strip()
        if not subject or len(subject) < 5:
            continue
        date_val = datetime.utcnow()
        date_str = item.get("date", "")
        if date_str:
            m = re.search(r"\d{2}/\d{2}/\d{4}", date_str)
            if m:
                try:
                    date_val = datetime.strptime(m.group(), "%d/%m/%Y")
                except Exception:
                    pass
        pdf_href = item.get("pdfHref", "")
        ref_match = re.search(r"N[°º]\s*([\d\-]+)", subject)
        notifications.append({
            "id": f"S-{ruc}-{i}-{abs(hash(subject)) & 0xFFFFFF}",
            "subject": subject[:300],
            "reference_number": ref_match.group(1) if ref_match else "",
            "date_received": date_val.isoformat(),
            "sender": "SUNAT",
            "status": "nuevo",
            "body_text": item.get("extra", "")[:500],
            "has_attachment": bool(pdf_href) or item.get("hasAttach", False),
            "attachment_name": pdf_href.split("/")[-1][:200] if pdf_href else "",
            "attachment_url": pdf_href,
            "is_urgent": _is_urgent(subject),
            "ruc": ruc,
        })
    return notifications
