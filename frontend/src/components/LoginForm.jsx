import { useState } from 'react'
import { apiLogin } from '../api'

export default function LoginForm({ onLogin }) {
  const [form, setForm] = useState({ ruc: '', usuario: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e, demoMode = false) {
    e.preventDefault()
    setError('')

    if (!demoMode) {
      if (form.ruc.length !== 11 || !/^\d+$/.test(form.ruc))
        return setError('El RUC debe tener exactamente 11 dígitos numéricos.')
      if (!form.usuario.trim()) return setError('Ingresa tu usuario SOL.')
      if (!form.password.trim()) return setError('Ingresa tu contraseña SOL.')
    }

    setLoading(true)
    try {
      const payload = demoMode
        ? { ruc: '20603448308', usuario: 'OLINKYLA', password: 'demo', demo_mode: true }
        : { ...form, demo_mode: false }

      const data = await apiLogin(payload.ruc, payload.usuario, payload.password, payload.demo_mode)
      onLogin({ ...data, ruc: payload.ruc, demo: demoMode })
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
            Plataforma para contadores y estudios contables. Monitoreo automático de notificaciones tributarias.
          </div>
          <div className="login-left-features">
            <div className="login-left-feature">
              <div className="login-left-feature-dot">✓</div>
              <span>Monitoreo automático del buzón SUNAT SOL</span>
            </div>
            <div className="login-left-feature">
              <div className="login-left-feature-dot">✓</div>
              <span>Alertas de multas, cobranzas y esquelas</span>
            </div>
            <div className="login-left-feature">
              <div className="login-left-feature-dot">✓</div>
              <span>Resumen ejecutivo con inteligencia artificial</span>
            </div>
          </div>
        </div>

        <div className="login-left-stats">
          <div>
            <div className="login-stat-val">500+</div>
            <div className="login-stat-lbl">Contadores</div>
          </div>
          <div>
            <div className="login-stat-val">12k+</div>
            <div className="login-stat-lbl">Alertas</div>
          </div>
          <div>
            <div className="login-stat-val">99.9%</div>
            <div className="login-stat-lbl">Uptime</div>
          </div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-card">
          <div className="login-card-title">Bienvenido de vuelta</div>
          <div className="login-card-sub">Ingresa a tu cuenta para continuar.</div>

          {error && <div className="error-msg">⚠️ {error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">RUC (11 dígitos)</label>
              <input
                className={`form-input ${error && form.ruc.length !== 11 ? 'error' : ''}`}
                type="text" maxLength={11} value={form.ruc}
                onChange={set('ruc')} placeholder="20123456789"
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Usuario SOL</label>
              <input
                className="form-input" type="text"
                value={form.usuario} onChange={set('usuario')}
                placeholder="Tu usuario SOL" autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Contraseña SOL</label>
              <input
                className="form-input" type="password"
                value={form.password} onChange={set('password')}
                placeholder="••••••••" autoComplete="current-password"
              />
            </div>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? '⏳ Conectando...' : '🔐 Ingresar'}
            </button>
          </form>

          <div className="divider">o</div>
          <button
            className="btn-primary"
            style={{ background: 'linear-gradient(135deg,#1B3A6B,#0f2347)' }}
            onClick={(e) => handleSubmit(e, true)}
            disabled={loading}
          >
            🧪 Probar con datos de demostración
          </button>

          <a href="/landing" className="back-home">← Volver a la página principal</a>
        </div>
      </div>
    </div>
  )
}
