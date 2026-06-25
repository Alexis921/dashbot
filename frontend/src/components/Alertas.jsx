import { useState, useEffect } from 'react'
import { apiListEmpresas, apiSyncRuc, apiVencimientos } from '../api'

const fmtFecha = (iso) => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'

function EstadoVenc({ v }) {
  const map = {
    vencido: { c: '#dc2626', bg: '#fee2e2', t: 'Vencido' },
    hoy: { c: '#b45309', bg: '#fef3c7', t: '¡Vence hoy!' },
    proximo: { c: '#b45309', bg: '#fef3c7', t: `En ${v.dias_restantes} día(s)` },
    vigente: { c: '#0369a1', bg: '#e0f2fe', t: `En ${v.dias_restantes} días` },
  }
  const s = map[v.estado] || map.vigente
  return <span style={{ color: s.c, background: s.bg, padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.t}</span>
}

function RucCard({ empresa, onSync, syncing }) {
  const Row = ({ label, value, badge }) => (
    <div className="ruc-row">
      <span className="ruc-label">{label}</span>
      {badge
        ? <span className="ruc-badge" style={{ background: badge.bg, color: badge.c }}>{value || '—'}</span>
        : <span className="ruc-value">{value || '—'}</span>}
    </div>
  )
  const estadoBadge = empresa.estado_ruc === 'ACTIVO'
    ? { bg: '#dcfce7', c: '#166534' } : { bg: '#fee2e2', c: '#991b1b' }
  const condBadge = empresa.condicion === 'HABIDO'
    ? { bg: '#dcfce7', c: '#166534' } : { bg: '#fef3c7', c: '#b45309' }
  return (
    <div className="ruc-card">
      <div className="ruc-card-head">
        <div>
          <div className="ruc-card-title">{empresa.razon_social || `RUC ${empresa.ruc}`}</div>
          <div className="ruc-card-ruc">RUC {empresa.ruc}</div>
        </div>
        <button className="btn-accent" style={{ flex: 'none', padding: '8px 14px' }} onClick={onSync} disabled={syncing}>
          {syncing ? '⏳ Consultando...' : '🔄 Sincronizar datos RUC'}
        </button>
      </div>
      <Row label="Estado" value={empresa.estado_ruc} badge={empresa.estado_ruc ? estadoBadge : null} />
      <Row label="Condición" value={empresa.condicion} badge={empresa.condicion ? condBadge : null} />
      <Row label="Actividad económica" value={empresa.actividad_economica} />
      <Row label="Dirección" value={empresa.direccion} />
      <Row label="Ubicación" value={empresa.ubicacion} />
      <Row label="Padrones" value={empresa.padrones} />
      {empresa.ruc_sync_at && <div className="ruc-synced">Actualizado: {new Date(empresa.ruc_sync_at).toLocaleString('es-PE')}</div>}
    </div>
  )
}

export default function Alertas() {
  const [empresas, setEmpresas] = useState([])
  const [sel, setSel] = useState(null)
  const [venc, setVenc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingVenc, setLoadingVenc] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    apiListEmpresas().then((d) => {
      setEmpresas(d.empresas || [])
      if (d.empresas?.length) setSel(d.empresas[0])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!sel) return
    setLoadingVenc(true); setErr(''); setVenc(null)
    apiVencimientos(sel.id)
      .then((d) => { if (d.success) setVenc(d); else setErr(d.error || 'No se pudo obtener el cronograma.') })
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingVenc(false))
  }, [sel])

  async function handleSyncRuc() {
    if (!sel) return
    setSyncing(true)
    try {
      const d = await apiSyncRuc(sel.id)
      setSel(d.empresa)
      setEmpresas((prev) => prev.map((e) => e.id === d.empresa.id ? d.empresa : e))
    } catch (e) {
      alert(`⚠️ ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <div className="prog-page"><div className="prog-card">Cargando...</div></div>
  if (!empresas.length) return (
    <div className="coming-soon">
      <div className="coming-soon-icon">⚠️</div>
      <h2>Sin empresas registradas</h2>
      <p>Agrega una empresa en el módulo Empresas para ver su ficha tributaria y cronograma de vencimientos.</p>
    </div>
  )

  return (
    <div className="prog-page">
      <div className="prog-header">
        <h1 className="prog-title">⚠️ Alertas y Vencimientos</h1>
        <p className="prog-sub">Ficha tributaria del RUC y cronograma oficial de vencimientos SUNAT, con el vencimiento del SIRE (día hábil anterior).</p>
      </div>

      <div className="form-group" style={{ maxWidth: 420 }}>
        <label className="form-label">Empresa</label>
        <select className="form-input" value={sel?.id || ''}
          onChange={(e) => setSel(empresas.find((x) => x.id === Number(e.target.value)))}>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc} — {e.ruc}</option>)}
        </select>
      </div>

      {sel && <RucCard empresa={sel} onSync={handleSyncRuc} syncing={syncing} />}

      {venc?.proximo && (
        <div className="venc-next">
          <div className="venc-next-label">🔔 Próximo vencimiento</div>
          <div className="venc-next-grid">
            <div><div className="venc-next-k">Período</div><div className="venc-next-v">{venc.proximo.periodo}</div></div>
            <div><div className="venc-next-k">📄 Declaración (IGV-Renta)</div><div className="venc-next-v">{fmtFecha(venc.proximo.vencimiento_declaracion)}</div></div>
            <div><div className="venc-next-k">📚 SIRE (Compras/Ventas)</div><div className="venc-next-v">{fmtFecha(venc.proximo.vencimiento_sire)}</div></div>
            <div><div className="venc-next-k">Faltan</div><div className="venc-next-v"><EstadoVenc v={venc.proximo} /></div></div>
          </div>
        </div>
      )}

      <div className="prog-card" style={{ maxWidth: 'none', marginTop: 16 }}>
        <div className="prog-card-title" style={{ marginBottom: 14 }}>
          📅 Cronograma {venc?.anio || ''} {venc && <span style={{ fontWeight: 400, color: 'var(--gray-600)', fontSize: 12 }}>· Último dígito RUC: {venc.ultimo_digito}</span>}
        </div>
        {loadingVenc ? <div style={{ color: 'var(--gray-600)', fontSize: 13 }}>Consultando cronograma oficial SUNAT...</div>
          : err ? <div className="error-msg">⚠️ {err}</div>
          : venc?.vencimientos?.length ? (
            <div className="venc-table">
              <div className="venc-row venc-row-head">
                <div>Período tributario</div>
                <div>📄 Declaración</div>
                <div>📚 SIRE</div>
                <div style={{ textAlign: 'right' }}>Estado</div>
              </div>
              {venc.vencimientos.map((v) => (
                <div className={`venc-row ${v.estado}`} key={v.periodo_mes}>
                  <div className="venc-periodo">{v.periodo}</div>
                  <div>{fmtFecha(v.vencimiento_declaracion)}</div>
                  <div>{fmtFecha(v.vencimiento_sire)}</div>
                  <div style={{ textAlign: 'right' }}><EstadoVenc v={v} /></div>
                </div>
              ))}
            </div>
          ) : <div style={{ color: 'var(--gray-600)', fontSize: 13 }}>Sin datos.</div>}
        <div className="venc-foot">Fuente: Cronograma oficial SUNAT (Res. 281-2022/SUNAT). El SIRE vence el día hábil anterior a la declaración.</div>
      </div>
    </div>
  )
}
