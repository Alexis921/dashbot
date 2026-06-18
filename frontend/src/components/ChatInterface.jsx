import { useState, useEffect, useRef, useCallback } from 'react'
import NotificationCard from './NotificationCard'
import { apiSync, apiSendEmail, apiMarkRead } from '../api'

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
        <button className="btn-quick" style={{ borderColor: '#c8102e', color: '#c8102e' }} onClick={onSendEmail}>
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

export default function ChatInterface({ session, onLogout }) {
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
    addBot(
      <span>
        ¡Hola! Soy <strong>Dashbot</strong> 👋<br />
        Conectado con RUC <strong>{session.ruc}</strong>.
        {session.demo && <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, marginLeft: 6 }}>DEMO</span>}<br /><br />
        Sincronizando tu buzón SUNAT...
      </span>
    )
    handleSync()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setTyping(true)
    try {
      const data = await apiSync(session.session_id)
      setTyping(false)

      // Error de conexión real a SUNAT
      if (!data.success && data.error) {
        const isCredErr = data.error_type === 'credenciales'
        addBot(
          <div style={{ background: '#fff0f0', border: '1px solid #fca5a5', borderLeft: '4px solid #d92d20', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 8 }}>
              {isCredErr ? '🔐 Credenciales incorrectas' : '⚠️ No se pudo conectar a SUNAT'}
            </div>
            <div style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6, marginBottom: 12 }}>
              {data.error}
            </div>
            {!isCredErr && (
              <div style={{ fontSize: 12, color: '#9a3412', background: '#fff7ed', borderRadius: 6, padding: '8px 12px' }}>
                💡 <strong>¿Por qué ocurre esto?</strong> El portal SOL de SUNAT usa JavaScript y protecciones anti-bot que bloquean el acceso directo.
                Estamos trabajando en una solución con navegador automatizado (Playwright).
                <br/><br/>
                Puedes usar el <strong>modo demo</strong> para ver cómo funciona el sistema mientras tanto.
              </div>
            )}
            {isCredErr && (
              <div style={{ fontSize: 12, color: '#1e40af', background: '#eff6ff', borderRadius: 6, padding: '8px 12px' }}>
                💡 Verifica tu RUC, usuario SOL y contraseña. La contraseña SOL es diferente a la clave SUNAT.
              </div>
            )}
          </div>
        )
        return
      }

      setNotifications(data.notifications || [])

      addBot(
        <SummaryCard
          summary={data.ai_summary}
          notifications={data.notifications || []}
          onSendEmail={() => setShowEmailModal(true)}
        />
      )

      if ((data.notifications || []).length > 0) {
        addBot(
          <div>
            <p style={{ marginBottom: 10, fontWeight: 600, color: '#0d1b3e' }}>
              📬 {data.new_count > 0 ? `${data.new_count} nueva(s) notificación(es) del buzón SUNAT:` : 'Notificaciones sincronizadas:'}
            </p>
            <div className="notif-list">
              {[...(data.notifications || [])]
                .sort((a, b) => (b.is_urgent ? 1 : 0) - (a.is_urgent ? 1 : 0))
                .map((n) => (
                  <NotificationCard key={n.id} notif={n} onMarkRead={handleMarkRead} sessionId={session.session_id} />
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

  async function handleMarkRead(notifId) {
    await apiMarkRead(session.session_id, [notifId])
    setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, status: 'leido' } : n))
    addBot('✓ Notificación marcada como leída.')
  }

  async function handleSendEmail(email) {
    setEmailLoading(true)
    try {
      await apiSendEmail(session.session_id, email)
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
      if (!u.length) addBot('✅ No tienes notificaciones urgentes en este momento.')
      else addBot(<div><p style={{ marginBottom: 8, fontWeight: 600, color: '#c8102e' }}>🔴 {u.length} urgente(s):</p><div className="notif-list">{u.map((n) => <NotificationCard key={n.id} notif={n} onMarkRead={handleMarkRead} sessionId={session.session_id} />)}</div></div>)
    } else if (t.includes('correo') || t.includes('email') || t.includes('enviar')) {
      addUser(text); setShowEmailModal(true)
    } else if (t.includes('resumen') || t.includes('total') || t.includes('cuántas')) {
      addUser(text)
      const urgent = notifications.filter((n) => n.is_urgent).length
      const nuevo = notifications.filter((n) => n.status === 'nuevo').length
      addBot(<div>📊 <strong style={{ color: '#0d1b3e' }}>Estado del buzón SUNAT — RUC {session.ruc}</strong><br /><br />🔴 Urgentes: <strong>{urgent}</strong><br />📬 Sin leer: <strong>{nuevo}</strong><br />📋 Total: <strong>{notifications.length}</strong></div>)
    } else if (t.includes('hola') || t.includes('ayuda')) {
      addUser(text)
      addBot(<span>Puedo ayudarte con:<br /><br />🔄 <strong>Sincronizar</strong> — Actualizar notificaciones SUNAT<br />🔴 <strong>Urgentes</strong> — Solo las prioritarias<br />📊 <strong>Resumen</strong> — Estado general<br />📧 <strong>Enviar correo</strong> — Resumen por email</span>)
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
        {typing && <TypingMsg />}
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
