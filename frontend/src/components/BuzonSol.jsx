import { useState, useEffect, useRef } from 'react'
import NotificationCard from './NotificationCard'
import { apiListEmpresas, apiSyncEmpresa, apiSendEmail, apiChat } from '../api'

const now = () => new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })

const FRASES_SYNC = [
  '🔐 Conectando de forma segura con SUNAT…',
  '📬 Abriendo tu buzón electrónico SOL…',
  '🔎 Leyendo tus notificaciones…',
  '🚨 Detectando lo urgente por ti…',
  '🧠 Analizando con inteligencia artificial…',
  '📅 Ordenando todo de lo más reciente a lo más antiguo…',
  '💪 ¡Tú tranquilo, Dashbot se encarga del trabajo pesado!',
  '✨ Casi listo… preparando tu resumen ejecutivo.',
]

function SyncLoader() {
  const [prog, setProg] = useState(6)
  const [fi, setFi] = useState(0)
  useEffect(() => {
    const p = setInterval(() => setProg((x) => Math.min(94, x + (94 - x) * 0.06 + 0.4)), 350)
    const f = setInterval(() => setFi((i) => (i + 1) % FRASES_SYNC.length), 2500)
    return () => { clearInterval(p); clearInterval(f) }
  }, [])
  return (
    <div className="sync-loader">
      <div className="sl-track">
        <div className="sl-bot" style={{ left: `calc(${prog}% - 16px)` }}>🤖</div>
        <div className="sl-bar"><div className="sl-fill" style={{ width: `${prog}%` }} /></div>
      </div>
      <div className="sl-frase" key={fi}>{FRASES_SYNC[fi]}</div>
      <div className="sl-sub">Esto puede tardar unos segundos. Estamos trayendo todo desde SUNAT…</div>
    </div>
  )
}

