"""
Cronograma de vencimientos tributarios SUNAT + vencimientos SIRE.

- Las fechas de declaración mensual se obtienen del cronograma OFICIAL de SUNAT
  (ww3.sunat.gob.pe/cl-ti-itcronobligme) según el último dígito del RUC. Se cachean
  por (año, último dígito) porque el cronograma solo depende de eso.
- El vencimiento del SIRE es el DÍA HÁBIL ANTERIOR al vencimiento de la declaración
  (SUNAT trabaja con días hábiles: si vence lunes, el SIRE venció el viernes previo).
"""
import re
import asyncio
from datetime import date, datetime, timedelta
import httpx

CRONO_URL = "https://ww3.sunat.gob.pe/cl-ti-itcronobligme/fvS01Alias"

_MESES = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "sep": 9, "oct": 10, "nov": 11, "dic": 12,
}
_MES_NOMBRE = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Setiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

# Feriados nacionales no laborables de Perú (para calcular el día hábil del SIRE).
# Se incluyen 2025-2027; los fines de semana se manejan aparte.
FERIADOS = {
    # 2025 (por si un periodo vence en enero refiriéndose a dic anterior)
    date(2025, 12, 8), date(2025, 12, 9), date(2025, 12, 25),
    # 2026
    date(2026, 1, 1), date(2026, 4, 2), date(2026, 4, 3), date(2026, 5, 1),
    date(2026, 6, 7), date(2026, 6, 29), date(2026, 7, 28), date(2026, 7, 29),
    date(2026, 8, 6), date(2026, 8, 30), date(2026, 10, 8), date(2026, 11, 1),
    date(2026, 12, 8), date(2026, 12, 9), date(2026, 12, 25),
    # 2027 (para el periodo Dic-26 que vence en enero 2027)
    date(2027, 1, 1),
}


# ── Cronograma oficial 2026 embebido (respaldo) ─────────────────────────────
# Obtenido del propio consultor de SUNAT (consPers) para los 10 últimos dígitos,
# verificado contra el patrón de días hábiles consecutivos y muestras múltiples
# por dígito (los RUC con prórrogas individuales fueron descartados).
# Formato: {ultimo_digito: {periodo_mes: (dia_venc, mes_venc)}}
# Se usa cuando el endpoint de SUNAT no responde (protección anti-bot intermitente).
CRONO_2026 = {
    0: {1: (16, 2), 2: (16, 3), 3: (17, 4), 4: (18, 5), 5: (15, 6), 6: (15, 7), 7: (18, 8), 8: (15, 9), 9: (16, 10), 10: (16, 11), 11: (17, 12), 12: (18, 1)},
    1: {1: (17, 2), 2: (17, 3), 3: (20, 4), 4: (19, 5), 5: (16, 6), 6: (16, 7), 7: (19, 8), 8: (16, 9), 9: (19, 10), 10: (17, 11), 11: (18, 12), 12: (19, 1)},
    2: {1: (18, 2), 2: (18, 3), 3: (21, 4), 4: (20, 5), 5: (17, 6), 6: (17, 7), 7: (20, 8), 8: (17, 9), 9: (20, 10), 10: (18, 11), 11: (21, 12), 12: (20, 1)},
    3: {1: (18, 2), 2: (18, 3), 3: (21, 4), 4: (20, 5), 5: (17, 6), 6: (17, 7), 7: (20, 8), 8: (17, 9), 9: (20, 10), 10: (18, 11), 11: (21, 12), 12: (20, 1)},
    4: {1: (19, 2), 2: (19, 3), 3: (22, 4), 4: (21, 5), 5: (18, 6), 6: (20, 7), 7: (21, 8), 8: (18, 9), 9: (21, 10), 10: (19, 11), 11: (22, 12), 12: (21, 1)},
    5: {1: (19, 2), 2: (19, 3), 3: (22, 4), 4: (21, 5), 5: (18, 6), 6: (20, 7), 7: (21, 8), 8: (18, 9), 9: (21, 10), 10: (19, 11), 11: (22, 12), 12: (21, 1)},
    6: {1: (20, 2), 2: (20, 3), 3: (23, 4), 4: (22, 5), 5: (19, 6), 6: (21, 7), 7: (24, 8), 8: (21, 9), 9: (22, 10), 10: (20, 11), 11: (23, 12), 12: (22, 1)},
    7: {1: (20, 2), 2: (20, 3), 3: (23, 4), 4: (22, 5), 5: (19, 6), 6: (21, 7), 7: (24, 8), 8: (21, 9), 9: (22, 10), 10: (20, 11), 11: (23, 12), 12: (22, 1)},
    8: {1: (23, 2), 2: (23, 3), 3: (24, 4), 4: (25, 5), 5: (22, 6), 6: (22, 7), 7: (25, 8), 8: (22, 9), 9: (23, 10), 10: (23, 11), 11: (24, 12), 12: (25, 1)},
    9: {1: (23, 2), 2: (23, 3), 3: (24, 4), 4: (25, 5), 5: (22, 6), 6: (22, 7), 7: (25, 8), 8: (22, 9), 9: (23, 10), 10: (23, 11), 11: (24, 12), 12: (25, 1)},
}
_CRONO_EMBEBIDO = {2026: CRONO_2026}


def _pares_fallback(ruc: str, anio: int) -> list:
    """Cronograma embebido para el año, si existe. Devuelve [(periodo_mes, fecha)]."""
    fila = _CRONO_EMBEBIDO.get(anio, {}).get(int(ruc[-1]), {})
    pares = []
    for pm, (dia, mes) in fila.items():
        y = anio + 1 if mes <= pm else anio
        try:
            pares.append((pm, date(y, mes, dia)))
        except ValueError:
            continue
    return sorted(pares)


