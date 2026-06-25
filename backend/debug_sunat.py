"""
Script de diagnóstico LOCAL para mapear el flujo real de SUNAT.
Corre con navegador VISIBLE desde la IP peruana del usuario.
Guarda screenshots + HTML en debug_out/ para analizar la estructura real.

Uso:  py debug_sunat.py
      (pedirá RUC, usuario y contraseña de forma segura)
"""
import sys
import os
import getpass
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), "debug_out")
os.makedirs(OUT, exist_ok=True)

SOL_URL = "https://www.sunat.gob.pe/sol.html"


def dump(page, name):
    """Guarda screenshot + HTML de la página y de todos sus frames."""
    try:
        page.screenshot(path=os.path.join(OUT, f"{name}.png"), full_page=True)
    except Exception as e:
        print(f"  [screenshot fail {name}]: {e}")
    try:
        with open(os.path.join(OUT, f"{name}.html"), "w", encoding="utf-8") as f:
            f.write(page.content())
    except Exception as e:
        print(f"  [html fail {name}]: {e}")
    # Frames
    for i, fr in enumerate(page.frames):
        if fr.url and "about:blank" not in fr.url:
            print(f"    frame{i}: {fr.url}")
            try:
                with open(os.path.join(OUT, f"{name}_frame{i}.html"), "w", encoding="utf-8") as f:
                    f.write(fr.content())
            except Exception:
                pass


