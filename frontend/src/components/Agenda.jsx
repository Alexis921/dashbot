import { useState, useEffect, useCallback } from 'react'
import {
  apiListObligaciones, apiListEmpresas, apiGenerarObligaciones,
  apiUpdateObligacion, apiCreateObligacion, apiDeleteObligacion,
} from '../api'

const TIPO_ICON = { declaracion_mensual: '📄', sire: '📚', detraccion: '💧', otro: '📌' }
const PRIO = {
  alta: { c: '#dc2626', bg: '#fee2e2', t: 'Alta' },
  media: { c: '#b45309', bg: '#fef3c7', t: 'Media' },
  baja: { c: '#0369a1', bg: '#e0f2fe', t: 'Baja' },
}
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const fmtFecha = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : '—'

function Card({ o, onDragStart, onClick }) {
  const p = PRIO[o.prioridad] || PRIO.media
  const venc = o.dias_restantes != null && o.dias_restantes < 0 && !['pagado', 'declarado', 'archivado'].includes(o.estado)
  return (
    <div className="ag-card" draggable onDragStart={(e) => onDragStart(e, o)} onClick={() => onClick(o)}>
      <div className="ag-card-top">
        <span>{TIPO_ICON[o.tipo] || '📌'} {o.periodo}</span>
        <span className="ag-prio" style={{ background: p.bg, color: p.c }}>{p.t}</span>
      </div>
      <div className="ag-card-title">{o.titulo}</div>
      <div className="ag-card-meta">
        {o.empresa && <span className="ag-emp">{o.empresa}</span>}
        <span className={`ag-fecha ${venc ? 'venc' : ''}`}>📅 {fmtFecha(o.fecha_vencimiento)}{venc ? ' (vencida)' : o.dias_restantes >= 0 ? ` · ${o.dias_restantes}d` : ''}</span>
      </div>
    </div>
  )
}

