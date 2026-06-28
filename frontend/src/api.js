// API client Dashbot — autenticación JWT + multiempresa
const BASE = import.meta.env.VITE_API_URL || ''

const TOKEN_KEY = 'dashbot_token'
export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY) }

async function req(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    const t = getToken()
    if (t) headers.Authorization = `Bearer ${t}`
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || 'Ocurrió un error')
  return data
}

// ── Autenticación ──────────────────────────────────────────
export async function apiRegister({ nombre, apellido, username, password }) {
  const data = await req('/api/auth/register', {
    method: 'POST', auth: false,
    body: { nombre, apellido, username, password },
  })
  setToken(data.token)
  return data
}

export async function apiLogin(username, password) {
  const data = await req('/api/auth/login', {
    method: 'POST', auth: false,
    body: { username, password },
  })
  setToken(data.token)
  return data
}

export async function apiMe() {
  return req('/api/auth/me')
}

// ── Empresas ───────────────────────────────────────────────
export async function apiListEmpresas() {
  return req('/api/empresas')
}

export async function apiLookupRuc(ruc) {
  return req(`/api/ruc/${ruc}`)
}

export async function apiCreateEmpresa({ ruc, razon_social, alias, sol_usuario, sol_password }) {
  return req('/api/empresas', {
    method: 'POST',
    body: { ruc, razon_social, alias, sol_usuario, sol_password },
  })
}

export async function apiDeleteEmpresa(id) {
  return req(`/api/empresas/${id}`, { method: 'DELETE' })
}

export async function apiSyncRuc(id) {
  return req(`/api/empresas/${id}/sync-ruc`, { method: 'POST' })
}

export async function apiVencimientos(id, year) {
  const q = year ? `?year=${year}` : ''
  return req(`/api/empresas/${id}/vencimientos${q}`)
}

export async function apiSyncEmpresa(id) {
  return req(`/api/empresas/${id}/sync`, { method: 'POST' })
}

export async function apiEmpresaNotifications(id) {
  return req(`/api/empresas/${id}/notifications`)
}

export async function apiSendEmail(empresaId, to_email) {
  return req(`/api/empresas/${empresaId}/send-email`, {
    method: 'POST', body: { to_email },
  })
}

export async function apiInterpret(notification) {
  return req('/api/interpret', { method: 'POST', body: { notification } })
}

export async function apiDownloadPdf(empresaId, notifId, filename) {
  const t = getToken()
  const res = await fetch(`${BASE}/api/empresas/${empresaId}/notifications/${notifId}/pdf`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  })
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

// ── Agenda Tributaria: Obligaciones ────────────────────────
export async function apiListObligaciones(empresaId = 0) {
  const q = empresaId ? `?empresa_id=${empresaId}` : ''
  return req(`/api/obligaciones${q}`)
}

export async function apiGenerarObligaciones(empresaId, year) {
  const q = year ? `?year=${year}` : ''
  return req(`/api/empresas/${empresaId}/obligaciones/generar${q}`, { method: 'POST' })
}

export async function apiCreateObligacion(data) {
  return req('/api/obligaciones', { method: 'POST', body: data })
}

export async function apiUpdateObligacion(id, data) {
  return req(`/api/obligaciones/${id}`, { method: 'PATCH', body: data })
}

export async function apiDeleteObligacion(id) {
  return req(`/api/obligaciones/${id}`, { method: 'DELETE' })
}

export async function apiObligacionDetalle(id) {
  return req(`/api/obligaciones/${id}/detalle`)
}

export async function apiAddComentario(id, texto) {
  return req(`/api/obligaciones/${id}/comentario`, { method: 'POST', body: { texto } })
}

export async function apiChatObligacion(id, pregunta, historial) {
  return req(`/api/obligaciones/${id}/chat`, { method: 'POST', body: { pregunta, historial } })
}

export async function apiUploadArchivo(id, file) {
  const fd = new FormData()
  fd.append('file', file)
  const t = getToken()
  const res = await fetch(`${BASE}/api/obligaciones/${id}/archivo`, {
    method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || 'No se pudo subir el archivo')
  return data
}

export async function apiDownloadArchivo(obligacionId, eventoId, nombre) {
  const t = getToken()
  const res = await fetch(`${BASE}/api/obligaciones/${obligacionId}/archivo/${eventoId}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  })
  if (!res.ok) throw new Error('No se pudo descargar')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nombre || 'archivo'; a.click()
  URL.revokeObjectURL(url)
}

export async function apiAnalizarDocumento(file) {
  const fd = new FormData()
  fd.append('file', file)
  const t = getToken()
  const res = await fetch(`${BASE}/api/documentos/analizar`, {
    method: 'POST',
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || 'No se pudo analizar el documento')
  return data
}

// ── Programación ───────────────────────────────────────────
export async function apiGetProgramacion() {
  return req('/api/programacion')
}

export async function apiSaveProgramacion(cfg) {
  return req('/api/programacion', { method: 'PUT', body: cfg })
}

// ── Configuración (WhatsApp) ───────────────────────────────
export async function apiGetConfiguracion() {
  return req('/api/configuracion')
}

export async function apiSaveConfiguracion(cfg) {
  return req('/api/configuracion', { method: 'PUT', body: cfg })
}

export async function apiTestWhatsapp(whatsapp_numero, whatsapp_apikey) {
  return req('/api/configuracion/test-whatsapp', {
    method: 'POST', body: { whatsapp_numero, whatsapp_apikey },
  })
}

// ── Demo ───────────────────────────────────────────────────
export async function apiDemoSync() {
  return req('/api/demo/sync', { method: 'POST', auth: false })
}