def main():
    print("=== Diagnostico SUNAT (las credenciales NO se guardan en disco) ===")
    ruc = input("RUC: ").strip()
    usuario = input("Usuario SOL: ").strip()
    password = input("Contrasena SOL: ").strip()
    print(f"\nConfirma -> RUC={ruc} | Usuario={usuario} | Contrasena tiene {len(password)} caracteres")
    ok = input("Es correcto? (s/n): ").strip().lower()
    if ok != "s":
        print("Cancelado. Vuelve a correr el script.")
        sys.exit(0)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=300)
        ctx = browser.new_context(locale="es-PE", viewport={"width": 1366, "height": 900})
        page = ctx.new_page()

        print("PASO 1: abrir sol.html (genera el token state)")
        page.goto(SOL_URL, wait_until="networkidle", timeout=40000)
        page.wait_for_timeout(2000)
        dump(page, "01_sol")

        # Dump de TODOS los links para ver cuál lleva al login
        links = page.evaluate("""() =>
            [...document.querySelectorAll('a')].map(a => ({
                text: (a.innerText||'').trim().slice(0,50),
                href: a.href,
                onclick: (a.getAttribute('onclick')||'').slice(0,100)
            })).filter(a => a.text || a.onclick)
        """)
        print("LINKS en sol.html:")
        for l in links:
            print("  ", l)

        # PASO 2: hacer click en "Ingresar" / "Operaciones en Línea"
        # Puede abrir NUEVA PESTAÑA o navegar en la misma
        print("PASO 2: click para ir al login")
        target = page
        try:
            with ctx.expect_page(timeout=8000) as newp:
                page.click("a:has-text('Operaciones en Línea'), a:has-text('Ingresar')")
            target = newp.value
            print(f"  -> abrio NUEVA PESTANA: {target.url}")
        except Exception:
            print("  -> sin nueva pestana, navegando en mismo tab")
            try:
                page.click("a:has-text('Operaciones en Línea'), a:has-text('Ingresar')")
            except Exception as e:
                print(f"  [click fail]: {e}")
        target.wait_for_timeout(4000)
        try:
            target.wait_for_load_state("networkidle", timeout=25000)
        except Exception:
            pass
        page = target  # seguir con la pestaña del login
        print(f"URL del login: {page.url}")
        dump(page, "02_login_page")

        # Listar inputs del formulario de login real
        inputs = page.evaluate("""() =>
            [...document.querySelectorAll('input')].map(e => ({
                name:e.name, id:e.id, type:e.type, placeholder:e.placeholder,
                visible: e.offsetParent !== null
            }))
        """)
        print("INPUTS login:")
        for i in inputs:
            print("  ", i)

        # PASO 3: llenar credenciales (campos reales: txtRuc, txtUsuario, txtContrasena)
        print("PASO 3: llenar credenciales")
        try:
            page.fill("#txtRuc", ruc)
            page.fill("#txtUsuario", usuario)
            page.fill("#txtContrasena", password)
            dump(page, "03_filled")
            page.click("#btnAceptar")
        except Exception as e:
            print(f"  [fill por id fallo: {e}] - intentando por orden")
            vis = [i for i in inputs if i["visible"] and i["type"] != "hidden"]
            if len(vis) >= 3:
                page.fill(f"#{vis[0]['id']}" if vis[0]['id'] else f"[name='{vis[0]['name']}']", ruc)
                page.fill(f"#{vis[1]['id']}" if vis[1]['id'] else f"[name='{vis[1]['name']}']", usuario)
                page.fill(f"#{vis[2]['id']}" if vis[2]['id'] else f"[name='{vis[2]['name']}']", password)
            page.keyboard.press("Enter")

        page.wait_for_timeout(5000)
        try:
            page.wait_for_load_state("networkidle", timeout=30000)
        except Exception:
            pass
        print(f"URL tras login: {page.url}")
        dump(page, "04_after_login")

        # Popup "Valida tus datos de contacto"
        print("PASO 4: manejar popups")
        for label in ["Finalizar", "Continuar sin confirmar"]:
            try:
                btn = page.locator(f"button:has-text('{label}'), input[value*='{label}']")
                if btn.count() > 0:
                    print(f"  click '{label}'")
                    btn.first.click()
                    page.wait_for_timeout(2500)
            except Exception as e:
                print(f"  [{label} fail]: {e}")
        dump(page, "05_after_popups")

        # Buscar link "Buzón Electrónico"
        print("PASO 5: buscar link Buzón Electrónico")
        links = page.evaluate("""() =>
            [...document.querySelectorAll('a')].map(a => ({
                text: (a.innerText||'').trim().slice(0,40),
                href: a.href, onclick: (a.getAttribute('onclick')||'').slice(0,80)
            })).filter(a => a.text && (a.text.toLowerCase().includes('buz') || a.text.toLowerCase().includes('notif')))
        """)
        print("LINKS buzón:")
        for l in links:
            print("  ", l)

        # Intentar click en buzón (puede abrir tab o cargar en frame)
        try:
            with ctx.expect_page(timeout=8000) as newp:
                page.click("a:has-text('Buzón Electrónico')")
            buzon = newp.value
            print(f"  → abrió NUEVA PESTAÑA: {buzon.url}")
        except Exception:
            buzon = page
            print("  → no abrió nueva pestaña, mismo page")
            try:
                page.click("a:has-text('Buzón Electrónico')")
            except Exception as e:
                print(f"  [click buzón fail]: {e}")

        buzon.wait_for_timeout(6000)
        try:
            buzon.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        print(f"URL buzón: {buzon.url}")
        dump(buzon, "06_buzon")

        # Buscar "Buzón Notificaciones"
        print("PASO 6: click Buzón Notificaciones")
        try:
            nb = buzon.locator("a:has-text('Buzón Notificaciones'), a:has-text('Notificaciones')")
            print(f"  count notif links: {nb.count()}")
            if nb.count() > 0:
                nb.first.click()
                buzon.wait_for_timeout(5000)
        except Exception as e:
            print(f"  [notif fail]: {e}")
        dump(buzon, "07_notificaciones")

        # Texto de cada frame
        print("PASO 7: contenido de frames del buzón")
        for i, fr in enumerate(buzon.frames):
            try:
                t = fr.inner_text("body")[:300]
                print(f"  frame{i} ({fr.url[:70]}): {t[:150]!r}")
            except Exception:
                pass

        print("\n=== Revisa la carpeta debug_out/ ===")
        print("Presiona ENTER para cerrar el navegador...")
        input()
        browser.close()


if __name__ == "__main__":
    main()
