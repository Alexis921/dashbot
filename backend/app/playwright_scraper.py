"""
Scraper del buzón SUNAT con Playwright (Chromium headless).
Flujo REAL validado (debug_sunat.py desde IP peruana):
  1. sol.html → click "Operaciones en Línea" (genera token state) → login OAuth
  2. Llenar #txtRuc, #txtUsuario, #txtContrasena → #btnAceptar
  3. Popup "Valida tus datos": Finalizar → Continuar sin confirmar
  4. Click "Buzón Electrónico" → carga lista
  5. Extraer <ul id="listaMensajes"> <li> ... con asunto/fecha/categoría/adjunto
"""
import asyncio
import re
from datetime import datetime

URGENT_KEYWORDS = [
    "multa", "infracción", "cobranza coactiva", "embargo", "sanción",
    "fiscalización", "requerimiento", "ejecución coactiva",
    "resolución de determinación", "resolución de multa", "orden de pago",
    "vencimiento", "urgente", "citación", "esquela",
]

SOL_URL = "https://www.sunat.gob.pe/sol.html"
EMENU_HOST = "https://e-menu.sunat.gob.pe"

# JS de extracción validado contra el HTML real del buzón
EXTRACT_JS = r"""() => {
    const out = [];
    const lis = document.querySelectorAll('ul#listaMensajes > li.list-group-item, ul#listaMensajes > li');
    lis.forEach(li => {
        const link = li.querySelector('a.linkMensaje');
        if (!link) return;
        const subject = (link.innerText || '').trim();
        if (!subject) return;
        const dateEl = li.querySelector('.fecPublica');
        const tagEl = li.querySelector('.label.tag, .label');
        const leido = li.querySelector('input[id="idLeido"]');
        const urgente = li.querySelector('input[id="idUrgente"]');
        const hasClip = !!li.querySelector('.fa-paperclip, [class*="paperclip"]');
        out.push({
            id: li.id || '',
            subject: subject,
            date: dateEl ? dateEl.innerText.trim() : '',
            category: tagEl ? tagEl.innerText.trim() : '',
            leido: leido ? leido.value : '0',
            urgente: urgente ? urgente.value : '0',
            hasAttach: hasClip
        });
    });
    return out;
}"""


def _is_urgent(subject: str, urgente_flag: str) -> bool:
    if urgente_flag == "1":
        return True
    s = subject.lower()
    return any(kw in s for kw in URGENT_KEYWORDS)


async def scrape_with_playwright(ruc: str, usuario: str, password: str) -> dict:
    try:
        from playwright.async_api import async_playwright  # noqa
    except ImportError:
        return {"success": False, "notifications": [], "error": "Playwright no instalado.", "error_type": "playwright_not_installed"}

    try:
        return await asyncio.wait_for(_run(ruc, usuario, password), timeout=110.0)
    except asyncio.TimeoutError:
        return {"success": False, "notifications": [],
                "error": "SUNAT tardó más de 110 segundos en responder.", "error_type": "timeout"}
    except Exception as e:
        return {"success": False, "notifications": [],
                "error": f"Error de navegador: {str(e)[:200]}", "error_type": "browser_error"}


async def _run(ruc: str, usuario: str, password: str) -> dict:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
                  "--disable-gpu", "--disable-extensions"],
        )
        ctx = await browser.new_context(
            viewport={"width": 1366, "height": 900},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
            locale="es-PE",
        )
        page = await ctx.new_page()
        try:
            return await _login_and_scrape(ctx, page, ruc, usuario, password)
        finally:
            await browser.close()


async def _click_maybe_newtab(ctx, page, selector: str, timeout: int = 8000):
    """Hace click; si abre nueva pestaña la devuelve, si no devuelve la misma página."""
    from playwright.async_api import TimeoutError as PWTimeout
    try:
        async with ctx.expect_page(timeout=timeout) as new_info:
            await page.locator(selector).first.click()
        new_page = await new_info.value
        try:
            await new_page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        return new_page
    except PWTimeout:
        # No abrió nueva pestaña — el click igual pudo navegar la misma página
        try:
            await page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        return page
    except Exception:
        return page


