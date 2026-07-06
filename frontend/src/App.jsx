import { useState, useEffect } from 'react'
import LoginForm from './components/LoginForm'
import ChatInterface from './components/ChatInterface'
import Empresas from './components/Empresas'
import Programacion from './components/Programacion'
import Configuracion from './components/Configuracion'
import Alertas from './components/Alertas'
import Agenda from './components/Agenda'
import CentroMando from './components/CentroMando'
import Equipo from './components/Equipo'
import Reportes from './components/Reportes'
import Perfil from './components/Perfil'
import Sunafil from './components/Sunafil'
import Declaraciones from './components/Declaraciones'
import { apiMe, getToken, clearToken } from './api'

// ── Iconos SVG futuristas (línea fina, currentColor) ──
const ICONS = {
  notificaciones: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  agenda: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 9.5h18"/>',
  dashboard: '<rect x="3" y="3" width="7" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  empresas: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8.5 7h2M13.5 7h2M8.5 11h2M13.5 11h2M10 21v-4h4v4"/>',
  alertas: '<path d="M12 3.5 21 19H3z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  programacion: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  equipo: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.8M20.5 19.5a5.5 5.5 0 0 0-3.5-5.1"/>',
  reportes: '<path d="M4 4v16h16"/><rect x="7.5" y="11" width="2.6" height="6" rx=".5"/><rect x="12" y="7.5" width="2.6" height="9.5" rx=".5"/><rect x="16.5" y="13.5" width="2.6" height="3.5" rx=".5"/>',
  'mi-plan': '<path d="M4 9 12 3l8 6-8 12z"/><path d="M4 9h16M9.5 3 7 9l5 12 5-12-2.5-6"/>',
  configuracion: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sugerencias: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.5 1 1.2 1.1 2H14.7c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>',
  caret: '<path d="M6 9l6 6 6-6"/>',
  colaboradores: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  planilla: '<path d="M6 2.5h7l5 5v14H6z"/><path d="M13 2.5v5h5M9 13h6M9 16.5h6"/>',
  talento: '<path d="M12 3.5l2.5 5.1 5.6.8-4 4 1 5.6L12 16.4 6.9 19l1-5.6-4-4 5.6-.8z"/>',
  contratos: '<path d="M6 2.5h7l5 5v14H6z"/><path d="M13 2.5v5h5"/>',
  libro: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 8h6M9 11.5h6"/>',
  sire: '<path d="M7 17a4.5 4.5 0 1 1 .4-8.98 6 6 0 0 1 11.4 1.7A3.6 3.6 0 0 1 18.5 17z"/><path d="M12 12v8M8.8 17.2 12 20.4l3.2-3.2"/>',
  resumen: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M12 3v9l7-2.2"/>',
  buzon: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  sunafil: '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>',
  declaraciones: '<path d="M6 2h9l3 3v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  kanban: '<rect x="3" y="4" width="4.5" height="16" rx="1"/><rect x="9.75" y="4" width="4.5" height="11" rx="1"/><rect x="16.5" y="4" width="4.5" height="7" rx="1"/>',
  tema: '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/><path d="M5.5 15.5l.7 1.65 1.65.7-1.65.7-.7 1.65-.7-1.65-1.65-.7 1.65-.7z"/>',
  calendario: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 9.5h18"/><circle cx="12" cy="14.5" r="1.5"/>',
  horario: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
}

function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />
  )
}

const MENU = [
  { id: 'notificaciones', label: 'Notificaciones', subs: [
    { id: 'buzon',         label: 'Buzón SOL' },
    { id: 'sunafil',       label: 'SUNAFIL' },
    { id: 'declaraciones', label: 'Mis Declaraciones y Pagos' },
  ] },
  { id: 'agenda',         label: 'Agenda Tributaria', subs: [
    { id: 'kanban',      label: 'Kanban Contable' },
    { id: 'calendario',  label: 'Calendario Tributario' },
    { id: 'horario',     label: 'Horario Contable' },
  ] },
  { id: 'dashboard',      label: 'Dashboard' },
  { id: 'empresas',       label: 'Empresas' },
  { id: 'alertas',        label: 'Alertas' },
  { id: 'programacion',   label: 'Programación' },
  { id: 'equipo',         label: 'Equipo', subs: [
    { id: 'colaboradores', label: 'Colaboradores' },
    { id: 'planilla',      label: 'Planilla' },
    { id: 'talento',       label: 'Gestión del talento' },
    { id: 'contratos',     label: 'Contratos y documentos' },
  ] },
  { id: 'reportes',       label: 'Reportes', subs: [
    { id: 'sire',    label: 'SIRE SUNAT' },
    { id: 'libro',   label: 'Libro de comprobantes' },
    { id: 'resumen', label: 'Resumen tributario' },
  ] },
  { id: 'mi-plan',        label: 'Mi Plan' },
  { id: 'configuracion',  label: 'Configuración' },
  { id: 'sugerencias',    label: 'Sugerencias' },
]

// Módulos cuyo "padre" abre directamente su primer submódulo (no tienen dashboard aparte)
const DEFAULT_SUB = { notificaciones: 'buzon', agenda: 'kanban' }

