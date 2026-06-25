import { useState } from 'react'
import { apiLogin, apiRegister } from '../api'

export default function LoginForm({ onAuth, onDemo }) {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [login, setLogin] = useState({ username: '', password: '' })
  const [reg, setReg] = useState({
    nombre: '', apellido: '', username: '', password: '', confirm: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const setL = (k) => (e) => setLogin((f) => ({ ...f, [k]: e.target.value }))
  const setR = (k) => (e) => setReg((f) => ({ ...f, [k]: e.target.value }))

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    if (!login.username.trim()) return setError('Ingresa tu nombre de usuario.')
    if (!login.password) return setError('Ingresa tu contraseña.')
    setLoading(true)
    try {
      const data = await apiLogin(login.username.trim(), login.password)
      onAuth(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError('')
    if (!reg.nombre.trim() || !reg.apellido.trim()) return setError('Ingresa tu nombre y apellido.')
    if (reg.username.trim().length < 3) return setError('El usuario debe tener al menos 3 caracteres.')
    if (reg.password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.')
    if (reg.password !== reg.confirm) return setError('Las contraseñas no coinciden.')
    setLoading(true)
    try {
      const data = await apiRegister({
        nombre: reg.nombre.trim(), apellido: reg.apellido.trim(),
        username: reg.username.trim(), password: reg.password,
      })
      onAuth(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-left">
        <div className="login-left-logo">
          <div className="login-left-logo-icon">📋</div>
          <div className="login-left-logo-text">
            <div className="login-left-logo-name">Dashbot</div>
            <div className="login-left-logo-sub">DASHCONT TECHNOLOGY</div>
          </div>
        </div>

        <div className="login-left-hero">
          <div className="login-left-headline">
            Gestiona el buzón SUNAT de tus clientes <span>sin complicaciones.</span>
          </div>
          <div className="login-left-desc">
            Plataforma multiempresa para contadores y estudios contables. Monitoreo automático de notificaciones tributarias.
          </div>
          <div className="login-left-features">
            <div className="login-left-feature"><div className="login-left-feature-dot">✓</div><span>Registra todas tus empresas en un solo lugar</span></div>
            <div className="login-left-feature"><div className="login-left-feature-dot">✓</div><span>Alertas de multas, cobranzas y esquelas</span></div>
            <div className="login-left-feature"><div className="login-left-feature-dot">✓</div><span>Resumen ejecutivo con inteligencia artificial</span></div>
          </div>
        </div>

        <div className="login-left-stats">
          <div><div className="login-stat-val">500+</div><div className="login-stat-lbl">Contadores</div></div>
          <div><div className="login-stat-val">12k+</div><div className="login-stat-lbl">Alertas</div></div>
          <div><div className="login-stat-val">99.9%</div><div className="login-stat-lbl">Uptime</div></div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-card">
          {mode === 'login' ? (
            <>
              <div className="login-card-title">Bienvenido de vuelta</div>
              <div className="login-card-sub">Ingresa a tu cuenta para continuar.</div>

              {error && <div className="error-msg">⚠️ {error}</div>}

              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label className="form-label">Nombre de usuario</label>
                  <input className="form-input" type="text" value={login.username}
                    onChange={setL('username')} placeholder="tu_usuario" autoComplete="username" />
                </div>
                <div className="form-group">
                  <label className="form-label">Contraseña</label>
                  <input className="form-input" type="password" value={login.password}
                    onChange={setL('password')} placeholder="••••••••" autoComplete="current-password" />
                </div>
                <button className="btn-primary" type="submit" disabled={loading}>
                  {loading ? '⏳ Ingresando...' : '🔐 Iniciar sesión'}
                </button>
              </form>

              <button className="btn-secondary-full" onClick={() => { setError(''); setMode('register') }} disabled={loading}>
                ✍️ Crear cuenta nueva
              </button>

              <div className="divider">o</div>
              <button className="btn-demo-full" onClick={onDemo} disabled={loading}>
                🧪 Usar demo
              </button>
            </>
          ) : (
            <>
              <div className="login-card-title">Crea tu cuenta</div>
              <div className="login-card-sub">Regístrate para empezar a gestionar tus empresas.</div>

              {error && <div className="error-msg">⚠️ {error}</div>}

              <form onSubmit={handleRegister}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Nombre</label>
                    <input className="form-input" type="text" value={reg.nombre}
                      onChange={setR('nombre')} placeholder="Juan" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Apellido</label>
                    <input className="form-input" type="text" value={reg.apellido}
                      onChange={setR('apellido')} placeholder="Pérez" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Nombre de usuario</label>
                  <input className="form-input" type="text" value={reg.username}
                    onChange={setR('username')} placeholder="juanperez" autoComplete="username" />
                </div>
                <div className="form-group">
                  <label className="form-label">Contraseña</label>
                  <input className="form-input" type="password" value={reg.password}
                    onChange={setR('password')} placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirmar contraseña</label>
                  <input className="form-input" type="password" value={reg.confirm}
                    onChange={setR('confirm')} placeholder="Repite tu contraseña" autoComplete="new-password" />
                </div>
                <button className="btn-primary" type="submit" disabled={loading}>
                  {loading ? '⏳ Registrando...' : '✅ Registrarse'}
                </button>
              </form>

              <button className="btn-secondary-full" onClick={() => { setError(''); setMode('login') }} disabled={loading}>
                ← Ya tengo cuenta
              </button>
            </>
          )}

          <a href="/landing" className="back-home">← Volver a la página principal</a>
        </div>
      </div>
    </div>
  )
}
