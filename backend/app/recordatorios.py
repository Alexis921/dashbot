"""
Motor de recordatorios de vencimientos (Agenda Tributaria Inteligente).
Avisa por WhatsApp y/o Email X días antes de cada obligación pendiente.
Tolera ticks perdidos: si el día exacto no se ejecutó, manda el recordatorio
del umbral más cercano aún no enviado (sin spam, gracias al dedup).
"""
import calendar
from datetime import date, datetime, timedelta

from app.database import SessionLocal, Configuracion, Obligacion, Empresa, RecordatorioLog
from app.whatsapp_service import send_whatsapp
from app.email_service import send_simple_email


async def _pago_reminder(db, cfg, hoy) -> int:
    """Avisa el día anterior al pago de quincena / fin de mes (dedup por mes)."""
    enviados = 0
    ultimo = calendar.monthrange(hoy.year, hoy.month)[1]
    periodo_int = hoy.year * 100 + hoy.month
    pagos = [(-1, "quincena", min(int(cfg.pago_quincena_dia or 15), ultimo)),
             (-2, "fin de mes", min(int(cfg.pago_finmes_dia or 30), ultimo))]
    for key, label, dia in pagos:
        fecha = date(hoy.year, hoy.month, dia)
        if hoy != fecha - timedelta(days=1) and hoy != fecha:
            continue
        ya = db.query(RecordatorioLog).filter(
            RecordatorioLog.obligacion_id == key, RecordatorioLog.dias_offset == periodo_int).first()
        if ya:
            continue
        msg = (f"💸 *Dashbot - Recordatorio de pago*\n\n"
               f"Recuerda realizar el *pago de planilla ({label})* el {fecha.strftime('%d/%m/%Y')}. "
               "Ten lista la transferencia para pagar a tiempo a tu equipo.")
        if cfg.whatsapp_numero and cfg.whatsapp_apikey:
            await send_whatsapp(cfg.whatsapp_numero, cfg.whatsapp_apikey, msg)
        if cfg.recordatorio_email_dest:
            await send_simple_email(cfg.recordatorio_email_dest,
                f"💸 Recordatorio de pago de planilla ({label})",
                f"<p style='font-family:Arial'>Recuerda pagar la planilla <b>({label})</b> el "
                f"{fecha.strftime('%d/%m/%Y')}.</p>")
        db.add(RecordatorioLog(obligacion_id=key, dias_offset=periodo_int))
        db.commit()
        enviados += 1
    return enviados

TIPO_LABEL = {
    "declaracion_mensual": "Declaración mensual IGV-Renta",
    "sire": "SIRE (Compras/Ventas)",
    "detraccion": "Detracción",
    "otro": "Obligación",
}
ESTADOS_CERRADOS = ("pagado", "declarado", "archivado")


def _parse_offsets(s: str) -> list:
    out = []
    for p in (s or "").split(","):
        p = p.strip()
        if p.isdigit():
            out.append(int(p))
    return sorted(set(out))


def _wsp_msg(empresa: str, o: Obligacion, dias: int) -> str:
    venc = o.fecha_vencimiento.strftime("%d/%m/%Y")
    cuando = "*vence HOY* 🔴" if dias == 0 else f"vence en *{dias} día(s)*"
    return (
        "⏰ *Dashbot - Recordatorio de vencimiento*\n\n"
        f"📋 {empresa}\n"
        f"{TIPO_LABEL.get(o.tipo, 'Obligación')} — {o.periodo}\n\n"
        f"📌 {o.titulo}\n"
        f"📅 {cuando} ({venc}).\n\n"
        "No olvides cumplir a tiempo para evitar multas."
    )


