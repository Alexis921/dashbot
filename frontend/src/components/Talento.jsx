import { useState, useEffect } from 'react'
import ConfirmModal from './ConfirmModal'
import {
  apiListTalento, apiCreateTalento, apiUpdateTalento, apiDeleteTalento,
  apiListColaboradores, apiListEmpresas, apiUpdateColaborador,
  apiGetConfiguracion, apiSaveConfiguracion,
} from '../api'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre']
const TIPOS = [
  { v: 'permiso', l: '📋 Permiso' }, { v: 'memorandum', l: '📝 Memorándum' },
  { v: 'hora_extra', l: '⏱️ Hora extra' }, { v: 'bono', l: '💰 Bono' },
  { v: 'tardanza', l: '⏰ Tardanza' }, { v: 'falta', l: '🚫 Falta' },
  { v: 'vacaciones', l: '🏖️ Vacaciones' }, { v: 'licencia', l: '🩺 Licencia' },
  { v: 'felicitacion', l: '🌟 Felicitación' }, { v: 'otro', l: '📎 Otro' },
]
const TIPO_L = Object.fromEntries(TIPOS.map((t) => [t.v, t.l]))
const HABILIDADES = ['Comunicación', 'Trabajo en equipo', 'Responsabilidad', 'Proactividad', 'Puntualidad']
const S = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })

function EventoModal({ inicial, colaboradores, periodo, onClose, onSaved }) {
  const [f, setF] = useState({ tipo: 'permiso', fecha: '', descripcion: '', monto: '', horas: '', estado: 'registrado', colaborador_id: '', colaborador_nombre: '', ...inicial })
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  function pickColab(e) {
    const c = colaboradores.find((x) => String(x.id) === e.target.value)
    setF((x) => ({ ...x, colaborador_id: e.target.value, colaborador_nombre: c ? c.nombre_completo : '', empresa_id: c ? c.empresa_id : x.empresa_id }))
  }
  async function guardar(e) {
    e.preventDefault(); setErr('')
    if (!f.colaborador_nombre && !f.colaborador_id) return setErr('Elige un colaborador.')
    setSaving(true)
    try {
      const payload = { ...f, periodo, colaborador_id: f.colaborador_id ? Number(f.colaborador_id) : null,
        empresa_id: f.empresa_id ? Number(f.empresa_id) : null, monto: Number(f.monto) || 0, horas: Number(f.horas) || 0 }
      const d = inicial?.id ? await apiUpdateTalento(inicial.id, payload) : await apiCreateTalento(payload)
      onSaved(d.evento, !!inicial?.id)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal colab-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>{inicial?.id ? 'Editar' : 'Nueva'} novedad</h3>
        {err && <div className="error-msg" style={{ marginBottom: 12 }}>⚠️ {err}</div>}
        <form onSubmit={guardar}>
          <div className="form-group"><label className="form-label">Colaborador *</label>
            <select className="form-input" value={f.colaborador_id} onChange={pickColab}>
              <option value="">— Selecciona —</option>
              {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nombre_completo}</option>)}
            </select></div>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Tipo</label>
              <select className="form-input" value={f.tipo} onChange={set('tipo')}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Fecha</label>
              <input className="form-input" type="date" value={f.fecha} onChange={set('fecha')} /></div>
          </div>
          <div className="form-group"><label className="form-label">Descripción / detalle</label>
            <textarea className="form-input" value={f.descripcion} onChange={set('descripcion')} rows={2} /></div>
          <div className="colab-row">
            {f.tipo === 'hora_extra' && <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Horas</label><input className="form-input" type="number" step="0.5" value={f.horas} onChange={set('horas')} /></div>}
            {(f.tipo === 'bono' || f.tipo === 'hora_extra') && <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Monto (S/)</label><input className="form-input" type="number" step="0.01" value={f.monto} onChange={set('monto')} /></div>}
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Estado</label>
              <select className="form-input" value={f.estado} onChange={set('estado')}><option value="registrado">Registrado</option><option value="aprobado">Aprobado</option><option value="rechazado">Rechazado</option></select></div>
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-accent" disabled={saving}>{saving ? '⏳...' : '💾 Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EvalModal({ colab, onClose, onSaved }) {
  const [hab, setHab] = useState(() => colab.habilidades || {})
  const [rend, setRend] = useState(colab.rendimiento || 0)
  const [notas, setNotas] = useState(colab.notas_desempeno || '')
  const [saving, setSaving] = useState(false)
  async function guardar() {
    setSaving(true)
    try {
      const payload = { ...colab, empresa_id: colab.empresa_id, habilidades: JSON.stringify(hab), rendimiento: Number(rend), notas_desempeno: notas }
      const d = await apiUpdateColaborador(colab.id, payload)
      onSaved(d.colaborador)
    } catch (e) { alert(`⚠️ ${e.message}`) } finally { setSaving(false) }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal colab-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>🌟 Desempeño · {colab.nombre_completo}</h3>
        <div className="colab-sec">Habilidades blandas (1 a 5)</div>
        {HABILIDADES.map((h) => {
          const key = h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ /g, '_')
          const val = hab[key] || 0
          return (
            <div key={key} className="eval-row">
              <span>{h}</span>
              <div className="eval-stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className={`eval-star ${n <= val ? 'on' : ''}`} onClick={() => setHab((x) => ({ ...x, [key]: n }))}>★</button>
                ))}
              </div>
            </div>
          )
        })}
        <div className="colab-sec">Rendimiento laboral</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input type="range" min="0" max="100" value={rend} onChange={(e) => setRend(e.target.value)} style={{ flex: 1 }} />
          <strong style={{ color: 'var(--navy)', minWidth: 44 }}>{rend}%</strong>
        </div>
        <div className="form-group" style={{ marginTop: 14 }}><label className="form-label">Notas de desempeño</label>
          <textarea className="form-input" value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} placeholder="Fortalezas, áreas de mejora, objetivos…" /></div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-accent" onClick={guardar} disabled={saving}>{saving ? '⏳...' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

