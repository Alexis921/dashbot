// En desarrollo: proxy a localhost:8000
// En producción: VITE_API_URL apunta al backend de Railway
const BASE = import.meta.env.VITE_API_URL || ''

export async function apiLogin(ruc, usuario, password, demo_mode = false) {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ruc, usuario, password, demo_mode }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error de autenticación')
  return data
}

export async function apiSync(session_id) {
  const res = await fetch(`${BASE}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al sincronizar')
  return data
}

export async function apiSendEmail(session_id, to_email) {
  const res = await fetch(`${BASE}/api/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id, to_email }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al enviar correo')
  return data
}

export async function apiMarkRead(session_id, notification_ids) {
  const res = await fetch(`${BASE}/api/mark-read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id, notification_ids }),
  })
  return res.json()
}

export async function apiLogout(session_id) {
  await fetch(`${BASE}/api/session/${session_id}`, { method: 'DELETE' })
}

export async function apiInterpretNotification(session_id, notification) {
  const res = await fetch(`${BASE}/api/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id, notification }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al interpretar')
  return data
}

export async function apiDownloadPdf(session_id, notif_id, filename) {
  const res = await fetch(`${BASE}/api/notifications/${notif_id}/pdf?session_id=${session_id}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || 'No se pudo descargar el PDF')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'notificacion_sunat.pdf'
  a.click()
  URL.revokeObjectURL(url)
}
