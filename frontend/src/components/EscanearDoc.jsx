import { useState, useEffect, useMemo } from 'react'
import { apiAnalizarDocumento, apiCreateObligacion, apiRegistrarComprobante } from '../api'

const fmtFecha = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
const digits = (s) => String(s || '').replace(/\D/g, '')
const S = (n) => 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const empNombre = (e) => e ? (e.alias || e.razon_social || `RUC ${e.ruc}`) : ''

function Campo({ label, value }) {
  if (value == null || value === '' || value === false) return null
  return (
    <div className="doc-campo">
      <span className="doc-campo-k">{label}</span>
      <span className="doc-campo-v">{String(value)}</span>
    </div>
  )
}

// ── Lógica tributaria peruana (heurística, editable por el usuario) ──
function clasificar(d, empresa) {
  const rucEmp = digits(empresa?.ruc)
  const rucEmisor = digits(d.ruc_emisor)
  const rucCliente = digits(d.ruc_cliente)
  const esFactura = /factura/i.test(d.tipo_comprobante || '')
  const esBoleta = /boleta/i.test(d.tipo_comprobante || '')
  const igv = Number(d.igv) || 0
  const base = Number(d.base_imponible) || 0
  const total = Number(d.importe_total) || 0
  const detraccion = !!d.detraccion_aplica

  let operacion = 'compra'
  let receptorOk = false
  if (rucEmp && rucEmisor && rucEmisor === rucEmp) { operacion = 'venta'; receptorOk = true }
  else if (rucEmp && rucCliente && rucCliente === rucEmp) { operacion = 'compra'; receptorOk = true }
  else { operacion = 'compra'; receptorOk = false }

  return { rucEmp, rucEmisor, rucCliente, esFactura, esBoleta, igv, base, total, detraccion, operacion, receptorOk }
}

function Linea({ ok, label, monto, nota, tone }) {
  return (
    <div className={`doc-lin ${tone || (ok ? 'si' : 'no')}`}>
      <div className="doc-lin-ico">{ok ? '✔' : '✕'}</div>
      <div className="doc-lin-body">
        <div className="doc-lin-top"><span>{label}</span>{monto != null && <strong>{S(monto)}</strong>}</div>
        {nota && <div className="doc-lin-nota">{nota}</div>}
      </div>
    </div>
  )
}

