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
        # ── PASO 1: sol.html ─────────────────────────────────────────────────
        await page.goto(SUNAT_SOL_URL, wait_until="networkidle", timeout=25000)
        await page.wait_for_timeout(1500)

        # Hacer clic en "Operaciones en Línea" o "Ingresar"
        ingresar = page.locator("a:has-text('Operaciones en Línea'), a:has-text('Ingresar'), button:has-text('Ingresar')")
        if await ingresar.count() > 0:
            await ingresar.first.click()
            await page.wait_for_load_state("networkidle", timeout=20000)
        await page.wait_for_timeout(2000)

        # ── PASO 2: OAuth en api-seguridad.sunat.gob.pe ──────────────────────
        # Si el click anterior no redirigió al OAuth, navegamos directamente
        if OAUTH_DOMAIN not in page.url:
            # Buscar el link de OAuth en la página actual
            oauth_link = page.locator(f"a[href*='{OAUTH_DOMAIN}']")
            if await oauth_link.count() > 0:
                await oauth_link.first.click()
                await page.wait_for_load_state("networkidle", timeout=20000)

        await page.wait_for_timeout(2000)

        # ── PASO 3: Llenar formulario OAuth ──────────────────────────────────
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
            # No llegamos al OAuth — reportar campos de la página actual
            inputs_info = await page.evaluate("""() =>
                [...document.querySelectorAll('input')].map(e => ({name:e.name,id:e.id,type:e.type}))
            """)
            return {
                "success": False, "notifications": [],
                "error": f"No se llegó al formulario OAuth de SUNAT. URL: {page.url} | Inputs: {inputs_info[:8]}",
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
        # Intentar link "Buzón Electrónico" en el menú
        buzon_link = page.locator("a:has-text('Buzón Electrónico'), a[href*='buzon' i], a[href*='Buzon' i]")
        if await buzon_link.count() > 0:
            await buzon_link.first.click()
            await page.wait_for_load_state("networkidle", timeout=20000)
        else:
            await page.goto(SUNAT_BUZON_URL, wait_until="networkidle", timeout=20000)

        await page.wait_for_timeout(3000)

        # ── PASO 7: Extraer notificaciones ───────────────────────────────────
        notifications = await _extract_buzon(page, ruc)

        if not notifications:
            body_lower = (await page.inner_text("body")).lower()
            if any(w in body_lower for w in ["buzón", "buzon", "notificaci", "bandeja"]):
                return {"success": True, "notifications": [], "error": None,
                        "note": "Buzón accedido. Sin notificaciones."}
            return {
                "success": False, "notifications": [],
                "error": f"Login completado pero no se accedió al buzón. URL final: {page.url}",
                "error_type": "buzon_not_reached",
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
    """Extrae notificaciones del buzón SUNAT (panel izquierdo con lista)."""
    notifications = []

    # Esperar lista de notificaciones
    try:
        await page.wait_for_selector(".items-list li, table tr td, .mensaje, [class*='item']", timeout=10000)
    except Exception:
        pass

    # Extraer via JavaScript — buscar en toda la página
    items = await page.evaluate("""() => {
        const results = [];

        // Intentar tabla clásica
        document.querySelectorAll('table tr').forEach((row, idx) => {
            if (idx === 0) return;
            const cells = [...row.querySelectorAll('td')].map(c => c.innerText.trim());
            if (cells.length >= 2 && cells[0].length > 10) {
                const link = row.querySelector('a[href]');
                results.push({
                    subject: cells[0],
                    date: cells[1] || '',
                    extra: cells.slice(2).join(' | '),
                    pdfHref: link ? link.href : '',
                    hasAttach: !!row.querySelector('img[src*="clip"], img[alt*="adjunto"], a[href*=".pdf"], a[href*="adjunto"]')
                });
            }
        });

        // Intentar lista de mensajes (nuevo buzón SUNAT)
        if (results.length === 0) {
            document.querySelectorAll('.asunto, [class*="asunto"], [class*="subject"], li[class*="item"]').forEach(el => {
                const text = el.innerText.trim();
                if (text.length > 10) {
                    const link = el.querySelector('a') || el.closest('li')?.querySelector('a');
                    results.push({
                        subject: text.split('\\n')[0],
                        date: '',
                        extra: text,
                        pdfHref: link ? link.href : '',
                        hasAttach: !!el.querySelector('[class*="clip"], [class*="attach"]')
                    });
                }
            });
        }

        return results.slice(0, 100);
    }""")

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
        notifications.append({
            "id": f"S-{ruc}-{i}-{abs(hash(subject)) & 0xFFFFFF}",
            "subject": subject[:300],
            "reference_number": re.search(r"N[°º]\s*([\d\-]+)", subject).group(1) if re.search(r"N[°º]\s*([\d\-]+)", subject) else "",
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
