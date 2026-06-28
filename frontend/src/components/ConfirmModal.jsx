export default function ConfirmModal({
  icon = '🗑️', title, message, detail,
  confirmLabel = 'Eliminar', cancelLabel = 'Cancelar',
  danger = true, loading = false, onConfirm, onCancel,
}) {
  return (
    <div className="cm-overlay" onClick={loading ? undefined : onCancel}>
      <div className="cm-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`cm-icon ${danger ? 'danger' : ''}`}>{icon}</div>
        <div className="cm-title">{title}</div>
        {message && <div className="cm-msg">{message}</div>}
        {detail && <div className="cm-detail">{detail}</div>}
        <div className="cm-actions">
          <button className="cm-btn cm-cancel" onClick={onCancel} disabled={loading}>{cancelLabel}</button>
          <button className={`cm-btn ${danger ? 'cm-danger' : 'cm-confirm'}`} onClick={onConfirm} disabled={loading}>
            {loading ? '⏳ Eliminando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
