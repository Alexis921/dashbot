import { useState } from 'react'
import LoginForm from './components/LoginForm'
import ChatInterface from './components/ChatInterface'
import { apiLogout } from './api'

export default function App() {
  const [session, setSession] = useState(null)

  async function handleLogout() {
    if (session?.session_id) {
      try { await apiLogout(session.session_id) } catch (_) {}
    }
    setSession(null)
  }

  if (!session) return <LoginForm onLogin={setSession} />

  return (
    <div className="app-shell">
      <ChatInterface session={session} onLogout={handleLogout} />
    </div>
  )
}
