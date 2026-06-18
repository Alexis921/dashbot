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

SUNAT_SOL_URL   = "https://www.sunat.gob.pe/sol.html"
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


async def _get_all_inputs(frame_or_page) -> list:
    """Devuelve lista de {name, id, type} de todos los inputs en la página/frame."""
    try:
        return await frame_or_page.evaluate("""() => {
            return [...document.querySelectorAll('input,select,textarea')].map(el => ({
                name: el.name || '',
                id: el.id || '',
                type: el.type || '',
                placeholder: el.placeholder || '',
            }));
        }""")
    except Exception:
        return []


async def _find_frame_with_login(page):
    """Busca en todos los frames el que contiene el formulario de login SUNAT."""
    # SUNAT usa varios nombres según la versión del portal:
    # Antiguo: txtRuc, txtUsuario, txtContrasena
    # Nuevo (Bootstrap/JS): username, password
    login_selectors = [
        "input[name='txtRuc']", "#txtRuc",
        "input[name='ruc']", "#ruc",
        "input[name='username']:not([type='hidden'])",
        "input[id='username']:not([type='hidden'])",
        "input[placeholder*='RUC' i]",
        "input[placeholder*='usuario' i]",
        "input[id*='ruc' i]:not([type='hidden'])",
        "input[name*='ruc' i]:not([type='hidden'])",
    ]

    candidates = [page] + list(page.frames)
    for candidate in candidates:
        for sel in login_selectors:
            try:
                if await candidate.locator(sel).count() > 0:
                    return candidate
            except Exception:
                continue
    return None


async def _fill_login_form(frame_or_page, ruc: str, usuario: str, password: str, inputs: list):
    """Llena el formulario detectando los campos reales de SUNAT."""
    input_names = {i.get("name", "").lower() for i in inputs}
    input_ids   = {i.get("id", "").lower() for i in inputs}

    visible = [i for i in inputs if i.get("type") != "hidden"]

    # Campo RUC — en portal nuevo SUNAT el campo username contiene RUC+usuario concatenado
    # En portal clásico: txtRuc separado
    ruc_field = next((
        i for i in visible
        if any(k in i.get("name","").lower() or k in i.get("id","").lower()
               for k in ["txtruc", "ruc"])
    ), None)

    if ruc_field:
        # Portal clásico: hay campo RUC separado
        await frame_or_page.locator(f"[name='{ruc_field['name']}']").first.fill(ruc)
        usr_field = next((
            i for i in visible
            if any(k in i.get("name","").lower() or k in i.get("id","").lower()
                   for k in ["usuario", "user"])
        ), None)
        if usr_field:
            await frame_or_page.locator(f"[name='{usr_field['name']}']").first.fill(usuario)
    else:
        # Portal nuevo (Bootstrap): campo "username" = RUC + USUARIO juntos (ej: 10094431153TRUSEGON)
        usr_field = next((
            i for i in visible
            if any(k in i.get("name","").lower() or k in i.get("id","").lower()
                   for k in ["username", "user", "usuario"])
        ), None)
        if usr_field:
            # SUNAT nuevo: el campo username lleva RUC + USUARIO sin espacio
            combined = ruc + usuario
            await frame_or_page.locator(f"[name='{usr_field['name']}']").first.fill(combined)

    # Campo Contraseña
    pwd_field = next((
        i for i in visible
        if i.get("type") == "password"
        or any(k in i.get("name","").lower() for k in ["contra", "pass", "pwd"])
    ), None)
    pwd_sel = f"[name='{pwd_field['name']}']" if pwd_field else "input[type='password']"
    await frame_or_page.locator(pwd_sel).first.fill(password)

    # Botón submit
    btn_sel = (
        "input[type='submit'], button[type='submit'], "
        "input[name='btnAceptar'], #btnAceptar, "
        "input[value*='ngres' i], button:has-text('Ingresar')"
    )
    await frame_or_page.locator(btn_sel).first.click()


async def _do_login_and_scrape(page, ruc: str, usuario: str, password: str) -> dict:
    from playwright.async_api import TimeoutError as PWTimeout

    try:
        # 1. Navegar a la página pública de SOL (tiene el formulario real de login)
        #    AutenticaMenuInternet.htm es el MENÚ post-login, no el formulario
        await page.goto(SUNAT_SOL_URL, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2000)

        # Diagnóstico de frames
        frame_urls = [f.url for f in page.frames if f.url and f.url != "about:blank"]

        # 2. Buscar el frame/página que tiene el formulario de login
        login_frame = await _find_frame_with_login(page)

        if login_frame is None:
            # Diagnóstico extendido: URL actual, título, todos los elementos interactivos
            current_url = page.url
            page_title = await page.title()
            all_inputs = []
            for frame in page.frames:
                all_inputs += await _get_all_inputs(frame)
            inputs_info = [(i.get("name"), i.get("id"), i.get("type")) for i in all_inputs]

            # Buscar cualquier elemento interactivo visible (no solo inputs)
            interactive = await page.evaluate("""() => {
                const els = [...document.querySelectorAll('input,button,a,[role=button],[contenteditable],div[onclick]')];
                return els.slice(0,20).map(e => ({
                    tag: e.tagName, type: e.type||'', id: e.id||'',
                    name: e.name||'', text: (e.innerText||'').slice(0,30),
                    visible: e.offsetParent !== null
                }));
            }""")

            return {
                "success": False,
                "notifications": [],
                "error": (
                    f"URL actual: {current_url} | "
                    f"Título: {page_title} | "
                    f"Frames: {frame_urls} | "
                    f"Inputs: {inputs_info[:10]} | "
                    f"Interactivos: {[e['tag']+':'+e['id']+'/'+e['text'][:20] for e in interactive[:8]]}"
                ),
                "error_type": "form_not_found",
            }

        # 3. Recopilar inputs reales y llenar el formulario
        inputs = await _get_all_inputs(login_frame)
        await _fill_login_form(login_frame, ruc, usuario, password, inputs)
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
