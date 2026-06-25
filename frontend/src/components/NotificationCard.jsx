import { useState } from 'react'
import { apiInterpret, apiDownloadPdf } from '../api'

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('es-PE', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return iso.slice(0, 10) }
}

export default function NotificationCard({ notif, onMarkRead, empresaId, demoMode = false }) {
  const [expanded, setExpanded] = useState(false)
  const [interpretation, setInterpretation] = useState(null)
  const [loadingAI, setLoadingAI] = useState(false)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [aiError, setAiError] = useState(null)

  const icon = notif.is_urgent ? '🔴' : notif.status === 'leido' ? '📭' : '📬'
  const badge = notif.is_urgent ? 'urgent' : notif.status === 'nuevo' ? 'new' : 'read'
  const badgeText = notif.is_urgent ? '⚠️ URGENTE' : notif.status === 'nuevo' ? '● Nuevo' : '✓ Leído'

  async function handleInterpret(e) {
    e.stopPropagation()
    if (interpretation) { setInterpretation(null); return }
    if (demoMode) {
      setAiError('El análisis con IA está disponible al registrar una empresa real.')
      return
    }
    setLoadingAI(true)
    setAiError(null)
    try {
      const data = await apiInterpret(notif)
      setInterpretation(data.interpretation)
    } catch (err) {
      setAiError(err.message)
    } finally {
      setLoadingAI(false)
    }
  }

  async function handleDownloadPdf(e) {
    e.stopPropagation()
    if (demoMode) {
      alert('⚠️ La descarga de PDF está disponible al registrar una empresa real.')
      return
    }
    setLoadingPdf(true)
    try {
      await apiDownloadPdf(empresaId, notif.id, notif.attachment_name)
    } catch (err) {
      alert(`⚠️ ${err.message}`)
    } finally {
      setLoadingPdf(false)
    }
  }

  return (
    <div
      className={`notif-card${notif.is_urgent ? ' urgent' : ''}${notif.status === 'leido' ? ' read' : ''}`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="notif-card-header">
        <span className="notif-icon">{icon}</span>
        <span className="notif-subject">{notif.subject}</span>
        <span className={`notif-badge ${badge}`}>{badgeText}</span>
      </div>

      <div className="notif-meta">
        <span>📅 {formatDate(notif.date_received)}</span>
        {notif.reference_number && <span>🔢 {notif.reference_number}</span>}
        {notif.has_attachment && <span>📎 Adjunto</span>}
        <span>🏛️ {notif.sender || 'SUNAT'}</span>
      </div>

      {expanded && (
        <div className="notif-body" onClick={(e) => e.stopPropagation()}>
          {notif.body_text && <p style={{ marginBottom: 10 }}>{notif.body_text}</p>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: interpretation ? 12 : 0 }}>
            <button
              className="btn-quick"
              style={{ borderColor: 'var(--green)', color: 'var(--green)', background: loadingAI ? 'var(--green-light)' : '' }}
              onClick={handleInterpret}
              disabled={loadingAI}
            >
              {loadingAI ? '⏳ Analizando...' : interpretation ? '🤖 Ocultar análisis' : '🤖 Interpretar con IA'}
            </button>

            {notif.has_attachment && (
              <button
                className="btn-quick"
                style={{ borderColor: 'var(--navy)', color: 'var(--navy)' }}
                onClick={handleDownloadPdf}
                disabled={loadingPdf}
              >
                {loadingPdf ? '⏳ Descargando...' : `📥 Descargar ${notif.attachment_name || 'adjunto'}`}
              </button>
            )}

            {notif.status === 'nuevo' && (
              <button
                className="btn-quick"
                onClick={(e) => { e.stopPropagation(); onMarkRead(notif.id) }}
              >
                ✓ Marcar como leído
              </button>
            )}
          </div>

          {aiError && (
            <div style={{ background: '#fff0f0', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginTop: 8 }}>
              ⚠️ {aiError}
            </div>
          )}

          {interpretation && (
            <div style={{
              background: 'linear-gradient(135deg, #e6f7ee, #f0fdf4)',
              border: '1px solid #b3e6cc',
              borderLeft: '4px solid var(--green)',
              borderRadius: 10,
              padding: '14px 16px',
              fontSize: 13,
              color: '#1d2939',
              lineHeight: 1.7,
              marginTop: 4,
              whiteSpace: 'pre-line',
            }}>
              <div style={{ fontWeight: 700, color: 'var(--green-dk)', marginBottom: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                🤖 Análisis IA — Gemini
              </div>
              {interpretation}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
