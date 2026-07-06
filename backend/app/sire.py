"""
Cliente de la API SIRE de SUNAT (RVIE = Registro de Ventas, RCE = Registro de Compras).

Flujo (según el manual de Servicios API del SIRE):
1. Token OAuth2 (password grant) con las Credenciales de API SUNAT del contribuyente
   (client_id + client_secret, registradas en Menú SOL) + su usuario/clave SOL.
2. Solicitar la exportación de la PROPUESTA del período → SUNAT devuelve un ticket.
3. Consultar el estado del ticket hasta que el archivo esté listo.
4. Descargar el archivo (ZIP con TXT delimitado por '|') y parsearlo.
"""
import io
import re
import json
import base64
import zipfile
import asyncio
from datetime import datetime

import httpx

TOKEN_URL = "https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/"
SCOPE = "https://api-sire.sunat.gob.pe"
BASE = "https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros"

# Endpoints oficiales (Manual de servicios Web API SIRE v22: Compras 5.34/5.31/5.32, Ventas 5.18)
EXPORTA = {
    "rce":  BASE + "/rce/propuesta/web/propuesta/{per}/exportacioncomprobantepropuesta?codTipoArchivo=0&codOrigenEnvio=2",
    "rvie": BASE + "/rvie/propuesta/web/propuesta/{per}/exportapropuesta?codTipoArchivo=0",
}
# La gestión de tickets y descarga de archivos es COMPARTIDA (rvierce)
TICKETS = BASE + "/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets?perIni={per}&perFin={per}&page=1&perPage=20"
ARCHIVO = BASE + "/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte"
# Consulta de períodos (5.33): sirve para verificar que el token tenga acceso al SIRE
PERIODOS = BASE + "/rvierce/padron/web/omisos/{codLibro}/periodos"
COD_LIBRO = {"rce": "080000", "rvie": "140000"}

MSG_SIN_PERMISOS = (
    "Tu aplicación en SUNAT aún no tiene habilitado el acceso al SIRE. "
    "En el Menú SOL entra a Credenciales de API SUNAT → Gestión Credenciales de API SUNAT, "
    "pulsa el botón Editar (lápiz, arriba a la derecha), en el listado de URIs marca la casilla "
    "«MIGE RCE y RVIE – SIRE», elige alcance «Web» y pulsa Guardar. "
    "OJO: si SUNAT genera un nuevo ID/CLAVE al guardar, actualízalos en SIRE SUNAT → Configuración."
)


def _limpiar_error(texto: str) -> str:
    t = re.sub(r"<[^>]+>", " ", texto or "")
    return re.sub(r"\s+", " ", t).strip()[:220]

TIPO_CP = {
    "01": "Factura", "03": "Boleta", "07": "Nota de Crédito", "08": "Nota de Débito",
    "02": "Recibo por Honorarios", "12": "Ticket", "14": "Recibo servicios públicos",
    "91": "Comprobante no domiciliado", "97": "Nota de Crédito no domiciliado",
}


async def obtener_token(client_id: str, client_secret: str, ruc: str,
                        sol_usuario: str, sol_password: str) -> dict:
    data = {
        "grant_type": "password",
        "scope": SCOPE,
        "client_id": client_id,
        "client_secret": client_secret,
        "username": f"{ruc}{sol_usuario}",
        "password": sol_password,
    }
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(TOKEN_URL.format(client_id=client_id), data=data)
    if r.status_code != 200:
        detalle = r.text[:250]
        return {"ok": False, "error": f"SUNAT rechazó la autenticación ({r.status_code}). "
                                      f"Verifica el ID/Clave de API y la clave SOL. Detalle: {detalle}"}
    tok = r.json().get("access_token")
    if not tok:
        return {"ok": False, "error": "SUNAT no devolvió un token de acceso."}
    return {"ok": True, "token": tok}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            # La app está registrada en SUNAT con esta URL (alcance Web)
            "Origin": "https://www.dashbot.pro",
            "Referer": "https://www.dashbot.pro/"}


async def _crear_ticket_exportacion(client, token: str, libro: str, periodo: str) -> dict:
    url = EXPORTA[libro].format(per=periodo)
    r = await client.get(url, headers=_headers(token))
    if r.status_code == 401:
        return {"ok": False, "error": MSG_TOKEN_CON_SIRE_401}
    if r.status_code != 200:
        return {"ok": False, "error": f"SUNAT export ({r.status_code}): {_limpiar_error(r.text)}"}
    try:
        j = r.json()
    except Exception:
        return {"ok": False, "error": f"Respuesta inesperada de SUNAT: {r.text[:200]}"}
    ticket = j.get("numTicket") or j.get("ticket")
    if not ticket:
        return {"ok": False, "error": f"SUNAT no devolvió ticket: {str(j)[:200]}"}
    return {"ok": True, "ticket": str(ticket)}