function PagosTab() {
  const [cfg, setCfg] = useState(null)
  const [saved, setSaved] = useState(false); const [saving, setSaving] = useState(false)
  useEffect(() => { apiGetConfiguracion().then((d) => setCfg(d.configuracion)).catch(() => {}) }, [])
  if (!cfg) return <div className="empresas-empty">Cargando…</div>
  const set = (k, v) => { setCfg((c) => ({ ...c, [k]: v })); setSaved(false) }
  async function guardar() { setSaving(true); try { await apiSaveConfiguracion(cfg); setSaved(true) } catch (e) { alert(`⚠️ ${e.message}`) } finally { setSaving(false) } }
  return (
    <div className="prog-card" style={{ maxWidth: 560 }}>
      <div className="prog-card-head"><div className="prog-card-icon" style={{ background: '#dcfce7' }}>💸</div>
        <div><div className="prog-card-title">Fechas de pago de planilla</div><div className="prog-card-desc">Define cuándo pagas y activa el recordatorio automático.</div></div></div>
      <div className="prog-grid">
        <div className="form-group"><label className="form-label">Pago de quincena (día)</label>
          <input className="form-input" type="number" min="1" max="31" value={cfg.pago_quincena_dia} onChange={(e) => set('pago_quincena_dia', Number(e.target.value))} /></div>
        <div className="form-group"><label className="form-label">Pago de fin de mes (día)</label>
          <input className="form-input" type="number" min="1" max="31" value={cfg.pago_finmes_dia} onChange={(e) => set('pago_finmes_dia', Number(e.target.value))} /></div>
      </div>
      <div className={`prog-toggle-row ${cfg.pago_recordatorio ? 'active' : ''}`} style={{ marginTop: 6 }}>
        <div><div className="prog-toggle-title">Recordatorio automático de pago</div><div className="prog-toggle-desc">Te avisamos un día antes de cada fecha de pago (usa los canales de Configuración).</div></div>
        <button type="button" className={`toggle ${cfg.pago_recordatorio ? 'on' : ''}`} onClick={() => set('pago_recordatorio', !cfg.pago_recordatorio)}><span className="toggle-knob" /></button>
      </div>
      {saved && <div className="prog-saved">✓ Guardado.</div>}
      <button className="btn-accent" style={{ width: '100%', marginTop: 14, padding: 11 }} onClick={guardar} disabled={saving}>{saving ? '⏳ Guardando…' : '💾 Guardar fechas de pago'}</button>
    </div>
  )
}