def es_dia_habil(d: date) -> bool:
    return d.weekday() < 5 and d not in FERIADOS


def dia_habil_anterior(d: date) -> date:
    """Devuelve el día hábil inmediatamente anterior a 'd' (para el SIRE)."""
    x = d - timedelta(days=1)
    while not es_dia_habil(x):
        x -= timedelta(days=1)
    return x


def _parse_fecha(dia: int, mes_txt: str, periodo_mes: int, anio_periodo: int) -> date | None:
    mes = _MESES.get(mes_txt.strip().lower()[:3])
    if not mes:
        return None
    # La declaración se presenta el mes siguiente; si el mes de vencimiento es
    # menor o igual al del periodo, cae en el año siguiente (Dic-26 -> Ene-27).
    anio = anio_periodo + 1 if mes <= periodo_mes else anio_periodo
    try:
        return date(anio, mes, dia)
    except ValueError:
        return None


_PATRON_CRONO = re.compile(
    r"(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Set|Sep|Oct|Nov|Dic)-(\d{2})\s+(\d{1,2})\s+"
    r"(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Set|Sep|Oct|Nov|Dic)",
    re.IGNORECASE,
)


def _parse_cronograma_html(html: str, anio: int) -> list:
    """Extrae los pares (periodo_mes, fecha) del HTML del cronograma SUNAT."""
    # Limpiar tags y colapsar TODO el espacio (incluidos saltos de línea)
    texto = re.sub(r"<[^>]+>", " ", html or "")
    texto = re.sub(r"\s+", " ", texto)
    resultados = []
    for m in _PATRON_CRONO.finditer(texto):
        periodo_mes = _MESES.get(m.group(1).lower()[:3])
        dia = int(m.group(3))
        fecha = _parse_fecha(dia, m.group(4), periodo_mes, anio)
        if periodo_mes and fecha:
            resultados.append((periodo_mes, fecha))
    return resultados


async def fetch_cronograma(ruc: str, anio: int, intentos: int = 3) -> list:
    """Consulta el cronograma oficial de SUNAT para un RUC, con reintentos.

    SUNAT es un servicio externo intermitente: a veces tarda o devuelve una
    página vacía/de error. Reintentamos un par de veces antes de rendirnos.
    Devuelve [(periodo_mes, fecha)] o [] si todos los intentos fallan.
    """
    for intento in range(intentos):
        html = ""
        try:
            async with httpx.AsyncClient(timeout=25.0, follow_redirects=True,
                                         headers={"User-Agent": "Mozilla/5.0"}) as client:
                await client.get(CRONO_URL)
                await client.post(CRONO_URL, data={"accion": "rptPers", "periodo": str(anio)})
                r = await client.post(CRONO_URL, data={
                    "accion": "consPers", "periodo": str(anio), "nroruc": ruc,
                })
                html = r.text
        except Exception:
            html = ""
        resultados = _parse_cronograma_html(html, anio)
        if resultados:
            return resultados
        if intento < intentos - 1:
            await asyncio.sleep(1.2)  # breve espera antes de reintentar
    return []


async def get_vencimientos(ruc: str, anio: int, db=None) -> dict:
    """Devuelve el cronograma completo con declaración + SIRE + estado, cacheando en DB."""
    pares = []
    # 1. Intentar cache por (año, último dígito)
    ultimo = ruc[-1]
    if db is not None:
        try:
            from app.database import Cronograma
            cached = db.query(Cronograma).filter(
                Cronograma.anio == anio, Cronograma.ultimo_digito == ultimo
            ).order_by(Cronograma.periodo_mes).all()
            if cached:
                pares = [(c.periodo_mes, c.fecha_venc) for c in cached]
        except Exception:
            pares = []

    # 2. Si no hay cache, consultar SUNAT; si no responde, usar el cronograma embebido
    if not pares:
        pares = await fetch_cronograma(ruc, anio)
        if not pares:
            pares = _pares_fallback(ruc, anio)
        if pares and db is not None:
            try:
                from app.database import Cronograma
                for periodo_mes, fecha in pares:
                    db.add(Cronograma(
                        anio=anio, ultimo_digito=ultimo,
                        periodo_mes=periodo_mes, fecha_venc=fecha,
                    ))
                db.commit()
            except Exception:
                db.rollback()

    if not pares:
        return {"success": False, "vencimientos": [],
                "error": "SUNAT no respondió a tiempo. Espera unos segundos y vuelve a pulsar 'Generar del cronograma'."}

    hoy = date.today()
    vencimientos = []
    for periodo_mes, fecha_decl in sorted(pares):
        if isinstance(fecha_decl, datetime):
            fecha_decl = fecha_decl.date()
        fecha_sire = dia_habil_anterior(fecha_decl)
        dias = (fecha_decl - hoy).days
        if dias < 0:
            estado = "vencido"
        elif dias == 0:
            estado = "hoy"
        elif dias <= 7:
            estado = "proximo"
        else:
            estado = "vigente"
        vencimientos.append({
            "periodo": f"{_MES_NOMBRE[periodo_mes]} {anio}",
            "periodo_mes": periodo_mes,
            "vencimiento_declaracion": fecha_decl.isoformat(),
            "vencimiento_sire": fecha_sire.isoformat(),
            "dias_restantes": dias,
            "estado": estado,
        })

    proximo = next((v for v in vencimientos if v["dias_restantes"] >= 0), None)
    return {"success": True, "anio": anio, "ultimo_digito": ultimo,
            "vencimientos": vencimientos, "proximo": proximo}
