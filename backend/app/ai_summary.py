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
    """Interpreta una notificación SUNAT con análisis de abogado tributarista experto."""
    subject = notification.get("subject", "")
    body = notification.get("body_text", "")
    ref = notification.get("reference_number", "")
    sender = notification.get("sender", "SUNAT")
    date = notification.get("date_received", "")[:10]
    is_urgent = notification.get("is_urgent", False)

    prompt = f"""Eres el mejor abogado tributarista del Perú, con 20 años de experiencia en el Tribunal Fiscal, SUNAT y litigios tributarios. Analizas esta notificación del Buzón Electrónico SOL con precisión legal y práctica.

NOTIFICACIÓN SUNAT:
- Asunto: {subject}
- Remitente: {sender}
- Fecha de notificación: {date}
- Número de referencia: {ref}
- Contenido: {body}

Proporciona un análisis tributario completo con este formato exacto:

⚖️ NATURALEZA JURÍDICA
[Explica qué tipo de acto administrativo es, qué norma del Código Tributario o ley lo sustenta, y sus efectos legales desde la fecha de notificación en el buzón SOL]

🚨 NIVEL DE RIESGO: [CRÍTICO / ALTO / MEDIO / BAJO]
[Justifica el nivel con base legal específica]

⏰ PLAZOS LEGALES
[Lista los plazos exactos que tiene el contribuyente para responder, apelar o cumplir. Cita artículos del Código Tributario si aplica]

🎯 ACCIONES INMEDIATAS (en orden de prioridad)
1. [Acción concreta con plazo]
2. [Acción concreta con plazo]
3. [Acción concreta con plazo]

💰 CONSECUENCIAS DE NO ACTUAR
[Describe las consecuencias legales y económicas específicas: embargos, multas, intereses TIM, cobranza coactiva, etc.]

💡 ESTRATEGIA RECOMENDADA
[Recomendación táctica del abogado: si conviene pagar, apelar, solicitar fraccionamiento, interponer recurso de reclamación, etc.]

Sé específico, usa términos legales peruanos y cita artículos cuando sea relevante. Máximo 350 palabras."""

    result = await _call_gemini(prompt, max_tokens=700) or await _call_claude(prompt, max_tokens=700)
    if result:
        return result

    # Fallback básico sin IA
    urgencia = "🚨 CRÍTICO" if is_urgent else "⚠️ REQUIERE ATENCIÓN"
    lines = [
        f"⚖️ NATURALEZA JURÍDICA\nNotificación oficial de {sender}. Asunto: {subject}",
        f"\n🚨 NIVEL DE RIESGO: {urgencia}",
        f"\n⏰ PLAZOS LEGALES\nSegún el Art. 104 del Código Tributario, la notificación en el Buzón SOL surte efectos desde el día hábil siguiente a su depósito.",
        f"\n🎯 ACCIONES INMEDIATAS\n1. Revisar el documento completo adjunto\n2. Consultar con contador o abogado tributario\n3. Verificar plazos específicos en el documento",
        f"\n💰 CONSECUENCIAS DE NO ACTUAR\nEl incumplimiento puede generar multas, intereses moratorios (TIM 1.2% mensual) y cobranza coactiva.",
        f"\n💡 ESTRATEGIA RECOMENDADA\nContactar inmediatamente a un especialista tributario para evaluar las opciones legales disponibles.",
    ]
    return "\n".join(lines)


async def generate_ai_summary_expert(notifications: list) -> str:
    """Genera resumen ejecutivo con análisis de riesgo tributario global."""
    if not notifications:
        return _basic_summary(notifications)

    urgent = [n for n in notifications if n.get("is_urgent")]
    notif_text = "\n".join(
        f"- [{n.get('date_received','')[:10]}] {n['subject']} | Ref: {n.get('reference_number','')} | {n.get('sender','')}"
        + (" 🚨 URGENTE" if n.get("is_urgent") else "")
        for n in notifications
    )

    prompt = f"""Eres el mejor abogado tributarista del Perú. Analiza estas {len(notifications)} notificaciones del Buzón SUNAT SOL y genera un resumen ejecutivo para el contador responsable.

NOTIFICACIONES:
{notif_text}

Genera el siguiente resumen ejecutivo:

📊 DIAGNÓSTICO GENERAL
[Estado global del contribuyente frente a SUNAT en 2-3 oraciones]

🚨 ALERTAS CRÍTICAS ({len(urgent)} urgentes)
[Lista solo las notificaciones de mayor riesgo con acción inmediata requerida]

⏰ PRÓXIMOS VENCIMIENTOS
[Plazos más cercanos a vencer según las notificaciones]

🎯 PLAN DE ACCIÓN PRIORITARIO
1. [Acción más urgente]
2. [Segunda acción]
3. [Tercera acción]

Responde en español, máximo 200 palabras. Sé específico y práctico."""

    result = await _call_gemini(prompt, max_tokens=500) or await _call_claude(prompt, max_tokens=500)
    return result or _basic_summary(notifications)


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
