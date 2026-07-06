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

export async function apiUpdateProfile(data) {
  return req('/api/auth/profile', { method: 'PUT', body: data })
}

export async function apiChangePassword(actual, nueva) {
  return req('/api/auth/change-password', { method: 'POST', body: { actual, nueva } })
}

// ── Empresas ───────────────────────────────────────────────
export async function apiListEmpresas() {
  return req('/api/empresas')
}

export async function apiLookupRuc(ruc) {
  return req(`/api/ruc/${ruc}`)
}

export async function apiCreateEmpresa({ ruc, razon_social, alias, sol_usuario, sol_password, acepto_terminos }) {
  return req('/api/empresas', {
    method: 'POST',
    body: { ruc, razon_social, alias, sol_usuario, sol_password, acepto_terminos },
  })
}

export async function apiDeleteEmpresa(id) {
  return req(`/api/empresas/${id}`, { method: 'DELETE' })
}

export async function apiUpdateEmpresa(id, data) {
  return req(`/api/empresas/${id}`, { method: 'PUT', body: data })
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

export async function apiGenerarTodas(year) {
  const q = year ? `?year=${year}` : ''
  return req(`/api/obligaciones/generar-todas${q}`, { method: 'POST' })
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

// ── Documentos del colaborador (Equipo · Contratos y documentos) ──
export async function apiListDocumentos(colaboradorId = 0, empresaId = 0) {
  const qs = new URLSearchParams()
  if (colaboradorId) qs.set('colaborador_id', colaboradorId)
  if (empresaId) qs.set('empresa_id', empresaId)
  return req(`/api/equipo/documentos?${qs.toString()}`)
}

export async function apiUploadDocumento({ colaboradorId, empresaId, colaboradorNombre, tipo, titulo, descripcion, file }) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('colaborador_id', colaboradorId || 0)
  fd.append('empresa_id', empresaId || 0)
  fd.append('colaborador_nombre', colaboradorNombre || '')
  fd.append('tipo', tipo || 'otro')
  fd.append('titulo', titulo || '')
  fd.append('descripcion', descripcion || '')
  const t = getToken()
  const res = await fetch(`${BASE}/api/equipo/documentos`, {
    method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || 'No se pudo subir el documento')
  return data
}

export async function apiDownloadDocumento(docId, nombre) {
  const t = getToken()
  const res = await fetch(`${BASE}/api/equipo/documentos/${docId}/download`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  })
  if (!res.ok) throw new Error('No se pudo descargar')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nombre || 'documento'; a.click()
  URL.revokeObjectURL(url)
}

export async function apiDeleteDocumento(docId) {
  return req(`/api/equipo/documentos/${docId}`, { method: 'DELETE' })
}

// ── Comprobantes (registro contable · compras/ventas) ──────
export async function apiListComprobantes(empresaId = 0, operacion = '') {
  const qs = new URLSearchParams()
  if (empresaId) qs.set('empresa_id', empresaId)
  if (operacion) qs.set('operacion', operacion)
  return req(`/api/comprobantes?${qs.toString()}`)
}

export async function apiRegistrarComprobante(payload) {
  return req('/api/comprobantes', { method: 'POST', body: payload })
}

export async function apiDeleteComprobante(id) {
  return req(`/api/comprobantes/${id}`, { method: 'DELETE' })
}

// ── SIRE SUNAT (API oficial) ───────────────────────────────
export async function apiSaveApiSunat(empresaId, clientId, clientSecret) {
  return req(`/api/empresas/${empresaId}/api-sunat`, {
    method: 'PUT', body: { client_id: clientId, client_secret: clientSecret },
  })
}

export async function apiSireProbar(empresaId) {
  return req('/api/sire/probar', { method: 'POST', body: { empresa_id: empresaId } })
}

export async function apiSireCargar(empresaId, periodo, libro) {
  return req('/api/sire/cargar', { method: 'POST', body: { empresa_id: empresaId, periodo, libro } })
}

export async function apiSireRegistrar(empresaId, periodo, libro, comprobantes) {
  return req('/api/sire/registrar', { method: 'POST', body: { empresa_id: empresaId, periodo, libro, comprobantes } })
}

// ── Horario Contable (agenda por horas) ────────────────────
export async function apiListHorario(fecha) {
  return req(`/api/horario?fecha=${encodeURIComponent(fecha)}`)
}

export async function apiSaveHorario(payload) {
  return req('/api/horario', { method: 'POST', body: payload })
}

export async function apiHorarioComentario(fecha, hora, texto) {
  return req('/api/horario/comentario', { method: 'POST', body: { fecha, hora, texto } })
}

export async function apiBuscarHorario(q) {
  return req(`/api/horario/buscar?q=${encodeURIComponent(q)}`)
}

export async function apiHorarioArchivo(fecha, hora, file) {
  const fd = new FormData()
  fd.append('file', file); fd.append('fecha', fecha); fd.append('hora', hora)
  const t = getToken()
  const res = await fetch(`${BASE}/api/horario/archivo`, {
    method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || 'No se pudo subir el archivo')
  return data
}

export async function apiHorarioArchivoDownload(fid, nombre) {
  const t = getToken()
  const res = await fetch(`${BASE}/api/horario/archivo/${fid}/download`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  })
  if (!res.ok) throw new Error('No se pudo descargar')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nombre || 'archivo'; a.click()
  URL.revokeObjectURL(url)
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

// ── Equipo: Colaboradores ──────────────────────────────────
export async function apiListColaboradores(empresaId = 0) {
  const q = empresaId ? `?empresa_id=${empresaId}` : ''
  return req(`/api/colaboradores${q}`)
}
export async function apiCreateColaborador(data) {
  return req('/api/colaboradores', { method: 'POST', body: data })
}
export async function apiUpdateColaborador(id, data) {
  return req(`/api/colaboradores/${id}`, { method: 'PUT', body: data })
}
export async function apiDeleteColaborador(id) {
  return req(`/api/colaboradores/${id}`, { method: 'DELETE' })
}
export async function apiImportColaboradores(empresaId, file) {
  const fd = new FormData(); fd.append('file', file)
  const t = getToken(); const p = empresaId ? `?empresa_id=${empresaId}` : ''
  const res = await fetch(`${BASE}/api/colaboradores/import${p}`, { method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd })
  const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.detail || 'No se pudo importar'); return d
}
export async function apiExportColaboradores(empresaId) {
  const t = getToken(); const p = empresaId ? `?empresa_id=${empresaId}` : ''
  const res = await fetch(`${BASE}/api/colaboradores/export${p}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
  if (!res.ok) throw new Error('No se pudo exportar')
  const blob = await res.blob(); const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'colaboradores.xlsx'; a.click(); URL.revokeObjectURL(url)
}

// ── Equipo: Talento (eventos) ──────────────────────────────
export async function apiListTalento(empresaId = 0, periodo = '', tipo = '') {
  const p = new URLSearchParams(); if (empresaId) p.set('empresa_id', empresaId); if (periodo) p.set('periodo', periodo); if (tipo) p.set('tipo', tipo)
  return req(`/api/talento/eventos?${p.toString()}`)
}
export async function apiCreateTalento(data) { return req('/api/talento/eventos', { method: 'POST', body: data }) }
export async function apiUpdateTalento(id, data) { return req(`/api/talento/eventos/${id}`, { method: 'PUT', body: data }) }
export async function apiDeleteTalento(id) { return req(`/api/talento/eventos/${id}`, { method: 'DELETE' }) }

// ── Planilla: poblar desde colaboradores ───────────────────
export async function apiPlanillaDesdeColaboradores(empresaId, periodo) {
  const p = new URLSearchParams(); if (empresaId) p.set('empresa_id', empresaId); if (periodo) p.set('periodo', periodo)
  return req(`/api/planilla/trabajadores/desde-colaboradores?${p.toString()}`, { method: 'POST' })
}

// ── Planilla (PLAME) ───────────────────────────────────────
export async function apiListPlanilla(tipo, empresaId = 0, periodo = '') {
  const p = new URLSearchParams()
  if (empresaId) p.set('empresa_id', empresaId)
  if (periodo) p.set('periodo', periodo)
  return req(`/api/planilla/${tipo}?${p.toString()}`)
}
export async function apiCreatePlanilla(tipo, data) {
  return req(`/api/planilla/${tipo}`, { method: 'POST', body: data })
}
export async function apiUpdatePlanilla(tipo, id, data) {
  return req(`/api/planilla/${tipo}/${id}`, { method: 'PUT', body: data })
}
export async function apiDeletePlanilla(tipo, id) {
  return req(`/api/planilla/${tipo}/${id}`, { method: 'DELETE' })
}
export async function apiImportPlanilla(tipo, empresaId, periodo, file) {
  const fd = new FormData(); fd.append('file', file)
  const t = getToken()
  const p = new URLSearchParams()
  if (empresaId) p.set('empresa_id', empresaId)
  if (periodo) p.set('periodo', periodo)
  const res = await fetch(`${BASE}/api/planilla/${tipo}/import?${p.toString()}`, {
    method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd,
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.detail || 'No se pudo importar')
  return d
}
export async function apiExportPlanilla(tipo, empresaId, periodo) {
  const t = getToken()
  const p = new URLSearchParams()
  if (empresaId) p.set('empresa_id', empresaId)
  if (periodo) p.set('periodo', periodo)
  const res = await fetch(`${BASE}/api/planilla/${tipo}/export?${p.toString()}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  })
  if (!res.ok) throw new Error('No se pudo exportar')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `planilla_${tipo}_${periodo || 'todos'}.xlsx`; a.click()
  URL.revokeObjectURL(url)
}

