import { useState, useEffect, useRef } from 'react'
import { apiListEmpresas, apiListObligaciones, apiChat } from '../api'

const SUGERENCIAS = [
  '¿Qué es la detracción y cuándo aplica?',
  '¿Cómo se calcula el vencimiento del SIRE?',
  '¿Qué pasa si declaro fuera de plazo?',
  '¿Qué multas evita pagar a tiempo?',
]

const fmtF = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : '—'

function Stat({ icon, num, label, color, bg }) {
  return (
    <div className="cm-stat" style={{ '--c': color, '--cbg': bg }}>
      <div className="cm-stat-ico">{icon}</div>
      <div>
        <div className="cm-stat-num">{num}</div>
        <div className="cm-stat-label">{label}</div>
      </div>
    </div>
  )
}

export default function CentroMando({ user, onOpenEmpresa, onGoModule }) {
  const [empresas, setEmpresas] = useState([])
  const [oblig, setOblig] = useState([])
  const [chat, setChat] = useState([])
  const [pregunta, setPregunta] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {})
    apiListObligaciones().then((d) => setOblig(d.obligaciones || [])).catch(() => {})
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat, loading])

  const abiertas = oblig.filter((o) => !['pagado', 'declarado', 'archivado'].includes(o.estado))
  const pendientes = abiertas.length
  const semana = abiertas.filter((o) => o.dias_restantes >= 0 && o.dias_restantes <= 7).length
  const vencidas = abiertas.filter((o) => o.dias_restantes < 0).length
  const proximos = abiertas.filter((o) => o.dias_restantes >= 0)
    .sort((a, b) => (a.fecha_vencimiento || '').localeCompare(b.fecha_vencimiento || '')).slice(0, 4)

  async function enviar(texto) {
    const q = (texto ?? pregunta).trim()
    if (!q || loading) return
    const hist = chat.map((m) => ({ role: m.role, content: m.content }))
    setChat((c) => [...c, { role: 'user', content: q }]); setPregunta(''); setLoading(true)
    try {
      const r = await apiChat(q, hist)
      setChat((c) => [...c, { role: 'assistant', content: r.respuesta }])
    } catch (e) {
      setChat((c) => [...c, { role: 'assistant', content: `⚠️ ${e.message}` }])
    } finally { setLoading(false) }
  }

  const nombre = (user?.nombre || '').split(' ')[0] || ''

  return (
    <div className="cm-page">
      <div className="cm-inner">
      <div className="cm-hero">
        <div className="cm-bot"><img src="/robot.png" alt="DashBot" className="cm-bot-img" /></div>
        <div>
          <div className="cm-hello">¡Hola{nombre ? `, ${nombre}` : ''}! 👋</div>
          <div className="cm-sub">Soy <strong>Dashbot</strong>, tu copiloto tributario. Aquí tienes tu panorama y puedes preguntarme lo que necesites.</div>
        </div>
      </div>

      <div className="cm-stats">
        <Stat icon="🏢" num={empresas.length} label="Empresas" color="#2563eb" bg="#dbeafe" />
        <Stat icon="📋" num={pendientes} label="Obligaciones pendientes" color="#0a9d63" bg="#d1fae5" />
        <Stat icon="⏰" num={semana} label="Vencen esta semana" color="#d97706" bg="#fef3c7" />
        <Stat icon="🚨" num={vencidas} label="Vencidas" color="#dc2626" bg="#fee2e2" />
      </div>

      <div className="cm-cols">
        <div className="cm-col">
          <div className="cm-col-h">🏢 Tus empresas <span className="cm-col-hint">elige una para ver su buzón SUNAT</span></div>
          <div className="cm-emp-grid">
            {empresas.map((e) => (
              <button key={e.id} className="cm-emp" onClick={() => onOpenEmpresa(e)}>
                <div className="cm-emp-av">{(e.razon_social || e.ruc)[0]}</div>
                <div className="cm-emp-info">
                  <div className="cm-emp-name">{e.alias || e.razon_social || 'Sin nombre'}</div>
                  <div className="cm-emp-ruc">RUC {e.ruc}</div>
                </div>
                <span className="cm-emp-go">Extraer →</span>
              </button>
            ))}
            <button className="cm-emp cm-emp-add" onClick={() => onGoModule('empresas')}>
              <div className="cm-emp-av cm-emp-av-add">+</div>
              <div className="cm-emp-info"><div className="cm-emp-name">Agregar empresa</div><div className="cm-emp-ruc">Registra un nuevo RUC</div></div>
            </button>
          </div>

          {proximos.length > 0 && (
            <>
              <div className="cm-col-h" style={{ marginTop: 18 }}>📅 Próximos vencimientos</div>
              <div className="cm-venc-list">
                {proximos.map((o) => (
                  <div key={o.id} className="cm-venc" onClick={() => onGoModule('agenda')}>
                    <span className="cm-venc-t">{o.titulo}</span>
                    <span className={`cm-venc-d ${o.dias_restantes <= 3 ? 'urgente' : ''}`}>{fmtF(o.fecha_vencimiento)} · {o.dias_restantes}d</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="cm-chat">
          <div className="cm-chat-h"><span className="cm-online" />💬 Pregúntale a Dashbot</div>
          <div className="cm-chat-msgs">
            {!chat.length && (
              <div className="cm-chat-empty">
                <p>Hazme una consulta tributaria. Por ejemplo:</p>
                <div className="cm-chips">
                  {SUGERENCIAS.map((s) => <button key={s} className="cm-chip" onClick={() => enviar(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {chat.map((m, i) => <div key={i} className={`cm-msg ${m.role}`}>{m.content}</div>)}
            {loading && <div className="cm-msg assistant">🤖 Pensando…</div>}
            <div ref={endRef} />
          </div>
          <div className="cm-chat-in">
            <input value={pregunta} onChange={(e) => setPregunta(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviar()} placeholder="Escribe tu consulta tributaria…" disabled={loading} />
            <button onClick={() => enviar()} disabled={loading || !pregunta.trim()}>➤</button>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
