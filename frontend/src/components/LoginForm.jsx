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
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">📋</div>
          <div className="login-title">Dashbot</div>
          <div className="login-brand">Dashcont Technology System Automatizacion SAC</div>
          <div className="login-sub">Buzón Electrónico SUNAT Inteligente</div>
        </div>

        {error && <div className="error-msg">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">RUC (11 dígitos)</label>
            <input
              className={`form-input ${error && form.ruc.length !== 11 ? 'error' : ''}`}
              type="text" maxLength={11} value={form.ruc}
              onChange={set('ruc')} placeholder="20603448308"
              autoComplete="off"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Usuario SOL</label>
            <input
              className="form-input" type="text"
              value={form.usuario} onChange={set('usuario')}
              placeholder="OLINKYLA" autoComplete="username"
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
            {loading ? '⏳ Conectando...' : '🔐 Ingresar al Buzón SUNAT'}
          </button>
        </form>

        <div className="divider">o</div>
        <button
          className="btn-primary"
          style={{ background: 'linear-gradient(135deg,#1a56a0,#0d3a7a)', boxShadow: '0 4px 16px rgba(26,86,160,.3)' }}
          onClick={(e) => handleSubmit(e, true)}
          disabled={loading}
        >
          🧪 Probar con datos de demostración
        </button>

        <a href="/landing.html" className="back-home">← Volver a la página principal</a>
      </div>
    </div>
  )
}
