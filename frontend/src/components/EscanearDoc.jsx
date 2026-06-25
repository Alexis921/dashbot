import { useState, useEffect } from 'react'
import { apiAnalizarDocumento, apiCreateObligacion } from '../api'

const fmtFecha = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

function Campo({ label, value }) {
  if (value == null || value === '' || value === false) return null
  return (
    <div className="doc-campo">
      <span className="doc-campo-k">{label}</span>
      <span className="doc-campo-v">{String(value)}</span>
    </div>
  )
}

export default function EscanearDoc({ empresas, onClose, onCreated }) {
  const [file, setFile] = useState(null)
  const [url, setUrl] = useState(null)
  const [analizando, setAnalizando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(false)
  const [creando, setCreando] = useState(false)
  const [sug, setSug] = useState(null)
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id || '')

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setResultado(null); setError(''); setSug(null)
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
          {/* Visor */}
          <div className="doc-viewer">
            {!file ? (
              <label className="doc-drop">
                <input type="file" accept="application/pdf,image/*" onChange={pick} hidden />
                <div style={{ fontSize: 44 }}>📤</div>
                <div className="doc-drop-t">Sube tu comprobante</div>
                <div className="doc-drop-s">Factura, boleta o comprobante de retención (PDF, JPG o PNG)</div>
                <span className="btn-accent" style={{ marginTop: 14, padding: '8px 16px', display: 'inline-block' }}>Elegir archivo</span>
              </label>
            ) : isPdf ? (
              <iframe title="documento" src={url} className="doc-frame" />
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
                <p>Sube un comprobante y la IA leerá automáticamente sus datos (OCR), detectará si requiere detracción y te propondrá una tarea con fecha y recordatorios.</p>
                <button className="btn-accent" style={{ width: '100%', padding: 11 }} onClick={analizar} disabled={!file || analizando}>
                  {analizando ? '🤖 Analizando con IA...' : '🤖 Analizar con IA'}
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
                        {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
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
    </div>
  )
}
