"""
Consulta de datos públicos de RUC (razón social, estado, dirección).
Usa APIs públicas peruanas con fallback. La razón social también se confirma
desde el propio login de SUNAT al sincronizar.
"""
import os
import httpx

RUC_API_TOKEN = os.getenv("RUC_API_TOKEN", "")


async def lookup_ruc(ruc: str) -> dict:
    """Devuelve {success, razon_social, estado, direccion, source}."""
    if len(ruc) != 11 or not ruc.isdigit():
        return {"success": False, "error": "RUC inválido (11 dígitos)."}

    # 1. apis.net.pe v2 (requiere token) si está configurado
    if RUC_API_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                r = await client.get(
                    "https://api.apis.net.pe/v2/sunat/ruc",
                    params={"numero": ruc},
                    headers={"Authorization": f"Bearer {RUC_API_TOKEN}"},
                )
                if r.status_code == 200:
                    d = r.json()
                    return {
                        "success": True,
                        "razon_social": d.get("razonSocial") or d.get("nombre") or "",
                        "estado": d.get("estado", ""),
                        "direccion": d.get("direccion", ""),
                        "source": "apis.net.pe",
                    }
        except Exception:
            pass

    # 2. apis.net.pe v1 (gratis, sin token, rate-limited)
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "https://api.apis.net.pe/v1/ruc",
                params={"numero": ruc},
                headers={"User-Agent": "Dashbot/1.0"},
            )
            if r.status_code == 200:
                d = r.json()
                rs = d.get("razonSocial") or d.get("nombre") or ""
                if rs:
                    return {
                        "success": True,
                        "razon_social": rs,
                        "estado": d.get("estado", ""),
                        "direccion": d.get("direccion", ""),
                        "source": "apis.net.pe",
                    }
    except Exception:
        pass

    # 3. Fallback: no se pudo consultar; el usuario ingresa la razón social
    #    (igual se confirmará al loguear en SUNAT)
    return {
        "success": False,
        "error": "No se pudo consultar el RUC automáticamente. Puedes escribir la razón social manualmente; se confirmará al conectar con SUNAT.",
    }
