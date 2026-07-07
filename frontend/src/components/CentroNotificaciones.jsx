import { useState, useEffect } from 'react'
import { apiDashboardNotificaciones } from '../api'

const S = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })

const NIVEL = {
  verde: { badge: '✅ Todo bajo control', cls: 'ok', frase: 'No hay urgencias. Dashbot sigue vigilando por ti.' },
  ambar: { badge: '🟡 Hay pendientes', cls: 'warn', frase: 'Tienes asuntos por revisar esta semana.' },
  rojo: { badge: '🚨 Atención requerida', cls: 'bad', frase: 'Hay asuntos urgentes que necesitan acción hoy.' },
}

const ORIGEN_CHIP = {
  buzon: { txt: '📬 Buzón SOL', cls: 'buzon' },
  declaraciones: { txt: '🧾 Declaraciones', cls: 'decl' },
  agenda: { txt: '📆 Agenda', cls: 'agenda' },
}

function Stat({ icon, num, label, color, bg }) {
  return (
    <div className="cm-stat" style={{ '--c': color, '--cbg': bg }}>
      <div className="cm-stat-ico">{icon}</div>
      <div><div className="cm-stat-num">{num}</div><div className="cm-stat-label">{label}</div></div>
    </div>
  )
}

function Dot({ estado, title }) {
  return <span className={`cn-dot cn-${estado}`} title={title} />
}

const fmtSync = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  const hoy = new Date().toDateString() === d.toDateString()
  return (hoy ? 'hoy ' : d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' ') +
    d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}

