import { useState, useRef } from 'react'
import { apiUpdateProfile, apiChangePassword } from '../api'

const CARGOS = ['Practicante', 'Auxiliar', 'Asistente', 'Analista', 'Supervisor',
  'Jefe', 'Auditor', 'Perito Contable', 'Ingeniero Contable']

function resizeImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')
      const min = Math.min(img.width, img.height)
      const sx = (img.width - min) / 2, sy = (img.height - min) / 2
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')) }
    img.src = url
  })
}

export default function Perfil({ user, onClose, onSaved, onLogout }) {
  const [f, setF] = useState({
    nombre: user.nombre || '', apellido: user.apellido || '', email: user.email || '',
    fecha_nacimiento: user.fecha_nacimiento || '', sexo: user.sexo || '',
    celular: user.celular || '', colegiatura: user.colegiatura || '', cargo: user.cargo || '',
  })
  const [foto, setFoto] = useState(user.foto || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const fileRef = useRef(null)
  // Cambio de contraseña
  const [showPass, setShowPass] = useState(false)
  const [pwd, setPwd] = useState({ actual: '', nueva: '', confirmar: '' })
  const [pwdMsg, setPwdMsg] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const setP = (k) => (e) => setPwd((x) => ({ ...x, [k]: e.target.value }))
  const initials = (user.nombre?.[0] || user.username?.[0] || 'U').toUpperCase()

  async function pickFoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return setErr('Selecciona un archivo de imagen.')
    setErr('')
    try { setFoto(await resizeImage(file)) } catch { setErr('No se pudo procesar la imagen.') }
  }

  async function guardar() {
    if (!f.nombre.trim()) return setErr('Tu nombre es obligatorio.')
    setSaving(true); setErr('')
    try {
      const d = await apiUpdateProfile({ ...f, foto })
      onSaved(d.user)
      setOk(true)
      setTimeout(onClose, 850)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function cambiarPwd() {
    if (!pwd.actual) return setPwdMsg('Ingresa tu contraseña actual.')
    if (pwd.nueva.length < 6) return setPwdMsg('La nueva contraseña debe tener al menos 6 caracteres.')
    if (pwd.nueva !== pwd.confirmar) return setPwdMsg('Las contraseñas no coinciden.')
    setPwdSaving(true); setPwdMsg('')
    try {
      await apiChangePassword(pwd.actual, pwd.nueva)
      setPwdMsg('ok'); setPwd({ actual: '', nueva: '', confirmar: '' })
    } catch (e) { setPwdMsg(e.message) } finally { setPwdSaving(false) }
  }

  return (
    <div className="pf-overlay" onClick={onClose}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pf-head">
          <div className="pf-head-t">Mi perfil</div>
          <button className="doc-close" onClick={onClose}>✕</button>
        </div>

        {ok ? (
          <div className="pf-ok">
            <div className="pf-ok-ring">{foto ? <img src={foto} alt="" /> : initials}</div>
            <div className="pf-ok-check">✓</div>
            <h3>¡Perfil actualizado!</h3>
          </div>
        ) : (
          <div className="pf-body">
            <div className="pf-avatar-wrap">
              <div className="pf-avatar-ring">
                <div className="pf-avatar">{foto ? <img src={foto} alt="avatar" /> : <span>{initials}</span>}</div>
                <button className="pf-avatar-cam" onClick={() => fileRef.current?.click()} title="Cambiar foto">📷</button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFoto} />
              <div className="pf-avatar-actions">
                <button className="pf-link" onClick={() => fileRef.current?.click()}>Subir foto</button>
                {foto && <button className="pf-link danger" onClick={() => setFoto('')}>Quitar</button>}
              </div>
            </div>

            {err && <div className="error-msg" style={{ margin: '0 0 12px' }}>⚠️ {err}</div>}

            <div className="pf-grid">
              <div className="form-group"><label className="form-label">Nombre *</label>
                <input className="form-input" value={f.nombre} onChange={set('nombre')} placeholder="Tu nombre" /></div>
              <div className="form-group"><label className="form-label">Apellido</label>
                <input className="form-input" value={f.apellido} onChange={set('apellido')} placeholder="Tu apellido" /></div>
            </div>

            <div className="form-group"><label className="form-label">Correo electrónico</label>
              <input className="form-input" type="email" value={f.email} onChange={set('email')} placeholder="tucorreo@dominio.com" /></div>

            <div className="pf-grid">
              <div className="form-group"><label className="form-label">Fecha de nacimiento</label>
                <input className="form-input" type="date" value={f.fecha_nacimiento} onChange={set('fecha_nacimiento')} /></div>
              <div className="form-group"><label className="form-label">Sexo</label>
                <div className="pf-seg">
                  <button className={f.sexo === 'M' ? 'on' : ''} onClick={() => setF((x) => ({ ...x, sexo: 'M' }))}>♂ Masculino</button>
                  <button className={f.sexo === 'F' ? 'on' : ''} onClick={() => setF((x) => ({ ...x, sexo: 'F' }))}>♀ Femenino</button>
                </div>
              </div>
            </div>

            <div className="pf-grid">
              <div className="form-group"><label className="form-label">Celular</label>
                <input className="form-input" type="tel" value={f.celular} onChange={set('celular')} placeholder="Ej. 987 654 321" /></div>
              <div className="form-group"><label className="form-label">N.º colegiatura (CCP)</label>
                <input className="form-input" value={f.colegiatura} onChange={set('colegiatura')} placeholder="Ej. 12-3456" /></div>
            </div>

            <div className="form-group"><label className="form-label">Cargo</label>
              <select className="form-input" value={f.cargo} onChange={set('cargo')}>
                <option value="">— Selecciona tu cargo —</option>
                {CARGOS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Seguridad y sesión */}
            <div className="pf-divider"><span>Seguridad y sesión</span></div>
            <div className="pf-sec-row">
              <button className={`pf-sec-btn ${showPass ? 'on' : ''}`} onClick={() => { setShowPass((v) => !v); setPwdMsg('') }}>🔒 Cambiar contraseña</button>
              <button className="pf-sec-btn danger" onClick={onLogout}>↪ Cerrar sesión</button>
            </div>

            {showPass && (
              <div className="pf-pwd">
                <input className="form-input" type="password" value={pwd.actual} onChange={setP('actual')} placeholder="Contraseña actual" autoComplete="current-password" />
                <div className="pf-grid" style={{ marginTop: 8 }}>
                  <input className="form-input" type="password" value={pwd.nueva} onChange={setP('nueva')} placeholder="Nueva contraseña" autoComplete="new-password" />
                  <input className="form-input" type="password" value={pwd.confirmar} onChange={setP('confirmar')} placeholder="Confirmar nueva" autoComplete="new-password" />
                </div>
                {pwdMsg && pwdMsg !== 'ok' && <div className="error-msg" style={{ marginTop: 8 }}>⚠️ {pwdMsg}</div>}
                {pwdMsg === 'ok' && <div className="pf-pwd-ok">✓ Contraseña actualizada.</div>}
                <button className="btn-accent" style={{ width: '100%', marginTop: 10 }} onClick={cambiarPwd} disabled={pwdSaving}>
                  {pwdSaving ? '⏳ Actualizando…' : 'Actualizar contraseña'}
                </button>
              </div>
            )}

            <div className="pf-foot">
              <button className="btn-secondary" onClick={onClose}>Cancelar</button>
              <button className="doc-bot-btn" style={{ flex: 1 }} onClick={guardar} disabled={saving}>
                <span className="doc-bot-glow" />
                <span className="doc-bot-label">{saving ? '⏳ Guardando…' : '💾 Guardar perfil'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
