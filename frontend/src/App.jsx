import { useState, useEffect } from 'react'
import LoginForm from './components/LoginForm'
import ChatInterface from './components/ChatInterface'
import Empresas from './components/Empresas'
import Programacion from './components/Programacion'
import { apiMe, getToken, clearToken } from './api'

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

function NoEmpresaSelected({ onGoEmpresas }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-icon">🏢</div>
      <h2>Selecciona una empresa</h2>
      <p>Para ver las notificaciones del buzón SUNAT, primero elige una empresa desde el módulo Empresas y haz clic en “Extraer”.</p>
      <button className="btn-accent" style={{ marginTop: 16 }} onClick={onGoEmpresas}>🏢 Ir a Empresas</button>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [demoMode, setDemoMode] = useState(false)
  const [booting, setBooting] = useState(true)
  const [activeModule, setActiveModule] = useState('empresas')
  const [selectedEmpresa, setSelectedEmpresa] = useState(null)

  // Restaurar sesión desde el token guardado
  useEffect(() => {
    const token = getToken()
    if (!token) { setBooting(false); return }
    apiMe()
      .then((data) => { setUser(data.user); setActiveModule('empresas') })
      .catch(() => clearToken())
      .finally(() => setBooting(false))
  }, [])

  function handleAuth(u) {
    setUser(u)
    setDemoMode(false)
    setActiveModule('empresas')
  }

  function handleDemo() {
    setDemoMode(true)
    setActiveModule('notificaciones')
  }

  function handleLogout() {
    clearToken()
    setUser(null)
    setDemoMode(false)
    setSelectedEmpresa(null)
    setActiveModule('empresas')
  }

  function openEmpresa(empresa) {
    setSelectedEmpresa(empresa)
    setActiveModule('notificaciones')
  }

  if (booting) {
    return <div className="login-screen" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ color: '#1B3A6B', fontWeight: 600 }}>Cargando Dashbot...</div>
    </div>
  }

  if (!user && !demoMode) {
    return <LoginForm onAuth={handleAuth} onDemo={handleDemo} />
  }

  const activeItem = MENU.find(m => m.id === activeModule)
  const displayName = demoMode ? 'Modo Demo' : `${user.nombre} ${user.apellido}`.trim() || user.username
  const initials = demoMode ? 'D' : (user.nombre?.[0] || user.username[0] || 'U').toUpperCase()

  function renderModule() {
    if (activeModule === 'empresas' && !demoMode) {
      return <Empresas onOpenEmpresa={openEmpresa} />
    }
    if (activeModule === 'programacion' && !demoMode) {
      return <Programacion />
    }
    if (activeModule === 'notificaciones') {
      if (demoMode) return <ChatInterface demoMode key="demo" />
      if (selectedEmpresa) return <ChatInterface empresa={selectedEmpresa} key={selectedEmpresa.id} />
      return <NoEmpresaSelected onGoEmpresas={() => setActiveModule('empresas')} />
    }
    return <ComingSoon title={activeItem?.label} icon={activeItem?.icon} />
  }

  return (
    <div className="app-shell">
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
            <div className="sidebar-user-name">{displayName}</div>
            <div className="sidebar-user-ruc">{demoMode ? 'Demo' : 'Sesión activa'}</div>
          </div>
          <button className="sidebar-logout" onClick={handleLogout} title="Cerrar sesión">↪</button>
        </div>
      </aside>

      <div className="main-content">
        <div className="main-topbar">
          <span className="topbar-title">{activeItem?.icon} {activeItem?.label}</span>
          {demoMode && <span className="topbar-badge-demo">DEMO</span>}
          {selectedEmpresa && activeModule === 'notificaciones' && (
            <span className="topbar-empresa">{selectedEmpresa.alias || selectedEmpresa.razon_social || `RUC ${selectedEmpresa.ruc}`}</span>
          )}
          <div className="sync-dot" title="Conectado" />
        </div>

        {renderModule()}
      </div>
    </div>
  )
}