async def _login_and_scrape(ctx, page, ruc, usuario, password) -> dict:
    from playwright.async_api import TimeoutError as PWTimeout

    try:
        # ── 1. sol.html (genera token state) ──────────────────────────────
        await page.goto(SOL_URL, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1500)

        # ── 2. Ir al login (puede abrir nueva pestaña) ────────────────────
        page = await _click_maybe_newtab(
            ctx, page,
            "a:has-text('Operaciones en Línea'), a:has-text('Operaciones en Linea'), a:has-text('Ingresar')",
        )
        await page.wait_for_timeout(2000)

        # ── 3. Llenar formulario de login ─────────────────────────────────
        try:
            await page.wait_for_selector("#txtRuc", timeout=15000)
        except PWTimeout:
            return {"success": False, "notifications": [],
                    "error": f"No se encontró el formulario de login. URL: {page.url}",
                    "error_type": "form_not_found"}

        await page.fill("#txtRuc", ruc)
        await page.fill("#txtUsuario", usuario)
        await page.fill("#txtContrasena", password)
        await page.click("#btnAceptar")
        await page.wait_for_timeout(4000)
        try:
            await page.wait_for_load_state("networkidle", timeout=25000)
        except Exception:
            pass

        # ── 4. Verificar credenciales ─────────────────────────────────────
        body = (await page.inner_text("body")).lower()
        if any(e in body for e in ["contraseña incorrecta", "usuario o contraseña",
                                    "datos incorrectos", "no es válido", "no válido"]):
            return {"success": False, "notifications": [],
                    "error": "Credenciales incorrectas. Verifica RUC, usuario SOL y contraseña SOL.",
                    "error_type": "credenciales"}
        if "error en la invocaci" in body:
            return {"success": False, "notifications": [],
                    "error": "SUNAT rechazó la sesión (token inválido). Reintenta en unos segundos.",
                    "error_type": "session_error"}

        # ── 5. Popup "Valida tus datos de contacto" ───────────────────────
        for label in ["Finalizar", "Continuar sin confirmar"]:
            try:
                btn = page.locator(f"button:has-text('{label}'), input[value*='{label}']")
                if await btn.count() > 0:
                    await btn.first.click()
                    await page.wait_for_timeout(2500)
            except Exception:
                pass

        # ── 6. Click "Buzón Electrónico" ──────────────────────────────────
        buzon = page
        try:
            buzon = await _click_maybe_newtab(
                ctx, page,
                "a:has-text('Buzón Electrónico'), a:has-text('Buzon Electronico')",
                timeout=8000,
            )
        except Exception:
            pass
        await buzon.wait_for_timeout(4000)

        # Asegurar que la pestaña "Buzón Notificaciones" esté activa
        for fr in buzon.frames:
            try:
                tab = fr.locator("a:has-text('Buzón Notificaciones'), a:has-text('Notificaciones')")
                if await tab.count() > 0:
                    await tab.first.click()
                    await buzon.wait_for_timeout(3000)
                    break
            except Exception:
                continue

        # ── 7. Extraer notificaciones del frame con listaMensajes ─────────
        notifs_raw = []
        for fr in buzon.frames:
            try:
                if await fr.locator("ul#listaMensajes").count() > 0:
                    await fr.wait_for_selector("ul#listaMensajes > li", timeout=8000)
                    notifs_raw = await fr.evaluate(EXTRACT_JS)
                    if notifs_raw:
                        break
            except Exception:
                continue

        # Fallback: intentar en la página principal
        if not notifs_raw:
            try:
                notifs_raw = await buzon.evaluate(EXTRACT_JS)
            except Exception:
                pass

        if not notifs_raw:
            # ¿Buzón vacío o no cargó?
            txt = ""
            for fr in buzon.frames:
                try:
                    txt += (await fr.inner_text("body")).lower()
                except Exception:
                    pass
            if "listamensajes" in txt or "no tiene" in txt or "bandeja" in txt:
                return {"success": True, "notifications": [], "error": None,
                        "note": "Buzón sin notificaciones."}
            return {"success": False, "notifications": [],
                    "error": f"Buzón abierto pero sin lista de mensajes. URL: {buzon.url}",
                    "error_type": "buzon_empty"}

        notifications = _build(notifs_raw, ruc)
        return {"success": True, "notifications": notifications, "error": None}

    except PWTimeout as e:
        return {"success": False, "notifications": [],
                "error": f"SUNAT no respondió a tiempo: {str(e)[:120]}", "error_type": "timeout"}
    except Exception as e:
        err = str(e)
        if "ERR_NAME_NOT_RESOLVED" in err:
            return {"success": False, "notifications": [],
                    "error": "No se resuelve el dominio de SUNAT (DNS).", "error_type": "dns_error"}
        return {"success": False, "notifications": [],
                "error": f"Error: {err[:280]}", "error_type": "navigation_error"}


