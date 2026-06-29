import { useState, useEffect, useRef } from 'react'
import ConfirmModal from './ConfirmModal'
import {
  apiListPlanilla, apiCreatePlanilla, apiUpdatePlanilla, apiDeletePlanilla,
  apiImportPlanilla, apiExportPlanilla, apiListEmpresas, apiPlanillaDesdeColaboradores,
} from '../api'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre']
const S = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const TRAB_VACIO = {
  num_doc: '', nombre: '', regimen_pensionario: 'ONP', afp_nombre: '', dias_laborados: 30,
  remuneracion: '', asignacion_familiar: '', otros_ingresos: '', aporte_pension: '',
  essalud: '', renta_quinta: '', otros_descuentos: '',
}
const CUARTA_VACIO = {
  tipo_doc: 'RUC', num_doc: '', nombre: '', num_recibo: '', fecha_emision: '',
  monto_bruto: '', retencion: '',
}

function TrabModal({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ ...TRAB_VACIO, ...inicial })
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  function autocompletar() {
    const rem = (Number(f.remuneracion) || 0) + (Number(f.asignacion_familiar) || 0) + (Number(f.otros_ingresos) || 0)
    const tasa = f.regimen_pensionario === 'AFP' ? 0.125 : 0.13
    setF((x) => ({ ...x, aporte_pension: (rem * tasa).toFixed(2), essalud: (rem * 0.09).toFixed(2) }))
  }
  async function guardar(e) {
    e.preventDefault(); setErr('')
    if (!f.nombre.trim() || !f.num_doc.trim()) return setErr('Documento y nombre son obligatorios.')
    setSaving(true)
    try {
      const num = (k) => Number(f[k]) || 0
      const payload = { ...f, periodo: f.periodo, dias_laborados: Number(f.dias_laborados) || 0,
        remuneracion: num('remuneracion'), asignacion_familiar: num('asignacion_familiar'),
        otros_ingresos: num('otros_ingresos'), aporte_pension: num('aporte_pension'),
        essalud: num('essalud'), renta_quinta: num('renta_quinta'), otros_descuentos: num('otros_descuentos') }
      const d = inicial?.id ? await apiUpdatePlanilla('trabajadores', inicial.id, payload) : await apiCreatePlanilla('trabajadores', payload)
      onSaved(d.trabajador, !!inicial?.id)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const inp = (k, p = {}) => <input className="form-input" value={f[k] ?? ''} onChange={set(k)} {...p} />
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal colab-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🧾 {inicial?.id ? 'Editar' : 'Nuevo'} trabajador (5ta)</h3>
        {err && <div className="error-msg" style={{ marginBottom: 12 }}>⚠️ {err}</div>}
        <form onSubmit={guardar}>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">N° documento *</label>{inp('num_doc')}</div>
            <div className="form-group" style={{ flex: 2, marginBottom: 0 }}><label className="form-label">Apellidos y nombres *</label>{inp('nombre')}</div>
          </div>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Pensión</label>
              <select className="form-input" value={f.regimen_pensionario} onChange={set('regimen_pensionario')}><option>ONP</option><option>AFP</option></select></div>
            {f.regimen_pensionario === 'AFP' && <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">AFP</label>
              <select className="form-input" value={f.afp_nombre} onChange={set('afp_nombre')}><option value=""></option><option>Integra</option><option>Prima</option><option>Profuturo</option><option>Habitat</option></select></div>}
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Días lab.</label>{inp('dias_laborados', { type: 'number' })}</div>
          </div>
          <div className="colab-sec">Ingresos</div>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Remuneración</label>{inp('remuneracion', { type: 'number', step: '0.01' })}</div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Asig. familiar</label>{inp('asignacion_familiar', { type: 'number', step: '0.01' })}</div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Otros ingresos</label>{inp('otros_ingresos', { type: 'number', step: '0.01' })}</div>
          </div>
          <div className="colab-sec">Descuentos y aportes <button type="button" className="pl-auto" onClick={autocompletar}>✨ Calcular aportes</button></div>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Aporte pensión</label>{inp('aporte_pension', { type: 'number', step: '0.01' })}</div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">EsSalud 9%</label>{inp('essalud', { type: 'number', step: '0.01' })}</div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Renta 5ta</label>{inp('renta_quinta', { type: 'number', step: '0.01' })}</div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Otros desc.</label>{inp('otros_descuentos', { type: 'number', step: '0.01' })}</div>
          </div>
          <div className="modal-actions" style={{ marginTop: 18 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-accent" disabled={saving}>{saving ? '⏳...' : '💾 Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CuartaModal({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ ...CUARTA_VACIO, ...inicial })
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const inp = (k, p = {}) => <input className="form-input" value={f[k] ?? ''} onChange={set(k)} {...p} />
  function calcular() { setF((x) => ({ ...x, retencion: ((Number(x.monto_bruto) || 0) * 0.08).toFixed(2) })) }
  async function guardar(e) {
    e.preventDefault(); setErr('')
    if (!f.nombre.trim() || !f.num_doc.trim()) return setErr('Documento y nombre son obligatorios.')
    setSaving(true)
    try {
      const payload = { ...f, periodo: f.periodo, monto_bruto: Number(f.monto_bruto) || 0, retencion: Number(f.retencion) || 0 }
      const d = inicial?.id ? await apiUpdatePlanilla('cuarta', inicial.id, payload) : await apiCreatePlanilla('cuarta', payload)
      onSaved(d.cuarta, !!inicial?.id)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal colab-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3>📄 {inicial?.id ? 'Editar' : 'Nuevo'} recibo 4ta (RHE)</h3>
        {err && <div className="error-msg" style={{ marginBottom: 12 }}>⚠️ {err}</div>}
        <form onSubmit={guardar}>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Tipo doc.</label>
              <select className="form-input" value={f.tipo_doc} onChange={set('tipo_doc')}><option>RUC</option><option>DNI</option></select></div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">N° documento *</label>{inp('num_doc')}</div>
          </div>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Razón social / Nombre *</label>{inp('nombre')}</div>
          </div>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">N° Recibo (RHE)</label>{inp('num_recibo', { placeholder: 'E001-123' })}</div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Fecha emisión</label>{inp('fecha_emision', { type: 'date' })}</div>
          </div>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Monto bruto</label>{inp('monto_bruto', { type: 'number', step: '0.01' })}</div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Retención 8% <button type="button" className="pl-auto" onClick={calcular}>✨</button></label>{inp('retencion', { type: 'number', step: '0.01' })}</div>
          </div>
          <div className="modal-actions" style={{ marginTop: 18 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-accent" disabled={saving}>{saving ? '⏳...' : '💾 Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Planilla({ onBack }) {
  const hoy = new Date()
  const [tab, setTab] = useState('trabajadores')
  const [empresas, setEmpresas] = useState([])
  const [filtroEmp, setFiltroEmp] = useState(0)
  const [periodo, setPeriodo] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`)
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [confirmar, setConfirmar] = useState(null)
  const [borrando, setBorrando] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {}) }, [])
  async function load() {
    setLoading(true)
    try { const d = await apiListPlanilla(tab, filtroEmp, periodo); setFilas(d[tab] || []) }
    catch (_) {} finally { setLoading(false) }
  }
  useEffect(() => { load() }, [tab, filtroEmp, periodo])

  const [y, m] = periodo.split('-')
  const totalIngresos = filas.reduce((s, f) => s + (f.total_ingresos ?? f.monto_bruto ?? 0), 0)
  const totalNeto = filas.reduce((s, f) => s + (f.neto_pagar || 0), 0)
  const totalRet = filas.reduce((s, f) => s + (f.retencion || f.aporte_pension || 0), 0)

  async function exportar() {
    try { await apiExportPlanilla(tab, filtroEmp, periodo) } catch (e) { alert(`⚠️ ${e.message}`) }
  }
  async function desdeColaboradores() {
    setMsg('Cargando colaboradores…')
    try { const d = await apiPlanillaDesdeColaboradores(filtroEmp, periodo); setMsg(`✓ ${d.creados} trabajador(es) agregados desde el registro.`); await load() }
    catch (e) { setMsg(`⚠️ ${e.message}`) }
  }
  async function importar(e) {
    const file = e.target.files?.[0]; if (!file) return
    setMsg('Importando…')
    try {
      const d = await apiImportPlanilla(tab, filtroEmp, periodo, file)
      setMsg(`✓ ${d.creados} fila(s) importadas.`); await load()
    } catch (err) { setMsg(`⚠️ ${err.message}`) } finally { if (fileRef.current) fileRef.current.value = '' }
  }
  async function confirmarEliminar() {
    setBorrando(true)
    try { await apiDeletePlanilla(tab, confirmar.id); setFilas((p) => p.filter((x) => x.id !== confirmar.id)); setConfirmar(null) }
    catch (e) { alert(`⚠️ ${e.message}`) } finally { setBorrando(false) }
  }

  return (
    <div className="prog-page">
      <div className="empresas-header">
        <div>
          <button className="eq-back" onClick={onBack}>← Equipo</button>
          <h1 className="empresas-title">🧾 Planilla (PLAME)</h1>
          <p className="empresas-sub">Remuneraciones de trabajadores y recibos de 4ta categoría · {MESES[Number(m) - 1]} {y}</p>
        </div>
        <button className="btn-accent" style={{ flex: 'none' }} onClick={() => setModal({ periodo })}>+ Agregar</button>
      </div>

      <div className="pl-tabs">
        <button className={`pl-tab ${tab === 'trabajadores' ? 'active' : ''}`} onClick={() => setTab('trabajadores')}>👷 Trabajadores (5ta)</button>
        <button className={`pl-tab ${tab === 'cuarta' ? 'active' : ''}`} onClick={() => setTab('cuarta')}>📄 Renta de 4ta (RHE)</button>
      </div>

      <div className="pl-toolbar">
        <div className="pl-filters">
          <input className="form-input" type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ width: 160 }} />
          <select className="form-input" value={filtroEmp} onChange={(e) => setFiltroEmp(Number(e.target.value))} style={{ width: 200 }}>
            <option value={0}>Todas las empresas</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
          </select>
        </div>
        <div className="pl-actions">
          {tab === 'trabajadores' && <button className="btn-secondary" onClick={desdeColaboradores}>👥 Importar colaboradores</button>}
          <label className="btn-secondary pl-imp"><input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={importar} />📥 Importar Excel</label>
          <button className="btn-secondary" onClick={exportar}>📤 Exportar Excel</button>
        </div>
      </div>
      {msg && <div className="pl-msg">{msg}</div>}

      <div className="pl-totales">
        <div><span>{tab === 'cuarta' ? 'Total bruto' : 'Total ingresos'}</span><strong>{S(totalIngresos)}</strong></div>
        <div><span>{tab === 'cuarta' ? 'Total retención' : 'Aportes/desc.'}</span><strong>{S(totalRet)}</strong></div>
        <div><span>Total neto</span><strong style={{ color: 'var(--green-dark)' }}>{S(totalNeto)}</strong></div>
        <div><span>Registros</span><strong>{filas.length}</strong></div>
      </div>

      {loading ? <div className="empresas-empty">Cargando…</div>
        : filas.length === 0 ? (
          <div className="empresas-empty">
            <div style={{ fontSize: 38, marginBottom: 8 }}>🧾</div>
            <h3>Sin registros en {MESES[Number(m) - 1]} {y}</h3>
            <p>Agrega manualmente o importa desde un Excel.</p>
          </div>
        ) : tab === 'trabajadores' ? (
          <div className="empresas-table pl-scroll">
            <div className="pl-trab-row pl-head"><div>Trabajador</div><div>Pensión</div><div>Ingresos</div><div>Aporte</div><div>Renta 5ta</div><div>Neto</div><div></div></div>
            {filas.map((t) => (
              <div className="pl-trab-row" key={t.id}>
                <div className="colab-cell-name" onClick={() => setModal(t)}><div className="empresa-avatar">{(t.nombre || '?')[0]}</div><div><div className="empresa-name">{t.nombre}</div><div className="empresa-ruc">{t.num_doc}</div></div></div>
                <div className="empresa-cell-muted">{t.regimen_pensionario}{t.afp_nombre ? ` · ${t.afp_nombre}` : ''}</div>
                <div className="empresa-cell-muted">{S(t.total_ingresos)}</div>
                <div className="empresa-cell-muted">{S(t.aporte_pension)}</div>
                <div className="empresa-cell-muted">{S(t.renta_quinta)}</div>
                <div style={{ fontWeight: 700, color: 'var(--green-dark)' }}>{S(t.neto_pagar)}</div>
                <div className="empresa-actions"><button className="btn-icon" onClick={() => setModal(t)}>✏️</button><button className="btn-icon" onClick={() => setConfirmar(t)}>🗑️</button></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empresas-table pl-scroll">
            <div className="pl-cuarta-row pl-head"><div>Prestador</div><div>Recibo</div><div>Fecha</div><div>Bruto</div><div>Retención</div><div>Neto</div><div></div></div>
            {filas.map((c) => (
              <div className="pl-cuarta-row" key={c.id}>
                <div className="colab-cell-name" onClick={() => setModal(c)}><div className="empresa-avatar">{(c.nombre || '?')[0]}</div><div><div className="empresa-name">{c.nombre}</div><div className="empresa-ruc">{c.tipo_doc} {c.num_doc}</div></div></div>
                <div className="empresa-cell-muted">{c.num_recibo || '—'}</div>
                <div className="empresa-cell-muted">{c.fecha_emision || '—'}</div>
                <div className="empresa-cell-muted">{S(c.monto_bruto)}</div>
                <div className="empresa-cell-muted">{S(c.retencion)}</div>
                <div style={{ fontWeight: 700, color: 'var(--green-dark)' }}>{S(c.neto_pagar)}</div>
                <div className="empresa-actions"><button className="btn-icon" onClick={() => setModal(c)}>✏️</button><button className="btn-icon" onClick={() => setConfirmar(c)}>🗑️</button></div>
              </div>
            ))}
          </div>
        )}

      {modal && tab === 'trabajadores' && <TrabModal inicial={{ ...modal, periodo }} onClose={() => setModal(null)}
        onSaved={(r, edit) => { setFilas((p) => edit ? p.map((x) => x.id === r.id ? r : x) : [...p, r]); setModal(null) }} />}
      {modal && tab === 'cuarta' && <CuartaModal inicial={{ ...modal, periodo }} onClose={() => setModal(null)}
        onSaved={(r, edit) => { setFilas((p) => edit ? p.map((x) => x.id === r.id ? r : x) : [...p, r]); setModal(null) }} />}
      {confirmar && <ConfirmModal icon="🗑️" title="Eliminar registro" message="¿Eliminar este registro de planilla? Esta acción no se puede deshacer."
        detail={confirmar.nombre} loading={borrando} onCancel={() => setConfirmar(null)} onConfirm={confirmarEliminar} />}
    </div>
  )
}
