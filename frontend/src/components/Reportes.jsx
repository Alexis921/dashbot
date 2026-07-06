import { useState, useEffect, useMemo } from 'react'
import ConfirmModal from './ConfirmModal'
import Sire from './Sire'
import { apiListComprobantes, apiListEmpresas, apiDeleteComprobante } from '../api'

const S = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const TIPO_ADQ = { bien: '📦 Bien', mercaderia: '🏷️ Mercadería', servicio: '🛠️ Servicio' }

const SUBS = [
  { id: 'sire', icon: '🛰️', titulo: 'SIRE SUNAT', desc: 'Extrae tus Registros de Compras y Ventas desde la API oficial de SUNAT.' },
  { id: 'libro', icon: '📚', titulo: 'Libro de comprobantes', desc: 'Compras y ventas que el bot registró desde tus facturas.' },
  { id: 'resumen', icon: '📊', titulo: 'Resumen tributario', desc: 'IGV crédito vs. débito, detracciones y retenciones.' },
]

function Stat({ icon, num, label, color }) {
  return (
    <div className="cm-stat">
      <div className="cm-stat-icon" style={{ color }}>{icon}</div>
      <div><div className="cm-stat-num" style={{ color }}>{num}</div><div className="cm-stat-label">{label}</div></div>
    </div>
  )
}

function useComprobantes(filtroEmp, operacion) {
  const [comps, setComps] = useState([])
  const [loading, setLoading] = useState(true)
  async function load() {
    setLoading(true)
    try { const d = await apiListComprobantes(filtroEmp, operacion); setComps(d.comprobantes || []) }
    catch (_) {} finally { setLoading(false) }
  }
  useEffect(() => { load() }, [filtroEmp, operacion])
  return { comps, setComps, loading, reload: load }
}

function Libro({ onBack, empresas }) {
  const [filtroEmp, setFiltroEmp] = useState(0)
  const [op, setOp] = useState('')
  const { comps, setComps, loading } = useComprobantes(filtroEmp, op)
  const [confirmar, setConfirmar] = useState(null)
  const [borrando, setBorrando] = useState(false)

  const tot = useMemo(() => comps.reduce((a, c) => ({
    base: a.base + (c.base_imponible || 0), igv: a.igv + (c.igv || 0), total: a.total + (c.importe_total || 0),
  }), { base: 0, igv: 0, total: 0 }), [comps])

  async function eliminar() {
    setBorrando(true)
    try { await apiDeleteComprobante(confirmar.id); setComps((p) => p.filter((x) => x.id !== confirmar.id)); setConfirmar(null) }
    catch (e) { alert(`⚠️ ${e.message}`) } finally { setBorrando(false) }
  }

  return (
    <div className="prog-page">
      <div className="empresas-header">
        <div>
          <button className="eq-back" onClick={onBack}>← Reportes</button>
          <h1 className="empresas-title">📚 Libro de comprobantes</h1>
          <p className="empresas-sub">Registro electrónico de compras y ventas, listo para tu PLE.</p>
        </div>
      </div>

      <div className="pl-filters" style={{ marginBottom: 12 }}>
        <select className="form-input" value={op} onChange={(e) => setOp(e.target.value)} style={{ width: 170 }}>
          <option value="">Todas las operaciones</option>
          <option value="compra">🛒 Solo compras</option>
          <option value="venta">💵 Solo ventas</option>
        </select>
        <select className="form-input" value={filtroEmp} onChange={(e) => setFiltroEmp(Number(e.target.value))} style={{ width: 200 }}>
          <option value={0}>Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
        </select>
      </div>

      {loading ? <div className="empresas-empty">Cargando…</div>
        : comps.length === 0 ? (
          <div className="empresas-empty">
            <div style={{ fontSize: 38 }}>📚</div>
            <h3>Aún no hay comprobantes</h3>
            <p>Usa <strong>Escanear documento → Registrar con el bot</strong> para llenar tu libro automáticamente.</p>
          </div>
        ) : (
          <div className="empresas-table">
            <div className="rep-row rep-head">
              <div>Operación</div><div>Comprobante</div><div>Fecha</div>
              <div className="rep-num">Base</div><div className="rep-num">IGV</div><div className="rep-num">Total</div><div></div>
            </div>
            {comps.map((c) => (
              <div className="rep-row" key={c.id}>
                <div><span className={`rep-badge ${c.operacion}`}>{c.operacion === 'venta' ? '💵 Venta' : '🛒 Compra'}</span></div>
                <div>
                  <div className="empresa-name">{c.serie_numero || c.tipo_comprobante || '—'}</div>
                  <div className="empresa-ruc">{c.operacion === 'venta' ? (c.razon_cliente || '') : (c.razon_emisor || '')}{c.tipo_adquisicion ? ` · ${TIPO_ADQ[c.tipo_adquisicion] || c.tipo_adquisicion}` : ''}</div>
                </div>
                <div className="empresa-cell-muted">{c.fecha_emision || '—'}</div>
                <div className="rep-num">{S(c.base_imponible)}</div>
                <div className="rep-num">{S(c.igv)}{c.detraccion_aplica ? <span className="rep-tag">💧</span> : c.credito_fiscal ? <span className="rep-tag">CF</span> : null}</div>
                <div className="rep-num"><strong>{S(c.importe_total)}</strong></div>
                <div className="empresa-actions"><button className="btn-icon" onClick={() => setConfirmar(c)}>🗑️</button></div>
              </div>
            ))}
            <div className="rep-row rep-tot">
              <div></div><div><strong>Totales ({comps.length})</strong></div><div></div>
              <div className="rep-num"><strong>{S(tot.base)}</strong></div>
              <div className="rep-num"><strong>{S(tot.igv)}</strong></div>
              <div className="rep-num"><strong>{S(tot.total)}</strong></div><div></div>
            </div>
          </div>
        )}

      {confirmar && <ConfirmModal title="Eliminar comprobante" message="¿Quitar este comprobante de tu libro? No se puede deshacer."
        detail={confirmar.serie_numero} loading={borrando} onCancel={() => setConfirmar(null)} onConfirm={eliminar} />}
    </div>
  )
}

