import { useState, useEffect, useMemo, useRef } from 'react'
import {
  apiListEmpresas, apiImportarPdt, apiListPdt, apiUpdatePdt, apiLimpiarPdt,
  apiImportarPagosSunat, apiListPagosSunat, apiLimpiarPagosSunat, apiReporteDecl,
} from '../api'

const S = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre']

const ESTADO_CHIP = {
  pagado: { txt: '✅ Pagado', cls: 'ok' },
  al_dia: { txt: '✔ Al día', cls: 'ok' },
  parcial: { txt: '🟡 Parcial', cls: 'warn' },
  pendiente: { txt: '🔴 Pendiente', cls: 'bad' },
  sin_declarar: { txt: '— Sin declarar', cls: 'off' },
}

const CAT_LABEL = {
  IGV: 'IGV', RENTA3: 'Renta 3ra', RENTA4: 'Renta 4ta', RENTA5: 'Renta 5ta',
  RENTA_ANUAL: 'Renta Anual', ONP: 'ONP', ESSALUD: 'EsSalud', FRACC: 'Fraccionam.', OTROS: 'Otros',
}

const CASILLA_LABELS = {
  100: 'Ventas netas (base)', 101: 'IGV de ventas', 102: 'Descuentos concedidos (base)',
  103: 'IGV de descuentos', 107: 'Compras gravadas (base)', 108: 'IGV de compras',
  156: 'Compras tasa 10% Ley 31556 (base)', 157: 'IGV compras tasa 10%', 120: 'Compras no gravadas',
  301: 'Renta: ingresos netos', 312: 'Renta: pago a cuenta', 140: 'IGV: impuesto resultante',
  302: 'Renta: impuesto resultante', 145: 'IGV: saldo a favor anterior', 303: 'Renta: saldo a favor anterior',
  184: 'IGV: tributo a pagar', 304: 'Renta: tributo a pagar / saldo', 179: 'IGV: retenciones del período',
  176: 'IGV: saldo retenciones anteriores', 165: 'IGV: retenciones no aplicadas',
  681: 'IGV: subtotal', 682: 'Renta: subtotal', 185: 'IGV: pagos previos', 317: 'Renta: pagos previos',
  188: '⭐ IGV: TOTAL DEUDA', 324: '⭐ Renta: TOTAL DEUDA',
}

// Campos editables de la tabla PDT (columna → casilla)
const PDT_COLS = [
  { key: 'ventas_base', lbl: 'Ventas', cas: 100 },
  { key: 'ventas_igv', lbl: 'IGV Ventas', cas: 101 },
  { key: 'compras_base', lbl: 'Compras', cas: 107 },
  { key: 'compras_igv', lbl: 'IGV Compras', cas: 108 },
  { key: 'renta_pago_cta', lbl: 'Pago a cta.', cas: 312 },
  { key: 'igv_deuda', lbl: 'IGV a pagar', cas: 188, star: true },
  { key: 'renta_deuda', lbl: 'Renta a pagar', cas: 324, star: true },
]

function Stat({ icon, num, label, color, bg }) {
  return (
    <div className="cm-stat" style={{ '--c': color, '--cbg': bg }}>
      <div className="cm-stat-ico">{icon}</div>
      <div><div className="cm-stat-num">{num}</div><div className="cm-stat-label">{label}</div></div>
    </div>
  )
}

function BtnImport({ label, icon, onFile, accept = '.xlsx,.xls', title, className = 'btn-secondary' }) {
  const ref = useRef(null)
  return (
    <>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      <button className={className} title={title} onClick={() => ref.current?.click()}>{icon} {label}</button>
    </>
  )
}

