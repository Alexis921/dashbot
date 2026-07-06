import { useState, useEffect } from 'react'
import { apiListEmpresas, apiSaveApiSunat, apiSireCargar, apiSireRegistrar, apiSireProbar } from '../api'

const S = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const MESES = [['01', 'Enero'], ['02', 'Febrero'], ['03', 'Marzo'], ['04', 'Abril'], ['05', 'Mayo'], ['06', 'Junio'],
  ['07', 'Julio'], ['08', 'Agosto'], ['09', 'Setiembre'], ['10', 'Octubre'], ['11', 'Noviembre'], ['12', 'Diciembre']]
const empNombre = (e) => e.alias || e.razon_social || `RUC ${e.ruc}`

function ConfigTab({ empresas, onSaved }) {
  const [empId, setEmpId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [probando, setProbando] = useState(false)
  const [prueba, setPrueba] = useState(null)

  const emp = empresas.find((e) => String(e.id) === String(empId))
  useEffect(() => {
    setClientId(emp?.api_client_id || ''); setClientSecret(''); setMsg(null); setPrueba(null)
  }, [empId])

  async function probar() {
    if (!emp) return
    setProbando(true); setPrueba(null); setMsg(null)
    try {
      const d = await apiSireProbar(emp.id)
      setPrueba(d)
    } catch (e) { setPrueba({ token_ok: false, sire_ok: false, detalle: e.message }) }
    finally { setProbando(false) }
  }

  async function guardar() {
    if (!emp) return setMsg({ t: 'err', m: 'Selecciona una empresa.' })
    if (!clientId.trim()) return setMsg({ t: 'err', m: 'Ingresa el ID de tu aplicación.' })
    if (!emp.api_configurada && !clientSecret.trim()) return setMsg({ t: 'err', m: 'Ingresa la CLAVE de tu aplicación.' })
    setSaving(true); setMsg(null)
    try {
      const d = await apiSaveApiSunat(emp.id, clientId.trim(), clientSecret.trim())
      onSaved(d.empresa)
      setClientSecret('')
      setMsg({ t: 'ok', m: 'Credenciales guardadas (cifradas). Ya puedes cargar Compras y Ventas.' })
    } catch (e) { setMsg({ t: 'err', m: e.message }) } finally { setSaving(false) }
  }

  return (
    <div className="sire-cfg">
      <div className="prog-card" style={{ maxWidth: 620 }}>
        <div className="prog-card-head">
          <div className="prog-card-icon" style={{ background: '#e0f2fe' }}>🔑</div>
          <div>
            <div className="prog-card-title">Credenciales de API SUNAT</div>
            <div className="prog-card-desc">Se obtienen en <strong>Menú SOL → Credenciales de API SUNAT</strong> (registra tu aplicación con la URL https://www.dashbot.pro/). Se guardan cifradas y se usan junto a la clave SOL para extraer el SIRE.</div>
          </div>
        </div>

        <div className="form-group"><label className="form-label">Empresa</label>
          <select className="form-input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
            <option value="">— Selecciona —</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{empNombre(e)} {e.api_configurada ? '· ✓ configurada' : ''}</option>
            ))}
          </select></div>

        {emp && (
          <>
            {emp.api_configurada && (
              <div className="sire-ok-badge">✓ Esta empresa ya tiene API configurada. Puedes actualizar las credenciales abajo.</div>
            )}
            <div className="form-group"><label className="form-label">ID (client_id) *</label>
              <input className="form-input" value={clientId} onChange={(e) => setClientId(e.target.value)}
                placeholder="Ej. e6f6d71c-fc6a-4301-b018-00a297584f95" autoComplete="off" /></div>
            <div className="form-group"><label className="form-label">CLAVE (client_secret) {emp.api_configurada ? '' : '*'}</label>
              {emp.api_configurada && (
                <div className="sire-ok-badge" style={{ marginBottom: 8 }}>
                  🔒 Tu CLAVE ya está <strong>guardada y cifrada</strong> — no necesitas volver a escribirla. Este campo es solo para <strong>reemplazarla</strong> si SUNAT te genera una nueva.
                </div>
              )}
              <div style={{ position: 'relative' }}>
                <input className="form-input" type={showSecret ? 'text' : 'password'} value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={emp.api_configurada ? '•••••••• (guardada — solo escribir si cambió)' : '••••••••••••'}
                  autoComplete="new-password" />
                <button type="button" onClick={() => setShowSecret((s) => !s)}
                  style={{ position: 'absolute', right: 10, top: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
                  {showSecret ? '🙈' : '👁️'}
                </button>
              </div></div>

            {msg && <div className={msg.t === 'ok' ? 'pf-pwd-ok' : 'error-msg'} style={{ marginBottom: 10 }}>{msg.t === 'ok' ? msg.m : `⚠️ ${msg.m}`}</div>}

            <button className="doc-bot-btn" style={{ width: '100%' }} onClick={guardar} disabled={saving}>
              <span className="doc-bot-glow" />
              <span className="doc-bot-label">{saving ? '⏳ Guardando…' : '🔐 Guardar credenciales'}</span>
            </button>

            {emp.api_configurada && (
              <button className="btn-secondary" style={{ width: '100%', marginTop: 10 }} onClick={probar} disabled={probando}>
                {probando ? '⏳ Probando conexión con SUNAT…' : '🔌 Probar conexión'}
              </button>
            )}

            {prueba && (
              <div className="sire-diag">
                <div className={`sire-diag-row ${prueba.token_ok ? 'ok' : 'fail'}`}>
                  {prueba.token_ok ? '✅' : '❌'} Autenticación (ID/CLAVE + clave SOL)
                </div>
                {prueba.token_ok && prueba.token_sire != null && (
                  <div className={`sire-diag-row ${prueba.token_sire ? 'ok' : 'fail'}`}>
                    {prueba.token_sire ? '✅' : '❌'} Permiso SIRE incluido en el token
                  </div>
                )}
                <div className={`sire-diag-row ${prueba.sire_ok ? 'ok' : 'fail'}`}>
                  {prueba.sire_ok ? '✅' : '❌'} Acceso a las APIs del SIRE
                </div>
                {prueba.sire_ok && prueba.periodos?.length > 0 && (
                  <div className="sire-diag-per">
                    📅 Períodos disponibles: {prueba.periodos.slice(0, 8).join(' · ')}
                  </div>
                )}
                {prueba.nota && <div className="sire-diag-per">ℹ️ {prueba.nota}</div>}
                {prueba.sire_ok && <div className="pf-pwd-ok">✓ Todo listo. Ya puedes cargar Compras y Ventas.</div>}
                {!prueba.sire_ok && prueba.detalle && <div className="error-msg" style={{ marginTop: 8 }}>⚠️ {prueba.detalle}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function LibroTab({ libro, empresas, onGoLibro }) {
  const hoy = new Date()
  const [empId, setEmpId] = useState('')
  const [anio, setAnio] = useState(String(hoy.getFullYear()))
  const [mes, setMes] = useState(String(hoy.getMonth() + 1).padStart(2, '0'))
  const [cargando, setCargando] = useState(false)
  const [registrando, setRegistrando] = useState(false)
  const [data, setData] = useState(null)   // {comprobantes, resumen}
  const [msg, setMsg] = useState(null)
  const [regOk, setRegOk] = useState(null)

  const emp = empresas.find((e) => String(e.id) === String(empId))
  const periodo = `${anio}${mes}`
  const label = libro === 'rce' ? 'compras' : 'ventas'
  const tercero = libro === 'rce' ? 'Proveedor' : 'Cliente'

  async function cargar() {
    if (!emp) return setMsg({ t: 'err', m: 'Selecciona una empresa.' })
    if (!emp.api_configurada) return setMsg({ t: 'err', m: 'Esta empresa no tiene API configurada. Ve a la pestaña Configuración.' })
    setCargando(true); setMsg(null); setData(null); setRegOk(null)
    try {
      const d = await apiSireCargar(emp.id, periodo, libro)
      if (d.estado === 'procesando') setMsg({ t: 'info', m: d.mensaje })
      else if (d.success) {
        setData(d)
        if (!d.comprobantes?.length) setMsg({ t: 'info', m: `SUNAT no tiene comprobantes de ${label} en la propuesta de ese período.` })
      } else setMsg({ t: 'err', m: d.error || 'No se pudo cargar.' })
    } catch (e) { setMsg({ t: 'err', m: e.message }) } finally { setCargando(false) }
  }

  async function registrar() {
    if (!data?.comprobantes?.length) return
    setRegistrando(true); setMsg(null)
    try {
      const d = await apiSireRegistrar(emp.id, periodo, libro, data.comprobantes)
      setRegOk(d)
    } catch (e) { setMsg({ t: 'err', m: e.message }) } finally { setRegistrando(false) }
  }

  const anios = []
  for (let y = hoy.getFullYear(); y >= hoy.getFullYear() - 3; y--) anios.push(String(y))

  return (
    <div>
      <div className="pl-filters" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="form-input" value={empId} onChange={(e) => { setEmpId(e.target.value); setData(null); setMsg(null); setRegOk(null) }} style={{ width: 230 }}>
          <option value="">— Empresa —</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{empNombre(e)}{e.api_configurada ? '' : ' (sin API)'}</option>)}
        </select>
        <select className="form-input" value={anio} onChange={(e) => setAnio(e.target.value)} style={{ width: 110 }}>
          {anios.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="form-input" value={mes} onChange={(e) => setMes(e.target.value)} style={{ width: 140 }}>
          {MESES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="doc-bot-btn" style={{ flex: 'none', padding: '10px 20px' }} onClick={cargar} disabled={cargando}>
          <span className="doc-bot-glow" />
          <span className="doc-bot-label">{cargando ? '🤖 Consultando SUNAT…' : '⚡ Cargar desde SUNAT'}</span>
        </button>
      </div>

      {msg && (
        <div className={msg.t === 'err' ? 'error-msg' : 'hor-venc'} style={{ marginBottom: 12 }}>
          {msg.t === 'err' ? `⚠️ ${msg.m}` : <span style={{ fontSize: 12.5 }}>{msg.t === 'info' ? 'ℹ️' : ''} {msg.m}</span>}
        </div>
      )}

      {regOk && (
        <div className="sire-reg-ok">
          ✅ <strong>{regOk.creados}</strong> comprobante(s) registrados en tu libro de {label}
          {regOk.omitidos > 0 && <> · {regOk.omitidos} omitido(s) por estar ya registrados</>}.
          <button className="pf-link" style={{ marginLeft: 8 }} onClick={onGoLibro}>Ver libro de comprobantes →</button>
        </div>
      )}

      {data?.comprobantes?.length > 0 && (
        <>
          <div className="cm-stats" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 12 }}>
            <div className="cm-stat" style={{ '--c': '#1B3A6B', '--cbg': '#dbeafe' }}><div className="cm-stat-ico">📄</div><div><div className="cm-stat-num">{data.resumen.cantidad}</div><div className="cm-stat-label">Comprobantes</div></div></div>
            <div className="cm-stat" style={{ '--c': '#0369a1', '--cbg': '#e0f2fe' }}><div className="cm-stat-ico">🧾</div><div><div className="cm-stat-num">{S(data.resumen.base)}</div><div className="cm-stat-label">Base imponible</div></div></div>
            <div className="cm-stat" style={{ '--c': '#b45309', '--cbg': '#fef3c7' }}><div className="cm-stat-ico">🧮</div><div><div className="cm-stat-num">{S(data.resumen.igv)}</div><div className="cm-stat-label">IGV</div></div></div>
            <div className="cm-stat" style={{ '--c': '#7c3aed', '--cbg': '#ede9fe' }}><div className="cm-stat-ico">➕</div><div><div className="cm-stat-num">{S(data.resumen.otros || 0)}</div><div className="cm-stat-label">Otros (exon./inaf./ISC)</div></div></div>
            <div className="cm-stat" style={{ '--c': '#0a9d63', '--cbg': '#d1fae5' }}><div className="cm-stat-ico">💵</div><div><div className="cm-stat-num">{S(data.resumen.total)}</div><div className="cm-stat-label">Total</div></div></div>
          </div>

          <div className="empresas-table" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <div className="sire-row sire-head">
              <div>Fecha</div><div>Tipo</div><div>Comprobante</div><div>{tercero}</div>
              <div className="rep-num">Base</div><div className="rep-num">IGV</div><div className="rep-num">Otros</div><div className="rep-num">Total</div><div>Mon.</div>
            </div>
            {data.comprobantes.map((c, i) => (
              <div className="sire-row" key={i}>
                <div className="empresa-cell-muted">{c.fecha_emision}</div>
                <div className="empresa-cell-muted">{c.tipo_comprobante}</div>
                <div><strong>{c.serie_numero}</strong></div>
                <div><div className="empresa-name" style={{ fontSize: 12 }}>{c.razon_social || '—'}</div><div className="empresa-ruc">{c.num_doc}</div></div>
                <div className="rep-num">{S(c.base_imponible)}</div>
                <div className="rep-num">{S(c.igv)}</div>
                <div className="rep-num">{S(c.otros || 0)}</div>
                <div className="rep-num"><strong>{S(c.importe_total)}</strong></div>
                <div className="empresa-cell-muted">{c.moneda}</div>
              </div>
            ))}
          </div>

          {!regOk && (
            <button className="doc-bot-btn doc-bot-cta" onClick={registrar} disabled={registrando}>
              <span className="doc-bot-glow" />
              <span className="doc-bot-label">{registrando ? '🤖 Registrando…' : `🤖 Registrar ${data.resumen.cantidad} comprobante(s) en mi libro`}</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function Sire({ onBack, onGoLibro }) {
  const [tab, setTab] = useState('config')
  const [empresas, setEmpresas] = useState([])

  useEffect(() => { apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {}) }, [])
  const actualizarEmpresa = (emp) => setEmpresas((p) => p.map((e) => (e.id === emp.id ? emp : e)))

  return (
    <div className="prog-page">
      <div className="empresas-header">
        <div>
          <button className="eq-back" onClick={onBack}>← Reportes</button>
          <h1 className="empresas-title">🛰️ SIRE SUNAT</h1>
          <p className="empresas-sub">Extrae tus Registros de Compras (RCE) y Ventas (RVIE) directo de la API oficial de SUNAT.</p>
        </div>
      </div>

      <div className="pl-tabs">
        <button className={`pl-tab ${tab === 'config' ? 'active' : ''}`} onClick={() => setTab('config')}>🔑 Configuración</button>
        <button className={`pl-tab ${tab === 'rce' ? 'active' : ''}`} onClick={() => setTab('rce')}>🛒 Registro de Compras</button>
        <button className={`pl-tab ${tab === 'rvie' ? 'active' : ''}`} onClick={() => setTab('rvie')}>💵 Registro de Ventas</button>
      </div>

      {tab === 'config' && <ConfigTab empresas={empresas} onSaved={actualizarEmpresa} />}
      {tab === 'rce' && <LibroTab libro="rce" empresas={empresas} onGoLibro={onGoLibro} />}
      {tab === 'rvie' && <LibroTab libro="rvie" empresas={empresas} onGoLibro={onGoLibro} />}
    </div>
  )
}