// Cierre de sesión por inactividad
const INACTIVIDAD_MAX = 10 * 60 * 1000 // 10 minutos
const LAST_ACT_KEY = 'dashbot_last_activity'

// Temas de color de la interfaz
const TEMAS = [
  { id: 'clasico', label: 'Clásico', c1: '#1B3A6B', c2: '#00A651' },
  { id: 'celeste', label: 'Celeste suave', c1: '#4a6fa5', c2: '#56b4e5' },
  { id: 'menta',   label: 'Verde suave',   c1: '#2f6b5e', c2: '#4fc79a' },
  { id: 'rosa',    label: 'Rosado Barbie', c1: '#c2187f', c2: '#ff6ec7' },
]

function ComingSoon({ title, icon }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-icon"><Icon name={icon} size={40} /></div>
      <h2>{title}</h2>
      <p>Este módulo estará disponible muy pronto. Estamos trabajando para traerte la mejor experiencia.</p>
      <div className="coming-soon-badge">🚀 Próximamente</div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [demoMode, setDemoMode] = useState(false)
  const [booting, setBooting] = useState(true)
  const [activeModule, setActiveModule] = useState('empresas')
  const [activeSub, setActiveSub] = useState(null)
  const [selectedEmpresa, setSelectedEmpresa] = useState(null)
  const [showPerfil, setShowPerfil] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('dashbot_theme') || 'clasico')
  const [showTemas, setShowTemas] = useState(false)
  const [avisoLogin, setAvisoLogin] = useState('')

  useEffect(() => {
    if (theme === 'clasico') document.body.removeAttribute('data-theme')
    else document.body.setAttribute('data-theme', theme)
    localStorage.setItem('dashbot_theme', theme)
  }, [theme])

  // Cierre automático tras 10 minutos sin actividad (mouse, teclado, scroll o toque)
  useEffect(() => {
    if (!user || demoMode) return
    localStorage.setItem(LAST_ACT_KEY, String(Date.now()))
    let ultimo = 0
    const marcar = () => {
      const ahora = Date.now()
      if (ahora - ultimo > 5000) { ultimo = ahora; localStorage.setItem(LAST_ACT_KEY, String(ahora)) }
    }
    const eventos = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }))
    const timer = setInterval(() => {
      const last = Number(localStorage.getItem(LAST_ACT_KEY) || 0)
      if (last && Date.now() - last > INACTIVIDAD_MAX) {
        setAvisoLogin('Tu sesión se cerró por inactividad. Vuelve a ingresar.')
        handleLogout()
      }
    }, 30000)
    return () => { eventos.forEach((e) => window.removeEventListener(e, marcar)); clearInterval(timer) }
  }, [user, demoMode])

  useEffect(() => {
    const token = getToken()
    if (!token) { setBooting(false); return }
    // Si la última actividad fue hace más de 10 min, cerrar la sesión guardada
    const last = Number(localStorage.getItem(LAST_ACT_KEY) || 0)
    if (last && Date.now() - last > INACTIVIDAD_MAX) {
      clearToken()
      setAvisoLogin('Tu sesión se cerró por inactividad. Vuelve a ingresar.')
      setBooting(false)
      return
    }
    apiMe()
      .then((data) => { setUser(data.user); setActiveModule('notificaciones'); setShowPerfil(true) })
      .catch(() => clearToken())
      .finally(() => setBooting(false))
  }, [])

  function go(moduleId, subId = null) {
    setActiveModule(moduleId)
    setActiveSub(subId)
  }

  // Navegación desde el sidebar: al ir a Notificaciones, vuelve al hub (deselecciona empresa)
  function goNav(moduleId, subId = null) {
    if (moduleId === 'notificaciones') setSelectedEmpresa(null)
    go(moduleId, subId)
  }

  function handleAuth(u) {
    setUser(u); setDemoMode(false); setAvisoLogin('')
    localStorage.setItem(LAST_ACT_KEY, String(Date.now()))
    go('notificaciones'); setShowPerfil(true)
  }
  function handleDemo() {
    setDemoMode(true); go('notificaciones')
  }
  function handleLogout() {
    clearToken(); setUser(null); setDemoMode(false); setSelectedEmpresa(null); go('empresas')
  }
  function openEmpresa(empresa) {
    setSelectedEmpresa(empresa); go('notificaciones')
  }

  if (booting) {
    return <div className="login-screen" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ color: '#1B3A6B', fontWeight: 600 }}>Cargando Dashbot...</div>
    </div>
  }

  if (!user && !demoMode) {
    return <LoginForm onAuth={handleAuth} onDemo={handleDemo} aviso={avisoLogin} />
  }

  const activeItem = MENU.find(m => m.id === activeModule)
  const activeSubItem = activeItem?.subs?.find(s => s.id === activeSub)
  const displayName = demoMode ? 'Modo Demo' : `${user.nombre} ${user.apellido}`.trim() || user.username
  const initials = demoMode ? 'D' : (user.nombre?.[0] || user.username[0] || 'U').toUpperCase()

  function renderModule() {
    if (activeModule === 'empresas' && !demoMode) return <Empresas onOpenEmpresa={openEmpresa} />
    if (activeModule === 'programacion' && !demoMode) return <Programacion />
    if (activeModule === 'configuracion' && !demoMode) return <Configuracion />
    if (activeModule === 'alertas' && !demoMode) return <Alertas />
    if (activeModule === 'agenda' && !demoMode) return <Agenda key={activeSub || 'kanban'} initialView={activeSub || 'kanban'} />
    if (activeModule === 'equipo' && !demoMode) return <Equipo key={activeSub || 'dash'} initialView={activeSub || 'dashboard'} />
    if (activeModule === 'reportes' && !demoMode) return <Reportes key={activeSub || 'dash'} initialView={activeSub || 'dashboard'} />
    if (activeModule === 'notificaciones') {
      if (demoMode) return <ChatInterface demoMode key="demo" />
      const sub = activeSub || 'buzon'
      if (sub === 'sunafil') return <Sunafil />
      if (sub === 'declaraciones') return <Declaraciones onGoModule={(m) => go(m)} />
      if (selectedEmpresa) return <ChatInterface empresa={selectedEmpresa} key={selectedEmpresa.id} />
      return <CentroMando user={user} onOpenEmpresa={openEmpresa} onGoModule={(m) => go(m)} />
    }
    return <ComingSoon title={activeItem?.label} icon={activeModule} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-row">
            <div className="sidebar-logo-icon"><img src="/robot.png" alt="DashBot" /></div>
            <div className="sidebar-logo-text">
              <div className="sidebar-logo-name">Dashbot</div>
              <div className="sidebar-logo-sub">DASHCONT TECHNOLOGY</div>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">Menú principal</div>
          {MENU.map(item => {
            const isActive = activeModule === item.id
            return (
              <div key={item.id}>
                <button
                  className={`sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={() => goNav(item.id, null)}
                >
                  <span className="sidebar-icon"><Icon name={item.id} /></span>
                  <span className="sidebar-label">{item.label}</span>
                  {item.subs && <span className={`sidebar-caret ${isActive ? 'open' : ''}`}><Icon name="caret" size={13} /></span>}
                </button>
                {item.subs && isActive && (
                  <div className="sidebar-subs">
                    {item.subs.map(sub => {
                      const effSub = activeSub || DEFAULT_SUB[item.id] || null
                      return (
                        <button key={sub.id}
                          className={`sidebar-sub ${effSub === sub.id ? 'active' : ''}`}
                          onClick={() => goNav(item.id, sub.id)}>
                          <span className="sidebar-sub-bar" />
                          <span className="sidebar-sub-ico"><Icon name={sub.id} size={14} /></span>
                          <span className="sidebar-sub-label">{sub.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="sidebar-user">
          <button className="sidebar-user-btn" onClick={() => !demoMode && setShowPerfil(true)} disabled={demoMode} title="Mi perfil">
            <div className="sidebar-avatar">{user?.foto ? <img src={user.foto} alt="" /> : initials}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{displayName}</div>
              <div className="sidebar-user-ruc">{demoMode ? 'Demo' : (user?.cargo || 'Ver mi perfil')}</div>
            </div>
          </button>
          <button className="sidebar-logout" onClick={handleLogout} title="Cerrar sesión">↪</button>
        </div>
      </aside>

      <div className="main-content">
        <div className="main-topbar">
          <span className="topbar-title">
            <Icon name={activeModule} size={18} />
            {activeItem?.label}{activeSubItem ? <span className="topbar-sub"> · {activeSubItem.label}</span> : ''}
          </span>
          {demoMode && <span className="topbar-badge-demo">DEMO</span>}
          {selectedEmpresa && activeModule === 'notificaciones' && (
            <span className="topbar-empresa">{selectedEmpresa.alias || selectedEmpresa.razon_social || `RUC ${selectedEmpresa.ruc}`}</span>
          )}
          <div className="topbar-right">
            <div className="sync-dot" title="Conectado" />
            <div className="tema-wrap">
              <button className="tema-btn" onClick={() => setShowTemas((v) => !v)} title="Cambiar colores">
                <Icon name="tema" size={17} />
              </button>
              {showTemas && (
                <div className="tema-pop" onMouseLeave={() => setShowTemas(false)}>
                  <div className="tema-pop-t">Tema de colores</div>
                  {TEMAS.map((t) => (
                    <button key={t.id} className={`tema-opt ${theme === t.id ? 'on' : ''}`}
                      onClick={() => { setTheme(t.id); setShowTemas(false) }}>
                      <span className="tema-dots"><span style={{ background: t.c1 }} /><span style={{ background: t.c2 }} /></span>
                      {t.label}
                      {theme === t.id && <span className="tema-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {renderModule()}
      </div>

      {showPerfil && user && (
        <Perfil user={user} onClose={() => setShowPerfil(false)} onSaved={(u) => setUser(u)}
          onLogout={() => { setShowPerfil(false); handleLogout() }} />
      )}
    </div>
  )
}
