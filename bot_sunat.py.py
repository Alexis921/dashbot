from playwright.sync_api import sync_playwright
import time

def ejecutar_bot():
    with sync_playwright() as p:
        # headless=False permite que veas cómo el bot mueve el navegador
        browser = p.chromium.launch(headless=False) 
        page = browser.new_page()
        
        print("Iniciando el BOT SUNAT READER...")
        
        # Ingresamos al portal institucional
        page.goto("https://www.sunat.gob.pe")
        print("¡Portal de SUNAT cargado con éxito!")
        
        # Pausamos el bot 5 segundos para que aprecies que sí entró a la página
        time.sleep(5) 
        
        browser.close()

if __name__ == "__main__":
    ejecutar_bot()