export default function Talento({ onBack }) {
  const hoy = new Date()
  const [tab, setTab] = useState('novedades')
  const [empresas, setEmpresas] = useState([])
  const [colabs, setColabs] = useState([])
  const [filtroEmp, setFiltroEmp] = useState(0)
  const [periodo, setPeriodo] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`)
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [evalColab, setEvalColab] = useState(null)
  const [confirmar, setConfirmar] = useState(null)
  const [borrando, setBorrando] = useState(false)

  useEffect(() => { apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {}) }, [])
  useEffect(() => { apiListColaboradores(filtroEmp).then((d) => setColabs(d.colaboradores || [])).catch(() => {}) }, [filtroEmp, tab])
  async function loadEventos() {
    setLoading(true)
    try { const d = await apiListTalento(filtroEmp, periodo); setEventos(d.eventos || []) } catch (_) {} finally { setLoading(false) }
  }
  useEffect(() => { if (tab === 'novedades') loadEventos() }, [tab, filtroEmp, periodo])

  async function confirmarEliminar() {
    setBorrando(true)
    try { await apiDeleteTalento(confirmar.id); setEventos((p) => p.filter((x) => x.id !== confirmar.id)); setConfirmar(null) }
    catch (e) { alert(`⚠️ ${e.message}`) } finally { setBorrando(false) }
  }
  const [y, m] = periodo.split('-')

  return (
    <div className="prog-page">
      <div className="empresas-header">
        <div>
          <button className="eq-back" onClick={onBack}>← Equipo</button>
          <h1 className="empresas-title">🌟 Gestión del Talento</h1>
          <p className="empresas-sub">Novedades, desempeño y fechas de pago de tu personal.</p>
        </div>
        {tab === 'novedades' && <button className="btn-accent" style={{ flex: 'none' }} onClick={() => setModal({})}>+ Nueva novedad</button>}
      </div>

      <div className="pl-tabs">
        <button className={`pl-tab ${tab === 'novedades' ? 'active' : ''}`} onClick={() => setTab('novedades')}>📋 Novedades</button>
        <button className={`pl-tab ${tab === 'desempeno' ? 'active' : ''}`} onClick={() => setTab('desempeno')}>🌟 Desempeño</button>
        <button className={`pl-tab ${tab === 'pagos' ? 'active' : ''}`} onClick={() => setTab('pagos')}>💸 Fechas de pago</button>
      </div>

      {tab !== 'pagos' && (
        <div className="pl-filters" style={{ marginBottom: 12 }}>
          {tab === 'novedades' && <input className="form-input" type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ width: 160 }} />}
          <select className="form-input" value={filtroEmp} onChange={(e) => setFiltroEmp(Number(e.target.value))} style={{ width: 200 }}>
            <option value={0}>Todas las empresas</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
          </select>
        </div>
      )}

      {tab === 'novedades' && (loading ? <div className="empresas-empty">Cargando…</div>
        : eventos.length === 0 ? <div className="empresas-empty"><div style={{ fontSize: 38 }}>📋</div><h3>Sin novedades en {MESES[Number(m) - 1]} {y}</h3><p>Registra permisos, memos, horas extras, bonos y más.</p></div>
        : <div className="empresas-table">
            {eventos.map((e) => (
              <div className="tal-row" key={e.id}>
                <div className="tal-tipo">{TIPO_L[e.tipo] || e.tipo}</div>
                <div><div className="empresa-name">{e.colaborador_nombre}</div><div className="empresa-ruc">{e.descripcion || '—'}</div></div>
                <div className="empresa-cell-muted">{e.fecha || '—'}</div>
                <div className="empresa-cell-muted">{e.horas ? `${e.horas} h` : ''}{e.monto ? ` · ${S(e.monto)}` : ''}</div>
                <div><span className={`colab-sit ${e.estado === 'aprobado' ? 'activo' : e.estado === 'rechazado' ? 'cesado' : ''}`}>{e.estado}</span></div>
                <div className="empresa-actions"><button className="btn-icon" onClick={() => setModal(e)}>✏️</button><button className="btn-icon" onClick={() => setConfirmar(e)}>🗑️</button></div>
              </div>
            ))}
          </div>)}

      {tab === 'desempeno' && (colabs.length === 0
        ? <div className="empresas-empty"><div style={{ fontSize: 38 }}>🌟</div><h3>Sin colaboradores</h3><p>Registra colaboradores para evaluar su desempeño.</p></div>
        : <div className="empresas-table">
            {colabs.map((c) => (
              <div className="tal-eval-row" key={c.id} onClick={() => setEvalColab(c)}>
                <div className="colab-cell-name"><div className="empresa-avatar">{(c.nombres || '?')[0]}</div><div><div className="empresa-name">{c.nombre_completo}</div><div className="empresa-ruc">{c.ocupacion || c.tipo_trabajador}</div></div></div>
                <div className="tal-rend"><div className="tal-rend-bar"><div className="tal-rend-fill" style={{ width: `${c.rendimiento || 0}%` }} /></div><span>{c.rendimiento || 0}%</span></div>
                <div className="empresa-actions"><button className="btn-icon">✏️</button></div>
              </div>
            ))}
          </div>)}

      {tab === 'pagos' && <PagosTab />}

      {modal && <EventoModal inicial={modal} colaboradores={colabs} periodo={periodo} onClose={() => setModal(null)}
        onSaved={(ev, edit) => { setEventos((p) => edit ? p.map((x) => x.id === ev.id ? ev : x) : [ev, ...p]); setModal(null) }} />}
      {evalColab && <EvalModal colab={evalColab} onClose={() => setEvalColab(null)}
        onSaved={(c) => { setColabs((p) => p.map((x) => x.id === c.id ? c : x)); setEvalColab(null) }} />}
      {confirmar && <ConfirmModal title="Eliminar novedad" message="¿Eliminar este registro? No se puede deshacer."
        detail={confirmar.colaborador_nombre} loading={borrando} onCancel={() => setConfirmar(null)} onConfirm={confirmarEliminar} />}
    </div>
  )
}
