"""Prueba la lógica de extracción contra el HTML real guardado del buzón."""
import os
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), "debug_out")
FRAME = os.path.join(OUT, "07_notificaciones_frame4.html")

EXTRACT_JS = """() => {
    const out = [];
    document.querySelectorAll('ul#listaMensajes > li.list-group-item, ul#listaMensajes > li').forEach(li => {
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
            leido: leido ? leido.value : '?',
            urgente: urgente ? urgente.value : '?',
            hasAttach: hasClip
        });
    });
    return out;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.goto("file:///" + FRAME.replace("\\", "/"))
    items = pg.evaluate(EXTRACT_JS)
    print(f"TOTAL EXTRAIDAS: {len(items)}\n")
    for i, it in enumerate(items[:8], 1):
        print(f"{i}. [{it['id']}] leido={it['leido']} urg={it['urgente']} clip={it['hasAttach']}")
        print(f"   {it['subject'][:80]}")
        print(f"   fecha={it['date']} | cat={it['category']}")
    b.close()
