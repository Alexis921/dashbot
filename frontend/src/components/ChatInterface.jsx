import { useState, useEffect, useRef, useCallback } from 'react'
import NotificationCard from './NotificationCard'
import { apiSyncEmpresa, apiDemoSync, apiSendEmail } from '../api'

function now() {
  return new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}

function BotMsg({ children, time }) {
  return (
    <div className="msg bot">
      <div className="msg-avatar">🤖</div>
      <div>
        <div className="msg-bubble">{children}</div>
        <div className="msg-time">{time || now()}</div>
      </div>
    </div>
  )
}

function UserMsg({ text, time }) {
  return (
    <div className="msg user">
      <div className="msg-avatar" style={{ background: '#1a56a0' }}>👤</div>
      <div>
        <div className="msg-bubble">{text}</div>
        <div className="msg-time" style={{ textAlign: 'right' }}>{time || now()}</div>
      </div>
    </div>
  )
}

function TypingMsg() {
  return (
    <div className="msg bot">
      <div className="msg-avatar">🤖</div>
      <div className="msg-bubble">
        <div className="typing-dots"><span /><span /><span /></div>
      </div>
    </div>
  )
}

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

function SummaryCard({ summary, notifications, onSendEmail }) {
  const urgent = notifications.filter((n) => n.is_urgent).length
  const pending = notifications.filter((n) => n.status === 'nuevo').length
  return (
    <div className="summary-card">
      <div className="summary-title">📊 Resumen Ejecutivo</div>
      <div className="stats-row">
        <div className="stat-box urgent"><div className="stat-num">{urgent}</div><div className="stat-label">URGENTES</div></div>
        <div className="stat-box pending"><div className="stat-num">{pending}</div><div className="stat-label">PENDIENTES</div></div>
        <div className="stat-box total"><div className="stat-num">{notifications.length}</div><div className="stat-label">TOTAL</div></div>
      </div>
      <div className="summary-text" style={{ marginTop: 12 }}>{summary}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn-quick" style={{ borderColor: '#00A651', color: '#00A651' }} onClick={onSendEmail}>
          📧 Enviar resumen por correo
        </button>
      </div>
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

export default function ChatInterface({ empresa, demoMode = false }) {
  const empresaId = empresa?.id
  const [messages, setMessages] = useState([])
  const [notifications, setNotifications] = useState([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const bottomRef = useRef(null)

  const addBot = useCallback((content) => {
    setMessages((m) => [...m, { id: Date.now() + Math.random(), role: 'bot', content, time: now() }])
  }, [])
  const addUser = useCallback((text) => {
    setMessages((m) => [...m, { id: Date.now(), role: 'user', text, time: now() }])
  }, [])

  useEffect(() => {
    const label = demoMode ? 'datos de demostración'
      : (empresa?.alias || empresa?.razon_social || `RUC ${empresa?.ruc}`)
    addBot(
      <span>
        ¡Hola! Soy <strong>Dashbot</strong> 👋<br />
        {demoMode
          ? <>Estás viendo el <strong>modo demo</strong>.</>
          : <>Conectando con <strong>{label}</strong>.</>}
        <br /><br />Sincronizando buzón SUNAT...
      </span>
    )
    handleSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setTyping(true)
    try {
      const data = demoMode ? await apiDemoSync() : await apiSyncEmpresa(empresaId)
      setTyping(false)

      if (!data.success && data.error) {
        const isCredErr = data.error_type === 'credenciales'
        const isCaptcha = data.error_type === 'captcha' || data.error_type === 'login_incomplete'
        addBot(
          <div style={{ background: '#fff0f0', border: '1px solid #fca5a5', borderLeft: '4px solid #d92d20', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 8 }}>
              {isCredErr ? '🔐 Credenciales incorrectas' : isCaptcha ? '🤖 SUNAT pide verificación' : '⚠️ No se pudo conectar a SUNAT'}
            </div>
            <div style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6 }}>{data.error}</div>
          </div>
        )
        return
      }

      setNotifications(data.notifications || [])
      addBot(<SummaryCard summary={data.ai_summary} notifications={data.notifications || []} onSendEmail={() => setShowEmailModal(true)} />)

      if ((data.notifications || []).length > 0) {
        addBot(
          <div>
            <p style={{ marginBottom: 10, fontWeight: 600, color: '#1B3A6B' }}>
              📬 {data.new_count > 0 ? `${data.new_count} nueva(s) notificación(es):` : 'Notificaciones sincronizadas:'}
            </p>
            <div className="notif-list">
              {[...(data.notifications || [])]
                .sort((a, b) => new Date(b.date_received || 0) - new Date(a.date_received || 0))
                .map((n) => (
                  <NotificationCard key={n.id} notif={n} onMarkRead={handleMarkRead} empresaId={empresaId} demoMode={demoMode} />
                ))}
            </div>
          </div>
        )
      } else {
        addBot('✅ No hay notificaciones nuevas en el buzón SUNAT.')
      }
      addBot(`🕐 Última sincronización: ${new Date().toLocaleString('es-PE')}`)
    } catch (err) {
      setTyping(false)
      addBot(`❌ Error al conectar: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  function handleMarkRead(notifId) {
    setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, status: 'leido' } : n))
    addBot('✓ Notificación marcada como leída.')
  }

  async function handleSendEmail(email) {
    if (demoMode) {
      addBot('ℹ️ El envío de correo está disponible al registrar una empresa real.')
      setShowEmailModal(false)
      return
    }
    setEmailLoading(true)
    try {
      await apiSendEmail(empresaId, email)
      setShowEmailModal(false)
      addBot(`✅ Resumen enviado exitosamente a ${email}`)
    } catch (err) {
      addBot(`❌ Error al enviar: ${err.message}`)
    } finally {
      setEmailLoading(false)
    }
  }

  function handleCommand(text) {
    const t = text.toLowerCase().trim()
    if (t.includes('sincroniz') || t.includes('actualiz') || t.includes('refres')) {
      addUser(text); handleSync()
    } else if (t.includes('urgent') || t.includes('import')) {
      addUser(text)
      const u = notifications.filter((n) => n.is_urgent)
        .sort((a, b) => new Date(b.date_received || 0) - new Date(a.date_received || 0))
      if (!u.length) addBot('✅ No tienes notificaciones urgentes en este momento.')
      else addBot(<div><p style={{ marginBottom: 8, fontWeight: 600, color: '#dc3545' }}>🔴 {u.length} urgente(s):</p><div className="notif-list">{u.map((n) => <NotificationCard key={n.id} notif={n} onMarkRead={handleMarkRead} empresaId={empresaId} demoMode={demoMode} />)}</div></div>)
    } else if (t.includes('correo') || t.includes('email') || t.includes('enviar')) {
      addUser(text); setShowEmailModal(true)
    } else if (t.includes('resumen') || t.includes('total') || t.includes('cuánt')) {
      addUser(text)
      const urgent = notifications.filter((n) => n.is_urgent).length
      const nuevo = notifications.filter((n) => n.status === 'nuevo').length
      addBot(<div>📊 <strong style={{ color: '#1B3A6B' }}>Estado del buzón SUNAT</strong><br /><br />🔴 Urgentes: <strong>{urgent}</strong><br />📬 Sin leer: <strong>{nuevo}</strong><br />📋 Total: <strong>{notifications.length}</strong></div>)
    } else {
      addUser(text)
      addBot('Prueba: sincronizar, urgentes, resumen o enviar correo.')
    }
  }

  function handleSend() {
    if (!input.trim()) return
    handleCommand(input.trim())
    setInput('')
  }

  return (
    <>
      <div className="chat-area">
        {messages.map((m) =>
          m.role === 'bot'
            ? <BotMsg key={m.id} time={m.time}>{m.content}</BotMsg>
            : <UserMsg key={m.id} text={m.text} time={m.time} />
        )}
        {typing && (syncing ? <SyncLoader /> : <TypingMsg />)}
        <div ref={bottomRef} />
      </div>

      <div className="quick-actions">
        {[
          { label: '🔄 Sincronizar', cmd: 'Sincronizar notificaciones' },
          { label: '🔴 Urgentes', cmd: 'Ver urgentes' },
          { label: '📊 Resumen', cmd: 'Ver resumen' },
          { label: '📧 Enviar correo', cmd: 'Enviar correo' },
        ].map((a) => (
          <button key={a.cmd} className="btn-quick" onClick={() => handleCommand(a.cmd)}>{a.label}</button>
        ))}
      </div>

      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Escribe un comando o pregunta..."
          disabled={syncing}
        />
        <button className="btn-send" onClick={handleSend} disabled={!input.trim() || syncing}>➤</button>
      </div>

      {showEmailModal && (
        <EmailModal onClose={() => setShowEmailModal(false)} onSend={handleSendEmail} loading={emailLoading} />
      )}
    </>
  )
}
