import { useState, useEffect, useCallback, useRef } from 'react'
import EscanearDoc from './EscanearDoc'
import ObligacionPage from './ObligacionPage'
import ConfirmModal from './ConfirmModal'
import {
  apiListObligaciones, apiListEmpresas, apiGenerarObligaciones,
  apiUpdateObligacion, apiCreateObligacion, apiDeleteObligacion,
  apiListHorario, apiSaveHorario, apiHorarioComentario, apiHorarioArchivo, apiHorarioArchivoDownload,
  apiBuscarHorario, apiGenerarTodas,
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

const HORAS = Array.from({ length: 18 }, (_, i) => 6 + i) // 6:00 .. 23:00
const horaLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'am' : 'pm'}`
const addDias = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const fmtDiaLargo = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { weekday: 'long', day: '2-digit', month: 'long' })
const CATS = [
  { key: 'declaraciones', label: 'Declaraciones', color: '#2563eb' },
  { key: 'reuniones', label: 'Reuniones', color: '#0a9d63' },
  { key: 'tramites', label: 'Trámites', color: '#d97706' },
  { key: 'clientes', label: 'Clientes', color: '#7c3aed' },
  { key: 'personal', label: 'Personal', color: '#db2777' },
  { key: 'otro', label: 'Otro', color: '#64748b' },
]
const fmtCom = (iso) => { try { return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
const fmtSize = (b) => !b ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`