export default function CentroNotificaciones({ user, onGo, onGoModule }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiDashboardNotificaciones().then(setData).catch((e) => setError(e.message))
  }, [])

  const nombre = (user?.nombre || '').split(' ')[0] || ''

  if (error) return <div className="cm-page"><div className="cm-inner"><div className="empresas-empty">⚠️ {error}</div></div></div>
  if (!data) {
    return (
      <div className="cm-page"><div className="cm-inner">
        <div className="cm-hero">
          <div className="cm-bot"><img src="/robot.png" alt="DashBot" className="cm-bot-img" /></div>
          <div><div className="cm-hello">Cargando tu radar tributario…</div></div>
        </div>
      </div></div>
    )
  }

  const { semaforo, stats, portales, feed, radar } = data
  const nv = NIVEL[semaforo.nivel] || NIVEL.verde
  const sinEmpresas = radar.length === 0

  return (
    <div className="cm-page">
      <div className="cm-inner">
        {/* Semáforo global */}
        <div className="cm-hero cn-hero">
          <div className="cm-bot"><img src="/robot.png" alt="DashBot" className="cm-bot-img" /></div>
          <div style={{ flex: 1 }}>
            <div className="cm-hello">¡Hola{nombre ? `, ${nombre}` : ''}! 👋</div>
            <div className="cm-sub">
              {semaforo.asuntos > 0
                ? <>Tienes <strong>{semaforo.asuntos} asunto{semaforo.asuntos !== 1 ? 's' : ''}</strong> que requieren tu atención. {nv.frase}</>
                : nv.frase}
            </div>
          </div>
          <span className={`cn-badge ${nv.cls}`}>{nv.badge}</span>
        </div>

        {/* Stats */}
        <div className="cm-stats">
          <Stat icon="🔴" num={stats.urgentes} label="Urgentes sin leer" color="#dc2626" bg="#fee2e2" />
          <Stat icon="🧾" num={S(stats.deuda_pendiente)} label="Deuda pendiente 621" color="#b45309" bg="#fef3c7" />
          <Stat icon="⏰" num={stats.vencen_semana} label="Vencen esta semana" color="#2563eb" bg="#dbeafe" />
          <Stat icon="🏢" num={stats.empresas} label="Empresas monitoreadas" color="#0a9d63" bg="#d1fae5" />
        </div>

        {/* Tarjetas portal */}
        <div className="cn-portales">
          <button className={`cn-portal ${stats.urgentes ? 'cn-portal-alerta' : ''}`} onClick={() => onGo('buzon')}>
            <div className="cn-portal-head">
              <span className="cn-portal-ico">📬</span>
              <span className="cn-portal-title">Buzón SOL</span>
              <Dot estado={stats.urgentes ? 'rojo' : stats.nuevas ? 'ambar' : stats.notifs ? 'verde' : 'gris'}
                title={stats.urgentes ? 'Hay urgentes' : 'Al día'} />
            </div>
            <div className="cn-portal-line">{stats.notifs} notificación(es) · <b>{stats.urgentes} urgente(s)</b></div>
            <div className="cn-portal-sub">{portales.buzon.ultima_sync ? `Última extracción: ${fmtSync(portales.buzon.ultima_sync)}` : 'Aún sin extracciones'}</div>
            <span className="cn-portal-go">Ir al buzón →</span>
          </button>

          <button className="cn-portal" onClick={() => onGo('sunafil')}>
            <div className="cn-portal-head">
              <span className="cn-portal-ico">🦺</span>
              <span className="cn-portal-title">SUNAFIL</span>
              <Dot estado="gris" title="Próximamente" />
            </div>
            <div className="cn-portal-line">Inspecciones laborales</div>
            <div className="cn-portal-sub">Módulo en construcción</div>
            <span className="cn-portal-go">Ver estado →</span>
          </button>

          <button className={`cn-portal ${portales.declaraciones.pendiente > 0 ? 'cn-portal-alerta' : ''}`} onClick={() => onGo('declaraciones')}>
            <div className="cn-portal-head">
              <span className="cn-portal-ico">🧾</span>
              <span className="cn-portal-title">Declaraciones</span>
              <Dot estado={portales.declaraciones.pendiente > 0 ? 'rojo' : 'verde'}
                title={portales.declaraciones.pendiente > 0 ? 'Deuda pendiente' : 'Al día'} />
            </div>
            <div className="cn-portal-line">
              {portales.declaraciones.pendiente > 0
                ? <b style={{ color: '#ff8f8f' }}>{S(portales.declaraciones.pendiente)} sin pagar · {portales.declaraciones.meses.length} mes(es)</b>
                : `Sin deuda pendiente en ${portales.declaraciones.anio}`}
            </div>
            <div className="cn-portal-sub">{portales.declaraciones.pendiente > 0 ? '⚠️ Riesgo de cobranza coactiva' : 'Declarado vs pagado al día'}</div>
            <span className="cn-portal-go">Ver deudas →</span>
          </button>
        </div>

        {sinEmpresas && (
          <div className="empresas-empty" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 38 }}>🏢</div>
            <h3>Registra tu primera empresa</h3>
            <p>El radar se enciende cuando registras un RUC y extraes su buzón.</p>
            <button className="btn-accent" style={{ marginTop: 12 }} onClick={() => onGoModule('empresas')}>＋ Agregar empresa</button>
          </div>
        )}

        {/* Feed + Radar */}
        <div className="cn-cols">
          <div className="cn-card">
            <div className="cn-card-h">🔔 Feed de alertas <span className="cn-card-hint">todas las fuentes</span></div>
            {feed.length === 0 ? (
              <div className="cn-vacio">✅ Sin alertas por ahora. Dashbot te avisará aquí cuando algo requiera tu atención.</div>
            ) : (
              <div className="cn-feed">
                {feed.map((f, i) => {
                  const chip = ORIGEN_CHIP[f.origen] || ORIGEN_CHIP.agenda
                  return (
                    <button key={i} className={`cn-feed-item cn-b-${f.nivel}`} onClick={() => f.sub ? onGo(f.sub) : onGoModule('agenda')}>
                      <div className="cn-feed-txt">
                        <div className="cn-feed-t">{f.titulo}</div>
                        <div className="cn-feed-m">{[f.empresa, f.detalle].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span className={`cn-chip ${chip.cls}`}>{chip.txt}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="cn-card">
            <div className="cn-card-h">🛰️ Radar de riesgo <span className="cn-card-hint">por empresa</span></div>
            {radar.length === 0 ? (
              <div className="cn-vacio">Sin empresas registradas todavía.</div>
            ) : (
              <>
                <div className="cn-radar-head"><span /><span>SOL</span><span>SUNAFIL</span><span>Deudas</span></div>
                <div className="cn-radar">
                  {radar.map((r) => (
                    <div className="cn-radar-row" key={r.empresa_id} title={r.pendiente ? `Deuda pendiente: ${S(r.pendiente)}` : undefined}>
                      <div className="cn-radar-emp">
                        <div className="cn-radar-name">{r.nombre}</div>
                        <div className="cn-radar-ruc">RUC {r.ruc}</div>
                      </div>
                      <Dot estado={r.sol} title={`Buzón: ${r.sol}`} />
                      <Dot estado={r.sunafil} title="SUNAFIL: próximamente" />
                      <Dot estado={r.deudas} title={r.pendiente ? `Pendiente ${S(r.pendiente)}` : 'Deudas'} />
                    </div>
                  ))}
                </div>
                <div className="cn-leyenda">
                  <span><Dot estado="verde" /> Al día</span>
                  <span><Dot estado="ambar" /> Por revisar</span>
                  <span><Dot estado="rojo" /> Riesgo</span>
                  <span><Dot estado="gris" /> Sin datos</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
