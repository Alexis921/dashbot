import { useState, useEffect } from 'react'
import { apiGetProgramacion, apiSaveProgramacion } from '../api'

function Toggle({ checked, onChange }) {
  return (
    <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span className="toggle-knob" />
    </button>
  )
}

export default function Programacion() {
  const [cfg, setCfg] = useState({
    activo: false, frecuencia: 'cada_x_horas', hora_inicio: '08:00',
    repetir_cada: 6, zona_horaria: 'America/Lima', correo_envio: '',
    fuente_sol: true, fuente_sunafil: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [nextRun, setNextRun] = useState(null)

  const set = (k, v) => { setCfg((c) => ({ ...c, [k]: v })); setSaved(false) }

  useEffect(() => {
    apiGetProgramacion()
      .then((d) => { setCfg((c) => ({ ...c, ...d.programacion })); setNextRun(d.programacion.next_run) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      const d = await apiSaveProgramacion({
        activo: cfg.activo, frecuencia: cfg.frecuencia, hora_inicio: cfg.hora_inicio,
        repetir_cada: Number(cfg.repetir_cada), zona_horaria: cfg.zona_horaria,
        correo_envio: cfg.correo_envio, fuente_sol: cfg.fuente_sol, fuente_sunafil: cfg.fuente_sunafil,
      })
      setSaved(true)
      setNextRun(d.programacion.next_run)
    } catch (err) {
      alert(`⚠️ ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="prog-page"><div className="prog-card">Cargando programación...</div></div>

  const fmtNext = nextRun
    ? new Date(nextRun).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="prog-page">
      <div className="prog-header">
        <h1 className="prog-title">🕐 Programación</h1>
        <p className="prog-sub">Define cuándo se extraen automáticamente las últimas notificaciones de todos tus RUCs activos.</p>
      </div>

      <div className="prog-card">
        <div className="prog-card-head">
          <div className="prog-card-icon">📅</div>
          <div>
            <div className="prog-card-title">Extracción automática</div>
            <div className="prog-card-desc">Se encola según la frecuencia elegida y la procesa el worker.</div>
          </div>
        </div>

        <div className={`prog-toggle-row ${cfg.activo ? 'active' : ''}`}>
          <div>
            <div className="prog-toggle-title">Activar extracción programada</div>
            <div className="prog-toggle-desc">Busca las últimas notificaciones sin presionar Extraer en cada empresa.</div>
          </div>
          <Toggle checked={cfg.activo} onChange={(v) => set('activo', v)} />
        </div>

        <div className="prog-grid">
          <div className="form-group">
            <label className="form-label">Frecuencia</label>
            <select className="form-input" value={cfg.frecuencia} onChange={(e) => set('frecuencia', e.target.value)}>
              <option value="cada_x_horas">Cada X horas</option>
              <option value="diario">Una vez al día</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Hora de inicio</label>
            <input className="form-input" type="time" value={cfg.hora_inicio} onChange={(e) => set('hora_inicio', e.target.value)} />
          </div>

          {cfg.frecuencia === 'cada_x_horas' && (
            <div className="form-group">
              <label className="form-label">Repetir cada</label>
              <select className="form-input" value={cfg.repetir_cada} onChange={(e) => set('repetir_cada', e.target.value)}>
                {[6, 8, 12, 24].map((h) => <option key={h} value={h}>{h} horas</option>)}
              </select>
              <div className="hint">Tu plan permite programar desde cada 6 horas.</div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Zona horaria</label>
            <input className="form-input" type="text" value={cfg.zona_horaria} onChange={(e) => set('zona_horaria', e.target.value)} />
          </div>
        </div>

        <div className="prog-divider" />

        <div className="form-group">
          <label className="form-label">📧 Correo de envío</label>
          <input className="form-input" type="email" value={cfg.correo_envio}
            onChange={(e) => set('correo_envio', e.target.value)} placeholder="reportes@tuempresa.com" />
          <div className="hint">A este correo llegarán los resúmenes cuando haya notificaciones nuevas.</div>
        </div>

        <div className="form-group">
          <label className="form-label">🏛️ Fuentes a monitorear</label>
          <div className="prog-sources">
            <label className="prog-source">
              <input type="checkbox" checked={cfg.fuente_sol} onChange={(e) => set('fuente_sol', e.target.checked)} />
              <div>
                <div className="prog-source-name">Buzón SOL — SUNAT</div>
                <div className="prog-source-desc">Notificaciones tributarias (multas, cobranzas, esquelas)</div>
              </div>
              <span className="prog-source-badge ok">Activo</span>
            </label>
            <label className="prog-source">
              <input type="checkbox" checked={cfg.fuente_sunafil} onChange={(e) => set('fuente_sunafil', e.target.checked)} />
              <div>
                <div className="prog-source-name">Buzón SUNAFIL — Inspección laboral</div>
                <div className="prog-source-desc">Notificaciones de fiscalización laboral y seguridad social</div>
              </div>
              <span className="prog-source-badge soon">Próximamente</span>
            </label>
          </div>
        </div>

        {saved && (
          <div className="prog-saved">
            ✓ Programación guardada correctamente.
            {cfg.activo && fmtNext && <span> Próxima extracción: <strong>{fmtNext}</strong>.</span>}
          </div>
        )}

        <button className="btn-accent prog-save" onClick={handleSave} disabled={saving}>
          {saving ? '⏳ Guardando...' : '💾 Guardar programación'}
        </button>
      </div>
    </div>
  )
}