function NuevaModal({ empresas, onClose, onCreated }) {
  const [f, setF] = useState({
    titulo: '', tipo: 'otro', empresa_id: empresas[0]?.id || '', fecha_vencimiento: '',
    prioridad: 'media', responsable: '', descripcion: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function save() {
    if (!f.titulo.trim() || !f.fecha_vencimiento) return alert('Título y fecha son obligatorios.')
    setSaving(true)
    try {
      const d = await apiCreateObligacion({ ...f, empresa_id: f.empresa_id ? Number(f.empresa_id) : null })
      onCreated(d.obligacion)
    } catch (e) { alert(`⚠️ ${e.message}`) } finally { setSaving(false) }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3>📌 Nueva obligación</h3>
        <div className="form-group"><label className="form-label">Título *</label>
          <input className="form-input" value={f.titulo} onChange={set('titulo')} placeholder="Ej: Pago de detracción" /></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="form-group" style={{ flex: 1 }}><label className="form-label">Tipo</label>
            <select className="form-input" value={f.tipo} onChange={set('tipo')}>
              <option value="otro">Otro</option><option value="declaracion_mensual">Declaración mensual</option>
              <option value="sire">SIRE</option><option value="detraccion">Detracción</option>
            </select></div>
          <div className="form-group" style={{ flex: 1 }}><label className="form-label">Prioridad</label>
            <select className="form-input" value={f.prioridad} onChange={set('prioridad')}>
              <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
            </select></div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="form-group" style={{ flex: 1 }}><label className="form-label">Empresa</label>
            <select className="form-input" value={f.empresa_id} onChange={set('empresa_id')}>
              <option value="">— Sin empresa —</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
            </select></div>
          <div className="form-group" style={{ flex: 1 }}><label className="form-label">Vencimiento *</label>
            <input className="form-input" type="date" value={f.fecha_vencimiento} onChange={set('fecha_vencimiento')} /></div>
        </div>
        <div className="form-group"><label className="form-label">Responsable</label>
          <input className="form-input" value={f.responsable} onChange={set('responsable')} placeholder="Opcional" /></div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-accent" onClick={save} disabled={saving}>{saving ? '⏳...' : '💾 Crear'}</button>
        </div>
      </div>
    </div>
  )
}

function DetalleModal({ o, estados, onClose, onUpdate, onDelete }) {
  const p = PRIO[o.prioridad] || PRIO.media
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>{TIPO_ICON[o.tipo] || '📌'} {o.titulo}</h3>
        <div className="det-meta">
          <span className="ag-prio" style={{ background: p.bg, color: p.c }}>{p.t}</span>
          {o.empresa && <span className="det-pill">{o.empresa}</span>}
          {o.periodo && <span className="det-pill">{o.periodo}</span>}
          <span className="det-pill">📅 {fmtFecha(o.fecha_vencimiento)}</span>
        </div>
        {o.descripcion && <p className="det-desc">{o.descripcion}</p>}
        <div className="form-group"><label className="form-label">Estado</label>
          <select className="form-input" value={o.estado} onChange={(e) => onUpdate(o.id, { estado: e.target.value })}>
            {estados.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Prioridad</label>
          <select className="form-input" value={o.prioridad} onChange={(e) => onUpdate(o.id, { prioridad: e.target.value })}>
            <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
          </select></div>
        <div className="modal-actions">
          <button className="btn-secondary" style={{ color: '#dc2626' }} onClick={() => onDelete(o.id)}>🗑️ Eliminar</button>
          <button className="btn-accent" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function Calendario({ obligaciones, onClick }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const first = new Date(cursor.y, cursor.m, 1)
  const startDow = (first.getDay() + 6) % 7 // lunes=0
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const byDate = {}
  obligaciones.forEach((o) => { if (o.fecha_vencimiento) (byDate[o.fecha_vencimiento] ||= []).push(o) })
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  const ymd = (d) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const hoy = new Date().toISOString().slice(0, 10)
  const nav = (delta) => setCursor((c) => { const nm = c.m + delta; return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 } })
  return (
    <div className="cal">
      <div className="cal-head">
        <button className="cal-nav" onClick={() => nav(-1)}>‹</button>
        <span className="cal-title">{MESES[cursor.m]} {cursor.y}</span>
        <button className="cal-nav" onClick={() => nav(1)}>›</button>
      </div>
      <div className="cal-grid cal-dows">{DIAS.map((d) => <div key={d} className="cal-dow">{d}</div>)}</div>
      <div className="cal-grid">
        {cells.map((d, i) => (
          <div key={i} className={`cal-cell ${d && ymd(d) === hoy ? 'today' : ''} ${!d ? 'empty' : ''}`}>
            {d && <><div className="cal-num">{d}</div>
              {(byDate[ymd(d)] || []).slice(0, 3).map((o) => {
                const p = PRIO[o.prioridad] || PRIO.media
                return <div key={o.id} className="cal-ev" style={{ background: p.bg, color: p.c }} onClick={() => onClick(o)} title={o.titulo}>{TIPO_ICON[o.tipo]} {o.titulo}</div>
              })}
              {(byDate[ymd(d)] || []).length > 3 && <div className="cal-more">+{byDate[ymd(d)].length - 3}</div>}
            </>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Agenda() {
  const [vista, setVista] = useState('kanban')
  const [obligaciones, setObligaciones] = useState([])
  const [estados, setEstados] = useState([])
  const [empresas, setEmpresas] = useState([])
  const [filtroEmp, setFiltroEmp] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState(null)
  const [showNueva, setShowNueva] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [generando, setGenerando] = useState(false)

  const load = useCallback(async () => {
    const d = await apiListObligaciones(filtroEmp)
    setObligaciones(d.obligaciones || [])
    setEstados(d.estados || [])
  }, [filtroEmp])

  useEffect(() => {
    apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {})
  }, [])
  useEffect(() => { setLoading(true); load().catch(() => {}).finally(() => setLoading(false)) }, [load])

  async function moverEstado(id, estado) {
    setObligaciones((prev) => prev.map((o) => o.id === id ? { ...o, estado } : o))
    try { await apiUpdateObligacion(id, { estado }) } catch { load() }
  }
  async function actualizar(id, data) {
    const d = await apiUpdateObligacion(id, data)
    setObligaciones((prev) => prev.map((o) => o.id === id ? d.obligacion : o))
    setDetalle((dd) => dd && dd.id === id ? d.obligacion : dd)
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar esta obligación?')) return
    await apiDeleteObligacion(id)
    setObligaciones((prev) => prev.filter((o) => o.id !== id))
    setDetalle(null)
  }
  async function generar() {
    const empId = filtroEmp || empresas[0]?.id
    if (!empId) return alert('Primero registra una empresa.')
    setGenerando(true)
    try {
      const d = await apiGenerarObligaciones(empId)
      if (d.success) { await load(); alert(`✓ ${d.creadas} obligación(es) generada(s) desde el cronograma.`) }
      else alert(`⚠️ ${d.error}`)
    } catch (e) { alert(`⚠️ ${e.message}`) } finally { setGenerando(false) }
  }

  const onDragStart = (e, o) => { setDragId(o.id); e.dataTransfer.effectAllowed = 'move' }
  const onDrop = (estado) => { if (dragId != null) moverEstado(dragId, estado); setDragId(null) }

  return (
    <div className="ag-page">
      <div className="ag-header">
        <div>
          <h1 className="prog-title">📆 Agenda Tributaria</h1>
          <p className="prog-sub">Tu centro operativo. Las obligaciones se generan solas desde el cronograma SUNAT.</p>
        </div>
        <div className="ag-actions">
          <button className="btn-secondary" onClick={generar} disabled={generando}>
            {generando ? '⏳...' : '✨ Generar del cronograma'}
          </button>
          <button className="btn-accent" style={{ flex: 'none' }} onClick={() => setShowNueva(true)}>+ Nueva</button>
        </div>
      </div>

      <div className="ag-toolbar">
        <div className="ag-tabs">
          {[['kanban', '▦ Kanban'], ['calendario', '📅 Calendario'], ['agenda', '☰ Agenda']].map(([k, l]) => (
            <button key={k} className={`ag-tab ${vista === k ? 'active' : ''}`} onClick={() => setVista(k)}>{l}</button>
          ))}
        </div>
        <select className="form-input ag-filter" value={filtroEmp} onChange={(e) => setFiltroEmp(Number(e.target.value))}>
          <option value={0}>Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
        </select>
      </div>

      {loading ? <div className="ag-empty">Cargando...</div>
        : obligaciones.length === 0 ? (
          <div className="ag-empty">
            <div style={{ fontSize: 40, marginBottom: 10 }}>📆</div>
            <h3>Aún no hay obligaciones</h3>
            <p>Genera automáticamente las declaraciones y SIRE desde el cronograma oficial, o crea una manual.</p>
            <button className="btn-accent" style={{ flex: 'none', marginTop: 14 }} onClick={generar} disabled={generando}>
              {generando ? '⏳...' : '✨ Generar del cronograma'}
            </button>
          </div>
        ) : vista === 'kanban' ? (
          <div className="kanban">
            {estados.map((s) => {
              const items = obligaciones.filter((o) => o.estado === s.key)
              return (
                <div key={s.key} className="kb-col" onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(s.key)}>
                  <div className="kb-col-head">{s.label} <span className="kb-count">{items.length}</span></div>
                  <div className="kb-list">
                    {items.map((o) => <Card key={o.id} o={o} onDragStart={onDragStart} onClick={setDetalle} />)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : vista === 'calendario' ? (
          <Calendario obligaciones={obligaciones} onClick={setDetalle} />
        ) : (
          <div className="ag-list">
            {[...obligaciones].sort((a, b) => (a.fecha_vencimiento || '').localeCompare(b.fecha_vencimiento || '')).map((o) => {
              const p = PRIO[o.prioridad] || PRIO.media
              const venc = o.dias_restantes != null && o.dias_restantes < 0 && !['pagado', 'declarado', 'archivado'].includes(o.estado)
              return (
                <div key={o.id} className="ag-list-row" onClick={() => setDetalle(o)}>
                  <span className="ag-list-icon">{TIPO_ICON[o.tipo] || '📌'}</span>
                  <div style={{ flex: 1 }}>
                    <div className="ag-list-title">{o.titulo}</div>
                    <div className="ag-list-sub">{o.empresa} {o.empresa && o.periodo ? '·' : ''} {o.periodo}</div>
                  </div>
                  <span className="ag-prio" style={{ background: p.bg, color: p.c }}>{p.t}</span>
                  <span className={`ag-list-date ${venc ? 'venc' : ''}`}>{fmtFecha(o.fecha_vencimiento)}</span>
                  <span className="ag-list-estado">{estados.find((s) => s.key === o.estado)?.label}</span>
                </div>
              )
            })}
          </div>
        )}

      {showNueva && <NuevaModal empresas={empresas} onClose={() => setShowNueva(false)}
        onCreated={(o) => { setObligaciones((p) => [...p, o]); setShowNueva(false) }} />}
      {detalle && <DetalleModal o={detalle} estados={estados} onClose={() => setDetalle(null)}
        onUpdate={actualizar} onDelete={eliminar} />}
    </div>
  )
}
