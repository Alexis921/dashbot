import { useState } from 'react'
import LoginForm from './components/LoginForm'
import ChatInterface from './components/ChatInterface'
import { apiLogout } from './api'

const MENU = [
  { id: 'notificaciones', label: 'Notificaciones', icon: '🔔' },
  { id: 'dashboard',      label: 'Dashboard',      icon: '📊' },
  { id: 'empresas',       label: 'Empresas',       icon: '🏢' },
  { id: 'alertas',        label: 'Alertas',        icon: '⚠️'  },
  { id: 'programacion',   label: 'Programación',   icon: '🕐' },
  { id: 'equipo',         label: 'Equipo',         icon: '👥' },
  { id: 'mi-plan',        label: 'Mi Plan',        icon: '💎' },
  { id: 'configuracion',  label: 'Configuración',  icon: '⚙️'  },
  { id: 'sugerencias',    label: 'Sugerencias',    icon: '💡' },
]

function ComingSoon({ title, icon }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-icon">{icon}</div>
      <h2>{title}</h2>
      <p>Este módulo estará disponible muy pronto. Estamos trabajando para traerte la mejor experiencia.</p>
      <div className="coming-soon-badge">🚀 Próximamente</div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [activeModule, setActiveModule] = useState('notificaciones')

  async function handleLogout() {
    if (session?.session_id) {
      try { await apiLogout(session.session_id) } catch (_) {}
    }
    setSession(null)
  }

  if (!session) return <LoginForm onLogin={setSession} />

  const initials = session.ruc ? session.ruc.slice(-4) : 'RUC'
  const activeItem = MENU.find(m => m.id === activeModule)

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-row">
            <div className="sidebar-logo-icon">📋</div>
            <div className="sidebar-logo-text">
              <div className="sidebar-logo-name">Dashbot</div>
              <div className="sidebar-logo-sub">DASHCONT TECHNOLOGY</div>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">Menú principal</div>
          {MENU.map(item => (
            <button
              key={item.id}
              className={`sidebar-item ${activeModule === item.id ? 'active' : ''}`}
              onClick={() => setActiveModule(item.id)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">RUC {session.ruc}</div>
            <div className="sidebar-user-ruc">{session.demo ? 'Modo demo' : 'Sesión activa'}</div>
          </div>
          <button className="sidebar-logout" onClick={handleLogout} title="Cerrar sesión">↪</button>
        </div>
      </aside>

      {/* Contenido principal */}
      <div className="main-content">
        <div className="main-topbar">
          <span className="topbar-title">{activeItem?.icon} {activeItem?.label}</span>
          {session.demo && <span className="topbar-badge-demo">DEMO</span>}
          <div className="sync-dot" title="Conectado" />
          <span className="topbar-ruc">RUC {session.ruc}</span>
        </div>

        {activeModule === 'notificaciones' ? (
          <ChatInterface session={session} onLogout={handleLogout} />
        ) : (
          <ComingSoon title={activeItem?.label} icon={activeItem?.icon} />
        )}
      </div>
    </div>
  )
}