function BloqueModal({ fecha, hora, bloque, onClose, onSaved }) {
  const [actividad, setActividad] = useState(bloque?.actividad || '')
  const [categoria, setCategoria] = useState(bloque?.categoria || '')
  const [recordatorio, setRecordatorio] = useState(bloque?.recordatorio || '')
  const [comentarios, setComentarios] = useState(bloque?.comentarios || [])
  const [archivos, setArchivos] = useState(bloque?.archivos || [])
  const [nuevoCom, setNuevoCom] = useState('')
  const [saving, setSaving] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [bajando, setBajando] = useState('')
  const fileRef = useRef(null)

  async function guardar() {
    setSaving(true)
    try {
      const cat = CATS.find((c) => c.key === categoria)
      const d = await apiSaveHorario({ fecha, hora, actividad: actividad.trim(), categoria, color: cat?.color || '', recordatorio })
      onSaved(d.bloque || {}); onClose()
    } catch (e) { alert(`⚠️ ${e.message}`) } finally { setSaving(false) }
  }
  async function addComentario() {
    if (!nuevoCom.trim()) return
    try { const d = await apiHorarioComentario(fecha, hora, nuevoCom.trim()); setComentarios(d.bloque.comentarios || []); setNuevoCom(''); onSaved(d.bloque) }
    catch (e) { alert(`⚠️ ${e.message}`) }
  }
  async function subir(e) {
    const file = e.target.files?.[0]; if (!file) return
    setSubiendo(true)
    try { const d = await apiHorarioArchivo(fecha, hora, file); setArchivos(d.bloque.archivos || []); onSaved(d.bloque) }
    catch (e) { alert(`⚠️ ${e.message}`) } finally { setSubiendo(false) }
  }
  async function bajar(a) {
    setBajando(a.fid)
    try { await apiHorarioArchivoDownload(a.fid, a.nombre) } catch (e) { alert(`⚠️ ${e.message}`) } finally { setBajando('') }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal colab-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <h3>🕒 {horaLabel(hora)} · Detalle</h3>
        <div className="form-group"><label className="form-label">Actividad</label>
          <input className="form-input" value={actividad} onChange={(e) => setActividad(e.target.value)} placeholder="¿Qué harás en esta hora?" /></div>

        <div className="colab-sec">Categoría (color)</div>
        <div className="hor-cats">
          {CATS.map((c) => (
            <button key={c.key} type="button" className="hor-cat"
              style={categoria === c.key ? { borderColor: c.color, background: c.color + '18', color: c.color } : undefined}
              onClick={() => setCategoria(categoria === c.key ? '' : c.key)}>
              <span className="dot" style={{ background: c.color }} />{c.label}
            </button>
          ))}
        </div>

        <div className="form-group" style={{ marginTop: 14 }}><label className="form-label">🔔 Recordatorio (hora)</label>
          <input className="form-input" type="time" value={recordatorio} onChange={(e) => setRecordatorio(e.target.value)} style={{ width: 150 }} /></div>

        <div className="colab-sec">💬 Comentarios</div>
        {comentarios.length > 0 && (
          <div className="hor-com-list">
            {comentarios.map((c, i) => <div key={i} className="hor-com">{c.texto}<div className="hor-com-f">{fmtCom(c.fecha)}</div></div>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" value={nuevoCom} onChange={(e) => setNuevoCom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addComentario()} placeholder="Agregar un comentario…" style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={addComentario} style={{ flex: 'none' }}>Añadir</button>
        </div>

        <div className="colab-sec">📎 Archivos y fotos</div>
        {archivos.length > 0 && (
          <div className="hor-com-list">
            {archivos.map((a) => (
              <div key={a.fid} className="hor-file">
                <span>📄 {a.nombre} <span style={{ color: 'var(--gray-500)' }}>{fmtSize(a.tamano)}</span></span>
                <button className="btn-icon" disabled={bajando === a.fid} onClick={() => bajar(a)}>{bajando === a.fid ? '⏳' : '⬇️'}</button>
              </div>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={subir} />
        <button className="btn-secondary" style={{ width: '100%' }} onClick={() => fileRef.current?.click()} disabled={subiendo}>
          {subiendo ? '⏳ Subiendo…' : '📂 Subir archivo o foto'}
        </button>

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" onClick={onClose}>Cerrar</button>
          <button className="btn-accent" onClick={guardar} disabled={saving}>{saving ? '⏳...' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

const fmtCorta = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' })

function HorarioBot({ onJump }) {
  const [q, setQ] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [res, setRes] = useState(null) // null = sin búsqueda aún
  const [ultimaQ, setUltimaQ] = useState('')

  async function buscar(texto) {
    const query = (texto ?? q).trim()
    if (query.length < 2 || buscando) return
    setBuscando(true)
    try {
      const d = await apiBuscarHorario(query)
      setRes(d.resultados || []); setUltimaQ(query)
    } catch (_) { setRes([]) } finally { setBuscando(false) }
  }

  return (
    <div className="hbot">
      <div className="hbot-head">
        <div className="hbot-avatar"><img src="/robot.png" alt="DashBot" className="hbot-img" /><span className="hbot-ring" /></div>
        <div>
          <div className="hbot-title">Asistente de agenda</div>
          <div className="hbot-sub"><span className="cm-online" />Busca en todos tus apuntes</div>
        </div>
      </div>

      <div className="hbot-in">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && buscar()}
          placeholder="Ej. facturas, declaración, reunión…" disabled={buscando} />
        <button onClick={() => buscar()} disabled={buscando || q.trim().length < 2}>{buscando ? '⏳' : '🔍'}</button>
      </div>

      <div className="hbot-body">
        {res === null ? (
          <div className="hbot-empty">
            <p>Escribe una palabra y buscaré entre todo lo que anotaste en tu horario — actividades y comentarios de cualquier día.</p>
            <div className="hbot-tips">
              {['facturas', 'declaración', 'reunión'].map((t) => (
                <button key={t} className="hbot-tip" onClick={() => { setQ(t); buscar(t) }}>{t}</button>
              ))}
            </div>
          </div>
        ) : res.length === 0 ? (
          <div className="hbot-msg">🤖 No encontré apuntes con «{ultimaQ}». Prueba con otra palabra.</div>
        ) : (
          <>
            <div className="hbot-msg">🤖 Encontré <strong>{res.length}</strong> apunte{res.length !== 1 ? 's' : ''} con «{ultimaQ}»:</div>
            <div className="hbot-res">
              {res.map((b) => (
                <button key={`${b.fecha}-${b.hora}`} className="hbot-item" onClick={() => onJump(b.fecha)}
                  style={b.color ? { borderLeftColor: b.color } : undefined}>
                  <div className="hbot-item-top">
                    <span className="hbot-item-f">{fmtCorta(b.fecha)}</span>
                    <span className="hbot-item-h">{horaLabel(b.hora)}</span>
                  </div>
                  <div className="hbot-item-t">{b.actividad || (b.comentarios?.[0]?.texto ?? '—')}</div>
                  <div className="hbot-item-meta">
                    {b.comentarios?.length > 0 && <span>💬 {b.comentarios.length}</span>}
                    {b.archivos?.length > 0 && <span>📎 {b.archivos.length}</span>}
                    {b.recordatorio && <span>🔔 {b.recordatorio}</span>}
                    <span className="hbot-item-go">Ir al día →</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Horario({ obligaciones, filtroEmp, onOpen }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [fecha, setFecha] = useState(hoy)
  const [bloques, setBloques] = useState({})
  const [loading, setLoading] = useState(true)
  const [rev, setRev] = useState(0)
  const [detalle, setDetalle] = useState(null)
  const horaActual = new Date().getHours()

  const cargar = useCallback(() => {
    setLoading(true)
    apiListHorario(fecha).then((d) => {
      const map = {}; (d.bloques || []).forEach((b) => { map[b.hora] = b })
      setBloques(map)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [fecha])
  useEffect(() => { cargar() }, [cargar])

  async function guardarActividad(hora, actividad) {
    if ((bloques[hora]?.actividad || '') === actividad) return
    try { const d = await apiSaveHorario({ fecha, hora, actividad, empresa_id: filtroEmp || null }); setBloques((b) => ({ ...b, [hora]: d.bloque })) } catch (_) {}
  }
  function onBloqueSaved(hora, bloque) {
    setBloques((b) => ({ ...b, [hora]: bloque })); setRev((r) => r + 1)
  }

  const delDia = obligaciones.filter((o) => o.fecha_vencimiento === fecha)

  return (
    <div className="hor">
      <div className="hor-bar">
        <button className="cal-nav" onClick={() => setFecha((f) => addDias(f, -1))}>‹</button>
        <div className="hor-fecha">
          <input type="date" className="form-input" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: 160 }} />
          <span className="hor-dia">{fmtDiaLargo(fecha)}</span>
        </div>
        <button className="cal-nav" onClick={() => setFecha((f) => addDias(f, 1))}>›</button>
        {fecha !== hoy && <button className="btn-secondary hor-hoy" onClick={() => setFecha(hoy)}>Hoy</button>}
      </div>

      {delDia.length > 0 && (
        <div className="hor-venc">
          <span className="hor-venc-lbl">📅 Vence hoy:</span>
          {delDia.map((o) => (
            <button key={o.id} className="hor-venc-chip" onClick={() => onOpen(o)}>{TIPO_ICON[o.tipo] || '📌'} {o.titulo}</button>
          ))}
        </div>
      )}

      <div className="hor-cols">
        {loading ? <div className="ag-empty" style={{ flex: 1 }}>Cargando…</div> : (
          <div className="hor-grid" key={`${fecha}-${rev}`}>
            {HORAS.map((h) => {
              const b = bloques[h]
              return (
                <div key={h} className={`hor-row ${fecha === hoy && h === horaActual ? 'now' : ''}`}
                  style={b?.color ? { borderLeft: `4px solid ${b.color}` } : undefined}>
                  <div className="hor-hora">{horaLabel(h)}</div>
                  <input className="hor-input" defaultValue={b?.actividad || ''} placeholder="—"
                    onBlur={(e) => guardarActividad(h, e.target.value.trim())}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} />
                  <div className="hor-meta">
                    {b?.recordatorio && <span className="hor-badge" title={`Recordatorio ${b.recordatorio}`}>🔔</span>}
                    {b?.comentarios?.length > 0 && <span className="hor-badge">💬 {b.comentarios.length}</span>}
                    {b?.archivos?.length > 0 && <span className="hor-badge">📎 {b.archivos.length}</span>}
                    <button className="hor-detail" onClick={() => setDetalle(h)}>Detalle</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <HorarioBot onJump={setFecha} />
      </div>

      {detalle != null && <BloqueModal fecha={fecha} hora={detalle} bloque={bloques[detalle]}
        onClose={() => setDetalle(null)} onSaved={(bl) => onBloqueSaved(detalle, bl)} />}
    </div>
  )
}

export default function Agenda({ initialView = 'kanban' }) {
  const [vista, setVista] = useState(initialView)
  const [obligaciones, setObligaciones] = useState([])
  const [estados, setEstados] = useState([])
  const [empresas, setEmpresas] = useState([])
  const [filtroEmp, setFiltroEmp] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState(null)
  const [showNueva, setShowNueva] = useState(false)
  const [showEscanear, setShowEscanear] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [generando, setGenerando] = useState(false)
  const [confirmar, setConfirmar] = useState(null)   // obligación a eliminar
  const [borrando, setBorrando] = useState(false)

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
  async function confirmarEliminar() {
    if (!confirmar) return
    setBorrando(true)
    try {
      await apiDeleteObligacion(confirmar.id)
      setObligaciones((prev) => prev.filter((o) => o.id !== confirmar.id))
      setConfirmar(null)
      setDetalle(null)
    } catch (e) {
      alert(`⚠️ ${e.message}`)
    } finally {
      setBorrando(false)
    }
  }
  async function generar() {
    if (!empresas.length) return alert('Primero registra una empresa.')
    setGenerando(true)
    try {
      // Con filtro: solo esa empresa. Sin filtro: TODAS las empresas del usuario.
      const d = filtroEmp ? await apiGenerarObligaciones(filtroEmp) : await apiGenerarTodas()
      if (d.success) {
        await load()
        let msg = `✓ ${d.creadas} obligación(es) generada(s) desde el cronograma.`
        if (d.fallidas) {
          const conError = (d.detalle || []).filter((x) => !x.success).map((x) => x.empresa).join(', ')
          msg += `\n⚠️ SUNAT no respondió para: ${conError}. Vuelve a intentar en unos segundos.`
        }
        alert(msg)
      } else alert(`⚠️ ${d.error}`)
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
          <button className="btn-secondary" onClick={() => setShowEscanear(true)}>📄 Escanear documento</button>
          <button className="btn-secondary" onClick={generar} disabled={generando}>
            {generando ? '⏳...' : '✨ Generar del cronograma'}
          </button>
          <button className="btn-accent" style={{ flex: 'none' }} onClick={() => setShowNueva(true)}>+ Nueva</button>
        </div>
      </div>

      <div className="ag-toolbar">
        <div className="ag-tabs">
          {[['kanban', '▦ Kanban Contable'], ['calendario', '📅 Calendario Tributario'], ['horario', '🕒 Horario Contable']].map(([k, l]) => (
            <button key={k} className={`ag-tab ${vista === k ? 'active' : ''}`} onClick={() => setVista(k)}>{l}</button>
          ))}
        </div>
        <select className="form-input ag-filter" value={filtroEmp} onChange={(e) => setFiltroEmp(Number(e.target.value))}>
          <option value={0}>Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
        </select>
      </div>

      {vista === 'horario' ? (
        <Horario obligaciones={obligaciones} filtroEmp={filtroEmp} onOpen={setDetalle} />
      ) : loading ? <div className="ag-empty">Cargando...</div>
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
        ) : (
          <Calendario obligaciones={obligaciones} onClick={setDetalle} />
        )}

      {showNueva && <NuevaModal empresas={empresas} onClose={() => setShowNueva(false)}
        onCreated={(o) => { setObligaciones((p) => [...p, o]); setShowNueva(false) }} />}
      {showEscanear && <EscanearDoc empresas={empresas} onClose={() => setShowEscanear(false)}
        onCreated={(o) => { setObligaciones((p) => [...p, o]); setShowEscanear(false); setVista('kanban') }} />}
      {detalle && <ObligacionPage obligacionId={detalle.id} estados={estados}
        onClose={() => setDetalle(null)}
        onChanged={(o) => setObligaciones((prev) => prev.map((x) => x.id === o.id ? o : x))}
        onDelete={() => setConfirmar(detalle)} />}
      {confirmar && (
        <ConfirmModal
          title="Eliminar obligación"
          message="¿Seguro que deseas eliminar esta obligación? Esta acción no se puede deshacer."
          detail={confirmar.titulo}
          loading={borrando}
          onCancel={() => setConfirmar(null)}
          onConfirm={confirmarEliminar}
        />
      )}
    </div>
  )
}