function EmailModal({ onClose, onSend, loading }) {
  const [email, setEmail] = useState('')
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>📧 Enviar Resumen por Correo</h3>
        <div className="form-group">
          <label className="form-label">Correo electrónico destino</label>
          <input className="form-input" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="contador@empresa.com" />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-accent" disabled={!email || loading} onClick={() => onSend(email)}>
            {loading ? '⏳ Enviando...' : '📤 Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BuzonSol({ user, initialEmpresa = null, onGoModule }) {
  const [empresas, setEmpresas] = useState([])
  const [sel, setSel] = useState(initialEmpresa)
  const [notifications, setNotifications] = useState([])
  const [summary, setSummary] = useState('')
  const [lastSync, setLastSync] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [filtro, setFiltro] = useState('todas') // todas | urgentes | nuevas
  const [chat, setChat] = useState([])
  const [input, setInput] = useState('')
  const [pensando, setPensando] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const chatEndRef = useRef(null)

  const nombre = (user?.nombre || '').split(' ')[0] || ''

  useEffect(() => { apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {}) }, [])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat, pensando, syncing])
  useEffect(() => {
    addBot(`¡Hola${nombre ? `, ${nombre}` : ''}! 👋 Soy Dashbot. Elige una empresa arriba y pulsa Extraer para leer su buzón SOL. También puedes hacerme cualquier consulta tributaria.`)
    if (initialEmpresa) extraer(initialEmpresa)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addBot(txt) { setChat((c) => [...c, { de: 'bot', txt, time: now() }]) }
  function addYo(txt) { setChat((c) => [...c, { de: 'yo', txt, time: now() }]) }

  async function extraer(empresa) {
    if (syncing) return
    setSel(empresa); setFiltro('todas'); setSyncing(true)
    const label = empresa.alias || empresa.razon_social || `RUC ${empresa.ruc}`
    addBot(`🛰️ Extrayendo el buzón SOL de ${label}…`)
    try {
      const data = await apiSyncEmpresa(empresa.id)
      if (!data.success && data.error) {
        const tipo = data.error_type === 'credenciales' ? '🔐 Credenciales incorrectas'
          : data.error_type === 'captcha' || data.error_type === 'login_incomplete' ? '🤖 SUNAT pide verificación'
          : '⚠️ No se pudo conectar a SUNAT'
        addBot(`${tipo}: ${data.error}`)
        setNotifications([]); setSummary('')
        return
      }
      const notifs = (data.notifications || [])
        .sort((a, b) => new Date(b.date_received || 0) - new Date(a.date_received || 0))
      setNotifications(notifs)
      setSummary(data.ai_summary || '')
      setLastSync(new Date())
      const urg = notifs.filter((n) => n.is_urgent).length
      addBot(`✅ Buzón de ${label} sincronizado: ${notifs.length} notificación(es), ${urg} urgente(s)${data.new_count ? `, ${data.new_count} nueva(s)` : ''}. Las tienes en el panel de la derecha 👉`)
      if (urg > 0) addBot(`🚨 Atención: hay ${urg} notificación(es) urgente(s). Puedo enviarte el resumen por correo — escribe «correo» o usa el botón.`)
    } catch (err) {
      addBot(`❌ Error al conectar: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  function handleMarkRead(notifId) {
    setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, status: 'leido' } : n))
  }

  async function handleSendEmail(email) {
    if (!sel) return
    setEmailLoading(true)
    try {
      await apiSendEmail(sel.id, email)
      setShowEmailModal(false)
      addBot(`✅ Resumen enviado exitosamente a ${email}`)
    } catch (err) {
      addBot(`❌ Error al enviar: ${err.message}`)
    } finally { setEmailLoading(false) }
  }

  async function comando(texto) {
    const t = texto.toLowerCase().trim()
    addYo(texto)
    if (t.includes('sincroniz') || t.includes('actualiz') || t.includes('extra')) {
      if (sel) { extraer(sel) } else { addBot('Primero elige una empresa arriba 👆 y pulso Extraer por ti.') }
      return
    }
    if (t.includes('urgent')) {
      const u = notifications.filter((n) => n.is_urgent)
      setFiltro('urgentes')
      addBot(u.length ? `🔴 Tienes ${u.length} urgente(s) — te las filtré en el panel de la derecha.` : '✅ No tienes notificaciones urgentes en este momento.')
      return
    }
    if (t.includes('correo') || t.includes('email') || t.includes('enviar')) {
      if (sel) setShowEmailModal(true)
      else addBot('Extrae primero el buzón de una empresa para poder enviarte su resumen.')
      return
    }
    if (t.includes('resumen') || t.includes('total') || t.includes('cuánt') || t.includes('cuant')) {
      if (!sel) { addBot('Aún no extraje ningún buzón. Elige una empresa arriba 👆.'); return }
      const urgent = notifications.filter((n) => n.is_urgent).length
      const nuevo = notifications.filter((n) => n.status === 'nuevo').length
      addBot(`📊 Estado del buzón:\n🔴 Urgentes: ${urgent}\n📬 Sin leer: ${nuevo}\n📋 Total: ${notifications.length}${summary ? `\n\n🧠 ${summary}` : ''}`)
      return
    }
    // Consulta libre → IA tributaria
    setPensando(true)
    try {
      const hist = chat.filter((m) => m.de !== 'sys').slice(-8)
        .map((m) => ({ role: m.de === 'yo' ? 'user' : 'assistant', content: m.txt }))
      const r = await apiChat(texto, hist)
      addBot(r.respuesta)
    } catch (e) {
      addBot(`⚠️ ${e.message}`)
    } finally { setPensando(false) }
  }

  function handleSend() {
    const q = input.trim()
    if (!q || pensando) return
    setInput('')
    comando(q)
  }

  const filtradas = filtro === 'urgentes' ? notifications.filter((n) => n.is_urgent)
    : filtro === 'nuevas' ? notifications.filter((n) => n.status === 'nuevo')
    : notifications
  const nUrg = notifications.filter((n) => n.is_urgent).length
  const nNue = notifications.filter((n) => n.status === 'nuevo').length

  return (
    <div className="cm-page">
      <div className="cm-inner">
        <div className="empresas-header">
          <div>
            <h1 className="empresas-title">📬 Buzón SOL</h1>
            <p className="empresas-sub">Elige una empresa, extrae su buzón SUNAT y revisa las notificaciones con análisis de IA.</p>
          </div>
        </div>

        {/* Tira de empresas a extraer */}
        <div className="bz-emps">
          {empresas.map((e) => {
            const activa = sel?.id === e.id
            return (
              <button key={e.id} className={`bz-emp ${activa ? 'bz-emp-on' : ''}`} onClick={() => extraer(e)} disabled={syncing}>
                <div className="bz-emp-av">{(e.razon_social || e.ruc)[0]}</div>
                <div className="bz-emp-info">
                  <div className="bz-emp-name">{e.alias || e.razon_social || 'Sin nombre'}</div>
                  <div className="bz-emp-ruc">RUC {e.ruc}</div>
                </div>
                <span className={`bz-emp-go ${activa ? 'on' : ''}`}>{activa ? (syncing ? '⏳' : '✓ Extraído') : '🛰️ Extraer'}</span>
              </button>
            )
          })}
          <button className="bz-emp bz-emp-add" onClick={() => onGoModule('empresas')}>
            <div className="bz-emp-av bz-emp-av-add">+</div>
            <div className="bz-emp-info">
              <div className="bz-emp-name">Agregar empresa</div>
              <div className="bz-emp-ruc">Registra un nuevo RUC</div>
            </div>
          </button>
        </div>

        <div className="bz-cols">
          {/* Chat de búsqueda SOL */}
          <div className="bz-chat">
            <div className="hbot-head">
              <div className="hbot-avatar"><img src="/robot.png" alt="DashBot" className="hbot-img" /><span className="hbot-ring" /></div>
              <div>
                <div className="hbot-title">Chat de búsqueda SOL</div>
                <div className="hbot-sub"><span className="cm-online" />{syncing ? 'Extrayendo buzón…' : 'Comandos y consultas tributarias'}</div>
              </div>
            </div>
            <div className="bz-chat-msgs">
              {chat.map((m, i) => (
                m.de === 'yo'
                  ? <div className="dp-bot-yo" key={i}>{m.txt}</div>
                  : <div className="hbot-msg dp-bot-msg" key={i}>{m.txt}</div>
              ))}
              {pensando && <div className="hbot-msg">🤖 Pensando…</div>}
              <div ref={chatEndRef} />
            </div>
            <div className="bz-chips">
              {['🔄 Sincronizar', '🔴 Urgentes', '📊 Resumen', '📧 Correo'].map((c) => (
                <button key={c} className="hbot-tip" onClick={() => comando(c.replace(/^[^\s]+\s/, ''))} disabled={syncing || pensando}>{c}</button>
              ))}
            </div>
            <div className="hbot-in">
              <input value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ej. urgentes, resumen, ¿qué es una esquela?…" disabled={pensando} />
              <button onClick={handleSend} disabled={pensando || !input.trim()}>➤</button>
            </div>
          </div>

          {/* Pantalla de notificaciones (separada) */}
          <div className="bz-panel">
            <div className="bz-panel-head">
              <div>
                <div className="bz-panel-title">🗂️ Notificaciones{sel ? ` · ${sel.alias || sel.razon_social || sel.ruc}` : ''}</div>
                {lastSync && <div className="bz-panel-sub">Última sincronización: {lastSync.toLocaleString('es-PE')}</div>}
              </div>
              {sel && !syncing && (
                <button className="bz-resync" onClick={() => extraer(sel)} title="Volver a extraer">🔄</button>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="bz-filtros">
                <button className={`bz-filtro ${filtro === 'todas' ? 'on' : ''}`} onClick={() => setFiltro('todas')}>📋 Todas ({notifications.length})</button>
                <button className={`bz-filtro urg ${filtro === 'urgentes' ? 'on' : ''}`} onClick={() => setFiltro('urgentes')}>🔴 Urgentes ({nUrg})</button>
                <button className={`bz-filtro ${filtro === 'nuevas' ? 'on' : ''}`} onClick={() => setFiltro('nuevas')}>📬 Sin leer ({nNue})</button>
              </div>
            )}

            <div className="bz-panel-body">
              {syncing ? <SyncLoader />
                : !sel ? (
                  <div className="empresas-empty" style={{ border: 'none' }}>
                    <div style={{ fontSize: 40 }}>🛰️</div>
                    <h3>Elige una empresa para extraer</h3>
                    <p>Haz clic en <strong>🛰️ Extraer</strong> sobre cualquiera de tus empresas y aquí verás sus notificaciones del buzón SOL.</p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="empresas-empty" style={{ border: 'none' }}>
                    <div style={{ fontSize: 40 }}>✅</div>
                    <h3>Buzón sin notificaciones</h3>
                    <p>No encontramos notificaciones en el buzón SOL de esta empresa.</p>
                  </div>
                ) : (
                  <>
                    {summary && filtro === 'todas' && (
                      <div className="bz-resumen">
                        <div className="bz-resumen-t">🧠 Resumen ejecutivo IA</div>
                        <div className="bz-resumen-x">{summary}</div>
                        <button className="btn-quick" style={{ marginTop: 10, borderColor: '#00A651', color: '#00A651' }} onClick={() => setShowEmailModal(true)}>
                          📧 Enviar resumen por correo
                        </button>
                      </div>
                    )}
                    <div className="notif-list">
                      {filtradas.map((n) => (
                        <NotificationCard key={n.id} notif={n} onMarkRead={handleMarkRead} empresaId={sel.id} />
                      ))}
                    </div>
                    {filtradas.length === 0 && (
                      <div className="empresas-empty" style={{ border: 'none' }}>
                        <p>No hay notificaciones con este filtro.</p>
                      </div>
                    )}
                  </>
                )}
            </div>
          </div>
        </div>
      </div>

      {showEmailModal && (
        <EmailModal onClose={() => setShowEmailModal(false)} onSend={handleSendEmail} loading={emailLoading} />
      )}
    </div>
  )
}
