import { useState, useEffect } from 'react'
import ConfirmModal from './ConfirmModal'
import {
  apiListEmpresas, apiLookupRuc, apiCreateEmpresa, apiDeleteEmpresa, apiUpdateEmpresa,
} from '../api'

function EstadoBadge({ estado }) {
  const map = {
    activa: { color: '#00A651', bg: '#dcfce7', label: 'Activa' },
    pendiente: { color: '#b45309', bg: '#fef3c7', label: 'Pendiente' },
    error: { color: '#dc2626', bg: '#fee2e2', label: 'Error conexión' },
  }
  const s = map[estado] || map.pendiente
  return (
    <span style={{ color: s.color, background: s.bg, padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
      ● {s.label}
    </span>
  )
}

function AddEmpresaModal({ onClose, onCreated, terminosAceptados }) {
  const [form, setForm] = useState({
    ruc: '', razon_social: '', alias: '', sol_usuario: '', sol_password: '',
  })
  const [lookupState, setLookupState] = useState('') // '', 'loading', 'ok', 'fail'
  const [showPass, setShowPass] = useState(false)
  const [acepto, setAcepto] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleRucBlur() {
    if (form.ruc.length !== 11 || !/^\d+$/.test(form.ruc)) return
    setLookupState('loading')
    try {
      const data = await apiLookupRuc(form.ruc)
      if (data.success && data.razon_social) {
        setForm((f) => ({ ...f, razon_social: data.razon_social }))
        setLookupState('ok')
      } else {
        setLookupState('fail')
      }
    } catch {
      setLookupState('fail')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.ruc.length !== 11 || !/^\d+$/.test(form.ruc)) return setError('El RUC debe tener 11 dígitos.')
    if (!form.sol_usuario.trim()) return setError('Ingresa el usuario SOL.')
    if (!form.sol_password.trim()) return setError('Ingresa la clave SOL.')
    if (!terminosAceptados && !acepto) return setError('Debes aceptar los términos y condiciones.')
    setSaving(true)
    try {
      const data = await apiCreateEmpresa({ ...form, acepto_terminos: acepto })
      onCreated(data.empresa)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3>🏢 Agregar empresa</h3>
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">RUC *</label>
            <input className="form-input" type="text" maxLength={11} value={form.ruc}
              onChange={set('ruc')} onBlur={handleRucBlur} placeholder="20123456789" autoComplete="off" />
            {lookupState === 'loading' && <div className="hint">🔎 Consultando SUNAT...</div>}
            {lookupState === 'ok' && <div className="hint" style={{ color: '#00A651' }}>✓ Datos encontrados en SUNAT</div>}
            {lookupState === 'fail' && <div className="hint" style={{ color: '#b45309' }}>No se pudo consultar. Escribe la razón social manualmente.</div>}
          </div>

          <div className="form-group">
            <label className="form-label">Razón social</label>
            <input className="form-input" type="text" value={form.razon_social}
              onChange={set('razon_social')} placeholder="Se completa automáticamente con el RUC" />
          </div>

          <div className="form-group">
            <label className="form-label">Nombre / Alias <span style={{ fontWeight: 400, color: '#94a3b8' }}>(opcional)</span></label>
            <input className="form-input" type="text" value={form.alias}
              onChange={set('alias')} placeholder="Ej: Cliente principal" />
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', margin: '14px 0', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1B3A6B', marginBottom: 10 }}>🔐 Credenciales SUNAT SOL (se guardan cifradas)</div>
            <div className="form-group">
              <label className="form-label">Usuario SOL *</label>
              <input className="form-input" type="text" value={form.sol_usuario}
                onChange={set('sol_usuario')} placeholder="Usuario SOL" autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Clave SOL *</label>
              <div style={{ position: 'relative' }}>
                <input className="form-input" type={showPass ? 'text' : 'password'} value={form.sol_password}
                  onChange={set('sol_password')} placeholder="••••••••" autoComplete="new-password" />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  style={{ position: 'absolute', right: 10, top: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
          </div>

          {!terminosAceptados && (
            <label className="terminos-check">
              <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
              <span>Acepto los <a href="/terminos" target="_blank" rel="noreferrer">términos y condiciones</a> y autorizo a Dashbot a usar mis credenciales SOL (cifradas) únicamente para leer mi buzón SUNAT en mi nombre.</span>
            </label>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-accent" disabled={saving || (!terminosAceptados && !acepto)}>
              {saving ? '⏳ Guardando...' : '💾 Agregar empresa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditEmpresaModal({ empresa, onClose, onSaved }) {
  const [form, setForm] = useState({
    razon_social: empresa.razon_social || '', alias: empresa.alias || '',
    sol_usuario: empresa.sol_usuario || '', sol_password: '',
  })
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.sol_usuario.trim()) return setError('El usuario SOL es obligatorio.')
    setSaving(true)
    try {
      const data = await apiUpdateEmpresa(empresa.id, form)
      onSaved(data.empresa)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3>✏️ Editar empresa</h3>
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">RUC</label>
            <input className="form-input" type="text" value={empresa.ruc} disabled
              style={{ background: 'var(--gray-50)', color: 'var(--gray-600)' }} />
            <div className="hint">El RUC no se puede cambiar.</div>
          </div>
          <div className="form-group">
            <label className="form-label">Razón social</label>
            <input className="form-input" type="text" value={form.razon_social} onChange={set('razon_social')} />
          </div>
          <div className="form-group">
            <label className="form-label">Nombre / Alias <span style={{ fontWeight: 400, color: '#94a3b8' }}>(opcional)</span></label>
            <input className="form-input" type="text" value={form.alias} onChange={set('alias')} placeholder="Ej: Cliente principal" />
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', margin: '14px 0', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1B3A6B', marginBottom: 10 }}>🔐 Credenciales SUNAT SOL</div>
            <div className="form-group">
              <label className="form-label">Usuario SOL *</label>
              <input className="form-input" type="text" value={form.sol_usuario} onChange={set('sol_usuario')} autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Nueva clave SOL</label>
              <div style={{ position: 'relative' }}>
                <input className="form-input" type={showPass ? 'text' : 'password'} value={form.sol_password}
                  onChange={set('sol_password')} placeholder="Déjala vacía para mantener la actual" autoComplete="new-password" />
                <button type="button" onClick={() => setShowPass((s) => !s)}
                  style={{ position: 'absolute', right: 10, top: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
              <div className="hint">Si el cliente cambió su clave SOL, escríbela aquí para actualizarla.</div>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-accent" disabled={saving}>
              {saving ? '⏳ Guardando...' : '💾 Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Empresas({ onOpenEmpresa }) {
  const [empresas, setEmpresas] = useState([])
  const [max, setMax] = useState(10)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editar, setEditar] = useState(null)
  const [terminosAceptados, setTerminosAceptados] = useState(true)
  const [confirmar, setConfirmar] = useState(null)
  const [borrando, setBorrando] = useState(false)

  async function load() {
    try {
      const data = await apiListEmpresas()
      setEmpresas(data.empresas || [])
      setMax(data.max || 10)
      setTerminosAceptados(data.terminos_aceptados ?? true)
    } catch (_) {
      // sesión expirada se maneja en App
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleDelete(empresa, e) {
    e.stopPropagation()
    setConfirmar(empresa)
  }
  async function confirmarEliminar() {
    if (!confirmar) return
    setBorrando(true)
    try {
      await apiDeleteEmpresa(confirmar.id)
      setEmpresas((prev) => prev.filter((x) => x.id !== confirmar.id))
      setConfirmar(null)
    } catch (err) {
      alert(`⚠️ ${err.message}`)
    } finally {
      setBorrando(false)
    }
  }

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="empresas-page">
      <div className="empresas-header">
        <div>
          <h1 className="empresas-title">🏢 Empresas</h1>
          <p className="empresas-sub">{empresas.length} de {max} empresas registradas</p>
        </div>
        <button className="btn-accent" onClick={() => setShowModal(true)} disabled={empresas.length >= max}>
          + Agregar empresa
        </button>
      </div>

      {loading ? (
        <div className="empresas-empty">Cargando empresas...</div>
      ) : empresas.length === 0 ? (
        <div className="empresas-empty">
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
          <h3>Aún no tienes empresas</h3>
          <p>Agrega tu primera empresa para empezar a monitorear su buzón SUNAT.</p>
          <button className="btn-accent" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>
            + Agregar mi primera empresa
          </button>
        </div>
      ) : (
        <>
          <div className="empresas-table">
            <div className="empresas-row empresas-row-head">
              <div>Empresa / RUC</div>
              <div>Estado</div>
              <div>Último login</div>
              <div>Última extracción</div>
              <div style={{ textAlign: 'right' }}>Acciones</div>
            </div>
            {empresas.map((e) => (
              <div className="empresas-row" key={e.id}>
                <div className="empresa-cell-name empresa-clickable" onClick={() => setEditar(e)} title="Ver / editar credenciales">
                  <div className="empresa-avatar">{(e.razon_social || e.ruc)[0]}</div>
                  <div>
                    <div className="empresa-name">{e.alias || e.razon_social || 'Sin nombre'}</div>
                    <div className="empresa-ruc">{e.ruc}</div>
                  </div>
                </div>
                <div><EstadoBadge estado={e.estado} /></div>
                <div className="empresa-cell-muted">{fmtDate(e.last_login)}</div>
                <div className="empresa-cell-muted">{fmtDate(e.last_sync)}</div>
                <div className="empresa-actions">
                  <button className="btn-extraer" onClick={() => onOpenEmpresa(e)}>⬇ Extraer</button>
                  <button className="btn-icon" title="Editar" onClick={() => setEditar(e)}>✏️</button>
                  <button className="btn-icon" title="Eliminar" onClick={(ev) => handleDelete(e, ev)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>

          <div className="plan-usage">
            <div className="plan-usage-label">USO DEL PLAN</div>
            <div className="plan-usage-bar">
              <div className="plan-usage-fill" style={{ width: `${(empresas.length / max) * 100}%` }} />
            </div>
            <div className="plan-usage-count">{empresas.length} / {max}</div>
          </div>
        </>
      )}

      {showModal && (
        <AddEmpresaModal
          terminosAceptados={terminosAceptados}
          onClose={() => setShowModal(false)}
          onCreated={(emp) => { setEmpresas((p) => [...p, emp]); setTerminosAceptados(true); setShowModal(false) }}
        />
      )}
      {editar && (
        <EditEmpresaModal
          empresa={editar}
          onClose={() => setEditar(null)}
          onSaved={(emp) => { setEmpresas((p) => p.map((x) => x.id === emp.id ? emp : x)); setEditar(null) }}
        />
      )}
      {confirmar && (
        <ConfirmModal
          icon="🏢"
          title="Eliminar empresa"
          message="Se eliminará la empresa y sus notificaciones guardadas. Esta acción no se puede deshacer."
          detail={confirmar.alias || confirmar.razon_social || confirmar.ruc}
          loading={borrando}
          onCancel={() => setConfirmar(null)}
          onConfirm={confirmarEliminar}
        />
      )}
    </div>
  )
}
