import { useState } from 'react'

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('es-PE', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return iso.slice(0, 10) }
}

export default function NotificationCard({ notif, onMarkRead }) {
  const [expanded, setExpanded] = useState(false)

  const icon = notif.is_urgent ? '🔴' : notif.status === 'leido' ? '📭' : '📬'
  const badge = notif.is_urgent ? 'urgent' : notif.status === 'nuevo' ? 'new' : 'read'
  const badgeText = notif.is_urgent ? '⚠️ URGENTE' : notif.status === 'nuevo' ? '● Nuevo' : '✓ Leído'

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
        <div className="notif-body">
          {notif.body_text && <p style={{ marginBottom: 10 }}>{notif.body_text}</p>}
          {notif.summary && (
            <p style={{ fontStyle: 'italic', color: '#444', marginBottom: 10 }}>
              💡 <strong>Resumen:</strong> {notif.summary}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {notif.has_attachment && (
              <button
                className="btn-quick"
                style={{ borderColor: '#1a56a0', color: '#1a56a0' }}
                onClick={(e) => { e.stopPropagation(); alert('Descarga disponible cuando se conecte a SUNAT real.') }}
              >
                📥 Descargar {notif.attachment_name || 'adjunto'}
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
        </div>
      )}
    </div>
  )
}
