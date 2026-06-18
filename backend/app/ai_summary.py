"""Genera resúmenes e interpretaciones usando IA (Gemini gratis o Claude)."""
import os
import httpx


GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.0-flash-lite:generateContent"
)


async def _call_gemini(prompt: str, max_tokens: int = 600) -> str | None:
    """Llama a Gemini 2.0 Flash Lite (gratis). Retorna None si no hay key."""
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                GEMINI_API_URL,
                params={"key": api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.3},
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception:
        pass
    return None


async def _call_claude(prompt: str, max_tokens: int = 500) -> str | None:
    """Llama a Claude Haiku. Retorna None si no hay key."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip()
    except Exception:
        return None


async def generate_ai_summary(notifications: list) -> str:
    """Genera un resumen ejecutivo del buzón SUNAT."""
    if not notifications:
        return _basic_summary(notifications)

    notif_text = "\n".join(
        f"- [{n.get('date_received','')[:10]}] {n['subject']} (Ref: {n.get('reference_number','')})"
        + (" ⚠️ URGENTE" if n.get("is_urgent") else "")
        for n in notifications
    )
    prompt = (
        "Eres un asistente contable/tributario peruano. "
        "Resume estas notificaciones del buzón SUNAT de forma clara y concisa "
        "para un contador. Destaca lo urgente primero, indica plazos si los hay "
        "y sugiere acciones inmediatas. Responde en español, máximo 5 líneas.\n\n"
        f"Notificaciones:\n{notif_text}"
    )

    result = await _call_gemini(prompt) or await _call_claude(prompt)
    return result or _basic_summary(notifications)


async def generate_notification_interpretation(notification: dict) -> str:
    """Interpreta una notificación SUNAT específica con detalle."""
    subject = notification.get("subject", "")
    body = notification.get("body_text", "")
    ref = notification.get("reference_number", "")
    sender = notification.get("sender", "SUNAT")
    date = notification.get("date_received", "")[:10]

    prompt = (
        "Eres un experto tributario peruano. Analiza esta notificación del buzón SUNAT "
        "y proporciona una interpretación práctica en español.\n\n"
        f"Asunto: {subject}\n"
        f"Remitente: {sender}\n"
        f"Fecha: {date}\n"
        f"Referencia: {ref}\n"
        f"Contenido: {body}\n\n"
        "Responde con:\n"
        "1. ¿Qué significa esta notificación? (2-3 oraciones)\n"
        "2. ¿Es urgente? ¿Por qué?\n"
        "3. ¿Qué acciones debe tomar el contador? (lista corta)\n"
        "4. ¿Hay plazos importantes?\n\n"
        "Sé específico y práctico. Máximo 200 palabras."
    )

    result = await _call_gemini(prompt, max_tokens=400) or await _call_claude(prompt, max_tokens=400)
    if result:
        return result

    # Fallback básico sin IA
    lines = [f"📋 Notificación de {sender}"]
    if notification.get("is_urgent"):
        lines.append("⚠️ Esta notificación requiere atención urgente.")
    lines.append(f"📄 Asunto: {subject}")
    if body:
        lines.append(f"📝 Contenido: {body[:200]}")
    lines.append("💡 Recomendación: Consultar con un especialista tributario para determinar las acciones a tomar.")
    return "\n".join(lines)


def _basic_summary(notifications: list) -> str:
    if not notifications:
        return "No hay notificaciones nuevas en el buzón SUNAT."

    urgent = [n for n in notifications if n.get("is_urgent")]
    total = len(notifications)

    lines = [f"📊 Tienes {total} notificación(es) en el buzón SUNAT."]

    if urgent:
        lines.append(f"⚠️ {len(urgent)} requiere(n) atención urgente:")
        for n in urgent[:3]:
            lines.append(f"   • {n['subject'][:80]}")

    pending = [n for n in notifications if n.get("status") == "nuevo"]
    if pending:
        lines.append(f"📬 {len(pending)} notificación(es) sin leer.")

    lines.append("Revisa el buzón para ver el detalle completo.")
    return "\n".join(lines)
