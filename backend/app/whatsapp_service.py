"""
Envío de alertas por WhatsApp.
Proveedor por defecto: CallMeBot (gratis). El usuario registra su número con el
bot de CallMeBot y obtiene un apikey; se envía con un simple GET.
Diseñado para cambiar de proveedor (Twilio / WhatsApp Cloud API) en el futuro.
"""
import os
import urllib.parse
import httpx

WHATSAPP_PROVIDER = os.getenv("WHATSAPP_PROVIDER", "callmebot")


def _normalize_phone(numero: str) -> str:
    """Deja solo dígitos y el + inicial. CallMeBot acepta formato +519xxxxxxxx."""
    n = (numero or "").strip().replace(" ", "").replace("-", "")
    if not n:
        return ""
    if not n.startswith("+"):
        # Si no tiene código país y parece peruano (9 dígitos), anteponer +51
        digits = "".join(c for c in n if c.isdigit())
        if len(digits) == 9:
            return "+51" + digits
        return "+" + digits
    return "+" + "".join(c for c in n[1:] if c.isdigit())


async def send_whatsapp(numero: str, apikey: str, mensaje: str) -> dict:
    """Envía un mensaje de WhatsApp. Devuelve {success, error}."""
    phone = _normalize_phone(numero)
    if not phone:
        return {"success": False, "error": "Número de WhatsApp no válido."}
    if not apikey:
        return {"success": False, "error": "Falta el API key de CallMeBot. Configúralo en Configuración."}

    if WHATSAPP_PROVIDER == "callmebot":
        try:
            url = (
                "https://api.callmebot.com/whatsapp.php"
                f"?phone={urllib.parse.quote(phone)}"
                f"&text={urllib.parse.quote(mensaje)}"
                f"&apikey={urllib.parse.quote(apikey)}"
            )
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.get(url)
                txt = r.text.lower()
                if r.status_code == 200 and ("message queued" in txt or "message sent" in txt or "success" in txt):
                    return {"success": True, "error": None}
                # CallMeBot devuelve 200 con HTML aun en errores; intentar detectar
                if "apikey" in txt and ("invalid" in txt or "not" in txt):
                    return {"success": False, "error": "API key inválido o número no registrado en CallMeBot."}
                if r.status_code == 200:
                    return {"success": True, "error": None}
                return {"success": False, "error": f"CallMeBot respondió {r.status_code}."}
        except Exception as e:
            return {"success": False, "error": f"Error al enviar WhatsApp: {str(e)[:150]}"}

    return {"success": False, "error": f"Proveedor WhatsApp '{WHATSAPP_PROVIDER}' no soportado."}


def build_alert_message(empresa_nombre: str, ruc: str, notifs: list, nivel: str) -> str:
    """Construye el texto de la alerta WhatsApp para notificaciones nuevas."""
    if nivel == "urgentes":
        relevantes = [n for n in notifs if n.get("is_urgent")]
    else:
        relevantes = list(notifs)
    if not relevantes:
        return ""

    urgentes = sum(1 for n in relevantes if n.get("is_urgent"))
    lineas = [
        "🔔 *Dashbot - Alerta SUNAT*",
        f"📋 {empresa_nombre or ('RUC ' + ruc)}",
        "",
        f"Tienes *{len(relevantes)}* notificación(es) nueva(s)"
        + (f", *{urgentes} urgente(s)* 🔴" if urgentes else "") + ":",
        "",
    ]
    for n in relevantes[:5]:
        marca = "🔴" if n.get("is_urgent") else "•"
        asunto = (n.get("subject", "") or "")[:90]
        lineas.append(f"{marca} {asunto}")
    if len(relevantes) > 5:
        lineas.append(f"...y {len(relevantes) - 5} más.")
    lineas += ["", "Revisa el detalle en dashbot.pro"]
    return "\n".join(lineas)
