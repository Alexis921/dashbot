import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import List


def build_html_summary(notifications: list, ruc: str) -> str:
    urgent = [n for n in notifications if n.get("is_urgent")]
    normal = [n for n in notifications if not n.get("is_urgent")]

    urgent_rows = ""
    for n in urgent:
        date_str = n.get("date_received", "")[:10]
        attach = "📎" if n.get("has_attachment") else ""
        urgent_rows += f"""
        <tr style="background:#fff3cd">
          <td style="padding:8px;border-bottom:1px solid #eee">🔴 {n['subject']}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{n.get('reference_number','')}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{date_str}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{attach}</td>
        </tr>"""

    normal_rows = ""
    for n in normal:
        date_str = n.get("date_received", "")[:10]
        attach = "📎" if n.get("has_attachment") else ""
        normal_rows += f"""
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">🟡 {n['subject']}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{n.get('reference_number','')}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{date_str}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{attach}</td>
        </tr>"""

    date_now = datetime.now().strftime("%d/%m/%Y %H:%M")
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px">
  <div style="background:#c8102e;color:white;padding:20px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:22px">📋 Resumen Buzón SUNAT</h1>
    <p style="margin:5px 0 0">RUC: {ruc} · Generado: {date_now}</p>
  </div>

  <div style="background:#f8f9fa;padding:15px;border:1px solid #dee2e6">
    <div style="display:flex;gap:20px">
      <div style="background:white;padding:15px;border-radius:6px;flex:1;text-align:center;border-left:4px solid #dc3545">
        <div style="font-size:28px;font-weight:bold;color:#dc3545">{len(urgent)}</div>
        <div style="color:#666;font-size:13px">URGENTES</div>
      </div>
      <div style="background:white;padding:15px;border-radius:6px;flex:1;text-align:center;border-left:4px solid #ffc107">
        <div style="font-size:28px;font-weight:bold;color:#ffc107">{len(normal)}</div>
        <div style="color:#666;font-size:13px">PENDIENTES</div>
      </div>
      <div style="background:white;padding:15px;border-radius:6px;flex:1;text-align:center;border-left:4px solid #28a745">
        <div style="font-size:28px;font-weight:bold;color:#28a745">{len(notifications)}</div>
        <div style="color:#666;font-size:13px">TOTAL</div>
      </div>
    </div>
  </div>

  {"<h3 style='color:#dc3545;margin:20px 0 10px'>⚠️ Notificaciones Urgentes</h3><table width='100%' style='border-collapse:collapse'><tr style='background:#dc3545;color:white'><th style='padding:10px;text-align:left'>Asunto</th><th style='padding:10px;text-align:left'>Referencia</th><th style='padding:10px;text-align:left'>Fecha</th><th style='padding:10px;text-align:left'>Adj.</th></tr>" + urgent_rows + "</table>" if urgent else ""}

  {"<h3 style='color:#856404;margin:20px 0 10px'>📬 Otras Notificaciones</h3><table width='100%' style='border-collapse:collapse'><tr style='background:#6c757d;color:white'><th style='padding:10px;text-align:left'>Asunto</th><th style='padding:10px;text-align:left'>Referencia</th><th style='padding:10px;text-align:left'>Fecha</th><th style='padding:10px;text-align:left'>Adj.</th></tr>" + normal_rows + "</table>" if normal else ""}

  <div style="background:#e9ecef;padding:15px;border-radius:0 0 8px 8px;margin-top:20px;font-size:12px;color:#666">
    Generado automáticamente por BOT SUNAT · No responder este correo.
  </div>
</body>
</html>"""


async def send_email_summary(to_email: str, notifications: list, ruc: str) -> dict:
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")

    if not smtp_user or not smtp_pass:
        return {"success": False, "error": "Credenciales SMTP no configuradas"}

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"📋 Resumen Buzón SUNAT - RUC {ruc} - {datetime.now().strftime('%d/%m/%Y')}"
        msg["From"] = smtp_user
        msg["To"] = to_email

        urgent_count = sum(1 for n in notifications if n.get("is_urgent"))
        text_body = (
            f"Resumen Buzón SUNAT - RUC {ruc}\n"
            f"Total notificaciones: {len(notifications)}\n"
            f"Urgentes: {urgent_count}\n\n"
            + "\n".join(f"- [{n.get('date_received','')[:10]}] {n['subject']}" for n in notifications)
        )

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(build_html_summary(notifications, ruc), "html", "utf-8"))

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, to_email, msg.as_string())

        return {"success": True, "error": None}

    except Exception as e:
        return {"success": False, "error": str(e)}
