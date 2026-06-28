import { useState, useEffect, useRef, useCallback } from 'react'
import {
  apiObligacionDetalle, apiUpdateObligacion, apiAddComentario,
  apiUploadArchivo, apiDownloadArchivo, apiChatObligacion,
} from '../api'

const TIPO_ICON = { declaracion_mensual: '📄', sire: '📚', detraccion: '💧', otro: '📌' }
const PRIO = { alta: 'Alta', media: 'Media', baja: 'Baja' }
const fmtF = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
const fmtFH = (iso) => iso ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

export default function ObligacionPage({ obligacionId, estados, onClose, onChanged, onDelete }) {
  const [d, setD] = useState(null)
  const [obs, setObs] = useState('')
  const [obsSaved, setObsSaved] = useState(true)
  const [checklist, setChecklist] = useState([])
  const [nuevoCheck, setNuevoCheck] = useState('')
  const [comentarios, setComentarios] = useState([])
  const [actividad, setActividad] = useState([])
  const [archivos, setArchivos] = useState([])
  const [tab, setTab] = useState('comentarios')
  const [nuevoComent, setNuevoComent] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [chat, setChat] = useState([])
  const [pregunta, setPregunta] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const obsTimer = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    apiObligacionDetalle(obligacionId).then((r) => {
      setD(r.obligacion); setObs(r.obligacion.observaciones || '')
      setChecklist(r.obligacion.checklist || [])
      setComentarios(r.comentarios || []); setActividad(r.actividad || []); setArchivos(r.archivos || [])
    }).catch(() => {})
  }, [obligacionId])

  const patch = useCallback(async (data) => {
    const r = await apiUpdateObligacion(obligacionId, data)
    setD(r.obligacion); onChanged?.(r.obligacion)
    return r.obligacion
  }, [obligacionId, onChanged])

  // Autoguardado de observaciones (debounce)
  function onObs(e) {
    setObs(e.target.value); setObsSaved(false)
    clearTimeout(obsTimer.current)
    obsTimer.current = setTimeout(async () => {
      await patch({ observaciones: e.target.value }); setObsSaved(true)
    }, 800)
  }

  async function saveChecklist(items) {
    setChecklist(items)
    await patch({ checklist: items })
  }
  const addCheck = () => { if (nuevoCheck.trim()) { saveChecklist([...checklist, { texto: nuevoCheck.trim(), done: false }]); setNuevoCheck('') } }
  const toggleCheck = (i) => saveChecklist(checklist.map((c, j) => j === i ? { ...c, done: !c.done } : c))
  const delCheck = (i) => saveChecklist(checklist.filter((_, j) => j !== i))

  async function cambiarEstado(estado) {
    const o = await patch({ estado })
    setActividad((a) => [{ id: Date.now(), tipo: 'actividad', texto: `Estado: ${estados.find(s => s.key === d.estado)?.label} → ${estados.find(s => s.key === estado)?.label}`, autor: 'Tú', created_at: new Date().toISOString() }, ...a])
  }

  function toggleRecDia(ds) {
    const cur = new Set((d.recordatorio_dias || '').split(',').map((s) => s.trim()).filter(Boolean))
    cur.has(ds) ? cur.delete(ds) : cur.add(ds)
    patch({ recordatorio_dias: [...cur].map(Number).sort((a, b) => b - a).join(',') })
  }

  async function addComentario() {
    if (!nuevoComent.trim()) return
    const r = await apiAddComentario(obligacionId, nuevoComent.trim())
    setComentarios((c) => [r.comentario, ...c]); setNuevoComent('')
  }

  async function subirArchivo(e) {
    const f = e.target.files?.[0]; if (!f) return
    setSubiendo(true)
    try {
      const r = await apiUploadArchivo(obligacionId, f)
      setArchivos((a) => [r.archivo, ...a])
      setActividad((a) => [{ id: Date.now(), tipo: 'actividad', texto: `Adjuntó archivo: ${r.archivo.archivo_nombre}`, autor: 'Tú', created_at: new Date().toISOString() }, ...a])
    } catch (err) { alert(`⚠️ ${err.message}`) } finally { setSubiendo(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function enviarPregunta() {
    if (!pregunta.trim() || chatLoading) return
    const q = pregunta.trim()
    const hist = chat.map((m) => ({ role: m.role, content: m.content }))
    setChat((c) => [...c, { role: 'user', content: q }]); setPregunta(''); setChatLoading(true)
    try {
      const r = await apiChatObligacion(obligacionId, q, hist)
      setChat((c) => [...c, { role: 'assistant', content: r.respuesta }])
    } catch (err) {
      setChat((c) => [...c, { role: 'assistant', content: `⚠️ ${err.message}` }])
    } finally { setChatLoading(false) }
  }

  if (!d) return <div className="doc-overlay"><div className="op-modal" style={{ padding: 40 }}>Cargando...</div></div>

  const done = checklist.filter((c) => c.done).length
  return (
    <div className="doc-overlay">
      <div className="op-modal">
        <div className="op-head">
          <div className="op-head-l">
            <span className="op-icon">{TIPO_ICON[d.tipo] || '📌'}</span>
            <div>
              <div className="op-title">{d.titulo}</div>
              <div className="op-sub">{d.empresa} {d.empresa && d.periodo ? '·' : ''} {d.periodo}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {onDelete && <button className="op-del" onClick={onDelete} title="Eliminar">🗑️</button>}
            <button className="doc-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="op-body">
          {/* Columna principal */}
          <div className="op-main">
            <div className="op-props">
              <div className="op-prop"><span className="op-prop-k">Estado</span>
                <select className="op-prop-v" value={d.estado} onChange={(e) => cambiarEstado(e.target.value)}>
                  {estados.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select></div>
              <div className="op-prop"><span className="op-prop-k">Prioridad</span>
                <select className="op-prop-v" value={d.prioridad} onChange={(e) => patch({ prioridad: e.target.value })}>
                  {Object.entries(PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div className="op-prop"><span className="op-prop-k">Vence</span><span className="op-prop-static">📅 {fmtF(d.fecha_vencimiento)}</span></div>
            </div>

            {d.descripcion && <div className="op-desc">{d.descripcion}</div>}

            <div className="op-section">
              <div className="op-section-h">📝 Observaciones {!obsSaved && <span className="op-saving">guardando…</span>}{obsSaved && obs && <span className="op-saved">✓ guardado</span>}</div>
              <textarea className="op-textarea" value={obs} onChange={onObs} placeholder="Escribe notas, recordatorios, detalles… (se guarda solo)" />
            </div>

            <div className="op-section">
              <div className="op-section-h">✅ Checklist <span className="op-count">{done}/{checklist.length}</span></div>
              {checklist.map((c, i) => (
                <div key={i} className="op-check">
                  <input type="checkbox" checked={c.done} onChange={() => toggleCheck(i)} />
                  <span className={c.done ? 'op-check-done' : ''}>{c.texto}</span>
                  <button className="op-check-del" onClick={() => delCheck(i)}>✕</button>
                </div>
              ))}
              <div className="op-check-add">
                <input value={nuevoCheck} onChange={(e) => setNuevoCheck(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCheck()} placeholder="+ Agregar ítem" />
                <button onClick={addCheck}>Agregar</button>
              </div>
            </div>

            <div className="op-section">
              <div className="op-section-h">🔔 Recordatorio de esta obligación</div>
              <div className="op-rec-hint">Avísame antes de que venza esta tarea. Si no eliges nada, usa tu configuración general.</div>
              <div className="rec-dias" style={{ marginBottom: 10 }}>
                {[15, 7, 3, 1, 0].map((n) => {
                  const sel = (d.recordatorio_dias || '').split(',').map((s) => s.trim()).includes(String(n))
                  return <button key={n} type="button" className={`rec-chip ${sel ? 'on' : ''}`} onClick={() => toggleRecDia(String(n))}>
                    {n === 0 ? 'El mismo día' : `${n} día${n > 1 ? 's' : ''} antes`}
                  </button>
                })}
              </div>
              <div className="op-rec-canales">
                <label className="rec-canal"><input type="checkbox" checked={d.recordatorio_wsp} onChange={(e) => patch({ recordatorio_wsp: e.target.checked })} /><span>💬 WhatsApp</span></label>
                <label className="rec-canal"><input type="checkbox" checked={d.recordatorio_email} onChange={(e) => patch({ recordatorio_email: e.target.checked })} /><span>📧 Correo</span></label>
              </div>
              {(d.recordatorio_dias || '').trim() && <div className="op-rec-ok">✓ Recordatorio activo para esta tarea por {[d.recordatorio_wsp && 'WhatsApp', d.recordatorio_email && 'correo'].filter(Boolean).join(' y ') || '(elige un canal)'}.</div>}
              <div className="op-rec-foot">Usa el número/correo de <strong>Configuración</strong>. Configúralos ahí una vez.</div>
            </div>

            <div className="op-section">
              <div className="op-tabs">
                {[['comentarios', `💬 Comentarios (${comentarios.length})`], ['actividad', `🕘 Actividad (${actividad.length})`], ['archivos', `📎 Archivos (${archivos.length})`]].map(([k, l]) => (
                  <button key={k} className={`op-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
                ))}
              </div>

              {tab === 'comentarios' && (
                <div>
                  <div className="op-coment-add">
                    <input value={nuevoComent} onChange={(e) => setNuevoComent(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addComentario()} placeholder="Escribe un comentario…" />
                    <button className="btn-accent" style={{ flex: 'none', padding: '8px 14px' }} onClick={addComentario}>Enviar</button>
                  </div>
                  {comentarios.map((c) => (
                    <div key={c.id} className="op-feed">
                      <div className="op-feed-av">{(c.autor || '?')[0]?.toUpperCase()}</div>
                      <div><div className="op-feed-txt">{c.texto}</div><div className="op-feed-meta">{c.autor} · {fmtFH(c.created_at)}</div></div>
                    </div>
                  ))}
                  {!comentarios.length && <div className="op-vacio">Sin comentarios aún.</div>}
                </div>
              )}

              {tab === 'actividad' && (
                <div>
                  {actividad.map((a) => (
                    <div key={a.id} className="op-act"><span className="op-act-dot" /><div><span className="op-act-txt">{a.texto}</span><span className="op-act-meta"> · {a.autor} · {fmtFH(a.created_at)}</span></div></div>
                  ))}
                  {!actividad.length && <div className="op-vacio">Sin actividad registrada.</div>}
                </div>
              )}

              {tab === 'archivos' && (
                <div>
                  <label className="op-upload">
                    <input ref={fileRef} type="file" hidden onChange={subirArchivo} />
                    {subiendo ? '⏳ Subiendo…' : '📎 Subir archivo'}
                  </label>
                  {archivos.map((a) => (
                    <div key={a.id} className="op-archivo" onClick={() => apiDownloadArchivo(obligacionId, a.id, a.archivo_nombre)}>
                      <span>📄 {a.archivo_nombre}</span>
                      <span className="op-feed-meta">{a.autor} · {fmtFH(a.created_at)} · ⬇</span>
                    </div>
                  ))}
                  {!archivos.length && <div className="op-vacio">Sin archivos adjuntos.</div>}
                </div>
              )}
            </div>
          </div>

          {/* Chat IA */}
          <div className="op-chat">
            <div className="op-chat-h">🤖 Chat IA tributario</div>
            <div className="op-chat-msgs">
              {!chat.length && <div className="op-chat-hint">Pregúntale a la IA sobre esta obligación. Ej: <em>"¿Por qué requiere detracción?"</em>, <em>"¿Qué pasa si no la pago a tiempo?"</em></div>}
              {chat.map((m, i) => (
                <div key={i} className={`op-msg ${m.role}`}>{m.content}</div>
              ))}
              {chatLoading && <div className="op-msg assistant">🤖 Pensando…</div>}
            </div>
            <div className="op-chat-in">
              <input value={pregunta} onChange={(e) => setPregunta(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && enviarPregunta()} placeholder="Pregunta sobre esta obligación…" disabled={chatLoading} />
              <button onClick={enviarPregunta} disabled={chatLoading || !pregunta.trim()}>➤</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