// ── Ventanita naciente: clasificación tributaria + registro con el bot ──
function ClasificacionVentana({ datos, empresas, empresaId, setEmpresaId, onClose, onRegistered }) {
  const empresa = useMemo(() => empresas.find((e) => String(e.id) === String(empresaId)), [empresas, empresaId])
  const base = useMemo(() => clasificar(datos, empresa), [datos, empresa])
  const [operacion, setOperacion] = useState(base.operacion)
  const [tipoAdq, setTipoAdq] = useState('servicio')
  const [retencion, setRetencion] = useState(false)
  const [registrando, setRegistrando] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState('')

  // Al cambiar de empresa, recalcular el sentido de la operación
  useEffect(() => { setOperacion(base.operacion) }, [base.operacion])
  // Sugerir retención: factura de compra > S/ 700 y sin detracción (excluyentes)
  useEffect(() => {
    setRetencion(operacion === 'compra' && base.esFactura && base.total > 700 && !base.detraccion)
  }, [operacion, base])

  const esCompra = operacion === 'compra'
  const creditoFiscal = esCompra && base.esFactura && base.igv > 0
  const gastoDeducible = esCompra && (base.esFactura || base.esBoleta)
  const receptorOk = esCompra
    ? (base.rucEmp && base.rucCliente && base.rucEmp === base.rucCliente)
    : (base.rucEmp && base.rucEmisor && base.rucEmp === base.rucEmisor)
  const retMonto = retencion ? +(base.total * 0.03).toFixed(2) : 0

  async function registrar() {
    if (!empresaId) return setErr('Selecciona la empresa con la que trabajas.')
    setRegistrando(true); setErr('')
    try {
      await apiRegistrarComprobante({
        empresa_id: Number(empresaId), operacion,
        tipo_comprobante: datos.tipo_comprobante || '', serie_numero: datos.serie_numero || '',
        ruc_emisor: datos.ruc_emisor || '', razon_emisor: datos.razon_social_emisor || '',
        ruc_cliente: datos.ruc_cliente || '', razon_cliente: datos.razon_social_cliente || '',
        fecha_emision: datos.fecha_emision || '', moneda: datos.moneda || 'PEN',
        base_imponible: base.base, igv: base.igv, importe_total: base.total,
        tipo_adquisicion: esCompra ? tipoAdq : '',
        credito_fiscal: creditoFiscal, credito_fiscal_monto: creditoFiscal ? base.igv : 0,
        gasto_deducible: gastoDeducible, gasto_monto: gastoDeducible ? base.base : 0,
        retencion_aplica: retencion, retencion_monto: retMonto,
        detraccion_aplica: base.detraccion, detraccion_porcentaje: Number(datos.detraccion_porcentaje) || 0,
        detraccion_monto: Number(datos.detraccion_monto) || 0, detraccion_codigo: datos.detraccion_codigo || '',
      })
      setOk(true)
      setTimeout(() => { onRegistered() }, 1400)
    } catch (e) { setErr(e.message) } finally { setRegistrando(false) }
  }

  return (
    <div className="doc-overlay doc-overlay-2" onClick={onClose}>
      <div className="doc-clasif" onClick={(e) => e.stopPropagation()}>
        {ok ? (
          <div className="doc-ok">
            <div className="doc-ok-ring">🤖</div>
            <div className="doc-ok-check">✓</div>
            <h3>¡Registrado!</h3>
            <p>El comprobante entró a tu libro de {esCompra ? 'compras' : 'ventas'}.</p>
          </div>
        ) : (
          <>
            <div className="doc-clasif-head">
              <div>
                <div className="doc-clasif-title">🧮 Clasificación tributaria</div>
                <div className="doc-clasif-sub">El bot analiza el comprobante y propone su tratamiento. Ajusta lo que necesites.</div>
              </div>
              <button className="doc-close" onClick={onClose}>✕</button>
            </div>

            <div className="doc-clasif-body">
              {/* Operación */}
              <div className="doc-seg">
                <button className={esCompra ? 'on' : ''} onClick={() => setOperacion('compra')}>🛒 Compra</button>
                <button className={!esCompra ? 'on' : ''} onClick={() => setOperacion('venta')}>💵 Venta</button>
              </div>

              {/* Empresa de trabajo */}
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="form-label">Empresa con la que trabajas</label>
                <select className="form-input" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                  <option value="">— Selecciona —</option>
                  {empresas.map((e) => <option key={e.id} value={e.id}>{empNombre(e)}</option>)}
                </select>
              </div>

              {/* Validación de receptor / emisor */}
              {!empresaId ? (
                <div className="doc-val warn">Selecciona la empresa para validar el comprobante.</div>
              ) : receptorOk ? (
                <div className="doc-val ok">✓ {esCompra ? 'El receptor' : 'El emisor'} coincide con <strong>{empNombre(empresa)}</strong>.</div>
              ) : (
                <div className="doc-val warn">
                  ⚠️ {esCompra
                    ? `El receptor del comprobante (RUC ${base.rucCliente || '—'}) no coincide con ${empNombre(empresa)} (RUC ${base.rucEmp || '—'}). En una compra, el receptor debe ser tu empresa.`
                    : `El emisor del comprobante (RUC ${base.rucEmisor || '—'}) no coincide con ${empNombre(empresa)} (RUC ${base.rucEmp || '—'}). En una venta, el emisor debe ser tu empresa.`}
                </div>
              )}

              {/* Tipo de adquisición (solo compra) */}
              {esCompra && (
                <div style={{ margin: '12px 0 4px' }}>
                  <label className="form-label">Tipo de adquisición</label>
                  <div className="doc-seg doc-seg-3">
                    <button className={tipoAdq === 'bien' ? 'on' : ''} onClick={() => setTipoAdq('bien')}>📦 Bien</button>
                    <button className={tipoAdq === 'mercaderia' ? 'on' : ''} onClick={() => setTipoAdq('mercaderia')}>🏷️ Mercadería</button>
                    <button className={tipoAdq === 'servicio' ? 'on' : ''} onClick={() => setTipoAdq('servicio')}>🛠️ Servicio</button>
                  </div>
                </div>
              )}

              {/* Tratamiento tributario */}
              <div className="doc-clasif-sec">Tratamiento tributario</div>
              {esCompra ? (
                <>
                  <Linea ok={creditoFiscal} label="Crédito fiscal (IGV)" monto={creditoFiscal ? base.igv : null}
                    nota={creditoFiscal ? 'Factura gravada: el IGV es crédito fiscal (art. 18°-19° Ley IGV).'
                      : base.esBoleta ? 'Las boletas no otorgan crédito fiscal (salvo RUC y casos del art. 19°).'
                        : 'Sin IGV gravado: no genera crédito fiscal.'} />
                  <Linea ok={gastoDeducible} label="Gasto / costo deducible" monto={gastoDeducible ? base.base : null}
                    nota={base.esFactura ? 'Sustenta gasto o costo para Renta (principio de causalidad).'
                      : 'Boleta: deducible con límites (Renta).'} />
                  <Linea ok={retencion} tone={retencion ? 'si' : 'no'} label="Retención del IGV (3%)" monto={retencion ? retMonto : null}
                    nota="Aplica solo si tu empresa es Agente de Retención designado por SUNAT y el comprobante supera S/ 700." />
                  <div className="doc-ret-toggle">
                    <span>Mi empresa es Agente de Retención</span>
                    <button className={`toggle ${retencion ? 'on' : ''}`} onClick={() => setRetencion((v) => !v)} disabled={base.detraccion}><span className="toggle-knob" /></button>
                  </div>
                  <Linea ok={base.detraccion} label="Detracción (SPOT)" monto={base.detraccion ? Number(datos.detraccion_monto) || null : null}
                    nota={base.detraccion ? `${datos.detraccion_porcentaje || ''}% · Deposítala en el Banco de la Nación. Excluye la retención.`
                      : 'El comprobante no está sujeto a detracción.'} />
                </>
              ) : (
                <>
                  <Linea ok label="Débito fiscal (IGV por pagar)" monto={base.igv} tone="deb"
                    nota="IGV que tu empresa cobró y debe declarar/pagar." />
                  <Linea ok label="Ingreso gravado" monto={base.base} tone="deb"
                    nota="Base que forma parte de tus ventas del período." />
                  {base.detraccion && <Linea ok label="Detracción (la retiene tu cliente)" monto={Number(datos.detraccion_monto) || null}
                    nota={`${datos.detraccion_porcentaje || ''}% depositado a tu cuenta del Banco de la Nación.`} />}
                </>
              )}

              {/* Resumen */}
              <div className="doc-resumen">
                <div><span>Base</span><strong>{S(base.base)}</strong></div>
                <div><span>IGV</span><strong>{S(base.igv)}</strong></div>
                <div><span>Total</span><strong>{S(base.total)}</strong></div>
              </div>

              {err && <div className="error-msg" style={{ marginTop: 10 }}>⚠️ {err}</div>}
            </div>

            <div className="doc-clasif-foot">
              <button className="btn-secondary" onClick={onClose}>Cancelar</button>
              <button className="doc-bot-btn" onClick={registrar} disabled={registrando}>
                <span className="doc-bot-glow" />
                <span className="doc-bot-label">{registrando ? '🤖 Registrando…' : '🤖 Registrar comprobante'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function EscanearDoc({ empresas, onClose, onCreated }) {
  const [file, setFile] = useState(null)
  const [url, setUrl] = useState(null)
  const [analizando, setAnalizando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')
  const [creando, setCreando] = useState(false)
  const [sug, setSug] = useState(null)
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id || '')
  const [verClasif, setVerClasif] = useState(false)

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setResultado(null); setError(''); setSug(null); setVerClasif(false)
    if (url) URL.revokeObjectURL(url)
    setFile(f); setUrl(URL.createObjectURL(f))
  }

  async function analizar() {
    if (!file) return
    setAnalizando(true); setError(''); setResultado(null)
    try {
      const d = await apiAnalizarDocumento(file)
      setResultado(d.datos)
      setSug(d.sugerencia)
    } catch (e) {
      setError(e.message)
    } finally {
      setAnalizando(false)
    }
  }

  async function programar() {
    setCreando(true)
    try {
      const d = await apiCreateObligacion({
        empresa_id: empresaId ? Number(empresaId) : null,
        tipo: sug.tipo, titulo: sug.titulo, descripcion: sug.descripcion,
        periodo: '', fecha_vencimiento: sug.fecha_vencimiento, prioridad: sug.prioridad,
      })
      onCreated(d.obligacion)
    } catch (e) {
      alert(`⚠️ ${e.message}`)
    } finally {
      setCreando(false)
    }
  }

  const isPdf = file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))

  return (
    <div className="doc-overlay">
      <div className="doc-modal">
        <div className="doc-head">
          <div className="doc-head-title">📄 Escanear documento con IA</div>
          <button className="doc-close" onClick={onClose}>✕</button>
        </div>

        <div className="doc-body">
          {/* Visor — factura en grande, sin panel de miniaturas */}
          <div className="doc-viewer">
            {!file ? (
              <label className="doc-drop">
                <input type="file" accept="application/pdf,image/*" onChange={pick} hidden />
                <div className="doc-scan">
                  <div className="doc-scan-ring" />
                  <img src="/robot.png" alt="DashBot" className="doc-scan-img" />
                  <div className="doc-scan-line" />
                </div>
                <div className="doc-drop-t">Sube tu comprobante</div>
                <div className="doc-drop-s">Factura, boleta o comprobante de retención · PDF, JPG o PNG</div>
                <span className="doc-drop-btn">⚡ Elegir archivo</span>
                <div className="doc-drop-hint">La IA escaneará y extraerá los datos automáticamente</div>
              </label>
            ) : isPdf ? (
              <iframe title="documento" src={`${url}#toolbar=1&navpanes=0&scrollbar=1&view=FitH`} className="doc-frame" />
            ) : (
              <img src={url} alt="documento" className="doc-img" />
            )}
            {file && (
              <label className="doc-rechoose">
                <input type="file" accept="application/pdf,image/*" onChange={pick} hidden />
                Cambiar archivo
              </label>
            )}
          </div>

          {/* Panel IA */}
          <div className="doc-panel">
            {!resultado && (
              <div className="doc-panel-empty">
                <div className="doc-ai-badge">⚡ Motor de IA</div>
                <p>Sube un comprobante y la IA leerá automáticamente sus datos (OCR), detectará si requiere detracción y te propondrá una tarea con fecha y recordatorios.</p>
                <div className="doc-feats">
                  <span className="doc-feat">🔍 OCR inteligente</span>
                  <span className="doc-feat">💧 Detracción</span>
                  <span className="doc-feat">🛒 Compra / Venta</span>
                  <span className="doc-feat">📅 Tarea + recordatorio</span>
                </div>
                <button className="doc-bot-btn doc-bot-cta" onClick={analizar} disabled={!file || analizando}>
                  <span className="doc-bot-glow" />
                  <span className="doc-bot-label">{analizando ? '🤖 Analizando…' : '🤖 Analizar con IA'}</span>
                </button>
                {error && <div className="error-msg" style={{ marginTop: 12 }}>⚠️ {error}</div>}
              </div>
            )}

            {resultado && (
              <>
                <div className="doc-detected">🤖 Datos detectados por IA</div>
                <div className="doc-campos">
                  <Campo label="Tipo" value={resultado.tipo_comprobante} />
                  <Campo label="Comprobante" value={resultado.serie_numero} />
                  <Campo label="Proveedor" value={resultado.razon_social_emisor} />
                  <Campo label="RUC emisor" value={resultado.ruc_emisor} />
                  <Campo label="Cliente" value={resultado.razon_social_cliente} />
                  <Campo label="Fecha emisión" value={resultado.fecha_emision} />
                  <Campo label="Base imponible" value={resultado.base_imponible != null ? `S/ ${resultado.base_imponible}` : null} />
                  <Campo label="IGV" value={resultado.igv != null ? `S/ ${resultado.igv}` : null} />
                  <Campo label="Total" value={resultado.importe_total != null ? `S/ ${resultado.importe_total}` : null} />
                  {resultado.detraccion_aplica && <>
                    <div className="doc-detr">💧 Sujeto a DETRACCIÓN</div>
                    <Campo label="% Detracción" value={resultado.detraccion_porcentaje ? `${resultado.detraccion_porcentaje}%` : null} />
                    <Campo label="Monto detracción" value={resultado.detraccion_monto != null ? `S/ ${resultado.detraccion_monto}` : null} />
                    <Campo label="Código" value={resultado.detraccion_codigo} />
                    <Campo label="Cuenta BN" value={resultado.cuenta_banco_nacion} />
                  </>}
                </div>

                {/* Botón futurista: registrar con el bot */}
                <button className="doc-bot-btn doc-bot-cta" onClick={() => setVerClasif(true)}>
                  <span className="doc-bot-glow" />
                  <span className="doc-bot-label">🤖 Registrar con el bot</span>
                  <span className="doc-bot-hint">Clasifica y guarda en tu libro contable</span>
                </button>

                {sug && (
                  <div className="doc-sugerencia">
                    <div className="doc-sug-head">✅ He detectado una obligación tributaria</div>
                    <div className="doc-sug-title">{sug.titulo}</div>
                    <div className="doc-sug-fecha">📅 Vence: <strong>{fmtFecha(sug.fecha_vencimiento)}</strong></div>
                    {sug.nota_fecha && <div className="doc-sug-nota">{sug.nota_fecha}</div>}
                    <div className="form-group" style={{ marginTop: 10 }}>
                      <label className="form-label">Empresa</label>
                      <select className="form-input" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                        <option value="">— Sin empresa —</option>
                        {empresas.map((e) => <option key={e.id} value={e.id}>{empNombre(e)}</option>)}
                      </select>
                    </div>
                    <div className="doc-sug-actions">
                      <button className="btn-accent" onClick={programar} disabled={creando}>
                        {creando ? '⏳...' : '✅ Programar tarea'}
                      </button>
                      <button className="btn-secondary" onClick={onClose}>❌ Ignorar</button>
                    </div>
                    <div className="doc-sug-foot">La tarea entra a tu Agenda y recibirá recordatorios automáticos según tu configuración.</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {verClasif && resultado && (
        <ClasificacionVentana
          datos={resultado} empresas={empresas}
          empresaId={empresaId} setEmpresaId={setEmpresaId}
          onClose={() => setVerClasif(false)}
          onRegistered={() => setVerClasif(false)}
        />
      )}
    </div>
  )
}