def _parse_date(s: str) -> datetime:
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?", s or "")
    if m:
        try:
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            hh = int(m.group(4) or 0); mm = int(m.group(5) or 0); ss = int(m.group(6) or 0)
            return datetime(y, mo, d, hh, mm, ss)
        except Exception:
            pass
    return datetime.utcnow()


def _build(items: list, ruc: str) -> list:
    out = []
    for it in items or []:
        subject = (it.get("subject") or "").replace("ASUNTO:", "").strip()
        if not subject:
            continue
        msg_id = it.get("id", "")
        ref = re.search(r"N[°º]\s*([\d\-]+)", subject)
        out.append({
            "id": f"S-{ruc}-{msg_id}" if msg_id else f"S-{ruc}-{abs(hash(subject)) & 0xFFFFFF}",
            "sunat_msg_id": msg_id,
            "subject": subject[:300],
            "reference_number": ref.group(1) if ref else "",
            "date_received": _parse_date(it.get("date", "")).isoformat(),
            "sender": "SUNAT",
            "status": "leido" if it.get("leido") == "1" else "nuevo",
            "body_text": f"Categoría: {it.get('category', '')}",
            "category": it.get("category", ""),
            "has_attachment": bool(it.get("hasAttach")),
            "attachment_name": "constancia.pdf" if it.get("hasAttach") else "",
            "is_urgent": _is_urgent(subject, it.get("urgente", "0")),
            "ruc": ruc,
        })
    return out


# ─────────────────────────────────────────────────────────────────────────
# Descarga de PDF on-demand: re-login + abrir mensaje + bajar constancia
# ─────────────────────────────────────────────────────────────────────────
async def download_pdf_from_sunat(ruc: str, usuario: str, password: str, sunat_msg_id: str) -> dict:
    """Re-loguea, abre el mensaje por ID y descarga el PDF de la constancia."""
    try:
        from playwright.async_api import async_playwright  # noqa
    except ImportError:
        return {"success": False, "error": "Playwright no instalado."}
    try:
        return await asyncio.wait_for(
            _download_pdf(ruc, usuario, password, sunat_msg_id), timeout=110.0)
    except asyncio.TimeoutError:
        return {"success": False, "error": "Timeout al descargar PDF de SUNAT."}
    except Exception as e:
        return {"success": False, "error": f"Error: {str(e)[:200]}"}


async def _download_pdf(ruc, usuario, password, sunat_msg_id) -> dict:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        ctx = await browser.new_context(locale="es-PE", viewport={"width": 1366, "height": 900})
        page = await ctx.new_page()
        try:
            # Login (mismo flujo)
            await page.goto(SOL_URL, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(1500)
            page = await _click_maybe_newtab(
                ctx, page,
                "a:has-text('Operaciones en Línea'), a:has-text('Ingresar')")
            await page.wait_for_selector("#txtRuc", timeout=15000)
            await page.fill("#txtRuc", ruc)
            await page.fill("#txtUsuario", usuario)
            await page.fill("#txtContrasena", password)
            await page.click("#btnAceptar")
            await page.wait_for_timeout(4000)
            for label in ["Finalizar", "Continuar sin confirmar"]:
                try:
                    btn = page.locator(f"button:has-text('{label}'), input[value*='{label}']")
                    if await btn.count() > 0:
                        await btn.first.click()
                        await page.wait_for_timeout(2000)
                except Exception:
                    pass
            buzon = await _click_maybe_newtab(
                ctx, page, "a:has-text('Buzón Electrónico')")
            await buzon.wait_for_timeout(3000)

            # Abrir el mensaje específico y leer el link bajarArchivo
            for fr in buzon.frames:
                try:
                    li = fr.locator(f"li#{sunat_msg_id} a.linkMensaje")
                    if await li.count() > 0:
                        await li.first.click()
                        await buzon.wait_for_timeout(2500)
                        adj = fr.locator("#listArchivosAdjuntos a[href*='bajarArchivo'], a[href*='bajarArchivo']")
                        if await adj.count() > 0:
                            href = await adj.first.get_attribute("href")
                            name = (await adj.first.inner_text()).strip()
                            url = href if href.startswith("http") else EMENU_HOST + href
                            # Descargar usando las cookies de la sesión
                            resp = await ctx.request.get(url)
                            if resp.ok:
                                data = await resp.body()
                                return {"success": True, "data": data,
                                        "filename": (name or "constancia") + ".pdf"}
                            return {"success": False, "error": f"SUNAT devolvió {resp.status} al bajar el PDF."}
                except Exception:
                    continue

            return {"success": False, "error": "No se encontró el adjunto del mensaje en SUNAT."}
        finally:
            await browser.close()
