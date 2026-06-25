"""
Worker de extracción programada.
Revisa las programaciones activas y ejecuta la sincronización cuando vencen.
Funciona como loop en proceso (mientras la máquina está activa) y también
puede dispararse vía POST /api/cron/tick (cron externo).
"""
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.database import SessionLocal, Programacion, Empresa
from app.email_service import send_email_summary

CHECK_INTERVAL_SECONDS = 300          # revisa cada 5 minutos
DELAY_BETWEEN_EMPRESAS = 25           # segundos entre empresas (evita CAPTCHA SUNAT)
_running = False


def compute_next_run(hora_inicio: str, repetir_cada: int, tz_name: str,
                     from_dt: datetime | None = None) -> datetime:
    """Calcula el próximo disparo en UTC (naive), alineado a hora_inicio + cada N horas."""
    repetir_cada = max(1, int(repetir_cada or 6))
    try:
        tz = ZoneInfo(tz_name or "America/Lima")
    except Exception:
        tz = ZoneInfo("America/Lima")
    try:
        hh, mm = [int(x) for x in (hora_inicio or "08:00").split(":")]
    except Exception:
        hh, mm = 8, 0

    now_utc = (from_dt or datetime.utcnow()).replace(tzinfo=ZoneInfo("UTC"))
    now_local = now_utc.astimezone(tz)
    anchor = now_local.replace(hour=hh, minute=mm, second=0, microsecond=0)
    # Retroceder al ancla de hoy y avanzar de a 'repetir_cada' horas hasta pasar ahora
    if anchor > now_local:
        anchor -= timedelta(days=1)
    nxt = anchor
    while nxt <= now_local:
        nxt += timedelta(hours=repetir_cada)
    return nxt.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


async def run_due_schedules() -> dict:
    """Ejecuta todas las programaciones vencidas. Devuelve un resumen."""
    from app.main import sync_empresa_core  # import diferido (evita ciclo)

    db = SessionLocal()
    processed = []
    try:
        now = datetime.utcnow()
        progs = (
            db.query(Programacion)
            .filter(Programacion.activo == True)  # noqa: E712
            .all()
        )
        for prog in progs:
            if prog.next_run and prog.next_run > now:
                continue  # aún no vence

            empresas = db.query(Empresa).filter(Empresa.user_id == prog.user_id).all()
            total_new = 0
            for i, empresa in enumerate(empresas):
                if not prog.fuente_sol:
                    continue  # SUNAFIL u otras fuentes: pendientes de implementar
                try:
                    res = await sync_empresa_core(empresa, db, want_ai=False)
                    new_count = res.get("new_count", 0) if res.get("success") else 0
                    total_new += new_count
                    # Enviar correo si hay novedades y hay destinatario configurado
                    if new_count > 0 and prog.correo_envio:
                        notifs = [
                            {
                                "subject": n.get("subject", ""),
                                "date_received": n.get("date_received", ""),
                                "reference_number": n.get("reference_number", ""),
                                "has_attachment": n.get("has_attachment", False),
                                "is_urgent": n.get("is_urgent", False),
                            }
                            for n in res.get("notifications", [])
                        ]
                        await send_email_summary(prog.correo_envio, notifs, empresa.ruc)
                except Exception as e:
                    print(f"[scheduler] error empresa {empresa.id}: {str(e)[:120]}")
                # Pausa entre empresas para no gatillar el CAPTCHA de SUNAT
                if i < len(empresas) - 1:
                    await asyncio.sleep(DELAY_BETWEEN_EMPRESAS)

            prog.last_run = now
            prog.next_run = compute_next_run(
                prog.hora_inicio, prog.repetir_cada, prog.zona_horaria, from_dt=now
            )
            db.commit()
            processed.append({"user_id": prog.user_id, "empresas": len(empresas), "nuevas": total_new})

        return {"processed": processed, "checked_at": now.isoformat()}
    finally:
        db.close()


async def schedule_loop():
    """Loop en proceso que revisa programaciones periódicamente."""
    global _running
    if _running:
        return
    _running = True
    await asyncio.sleep(15)  # esperar a que el server termine de arrancar
    while True:
        try:
            await run_due_schedules()
        except Exception as e:
            print(f"[scheduler] loop error: {str(e)[:150]}")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