// ── Chatbot general (Centro de Mando) ──────────────────────
export async function apiChat(pregunta, historial) {
  return req('/api/chat', { method: 'POST', body: { pregunta, historial } })
}

// ── Declaraciones y Pagos (PDT 621 + pagos SUNAT) ──────────
async function uploadDecl(path, empresaId, file, modo) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${BASE}${path}?empresa_id=${empresaId}&modo=${modo}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || 'Error al importar el archivo')
  return data
}

export async function apiImportarPdt(empresaId, file, modo = 'cargar') {
  return uploadDecl('/api/declaraciones/pdt/importar', empresaId, file, modo)
}

export async function apiListPdt(empresaId = 0, anio = 0) {
  return req(`/api/declaraciones/pdt?empresa_id=${empresaId}&anio=${anio}`)
}

export async function apiUpdatePdt(id, data) {
  return req(`/api/declaraciones/pdt/${id}`, { method: 'PUT', body: data })
}

export async function apiLimpiarPdt(empresaId = 0, anio = 0) {
  return req(`/api/declaraciones/pdt?empresa_id=${empresaId}&anio=${anio}`, { method: 'DELETE' })
}

export async function apiImportarPagosSunat(empresaId, file, modo = 'cargar') {
  return uploadDecl('/api/declaraciones/pagos/importar', empresaId, file, modo)
}

export async function apiListPagosSunat(empresaId = 0, anio = 0) {
  return req(`/api/declaraciones/pagos?empresa_id=${empresaId}&anio=${anio}`)
}

export async function apiLimpiarPagosSunat(empresaId = 0, anio = 0) {
  return req(`/api/declaraciones/pagos?empresa_id=${empresaId}&anio=${anio}`, { method: 'DELETE' })
}

export async function apiReporteDecl(empresaId = 0, anio = 0) {
  return req(`/api/declaraciones/reporte?empresa_id=${empresaId}&anio=${anio}`)
}

// ── Demo ───────────────────────────────────────────────────
export async function apiDemoSync() {
  return req('/api/demo/sync', { method: 'POST', auth: false })
}