// ── Tab: Reporte (dashboard declarado vs pagado) ─────────────────────────────
function TabReporte({ reporte }) {
  const [abierto, setAbierto] = useState(0)
  if (!reporte) return <div className="empresas-empty">Cargando…</div>
  const { meses, totales, pendientes, categorias } = reporte
  const conDatos = meses.some((m) => m.estado !== 'sin_declarar' || m.pagado_total > 0)
  if (!conDatos) {
    return (
      <div className="empresas-empty">
        <div style={{ fontSize: 38 }}>📊</div>
        <h3>Aún no hay datos para el reporte</h3>
        <p>Importa el <strong>Detalle PDT 621</strong> y el <strong>Detalle de Pagos</strong> en las otras pestañas, y aquí verás el match declarado vs pagado.</p>
      </div>
    )
  }
  return (
    <>
      {totales.pendiente > 0 && (
        <div className="dp-alert">
          <div className="dp-alert-ico">🚨</div>
          <div>
            <strong>Tienes {S(totales.pendiente)} de deuda declarada sin pagar</strong> en {pendientes.length} período{pendientes.length !== 1 ? 's' : ''} ({pendientes.map((p) => p.nombre).join(', ')}).
            <div className="dp-alert-sub">Una deuda declarada y no pagada genera una <strong>Orden de Pago</strong>: SUNAT puede pasarla a <strong>cobranza coactiva</strong> (embargo de cuentas) 7 días hábiles después de notificarla. Prioriza el pago o solicita fraccionamiento.</div>
          </div>
        </div>
      )}

      <div className="empresas-table" style={{ marginBottom: 18 }}>
        <div className="dp-rep-row dp-head">
          <div>Período</div><div className="rep-num">Declarado (621)</div><div className="rep-num">Pagado (621)</div>
          <div className="rep-num">Diferencia</div><div>Estado</div><div />
        </div>
        {meses.map((m) => {
          const chip = ESTADO_CHIP[m.estado] || ESTADO_CHIP.sin_declarar
          const open = abierto === m.mes
          return (
            <div key={m.mes}>
              <div className={`dp-rep-row dp-click ${open ? 'dp-open' : ''}`} onClick={() => setAbierto(open ? 0 : m.mes)}>
                <div className="tal-tipo">{m.nombre}</div>
                <div className="rep-num">{m.estado === 'sin_declarar' ? '—' : S(m.declarado)}</div>
                <div className="rep-num">{m.pagado_pdt ? S(m.pagado_pdt) : '—'}</div>
                <div className={`rep-num ${m.diferencia > 0 ? 'dp-rojo' : ''}`}>{m.estado === 'sin_declarar' ? '—' : S(Math.max(m.diferencia, 0))}</div>
                <div><span className={`dp-chip ${chip.cls}`}>{chip.txt}</span></div>
                <div className="dp-caret">{open ? '▾' : '▸'}</div>
              </div>
              {open && (
                <div className="dp-exp">
                  <div className="dp-exp-grid">
                    <div>
                      <div className="dp-exp-title">🧾 Declarado en el PDT 621</div>
                      <div className="dp-exp-line"><span>IGV (casilla 188)</span><b>{S(m.declarado_igv)}</b></div>
                      <div className="dp-exp-line"><span>Renta (casilla 324)</span><b>{S(m.declarado_renta)}</b></div>
                      <div className="dp-exp-line dp-exp-tot"><span>Total declarado</span><b>{S(m.declarado)}</b></div>
                    </div>
                    <div>
                      <div className="dp-exp-title">💵 Pagos del período</div>
                      {m.pagos.length === 0 ? <div className="dp-exp-vacio">Sin pagos registrados.</div>
                        : m.pagos.map((p) => (
                          <div className="dp-exp-line" key={p.id}>
                            <span>{p.fecha?.slice(5)} · {CAT_LABEL[p.categoria] || p.categoria}{p.banco && p.banco !== '-' ? ` · ${p.banco.trim()}` : ''}</span>
                            <b>{S(p.importe)}</b>
                          </div>
                        ))}
                      <div className="dp-exp-line dp-exp-tot"><span>Total pagado</span><b>{S(m.pagado_total)}</b></div>
                    </div>
                  </div>
                  {m.diferencia > 0 && m.estado !== 'sin_declarar' && (
                    <div className="dp-exp-deuda">⚠️ Queda por pagar <b>{S(m.diferencia)}</b> del 621 de {m.nombre}.</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {categorias.length > 0 && (
        <div className="empresas-table">
          <div className="dp-mx-title">💰 Pagos por tributo (matriz anual)</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="dp-mx">
              <thead>
                <tr><th>Mes</th>{categorias.map((c) => <th key={c}>{CAT_LABEL[c] || c}</th>)}<th>Total</th></tr>
              </thead>
              <tbody>
                {meses.filter((m) => m.pagado_total > 0).map((m) => (
                  <tr key={m.mes}>
                    <td>{m.nombre}</td>
                    {categorias.map((c) => <td key={c}>{m.matriz[c] ? S(m.matriz[c]) : '—'}</td>)}
                    <td><b>{S(m.pagado_total)}</b></td>
                  </tr>
                ))}
                <tr className="dp-mx-tot">
                  <td>Total</td>
                  {categorias.map((c) => <td key={c}>{S(meses.reduce((a, m) => a + (m.matriz[c] || 0), 0))}</td>)}
                  <td><b>{S(totales.pagado_total)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Tab: PDT 621 (declaraciones importadas, editables) ───────────────────────
function TabPdt({ decls, empresaId, anio, onReload, setMsg }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [detalle, setDetalle] = useState(null)

  const dirty = Object.keys(edits).length

  async function importar(file, modo) {
    try {
      const r = await apiImportarPdt(empresaId, file, modo)
      setMsg(`✅ PDT 621: ${r.creados} mes(es) importado(s)${r.actualizados ? `, ${r.actualizados} actualizado(s)` : ''}.`)
      setEdits({}); onReload()
    } catch (e) { setMsg(`⚠️ ${e.message}`) }
  }

  async function limpiar() {
    if (!confirm(`¿Borrar todas las declaraciones del ${anio} de esta vista?`)) return
    try {
      const r = await apiLimpiarPdt(empresaId, anio)
      setMsg(`🧹 ${r.eliminados} declaración(es) eliminada(s).`)
      setEdits({}); onReload()
    } catch (e) { setMsg(`⚠️ ${e.message}`) }
  }

  async function guardar() {
    setSaving(true)
    try {
      for (const [id, campos] of Object.entries(edits)) await apiUpdatePdt(Number(id), campos)
      setMsg(`💾 ${dirty} declaración(es) guardada(s).`)
      setEdits({}); onReload()
    } catch (e) { setMsg(`⚠️ ${e.message}`) } finally { setSaving(false) }
  }

  const setCampo = (id, key, val) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: val === '' ? null : Number(val) } }))

  return (
    <>
      <div className="dp-toolbar">
        <BtnImport label="Cargar Excel" icon="📥" className="btn-accent" title="Suma/actualiza los meses del archivo"
          onFile={(f) => importar(f, 'cargar')} accept=".xlsx" />
        <BtnImport label="Reemplazar" icon="🔁" title="Borra el año del archivo y lo vuelve a importar"
          onFile={(f) => importar(f, 'reemplazar')} accept=".xlsx" />
        <button className="btn-secondary" onClick={limpiar}>🧹 Limpiar</button>
        {dirty > 0 && (
          <button className="btn-accent" onClick={guardar} disabled={saving} style={{ marginLeft: 'auto' }}>
            {saving ? '⏳ Guardando…' : `💾 Guardar cambios (${dirty})`}
          </button>
        )}
      </div>
      <div className="dp-hint">Descarga el reporte <strong>“Detalle de declaraciones — PDT 621”</strong> desde SOL (Mis declaraciones y pagos) y cárgalo aquí. Las casillas son editables: corrige y pulsa Guardar.</div>

      {decls.length === 0 ? (
        <div className="empresas-empty">
          <div style={{ fontSize: 38 }}>🧾</div>
          <h3>Sin declaraciones del {anio}</h3>
          <p>Carga el Excel del Detalle PDT 621 para empezar.</p>
        </div>
      ) : (
        <div className="empresas-table" style={{ overflowX: 'auto' }}>
          <div className="dp-pdt-row dp-head">
            <div>Mes</div>
            {PDT_COLS.map((c) => (
              <div key={c.key} className="rep-num" title={`Casilla ${c.cas}`}>
                {c.star ? '⭐ ' : ''}{c.lbl} <span className="dp-cas">{c.cas}</span>
              </div>
            ))}
            <div style={{ textAlign: 'center' }}>Detalle</div>
          </div>
          {decls.map((d) => (
            <div className={`dp-pdt-row ${edits[d.id] ? 'dp-dirty' : ''}`} key={d.id}>
              <div>
                <div className="tal-tipo">{MESES[d.mes - 1]}</div>
                <div className="empresa-ruc">{d.tipo_decl}{d.igv_justo === 'SI' ? ' · IGV Justo' : ''}</div>
              </div>
              {PDT_COLS.map((c) => (
                <div key={c.key} className="rep-num">
                  <input type="number" step="0.01" className="dp-edit"
                    value={edits[d.id]?.[c.key] !== undefined ? (edits[d.id][c.key] ?? '') : (d[c.key] ?? '')}
                    onChange={(e) => setCampo(d.id, c.key, e.target.value)} />
                </div>
              ))}
              <div style={{ textAlign: 'center' }}>
                <button className="dp-ver" title="Ver todas las casillas" onClick={() => setDetalle(d)}>👁️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detalle && (
        <div className="cm-overlay" onClick={() => setDetalle(null)}>
          <div className="modal" style={{ maxWidth: 520, maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3>🧾 PDT 621 — {MESES[detalle.mes - 1]} {detalle.anio}</h3>
            <div className="dp-det">
              {Object.entries(detalle.detalle || {})
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([cas, val]) => (
                  <div className="dp-exp-line" key={cas}>
                    <span><span className="dp-cas">{cas}</span> {CASILLA_LABELS[cas] || 'Casilla ' + cas}</span>
                    <b>{val === null || val === undefined ? '—' : S(val)}</b>
                  </div>
                ))}
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Tab: Pagos SUNAT ─────────────────────────────────────────────────────────
function TabPagos({ pagos, empresaId, anio, onReload, setMsg }) {
  async function importar(file, modo) {
    try {
      const r = await apiImportarPagosSunat(empresaId, file, modo)
      setMsg(`✅ Pagos: ${r.creados} importado(s)${r.omitidos ? `, ${r.omitidos} duplicado(s) omitido(s)` : ''}.`)
      onReload()
    } catch (e) { setMsg(`⚠️ ${e.message}`) }
  }

  async function limpiar() {
    if (!confirm(`¿Borrar todos los pagos del ${anio} de esta vista?`)) return
    try {
      const r = await apiLimpiarPagosSunat(empresaId, anio)
      setMsg(`🧹 ${r.eliminados} pago(s) eliminado(s).`)
      onReload()
    } catch (e) { setMsg(`⚠️ ${e.message}`) }
  }

  const grupos = useMemo(() => {
    const g = {}
    for (const p of pagos) {
      const k = `${p.anio}-${String(p.mes).padStart(2, '0')}`
      ;(g[k] = g[k] || []).push(p)
    }
    return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]))
  }, [pagos])

  return (
    <>
      <div className="dp-toolbar">
        <BtnImport label="Cargar Excel" icon="📥" className="btn-accent" title="Suma pagos nuevos (omite duplicados)"
          onFile={(f) => importar(f, 'cargar')} />
        <BtnImport label="Reemplazar" icon="🔁" title="Borra el año del archivo y lo vuelve a importar"
          onFile={(f) => importar(f, 'reemplazar')} />
        <button className="btn-secondary" onClick={limpiar}>🧹 Limpiar</button>
      </div>
      <div className="dp-hint">Descarga el reporte <strong>“Detalle de declaraciones y pagos”</strong> desde SOL (acepta el .xls original de SUNAT) — incluye tributos del PDT, planilla y fraccionamientos.</div>

      {grupos.length === 0 ? (
        <div className="empresas-empty">
          <div style={{ fontSize: 38 }}>💵</div>
          <h3>Sin pagos del {anio}</h3>
          <p>Carga el Excel del Detalle de Pagos para empezar.</p>
        </div>
      ) : grupos.map(([periodo, lista]) => {
        const [y, m] = periodo.split('-')
        const total = lista.reduce((a, p) => a + (p.importe || 0), 0)
        return (
          <div className="empresas-table" style={{ marginBottom: 14 }} key={periodo}>
            <div className="dp-mes-head">
              <span>📅 {MESES[Number(m) - 1]} {y}</span>
              <span>{lista.length} pago{lista.length !== 1 ? 's' : ''} · <b>{S(total)}</b></span>
            </div>
            {lista.map((p) => (
              <div className="dp-pago-row" key={p.id}>
                <div className="empresa-cell-muted">{p.fecha_pago}</div>
                <div>
                  <div className="empresa-name">{p.tributo && p.tributo !== '-' ? p.tributo : p.descripcion}</div>
                  <div className="empresa-ruc">Form. {p.formulario} · Orden {p.orden}{p.banco && p.banco !== '-' ? ` · Banco ${p.banco.trim()}` : ''}</div>
                </div>
                <div><span className={`dp-cat dp-cat-${p.categoria}`}>{CAT_LABEL[p.categoria] || p.categoria}</span></div>
                <div className="rep-num"><b>{S(p.importe)}</b></div>
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}

// ── Bot asistente (panel derecho) ────────────────────────────────────────────
function DeclaBot({ reporte, anio }) {
  const [q, setQ] = useState('')
  const [chat, setChat] = useState([])
  const bodyRef = useRef(null)

  useEffect(() => { bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight) }, [chat])

  function responder(texto) {
    if (!reporte) return 'Aún estoy cargando tus datos, dame un segundo…'
    const t = texto.toLowerCase()
    const { totales, pendientes, meses } = reporte
    const lineaPend = () => pendientes.map((p) => `• ${p.nombre}: ${S(p.monto)}`).join('\n')

    const mesIdx = MESES.findIndex((m) => t.includes(m.toLowerCase()))
    if (mesIdx >= 0) {
      const m = meses[mesIdx]
      if (m.estado === 'sin_declarar') return `📅 ${m.nombre} ${anio}: aún no tiene declaración PDT 621 importada.${m.pagado_total > 0 ? ` Sí registro pagos por ${S(m.pagado_total)}.` : ''}`
      const chip = ESTADO_CHIP[m.estado]?.txt || m.estado
      return `📅 ${m.nombre} ${anio} — ${chip}\n• Declarado: ${S(m.declarado)} (IGV ${S(m.declarado_igv)} + Renta ${S(m.declarado_renta)})\n• Pagado del 621: ${S(m.pagado_pdt)}\n• Pagado total (todos los tributos): ${S(m.pagado_total)}${m.diferencia > 0 ? `\n⚠️ Queda por pagar ${S(m.diferencia)}.` : '\n✅ Sin deuda pendiente del 621.'}`
    }
    if (/coactiva|embargo|riesgo/.test(t)) {
      const intro = 'ℹ️ Cobranza coactiva: si declaras y no pagas, SUNAT emite una Orden de Pago. Notificada la Resolución de Ejecución Coactiva, tienes 7 días hábiles antes de que puedan embargar cuentas o bienes.'
      if (!pendientes.length) return `${intro}\n\n✅ Buenas noticias: no tienes deuda declarada pendiente del ${anio}. Riesgo bajo.`
      return `${intro}\n\n🚨 Tu riesgo actual (${anio}):\n${lineaPend()}\nTotal expuesto: ${S(totales.pendiente)}\n\n💡 Prioriza el período más antiguo (la deuda genera interés diario) o solicita fraccionamiento Art. 36.`
    }
    if (/pendiente|debo|deuda|falta/.test(t)) {
      if (!pendientes.length) return `✅ No tienes deuda pendiente del PDT 621 en ${anio}. Todo lo declarado está pagado.`
      return `🔴 Deuda pendiente del ${anio}: ${S(totales.pendiente)}\n${lineaPend()}\n\n⚠️ Recuerda: deuda declarada y no pagada puede pasar a cobranza coactiva. Pregúntame «riesgo coactiva» para más detalle.`
    }
    if (/pagu|pagad|pagos/.test(t)) {
      const top = meses.filter((m) => m.pagado_total > 0).map((m) => `• ${m.nombre}: ${S(m.pagado_total)}`).join('\n')
      return `💵 Pagos ${anio}:\n• Del PDT 621 (IGV + Renta 3ra): ${S(totales.pagado_pdt)}\n• Total todos los tributos: ${S(totales.pagado_total)}\n${top ? '\nPor mes:\n' + top : ''}`
    }
    if (/declar/.test(t)) {
      const declarados = meses.filter((m) => m.estado !== 'sin_declarar')
      return `🧾 Declaraciones ${anio}: ${declarados.length} mes(es) con PDT 621.\n• Total declarado (188 + 324): ${S(totales.declarado)}\n• Pagado: ${S(totales.pagado_pdt)}\n• Diferencia: ${S(totales.pendiente)}`
    }
    if (/igv/.test(t)) {
      const igv = meses.reduce((a, m) => a + m.declarado_igv, 0)
      return `📊 IGV declarado ${anio} (casilla 188): ${S(igv)}\nPagado vía IGV/Renta3: ${S(totales.pagado_pdt)}${totales.pendiente > 0 ? `\n⚠️ Pendiente: ${S(totales.pendiente)}` : ''}`
    }
    if (/renta/.test(t)) {
      const renta = meses.reduce((a, m) => a + m.declarado_renta, 0)
      return `📊 Renta declarada ${anio} (casilla 324): ${S(renta)}${renta === 0 ? '\n💡 Si sale 0 suele ser por saldo a favor arrastrado (casilla 304 negativa).' : ''}`
    }
    // resumen general
    return `🤖 Resumen ${anio}:\n• Declarado: ${S(totales.declarado)}\n• Pagado (621): ${S(totales.pagado_pdt)}\n• Pagado total: ${S(totales.pagado_total)}\n• Pendiente: ${S(totales.pendiente)}${pendientes.length ? `\n\n🔴 Meses con deuda: ${pendientes.map((p) => p.nombre).join(', ')}` : '\n\n✅ Sin deuda pendiente.'}\n\nPregúntame: «¿qué debo?», «riesgo coactiva», «pagos de marzo»…`
  }

  function enviar(texto) {
    const query = (texto ?? q).trim()
    if (!query) return
    setChat((c) => [...c, { de: 'yo', txt: query }, { de: 'bot', txt: responder(query) }])
    setQ('')
  }

  return (
    <div className="hbot">
      <div className="hbot-head">
        <div className="hbot-avatar"><img src="/robot.png" alt="DashBot" className="hbot-img" /><span className="hbot-ring" /></div>
        <div>
          <div className="hbot-title">Asistente tributario</div>
          <div className="hbot-sub"><span className="cm-online" />Deudas, pagos y coactiva</div>
        </div>
      </div>

      <div className="hbot-in">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && enviar()}
          placeholder="Ej. ¿qué debo?, marzo, coactiva…" />
        <button onClick={() => enviar()} disabled={!q.trim()}>➤</button>
      </div>

      <div className="hbot-body" ref={bodyRef}>
        {chat.length === 0 ? (
          <div className="hbot-empty">
            <p>Pregúntame cuánto declaraste, cuánto pagaste, qué tienes pendiente y si alguna deuda corre riesgo de <strong>cobranza coactiva</strong>.</p>
            <div className="hbot-tips">
              {['¿Qué debo?', 'Riesgo coactiva', '¿Cuánto pagué?', 'Resumen'].map((tp) => (
                <button key={tp} className="hbot-tip" onClick={() => enviar(tp)}>{tp}</button>
              ))}
            </div>
          </div>
        ) : chat.map((m, i) => (
          m.de === 'yo'
            ? <div className="dp-bot-yo" key={i}>{m.txt}</div>
            : <div className="hbot-msg dp-bot-msg" key={i}>{m.txt}</div>
        ))}
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function Declaraciones() {
  const anioHoy = new Date().getFullYear()
  const [empresas, setEmpresas] = useState([])
  const [filtroEmp, setFiltroEmp] = useState(0)
  const [anio, setAnio] = useState(anioHoy)
  const [tab, setTab] = useState('reporte')
  const [reporte, setReporte] = useState(null)
  const [decls, setDecls] = useState([])
  const [pagos, setPagos] = useState([])
  const [msg, setMsg] = useState('')

  useEffect(() => { apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {}) }, [])

  async function cargarTodo() {
    try {
      const [r, d, p] = await Promise.all([
        apiReporteDecl(filtroEmp, anio), apiListPdt(filtroEmp, anio), apiListPagosSunat(filtroEmp, anio),
      ])
      setReporte(r); setDecls(d.declaraciones || []); setPagos(p.pagos || [])
    } catch (_) {}
  }
  useEffect(() => { cargarTodo() }, [filtroEmp, anio])

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 6000)
    return () => clearTimeout(t)
  }, [msg])

  const stats = reporte?.totales || { declarado: 0, pagado_pdt: 0, pagado_total: 0, pendiente: 0 }
  const nRiesgo = reporte?.pendientes?.length || 0

  return (
    <div className="cm-page">
      <div className="cm-inner">
        <div className="empresas-header">
          <div>
            <h1 className="empresas-title">🧾 Declaraciones y Pagos</h1>
            <p className="empresas-sub">Controla cuánto declaraste, cuánto pagaste y qué deudas no deben llegar a cobranza coactiva.</p>
          </div>
          <div className="pl-filters">
            <select className="form-input" value={filtroEmp} onChange={(e) => setFiltroEmp(Number(e.target.value))} style={{ width: 200 }}>
              <option value={0}>Todas las empresas</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
            </select>
            <select className="form-input" value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ width: 110 }}>
              {[anioHoy + 1, anioHoy, anioHoy - 1, anioHoy - 2].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="cm-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Stat icon="🧾" num={S(stats.declarado)} label={`Declarado ${anio}`} color="#2563eb" bg="#dbeafe" />
          <Stat icon="💵" num={S(stats.pagado_total)} label="Pagado (todos los tributos)" color="#0a9d63" bg="#d1fae5" />
          <Stat icon="🔴" num={S(stats.pendiente)} label="Deuda pendiente 621" color="#dc2626" bg="#fee2e2" />
          <Stat icon="⚠️" num={nRiesgo} label="Meses en riesgo" color="#b45309" bg="#fef3c7" />
        </div>

        {msg && <div className="dp-msg">{msg}</div>}

        <div className="pl-tabs">
          <button className={`pl-tab ${tab === 'reporte' ? 'active' : ''}`} onClick={() => setTab('reporte')}>📊 Reporte</button>
          <button className={`pl-tab ${tab === 'pdt' ? 'active' : ''}`} onClick={() => setTab('pdt')}>🧾 Declaraciones PDT 621</button>
          <button className={`pl-tab ${tab === 'pagos' ? 'active' : ''}`} onClick={() => setTab('pagos')}>💵 Pagos SUNAT</button>
        </div>

        <div className="dp-cols">
          <div className="dp-main">
            {tab === 'reporte' && <TabReporte reporte={reporte} />}
            {tab === 'pdt' && <TabPdt decls={decls} empresaId={filtroEmp} anio={anio} onReload={cargarTodo} setMsg={setMsg} />}
            {tab === 'pagos' && <TabPagos pagos={pagos} empresaId={filtroEmp} anio={anio} onReload={cargarTodo} setMsg={setMsg} />}
          </div>
          <DeclaBot reporte={reporte} anio={anio} />
        </div>
      </div>
    </div>
  )
}
