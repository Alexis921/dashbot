"""Genera resúmenes inteligentes usando Claude."""
import os
from typing import List


async def generate_ai_summary(notifications: list) -> str:
    """Genera un resumen ejecutivo con Claude. Si no hay API key, usa resumen básico."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")

    if not api_key or not notifications:
        return _basic_summary(notifications)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        notif_text = "\n".join(
            f"- [{n.get('date_received','')[:10]}] {n['subject']} (Ref: {n.get('reference_number','')})"
            + (f" ⚠️ URGENTE" if n.get("is_urgent") else "")
            for n in notifications
        )

        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": (
                    "Eres un asistente contable/tributario peruano. "
                    "Resume estas notificaciones del buzón SUNAT de forma clara y concisa "
                    "para un contador o administrador. Destaca lo urgente primero, "
                    "indica plazos si los hay y sugiere acciones inmediatas. "
                    "Responde en español, máximo 5 líneas.\n\n"
                    f"Notificaciones:\n{notif_text}"
                )
            }]
        )
        return message.content[0].text

    except Exception as e:
        return _basic_summary(notifications)


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
