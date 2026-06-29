import { useState, useEffect } from 'react'
import ConfirmModal from './ConfirmModal'
import {
  apiListColaboradores, apiListEmpresas, apiCreateColaborador,
  apiUpdateColaborador, apiDeleteColaborador,
} from '../api'

const VACIO = {
  empresa_id: '', tipo_doc: 'DNI', num_doc: '', ap_paterno: '', ap_materno: '', nombres: '',
  fecha_nacimiento: '', sexo: '', nacionalidad: 'Peruana', tipo_trabajador: 'Empleado',
  regimen_laboral: 'Régimen General', tipo_contrato: 'Indeterminado', ocupacion: '',
  jornada: 'Tiempo completo', fecha_ingreso: '', fecha_cese: '', situacion: 'activo',
  regimen_pensionario: 'ONP', afp_nombre: '', cuspp: '', regimen_salud: 'EsSalud',
  remuneracion: '', periodicidad: 'Mensual', tipo_pago: 'Depósito', cci: '',
  email: '', telefono: '', direccion: '', discapacidad: false, sindicalizado: false,
}

function Campo({ label, children, full }) {
  return (
    <div className="form-group" style={{ flex: full ? '1 1 100%' : 1, marginBottom: 0 }}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  )
}

function ColabModal({ inicial, empresas, onClose, onSaved }) {
  const [f, setF] = useState({ ...VACIO, ...inicial, empresa_id: inicial?.empresa_id || empresas[0]?.id || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const inp = (k, props = {}) => <input className="form-input" value={f[k] || ''} onChange={set(k)} {...props} />
  const sel = (k, opts) => <select className="form-input" value={f[k] || ''} onChange={set(k)}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>

  async function guardar(e) {
    e.preventDefault(); setError('')
    if (!f.num_doc.trim() || !f.nombres.trim() || !f.ap_paterno.trim()) return setError('Documento, nombres y apellido paterno son obligatorios.')
    setSaving(true)
    try {
      const payload = { ...f, empresa_id: f.empresa_id ? Number(f.empresa_id) : null }
      const data = inicial?.id ? await apiUpdateColaborador(inicial.id, payload) : await apiCreateColaborador(payload)
      onSaved(data.colaborador, !!inicial?.id)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal colab-modal" onClick={(e) => e.stopPropagation()}>
        <h3>👤 {inicial?.id ? 'Editar' : 'Nuevo'} colaborador</h3>
        <p className="colab-modal-sub">Datos alineados al PDT PLAME / T-Registro SUNAT.</p>
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={guardar}>
          <div className="colab-sec">Identificación</div>
          <div className="colab-row">
            <Campo label="Empresa (empleador)">{sel('empresa_id', [''].concat(empresas.map((e) => e.id))) }</Campo>
          </div>
          <div className="colab-row">
            <Campo label="Tipo doc.">{sel('tipo_doc', ['DNI', 'CE', 'Pasaporte', 'PTP'])}</Campo>
            <Campo label="N° documento *">{inp('num_doc', { maxLength: 20 })}</Campo>
            <Campo label="Sexo">{sel('sexo', ['', 'M', 'F'])}</Campo>
          </div>
          <div className="colab-row">
            <Campo label="Apellido paterno *">{inp('ap_paterno')}</Campo>
            <Campo label="Apellido materno">{inp('ap_materno')}</Campo>
          </div>
          <div className="colab-row">
            <Campo label="Nombres *">{inp('nombres')}</Campo>
            <Campo label="Fecha nacimiento">{inp('fecha_nacimiento', { type: 'date' })}</Campo>
            <Campo label="Nacionalidad">{inp('nacionalidad')}</Campo>
          </div>

          <div className="colab-sec">Datos laborales (PLAME)</div>
          <div className="colab-row">
            <Campo label="Tipo de trabajador">{sel('tipo_trabajador', ['Empleado', 'Obrero', 'Practicante', 'Pensionista', 'Personal de terceros'])}</Campo>
            <Campo label="Régimen laboral">{sel('regimen_laboral', ['Régimen General', 'Microempresa', 'Pequeña empresa', 'Agrario', 'Construcción civil', 'Trabajadora del hogar'])}</Campo>
          </div>
          <div className="colab-row">
            <Campo label="Tipo de contrato">{sel('tipo_contrato', ['Indeterminado', 'Plazo fijo', 'Tiempo parcial', 'Locación de servicios'])}</Campo>
            <Campo label="Ocupación / cargo">{inp('ocupacion')}</Campo>
            <Campo label="Jornada">{sel('jornada', ['Tiempo completo', 'Tiempo parcial'])}</Campo>
          </div>
          <div className="colab-row">
            <Campo label="Fecha de ingreso">{inp('fecha_ingreso', { type: 'date' })}</Campo>
            <Campo label="Fecha de cese">{inp('fecha_cese', { type: 'date' })}</Campo>
            <Campo label="Situación">{sel('situacion', ['activo', 'cesado', 'subsidiado', 'licencia'])}</Campo>
          </div>

          <div className="colab-sec">Previsional y salud</div>
          <div className="colab-row">
            <Campo label="Régimen pensionario">{sel('regimen_pensionario', ['ONP', 'AFP'])}</Campo>
            {f.regimen_pensionario === 'AFP' && <Campo label="AFP">{sel('afp_nombre', ['', 'Integra', 'Prima', 'Profuturo', 'Habitat'])}</Campo>}
            {f.regimen_pensionario === 'AFP' && <Campo label="CUSPP">{inp('cuspp')}</Campo>}
            <Campo label="Régimen de salud">{sel('regimen_salud', ['EsSalud', 'EPS'])}</Campo>
          </div>

          <div className="colab-sec">Remuneración y pago</div>
          <div className="colab-row">
            <Campo label="Remuneración (S/)">{inp('remuneracion', { type: 'number', step: '0.01' })}</Campo>
            <Campo label="Periodicidad">{sel('periodicidad', ['Mensual', 'Quincenal', 'Semanal'])}</Campo>
            <Campo label="Forma de pago">{sel('tipo_pago', ['Depósito', 'Efectivo'])}</Campo>
          </div>
          <div className="colab-row">
            <Campo label="CCI (cuenta interbancaria)">{inp('cci')}</Campo>
          </div>

          <div className="colab-sec">Contacto</div>
          <div className="colab-row">
            <Campo label="Correo">{inp('email', { type: 'email' })}</Campo>
            <Campo label="Teléfono">{inp('telefono')}</Campo>
          </div>
          <div className="colab-row">
            <Campo label="Dirección" full>{inp('direccion')}</Campo>
          </div>
          <div className="colab-checks">
            <label><input type="checkbox" checked={f.discapacidad} onChange={set('discapacidad')} /> Persona con discapacidad</label>
            <label><input type="checkbox" checked={f.sindicalizado} onChange={set('sindicalizado')} /> Sindicalizado</label>
          </div>

          <div className="modal-actions" style={{ marginTop: 18 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-accent" disabled={saving}>{saving ? '⏳ Guardando...' : '💾 Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Colaboradores({ onBack }) {
  const [colabs, setColabs] = useState([])
  const [empresas, setEmpresas] = useState([])
  const [filtro, setFiltro] = useState(0)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)   // null | {} (nuevo) | colaborador (editar)
  const [confirmar, setConfirmar] = useState(null)
  const [borrando, setBorrando] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const d = await apiListColaboradores(filtro)
      setColabs(d.colaboradores || [])
    } catch (_) {} finally { setLoading(false) }
  }
  useEffect(() => { apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {}) }, [])
  useEffect(() => { load() }, [filtro])

  async function confirmarEliminar() {
    if (!confirmar) return
    setBorrando(true)
    try { await apiDeleteColaborador(confirmar.id); setColabs((p) => p.filter((x) => x.id !== confirmar.id)); setConfirmar(null) }
    catch (e) { alert(`⚠️ ${e.message}`) } finally { setBorrando(false) }
  }

  return (
    <div className="prog-page">
      <div className="empresas-header">
        <div>
          <button className="eq-back" onClick={onBack}>← Equipo</button>
          <h1 className="empresas-title">👥 Colaboradores</h1>
          <p className="empresas-sub">{colabs.length} colaborador(es) · alineado al PDT PLAME</p>
        </div>
        <button className="btn-accent" style={{ flex: 'none' }} onClick={() => setModal({})}>+ Nuevo colaborador</button>
      </div>

      <div className="form-group" style={{ maxWidth: 320 }}>
        <label className="form-label">Empresa</label>
        <select className="form-input" value={filtro} onChange={(e) => setFiltro(Number(e.target.value))}>
          <option value={0}>Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
        </select>
      </div>

      {loading ? <div className="empresas-empty">Cargando...</div>
        : colabs.length === 0 ? (
          <div className="empresas-empty">
            <div style={{ fontSize: 40, marginBottom: 10 }}>👥</div>
            <h3>Sin colaboradores</h3>
            <p>Registra tu primer colaborador con los datos del PLAME.</p>
            <button className="btn-accent" style={{ marginTop: 14 }} onClick={() => setModal({})}>+ Nuevo colaborador</button>
          </div>
        ) : (
          <div className="empresas-table">
            <div className="colab-row-grid colab-head">
              <div>Colaborador</div><div>Documento</div><div>Cargo</div><div>Pensión</div><div>Situación</div><div style={{ textAlign: 'right' }}>Acciones</div>
            </div>
            {colabs.map((c) => (
              <div className="colab-row-grid" key={c.id}>
                <div className="colab-cell-name" onClick={() => setModal(c)}>
                  <div className="empresa-avatar">{(c.nombres || c.num_doc || '?')[0]}</div>
                  <div>
                    <div className="empresa-name">{c.nombre_completo || 'Sin nombre'}</div>
                    <div className="empresa-ruc">{c.ocupacion || c.tipo_trabajador}</div>
                  </div>
                </div>
                <div className="empresa-cell-muted">{c.tipo_doc} {c.num_doc}</div>
                <div className="empresa-cell-muted">{c.ocupacion || '—'}</div>
                <div className="empresa-cell-muted">{c.regimen_pensionario}{c.afp_nombre ? ` · ${c.afp_nombre}` : ''}</div>
                <div><span className={`colab-sit ${c.situacion}`}>{c.situacion}</span></div>
                <div className="empresa-actions">
                  <button className="btn-icon" title="Editar" onClick={() => setModal(c)}>✏️</button>
                  <button className="btn-icon" title="Eliminar" onClick={() => setConfirmar(c)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}

      {modal && <ColabModal inicial={modal} empresas={empresas} onClose={() => setModal(null)}
        onSaved={(c, edit) => { setColabs((p) => edit ? p.map((x) => x.id === c.id ? c : x) : [...p, c]); setModal(null) }} />}
      {confirmar && <ConfirmModal icon="👤" title="Eliminar colaborador"
        message="¿Seguro que deseas eliminar a este colaborador? Esta acción no se puede deshacer."
        detail={confirmar.nombre_completo} loading={borrando}
        onCancel={() => setConfirmar(null)} onConfirm={confirmarEliminar} />}
    </div>
  )
}