async def _listar_tickets(client, token: str, periodo: str) -> list:
    url = TICKETS.format(per=periodo)
    r = await client.get(url, headers=_headers(token))
    if r.status_code != 200:
        return []
    try:
        j = r.json()
    except Exception:
        return []
    regs = j.get("registros") or j.get("items") or []
    # Solo los tickets del período consultado
    return [x for x in regs if str(x.get("perTributario") or "") in ("", periodo)]


def _ticket_listo(reg: dict) -> bool:
    archivos = reg.get("archivoReporte") or []
    estado = str(reg.get("codEstadoProceso") or "")
    return bool(archivos) and estado in ("06", "6", "")


async def _descargar_archivo(client, token: str, reg: dict) -> dict:
    archivos = reg.get("archivoReporte") or []
    if not archivos:
        return {"ok": False, "error": "El ticket no tiene archivo aún."}
    a = archivos[0]
    nombre = a.get("nomArchivoReporte") or a.get("nomArchivoContenidoTxt") or ""
    cod = a.get("codTipoAchivoReporte", a.get("codTipoArchivoReporte"))
    params = {
        "nomArchivoReporte": nombre,
        # Según el manual, si SUNAT devuelve null se envía el mismo valor (null)
        "codTipoArchivoReporte": "null" if cod is None else str(cod),
    }
    r = await client.get(ARCHIVO, headers=_headers(token), params=params)
    if r.status_code == 401:
        return {"ok": False, "error": MSG_TOKEN_CON_SIRE_401}
    if r.status_code != 200:
        return {"ok": False, "error": f"SUNAT descarga ({r.status_code}): {_limpiar_error(r.text)}"}
    data = r.content
    # ZIP → primer archivo interno; si no, texto plano
    if data[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                nombres = z.namelist()
                if not nombres:
                    return {"ok": False, "error": "El ZIP de SUNAT vino vacío."}
                data = z.read(nombres[0])
        except Exception as e:
            return {"ok": False, "error": f"No se pudo abrir el ZIP: {str(e)[:120]}"}
    try:
        texto = data.decode("utf-8")
    except UnicodeDecodeError:
        texto = data.decode("latin-1", "ignore")
    return {"ok": True, "texto": texto, "nombre": nombre}


def _num(v) -> float:
    try:
        return float(str(v).strip().replace(",", ""))
    except Exception:
        return 0.0


def _fecha_iso(v: str) -> str:
    v = (v or "").strip()
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", v)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return v[:10]


# Posiciones (0-index) según los Anexos oficiales de la R.S. 112-2021/SUNAT:
# RCE (Anexo 11): fecha=C5, tipo=C7, serie=C8, nro=C10, doc=C13, razón=C14,
#                 BI DG=C15, IGV DG=C16, total=C25, moneda=C26
# RVIE (Anexo 3): fecha=C5, tipo=C7, serie=C8, nro=C9, doc=C12, razón=C13,
#                 BI gravada=C15, IGV DG=C17, total=C26, moneda=C27
POSICIONES = {
    "rce":  {"fecha": 4, "tipo": 6, "serie": 7, "num": 9, "doc": 12, "razon": 13,
             "base": 14, "igv": 15, "total": 24, "moneda": 25},
    "rvie": {"fecha": 4, "tipo": 6, "serie": 7, "num": 8, "doc": 11, "razon": 12,
             "base": 14, "igv": 16, "total": 25, "moneda": 26},
}


def parsear_propuesta(texto: str, libro: str) -> dict:
    """Parsea el TXT de la propuesta ('|' como separador). Usa las cabeceras si
    existen; si no, cae al mapeo posicional de los Anexos oficiales."""
    lineas = [l for l in texto.splitlines() if l.strip()]
    if not lineas:
        return {"comprobantes": [], "headers": []}
    primera = lineas[0].lower()
    con_header = ("fecha" in primera or "ruc" in primera or "periodo" in primera)
    headers = [h.strip() for h in lineas[0].split("|")] if con_header else []
    hl = [h.lower() for h in headers]

    def idx(*claves):
        for i, h in enumerate(hl):
            if all(k in h for k in claves):
                return i
        return -1

    pos = POSICIONES[libro]
    if con_header:
        i_fecha = idx("fecha", "emis")
        i_tipo = idx("tipo", "cp")
        if i_tipo < 0:
            i_tipo = idx("tipo", "comprobante")
        i_serie = idx("serie")
        i_num = idx("nro", "cp")
        if i_num < 0:
            i_num = idx("num", "cp")
        if i_num < 0:
            i_num = idx("nro", "inicial")
        i_doc = idx("nro", "doc", "identidad")
        if i_doc < 0:
            i_doc = idx("num", "doc", "identidad")
        if i_doc < 0:
            i_doc = idx("doc", "identidad")
        # La razón social del tercero va justo después del Nro Doc (Anexos 3 y 11);
        # así evitamos confundirla con la razón social del propio contribuyente (C2).
        i_razon = i_doc + 1 if i_doc >= 0 else idx("apellidos")
        i_base = idx("bi", "grav")
        if i_base < 0:
            i_base = idx("base", "imponible")
        i_igv = idx("igv")
        i_total = idx("total", "cp")
        if i_total < 0:
            i_total = idx("importe", "total")
        if i_total < 0:
            i_total = idx("total")
        i_mon = idx("moneda")
        # Si alguna clave no se encontró en cabeceras, usar su posición oficial
        i_fecha = i_fecha if i_fecha >= 0 else pos["fecha"]
        i_tipo = i_tipo if i_tipo >= 0 else pos["tipo"]
        i_serie = i_serie if i_serie >= 0 else pos["serie"]
        i_num = i_num if i_num >= 0 else pos["num"]
        i_doc = i_doc if i_doc >= 0 else pos["doc"]
        i_razon = i_razon if i_razon >= 0 else pos["razon"]
        i_base = i_base if i_base >= 0 else pos["base"]
        i_igv = i_igv if i_igv >= 0 else pos["igv"]
        i_total = i_total if i_total >= 0 else pos["total"]
        i_mon = i_mon if i_mon >= 0 else pos["moneda"]
        datos = lineas[1:]
    else:
        i_fecha, i_tipo, i_serie, i_num = pos["fecha"], pos["tipo"], pos["serie"], pos["num"]
        i_doc, i_razon, i_base, i_igv = pos["doc"], pos["razon"], pos["base"], pos["igv"]
        i_total, i_mon = pos["total"], pos["moneda"]
        datos = lineas

    def get(campos, i):
        return campos[i].strip() if 0 <= i < len(campos) else ""

    comprobantes = []
    for linea in datos:
        campos = linea.split("|")
        if len(campos) < 3:
            continue
        tipo_raw = get(campos, i_tipo)
        tipo = TIPO_CP.get(tipo_raw.zfill(2) if tipo_raw.isdigit() else tipo_raw, tipo_raw)
        serie = get(campos, i_serie)
        numero = get(campos, i_num)
        base = _num(get(campos, i_base))
        igv = _num(get(campos, i_igv))
        total = _num(get(campos, i_total)) or (base + igv)
        comprobantes.append({
            "fecha_emision": _fecha_iso(get(campos, i_fecha)),
            "tipo_comprobante": tipo or "Comprobante",
            "serie_numero": f"{serie}-{numero}".strip("-"),
            "num_doc": get(campos, i_doc),
            "razon_social": get(campos, i_razon),
            "base_imponible": base,
            "igv": igv,
            # Exonerado/inafecto/exportación/ISC/ICBPER, etc. (todo lo que no es BI+IGV)
            "otros": round(total - base - igv, 2),
            "importe_total": total,
            "moneda": get(campos, i_mon) or "PEN",
        })
    return {"comprobantes": comprobantes, "headers": headers}


def _claims_token(token: str) -> dict:
    """Decodifica el payload del JWT (sin verificar firma) para inspeccionar permisos."""
    try:
        parte = token.split(".")[1]
        parte += "=" * (-len(parte) % 4)
        return json.loads(base64.urlsafe_b64decode(parte))
    except Exception:
        return {}


MSG_TOKEN_SIN_SIRE = (
    "SUNAT emitió el token pero AÚN NO incluye el permiso del SIRE, aunque la casilla esté marcada. "
    "Solución: en Gestión de Credenciales de API SUNAT pulsa Editar, desmarca y vuelve a marcar "
    "«MIGE RCE y RVIE – SIRE», y Guarda de nuevo. Si en unos minutos sigue igual, elimina y vuelve a "
    "registrar la aplicación (genera ID/CLAVE nuevos) y actualízalos aquí en Configuración."
)
MSG_TOKEN_CON_SIRE_401 = (
    "Tu token SÍ trae el permiso del SIRE, pero SUNAT rechazó la consulta. Suele ser propagación: "
    "espera 2-5 minutos y vuelve a probar. Si persiste, en SUNAT cambia el Alcance de la aplicación "
    "a «Desktop», guarda y prueba otra vez."
)


async def probar_acceso(client_id: str, client_secret: str, ruc: str,
                        sol_usuario: str, sol_password: str) -> dict:
    """Diagnóstico por etapas: 1) token, 2) permiso SIRE dentro del token, 3) acceso, 4) períodos."""
    t = await obtener_token(client_id, client_secret, ruc, sol_usuario, sol_password)
    if not t["ok"]:
        return {"success": True, "token_ok": False, "sire_ok": False, "detalle": t["error"]}
    token = t["token"]
    claims = _claims_token(token)
    token_sire = ("migeigv" in json.dumps(claims).lower()) if claims else None
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(PERIODOS.format(codLibro=COD_LIBRO["rce"]), headers=_headers(token))
        if r.status_code == 401:
            # Segundo canario: el servicio de tickets (a veces los permisos difieren por URI)
            per_actual = datetime.utcnow().strftime("%Y%m")
            rt = await client.get(TICKETS.format(per=per_actual), headers=_headers(token))
            if rt.status_code == 200:
                return {"success": True, "token_ok": True, "token_sire": token_sire, "sire_ok": True,
                        "periodos": [],
                        "nota": "Acceso verificado con el servicio de tickets (el de períodos está restringido, no afecta la carga)."}
            if token_sire is False:
                detalle = MSG_TOKEN_SIN_SIRE
            elif token_sire is True:
                detalle = MSG_TOKEN_CON_SIRE_401
            else:
                detalle = MSG_SIN_PERMISOS
            return {"success": True, "token_ok": True, "token_sire": token_sire,
                    "sire_ok": False, "detalle": detalle}
        if r.status_code != 200:
            return {"success": True, "token_ok": True, "token_sire": token_sire, "sire_ok": False,
                    "detalle": f"SUNAT respondió {r.status_code}: {_limpiar_error(r.text)}"}
        try:
            j = r.json()
        except Exception:
            j = []
        periodos = []

        def rec(x):
            if isinstance(x, dict):
                if "perTributario" in x:
                    periodos.append(str(x["perTributario"]))
                for v in x.values():
                    rec(v)
            elif isinstance(x, list):
                for v in x:
                    rec(v)
        rec(j)
        return {"success": True, "token_ok": True, "token_sire": token_sire, "sire_ok": True,
                "periodos": sorted(set(periodos), reverse=True)[:12]}


async def cargar_propuesta(client_id: str, client_secret: str, ruc: str,
                           sol_usuario: str, sol_password: str,
                           libro: str, periodo: str) -> dict:
    """Flujo completo: token → ticket (reusa si ya existe uno listo) → descarga → parseo."""
    if libro not in EXPORTA:
        return {"success": False, "error": "Libro inválido (usa rce o rvie)."}

    t = await obtener_token(client_id, client_secret, ruc, sol_usuario, sol_password)
    if not t["ok"]:
        return {"success": False, "error": t["error"]}
    token = t["token"]

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 0. Verificación de permisos: solo bloquear si el TOKEN no trae el permiso SIRE.
        #    (El canario de «períodos» puede fallar por sí solo; no debe frenar la carga.)
        claims = _claims_token(token)
        token_sire = ("migeigv" in json.dumps(claims).lower()) if claims else None
        if token_sire is False:
            return {"success": False, "error": MSG_TOKEN_SIN_SIRE}

        # 1. ¿Ya hay un ticket de exportación listo para este período?
        registros = await _listar_tickets(client, token, periodo)
        listo = next((r for r in registros if _ticket_listo(r)), None)

        # 2. Si no hay, crear el ticket y esperar un poco
        if not listo:
            ct = await _crear_ticket_exportacion(client, token, libro, periodo)
            if not ct["ok"]:
                return {"success": False, "error": ct["error"]}
            nuevo = ct["ticket"]
            for _ in range(8):  # ~24 s de espera máxima
                await asyncio.sleep(3)
                registros = await _listar_tickets(client, token, periodo)
                # Preferir el ticket recién creado; si no, cualquiera listo del período
                listo = next((r for r in registros if str(r.get("numTicket")) == nuevo and _ticket_listo(r)), None) \
                    or next((r for r in registros if _ticket_listo(r)), None)
                if listo:
                    break
            if not listo:
                return {"success": True, "estado": "procesando",
                        "mensaje": "SUNAT sigue preparando el archivo. Vuelve a pulsar «Cargar» en unos segundos."}

        # 3. Descargar y parsear
        d = await _descargar_archivo(client, token, listo)
        if not d["ok"]:
            return {"success": False, "error": d["error"]}
        p = parsear_propuesta(d["texto"], libro)
        comps = p["comprobantes"]
        return {
            "success": True, "estado": "ok", "libro": libro, "periodo": periodo,
            "comprobantes": comps,
            "resumen": {
                "cantidad": len(comps),
                "base": round(sum(c["base_imponible"] for c in comps), 2),
                "igv": round(sum(c["igv"] for c in comps), 2),
                "otros": round(sum(c.get("otros", 0) for c in comps), 2),
                "total": round(sum(c["importe_total"] for c in comps), 2),
            },
        }