def _email_html(empresa: str, o: Obligacion, dias: int) -> str:
    venc = o.fecha_vencimiento.strftime("%d/%m/%Y")
    cuando = "vence HOY" if dias == 0 else f"vence en {dias} día(s)"
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#1B3A6B;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">⏰ Recordatorio de vencimiento</h2>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:20px 22px;border-radius:0 0 10px 10px">
        <p style="font-size:14px;color:#334155;margin:0 0 6px"><strong>{empresa}</strong></p>
        <p style="font-size:13px;color:#64748b;margin:0 0 14px">{TIPO_LABEL.get(o.tipo,'Obligación')} — {o.periodo}</p>
        <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:8px">
          <div style="font-size:15px;font-weight:700;color:#1e293b">{o.titulo}</div>
          <div style="font-size:13px;color:#92400e;margin-top:4px">📅 {cuando} ({venc})</div>
        </div>
        <p style="font-size:12px;color:#94a3b8;margin-top:18px">Generado automáticamente por Dashbot · dashbot.pro</p>
      </div>
    </div>"""


async def run_recordatorios() -> dict:
    db = SessionLocal()
    enviados = 0
    procesados = []
    try:
        hoy = date.today()
        # Todos los usuarios con configuración (tiene las credenciales de envío)
        configs = db.query(Configuracion).all()
        for cfg in configs:
            global_offsets = _parse_offsets(cfg.recordatorio_dias) if cfg.recordatorios_activo else []
            nombres = {e.id: (e.alias or e.razon_social or f"RUC {e.ruc}")
                       for e in db.query(Empresa).filter(Empresa.user_id == cfg.user_id).all()}

            obligaciones = db.query(Obligacion).filter(
                Obligacion.user_id == cfg.user_id,
                ~Obligacion.estado.in_(ESTADOS_CERRADOS),
                Obligacion.fecha_vencimiento.isnot(None),
            ).all()

            for o in obligaciones:
                # Resolver: recordatorio PROPIO de la obligación o el global
                propio = (o.recordatorio_dias or "").strip()
                if propio:
                    offsets = _parse_offsets(propio)
                    usar_wsp = bool(o.recordatorio_wsp)
                    usar_email = bool(o.recordatorio_email)
                elif global_offsets:
                    offsets = global_offsets
                    usar_wsp = cfg.recordatorio_wsp
                    usar_email = cfg.recordatorio_email
                else:
                    continue
                if not offsets:
                    continue
                max_off = max(offsets)
                dias = (o.fecha_vencimiento.date() - hoy).days
                if dias < 0 or dias > max_off:
                    continue
                # Umbrales aplicables aún no enviados (>= dias). Enviar solo el más cercano.
                pendientes = sorted([off for off in offsets if off >= dias])
                ya = {r.dias_offset for r in db.query(RecordatorioLog).filter(
                    RecordatorioLog.obligacion_id == o.id).all()}
                pendientes = [off for off in pendientes if off not in ya]
                if not pendientes:
                    continue
                enviar_off = pendientes[0]  # el umbral más cercano a vencer

                empresa = nombres.get(o.empresa_id, "Tu empresa")
                if usar_wsp and cfg.whatsapp_numero and cfg.whatsapp_apikey:
                    await send_whatsapp(cfg.whatsapp_numero, cfg.whatsapp_apikey, _wsp_msg(empresa, o, dias))
                dest = cfg.recordatorio_email_dest
                if usar_email and dest:
                    await send_simple_email(
                        dest, f"⏰ Recordatorio: {o.titulo}", _email_html(empresa, o, dias))

                # Registrar todos los umbrales aplicables como enviados (evita reenvíos)
                for off in pendientes:
                    db.add(RecordatorioLog(obligacion_id=o.id, dias_offset=off))
                db.commit()
                enviados += 1
                procesados.append({"obligacion_id": o.id, "dias": dias, "offset": enviar_off})

            # Recordatorio de PAGO de planilla (quincena / fin de mes)
            if cfg.pago_recordatorio:
                enviados += await _pago_reminder(db, cfg, hoy)

        return {"enviados": enviados, "detalle": procesados, "checked_at": datetime.utcnow().isoformat()}
    finally:
        db.close()
