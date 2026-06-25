import { useState, useEffect } from 'react'
import { apiGetConfiguracion, apiSaveConfiguracion, apiTestWhatsapp } from '../api'

function Toggle({ checked, onChange }) {
  return (
    <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span className="toggle-knob" />
    </button>
  )
}

export default function Configuracion() {
  const [cfg, setCfg] = useState({
    whatsapp_activo: false, whatsapp_numero: '', whatsapp_apikey: '', whatsapp_nivel: 'urgentes',
    recordatorios_activo: false, recordatorio_dias: '7,3,1,0', recordatorio_wsp: true,
    recordatorio_email: false, recordatorio_email_dest: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState(null)

  const set = (k, v) => { setCfg((c) => ({ ...c, [k]: v })); setSaved(false) }

  useEffect(() => {
    apiGetConfiguracion()
      .then((d) => setCfg((c) => ({ ...c, ...d.configuracion })))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setSaved(false)
    try {
      await apiSaveConfiguracion(cfg)
      setSaved(true)
    } catch (err) {
      alert(`⚠️ ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true); setTestMsg(null)
    try {
      await apiTestWhatsapp(cfg.whatsapp_numero, cfg.whatsapp_apikey)
      setTestMsg({ ok: true, text: '✓ Mensaje de prueba enviado. Revisa tu WhatsApp.' })
    } catch (err) {
      setTestMsg({ ok: false, text: err.message })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="prog-page"><div className="prog-card">Cargando configuración...</div></div>

  return (
    <div className="prog-page">
      <div className="prog-header">
        <h1 className="prog-title">⚙️ Configuración</h1>
        <p className="prog-sub">Personaliza cómo y dónde quieres recibir las alertas de tus notificaciones SUNAT.</p>
      </div>

      <div className="prog-card">
        <div className="prog-card-head">
          <div className="prog-card-icon" style={{ background: '#dcfce7' }}>💬</div>
          <div>
            <div className="prog-card-title">Alertas por WhatsApp</div>
            <div className="prog-card-desc">Recibe un mensaje al instante cuando llegue una notificación nueva.</div>
          </div>
        </div>

        <div className={`prog-toggle-row ${cfg.whatsapp_activo ? 'active' : ''}`}>
          <div>
            <div className="prog-toggle-title">Activar alertas por WhatsApp</div>
            <div className="prog-toggle-desc">Te avisamos en tu celular sin que tengas que abrir la app.</div>
          </div>
          <Toggle checked={cfg.whatsapp_activo} onChange={(v) => set('whatsapp_activo', v)} />
        </div>

        <div className="form-group">
          <label className="form-label">📱 Número de WhatsApp</label>
          <input className="form-input" type="tel" value={cfg.whatsapp_numero}
            onChange={(e) => set('whatsapp_numero', e.target.value)} placeholder="+51987654321" />
          <div className="hint">Incluye el código de país. Para Perú: +51 seguido de los 9 dígitos.</div>
        </div>

        <div className="form-group">
          <label className="form-label">🔑 API Key de CallMeBot</label>
          <input className="form-input" type="text" value={cfg.whatsapp_apikey}
            onChange={(e) => set('whatsapp_apikey', e.target.value)} placeholder="Ej: 1234567" />
          <div className="hint">Es gratis. Mira abajo cómo obtenerla en 1 minuto.</div>
        </div>

        <div className="form-group">
          <label className="form-label">🔔 Nivel de alerta</label>
          <select className="form-input" value={cfg.whatsapp_nivel} onChange={(e) => set('whatsapp_nivel', e.target.value)}>
            <option value="urgentes">Solo notificaciones urgentes (multas, cobranzas, embargos)</option>
            <option value="todas">Todas las notificaciones nuevas</option>
          </select>
        </div>

        <div className="wa-help">
          <div className="wa-help-title">📋 Cómo obtener tu API Key (gratis, 1 minuto)</div>
          <ol className="wa-help-steps">
            <li>Agrega el número <strong>+34 644 51 95 23</strong> a tus contactos de WhatsApp.</li>
            <li>Envíale el mensaje: <em>"I allow callmebot to send me messages"</em></li>
            <li>Recibirás tu <strong>API Key</strong> personal por WhatsApp.</li>
            <li>Pégala arriba, guarda y prueba. ¡Listo!</li>
          </ol>
        </div>

        {testMsg && (
          <div className={testMsg.ok ? 'prog-saved' : 'error-msg'} style={{ margin: '14px 0' }}>
            {testMsg.ok ? testMsg.text : `⚠️ ${testMsg.text}`}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <button className="btn-secondary" style={{ width: '100%' }} onClick={handleTest}
            disabled={testing || !cfg.whatsapp_numero || !cfg.whatsapp_apikey}>
            {testing ? '⏳ Enviando...' : '📤 Enviar mensaje de prueba'}
          </button>
        </div>
      </div>

      {/* ── Recordatorios de vencimientos ── */}
      <div className="prog-card" style={{ marginTop: 16 }}>
        <div className="prog-card-head">
          <div className="prog-card-icon" style={{ background: '#fef3c7' }}>⏰</div>
          <div>
            <div className="prog-card-title">Recordatorios de vencimientos</div>
            <div className="prog-card-desc">Te avisamos antes de cada vencimiento de tu Agenda Tributaria (declaración y SIRE).</div>
          </div>
        </div>

        <div className={`prog-toggle-row ${cfg.recordatorios_activo ? 'active' : ''}`}>
          <div>
            <div className="prog-toggle-title">Activar recordatorios automáticos</div>
            <div className="prog-toggle-desc">Avisos antes del vencimiento de cada obligación pendiente.</div>
          </div>
          <Toggle checked={cfg.recordatorios_activo} onChange={(v) => set('recordatorios_activo', v)} />
        </div>

        <div className="form-group">
          <label className="form-label">¿Cuántos días antes avisar?</label>
          <div className="rec-dias">
            {[30, 15, 7, 3, 1, 0].map((d) => {
              const sel = (cfg.recordatorio_dias || '').split(',').map((x) => x.trim()).includes(String(d))
              return (
                <button key={d} type="button" className={`rec-chip ${sel ? 'on' : ''}`}
                  onClick={() => {
                    const cur = new Set((cfg.recordatorio_dias || '').split(',').map((x) => x.trim()).filter(Boolean))
                    sel ? cur.delete(String(d)) : cur.add(String(d))
                    const ord = [...cur].map(Number).sort((a, b) => b - a).join(',')
                    set('recordatorio_dias', ord)
                  }}>
                  {d === 0 ? 'El mismo día' : `${d} días`}
                </button>
              )
            })}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Canales</label>
          <div className="rec-canales">
            <label className="rec-canal">
              <input type="checkbox" checked={cfg.recordatorio_wsp} onChange={(e) => set('recordatorio_wsp', e.target.checked)} />
              <span>💬 WhatsApp <small>(usa el número de arriba)</small></span>
            </label>
            <label className="rec-canal">
              <input type="checkbox" checked={cfg.recordatorio_email} onChange={(e) => set('recordatorio_email', e.target.checked)} />
              <span>📧 Correo electrónico</span>
            </label>
          </div>
        </div>

        {cfg.recordatorio_email && (
          <div className="form-group">
            <label className="form-label">Correo de destino</label>
            <input className="form-input" type="email" value={cfg.recordatorio_email_dest}
              onChange={(e) => set('recordatorio_email_dest', e.target.value)} placeholder="reportes@tuempresa.com" />
          </div>
        )}
      </div>

      {saved && <div className="prog-saved" style={{ marginTop: 14 }}>✓ Configuración guardada correctamente.</div>}

      <button className="btn-accent" style={{ width: '100%', marginTop: 16, padding: 12 }} onClick={handleSave} disabled={saving}>
        {saving ? '⏳ Guardando...' : '💾 Guardar configuración'}
      </button>
    </div>
  )
}