function Resumen({ onBack, empresas }) {
  const [filtroEmp, setFiltroEmp] = useState(0)
  const { comps, loading } = useComprobantes(filtroEmp, '')

  const r = useMemo(() => {
    const ventas = comps.filter((c) => c.operacion === 'venta')
    const compras = comps.filter((c) => c.operacion === 'compra')
    const debito = ventas.reduce((a, c) => a + (c.igv || 0), 0)
    const credito = compras.reduce((a, c) => a + (c.credito_fiscal_monto || 0), 0)
    return {
      ventasBase: ventas.reduce((a, c) => a + (c.base_imponible || 0), 0),
      comprasBase: compras.reduce((a, c) => a + (c.base_imponible || 0), 0),
      debito, credito, igvPagar: Math.max(0, debito - credito), saldoFavor: Math.max(0, credito - debito),
      detraccion: comps.reduce((a, c) => a + (c.detraccion_monto || 0), 0),
      retencion: comps.reduce((a, c) => a + (c.retencion_monto || 0), 0),
      nV: ventas.length, nC: compras.length,
    }
  }, [comps])

  return (
    <div className="prog-page">
      <div className="empresas-header">
        <div>
          <button className="eq-back" onClick={onBack}>← Reportes</button>
          <h1 className="empresas-title">📊 Resumen tributario</h1>
          <p className="empresas-sub">IGV del período según los comprobantes registrados. Referencial — valida con tu PDT.</p>
        </div>
        <select className="form-input" value={filtroEmp} onChange={(e) => setFiltroEmp(Number(e.target.value))} style={{ width: 200, flex: 'none' }}>
          <option value={0}>Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
        </select>
      </div>

      {loading ? <div className="empresas-empty">Cargando…</div> : (
        <>
          <div className="cm-stats">
            <Stat icon="💵" num={S(r.ventasBase)} label={`Ventas (${r.nV})`} color="#0a9d63" />
            <Stat icon="🛒" num={S(r.comprasBase)} label={`Compras (${r.nC})`} color="#1B3A6B" />
            <Stat icon="📤" num={S(r.debito)} label="Débito fiscal (IGV ventas)" color="#b45309" />
            <Stat icon="📥" num={S(r.credito)} label="Crédito fiscal (IGV compras)" color="#0369a1" />
          </div>

          <div className="rep-igv">
            <div className="rep-igv-main">
              <div className="rep-igv-label">{r.igvPagar > 0 ? 'IGV por pagar (aprox.)' : 'Saldo a favor (aprox.)'}</div>
              <div className="rep-igv-val" style={{ color: r.igvPagar > 0 ? '#b45309' : '#0a9d63' }}>
                {S(r.igvPagar > 0 ? r.igvPagar : r.saldoFavor)}
              </div>
              <div className="rep-igv-formula">Débito {S(r.debito)} − Crédito {S(r.credito)}</div>
            </div>
            <div className="rep-igv-side">
              <div className="rep-igv-item"><span>💧 Detracciones</span><strong>{S(r.detraccion)}</strong></div>
              <div className="rep-igv-item"><span>🧾 Retenciones IGV</span><strong>{S(r.retencion)}</strong></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function Reportes({ initialView = 'dashboard' }) {
  const [view, setView] = useState(initialView)
  const [empresas, setEmpresas] = useState([])
  const [comps, setComps] = useState([])

  useEffect(() => { apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {}) }, [])
  useEffect(() => { apiListComprobantes().then((d) => setComps(d.comprobantes || [])).catch(() => {}) }, [view])

  if (view === 'sire') return <Sire onBack={() => setView('dashboard')} onGoLibro={() => setView('libro')} />
  if (view === 'libro') return <Libro onBack={() => setView('dashboard')} empresas={empresas} />
  if (view === 'resumen') return <Resumen onBack={() => setView('dashboard')} empresas={empresas} />

  const nC = comps.filter((c) => c.operacion === 'compra').length
  const nV = comps.filter((c) => c.operacion === 'venta').length
  const igv = comps.reduce((a, c) => a + (c.igv || 0), 0)

  return (
    <div className="cm-page">
      <div className="cm-hero">
        <div className="cm-bot">📊</div>
        <div>
          <div className="cm-hello">Reportes</div>
          <div className="cm-sub">Tu información tributaria consolidada: libro de compras/ventas y resumen del IGV, alimentados por el bot.</div>
        </div>
      </div>

      <div className="cm-stats">
        <Stat icon="📄" num={comps.length} label="Comprobantes" color="#1B3A6B" />
        <Stat icon="🛒" num={nC} label="Compras" color="#0369a1" />
        <Stat icon="💵" num={nV} label="Ventas" color="#0a9d63" />
        <Stat icon="🧮" num={S(igv)} label="IGV acumulado" color="#b45309" />
      </div>

      <div className="eq-grid">
        {SUBS.map((s) => (
          <button key={s.id} className="eq-card" onClick={() => setView(s.id)}>
            <div className="eq-card-icon">{s.icon}</div>
            <div className="eq-card-title">{s.titulo}</div>
            <div className="eq-card-desc">{s.desc}</div>
            <span className="eq-card-go">Abrir →</span>
          </button>
        ))}
      </div>
    </div>
  )
}
