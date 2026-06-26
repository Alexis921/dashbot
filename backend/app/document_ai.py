"""
IA de Documentos (Agenda Tributaria — Fase 3).
Usa Gemini (visión/multimodal) para hacer OCR + extracción estructurada de
comprobantes electrónicos peruanos (facturas, retenciones, etc.) y proponer
una obligación tributaria con su fecha de vencimiento.
"""
import os
import json
import base64
import re
from datetime import date, datetime, timedelta

import httpx

from app.cronograma import es_dia_habil

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
# flash-lite: soporta visión/PDF y tiene cuota gratis más generosa que flash
GEMINI_MODEL = os.getenv("GEMINI_DOC_MODEL", "gemini-2.0-flash-lite")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

EXTRACTION_PROMPT = """Eres un asistente contable experto en tributación peruana (SUNAT).
Analiza este comprobante electrónico (factura, boleta, nota, comprobante de retención o percepción)
y extrae los datos en JSON EXACTO con estas claves (usa null si no aplica o no se encuentra):

{
  "tipo_comprobante": "Factura | Boleta | Nota de Crédito | Nota de Débito | Comprobante de Retención | Comprobante de Percepción",
  "serie_numero": "ej F001-00012345",
  "ruc_emisor": "11 dígitos",
  "razon_social_emisor": "proveedor",
  "ruc_cliente": "11 dígitos",
  "razon_social_cliente": "cliente",
  "fecha_emision": "YYYY-MM-DD",
  "fecha_vencimiento": "YYYY-MM-DD o null",
  "moneda": "PEN | USD",
  "base_imponible": 0.0,
  "igv": 0.0,
  "importe_total": 0.0,
  "detraccion_aplica": true/false,
  "detraccion_porcentaje": 0.0,
  "detraccion_monto": 0.0,
  "detraccion_codigo": "código del bien/servicio sujeto a detracción o null",
  "cuenta_banco_nacion": "número de cuenta del Banco de la Nación o null",
  "numero_operacion": "si existe o null"
}

Reglas:
- Los montos son números (sin símbolo de moneda ni separador de miles).
- Si el documento menciona detracción/SPOT, detraccion_aplica=true y completa porcentaje y monto.
- Calcula cualquier dato faltante si es deducible (ej. igv = base * 0.18; total = base + igv).
- Responde SOLO el JSON, sin texto adicional."""


def quinto_dia_habil_mes_siguiente(fecha_emision: date) -> date:
    """Fecha límite típica para depositar la detracción: 5° día hábil del mes siguiente."""
    y, m = fecha_emision.year, fecha_emision.month
    if m == 12:
        y, m = y + 1, 1
    else:
        m += 1
    d = date(y, m, 1)
    habiles = 0
    while True:
        if es_dia_habil(d):
            habiles += 1
            if habiles >= 5:
                return d
        d += timedelta(days=1)


def _parse_date(s):
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None


async def analizar_documento(file_bytes: bytes, mime_type: str) -> dict:
    """Envía el documento a Gemini, devuelve datos extraídos + obligación sugerida."""
    if not GEMINI_KEY:
        return {"success": False, "error": "GEMINI_API_KEY no configurada en el servidor."}

    b64 = base64.b64encode(file_bytes).decode()
    payload = {
        "contents": [{
            "parts": [
                {"text": EXTRACTION_PROMPT},
                {"inline_data": {"mime_type": mime_type, "data": b64}},
            ]
        }],
        "generationConfig": {"temperature": 0.1, "response_mime_type": "application/json"},
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(GEMINI_URL, json=payload,
                                  headers={"x-goog-api-key": GEMINI_KEY})
            if r.status_code != 200:
                return {"success": False, "error": f"Gemini respondió {r.status_code}: {r.text[:200]}"}
            data = r.json()
            txt = data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        return {"success": False, "error": f"Error al analizar con IA: {str(e)[:200]}"}

    # Parsear el JSON devuelto
    try:
        m = re.search(r"\{.*\}", txt, re.DOTALL)
        datos = json.loads(m.group(0) if m else txt)
    except Exception:
        return {"success": False, "error": "La IA no devolvió datos estructurados.", "raw": txt[:300]}

    sugerencia = _sugerir_obligacion(datos)
    return {"success": True, "datos": datos, "sugerencia": sugerencia}


def _sugerir_obligacion(d: dict) -> dict:
    """Propone una obligación con fecha y prioridad a partir de los datos extraídos."""
    serie = d.get("serie_numero") or "comprobante"
    proveedor = d.get("razon_social_emisor") or ""
    emision = _parse_date(d.get("fecha_emision")) or date.today()

    if d.get("detraccion_aplica"):
        venc = quinto_dia_habil_mes_siguiente(emision)
        monto = d.get("detraccion_monto")
        desc = (
            f"Depósito de detracción (SPOT) del comprobante {serie}"
            + (f" de {proveedor}" if proveedor else "") + ".\n"
            + (f"Monto detracción: S/ {monto}\n" if monto else "")
            + (f"Porcentaje: {d.get('detraccion_porcentaje')}%\n" if d.get("detraccion_porcentaje") else "")
            + (f"Cuenta Banco de la Nación: {d.get('cuenta_banco_nacion')}\n" if d.get("cuenta_banco_nacion") else "")
            + f"Base: S/ {d.get('base_imponible')} · IGV: S/ {d.get('igv')} · Total: S/ {d.get('importe_total')}"
        )
        return {
            "tipo": "detraccion",
            "titulo": f"Pago de detracción · {serie}",
            "descripcion": desc,
            "fecha_vencimiento": venc.isoformat(),
            "prioridad": "alta",
            "nota_fecha": "Fecha sugerida: 5.º día hábil del mes siguiente (verifícala según tu caso).",
        }

    tipo = (d.get("tipo_comprobante") or "Comprobante")
    venc = _parse_date(d.get("fecha_vencimiento")) or quinto_dia_habil_mes_siguiente(emision)
    return {
        "tipo": "otro",
        "titulo": f"Revisar/registrar {tipo} · {serie}",
        "descripcion": (
            f"{tipo} {serie}" + (f" de {proveedor}" if proveedor else "") + ".\n"
            f"Total: S/ {d.get('importe_total')} · IGV: S/ {d.get('igv')}"
        ),
        "fecha_vencimiento": venc.isoformat(),
        "prioridad": "media",
        "nota_fecha": "Fecha estimada; ajústala según tu obligación.",
    }
