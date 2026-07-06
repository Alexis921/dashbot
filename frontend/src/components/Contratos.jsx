import { useState, useEffect, useRef } from 'react'
import ConfirmModal from './ConfirmModal'
import {
  apiListDocumentos, apiUploadDocumento, apiDownloadDocumento, apiDeleteDocumento,
  apiListColaboradores, apiListEmpresas,
} from '../api'

const TIPOS = [
  { v: 'contrato', l: '📄 Contrato', c: '#dbeafe' },
  { v: 'boleta', l: '🧾 Boleta de pago', c: '#dcfce7' },
  { v: 'identidad', l: '🪪 Documento de identidad', c: '#fef3c7' },
  { v: 'cv', l: '📋 Currículum (CV)', c: '#ede9fe' },
  { v: 'certificado', l: '🎓 Certificado', c: '#fce7f3' },
  { v: 'otro', l: '📎 Otro', c: '#e2e8f0' },
]
const TIPO_MAP = Object.fromEntries(TIPOS.map((t) => [t.v, t]))
const ICON = (t) => (TIPO_MAP[t]?.l || '📎 Otro').split(' ')[0]
const COLOR = (t) => TIPO_MAP[t]?.c || '#e2e8f0'

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
function fmtFecha(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso.slice(0, 10) }
}

function UploadModal({ colaboradores, preColab, onClose, onSaved }) {
  const [f, setF] = useState({
    colaborador_id: preColab ? String(preColab) : '', colaborador_nombre: '', empresa_id: '',
    tipo: 'contrato', titulo: '', descripcion: '',
  })
  const [file, setFile] = useState(null)
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  function pickColab(e) {
    const c = colaboradores.find((x) => String(x.id) === e.target.value)
    setF((x) => ({ ...x, colaborador_id: e.target.value, colaborador_nombre: c ? c.nombre_completo : '', empresa_id: c ? c.empresa_id : x.empresa_id }))
  }
  async function guardar(e) {
    e.preventDefault(); setErr('')
    if (!f.colaborador_id) return setErr('Elige un colaborador.')
    if (!file) return setErr('Selecciona un archivo.')
    setSaving(true)
    try {
      const d = await apiUploadDocumento({
        colaboradorId: Number(f.colaborador_id), empresaId: f.empresa_id ? Number(f.empresa_id) : 0,
        colaboradorNombre: f.colaborador_nombre, tipo: f.tipo, titulo: f.titulo, descripcion: f.descripcion, file,
      })
      onSaved(d.documento)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal colab-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>📎 Subir documento</h3>
        {err && <div className="error-msg" style={{ marginBottom: 12 }}>⚠️ {err}</div>}
        <form onSubmit={guardar}>
          <div className="form-group"><label className="form-label">Colaborador *</label>
            <select className="form-input" value={f.colaborador_id} onChange={pickColab}>
              <option value="">— Selecciona —</option>
              {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nombre_completo}</option>)}
            </select></div>
          <div className="colab-row">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Tipo</label>
              <select className="form-input" value={f.tipo} onChange={set('tipo')}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label className="form-label">Título (opcional)</label>
              <input className="form-input" value={f.titulo} onChange={set('titulo')} placeholder="Ej. Contrato a plazo fijo" /></div>
          </div>
          <div className="form-group"><label className="form-label">Descripción (opcional)</label>
            <textarea className="form-input" value={f.descripcion} onChange={set('descripcion')} rows={2} /></div>
          <div className="form-group">
            <label className="form-label">Archivo * <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(PDF, imagen o Word · máx. 15 MB)</span></label>
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button type="button" className="btn-secondary" style={{ width: '100%' }} onClick={() => fileRef.current?.click()}>
              {file ? `📄 ${file.name}` : '📂 Elegir archivo…'}
            </button>
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-accent" disabled={saving}>{saving ? '⏳ Subiendo…' : '⬆️ Subir'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Contratos({ onBack }) {
  const [empresas, setEmpresas] = useState([])
  const [colabs, setColabs] = useState([])
  const [filtroEmp, setFiltroEmp] = useState(0)
  const [filtroColab, setFiltroColab] = useState(0)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [confirmar, setConfirmar] = useState(null)
  const [borrando, setBorrando] = useState(false)
  const [bajando, setBajando] = useState(0)

  useEffect(() => { apiListEmpresas().then((d) => setEmpresas(d.empresas || [])).catch(() => {}) }, [])
  useEffect(() => { apiListColaboradores(filtroEmp).then((d) => setColabs(d.colaboradores || [])).catch(() => {}) }, [filtroEmp])

  async function loadDocs() {
    setLoading(true)
    try { const d = await apiListDocumentos(filtroColab, filtroEmp); setDocs(d.documentos || []) }
    catch (_) {} finally { setLoading(false) }
  }
  useEffect(() => { loadDocs() }, [filtroEmp, filtroColab])

  async function descargar(d) {
    setBajando(d.id)
    try { await apiDownloadDocumento(d.id, d.nombre_archivo) } catch (e) { alert(`⚠️ ${e.message}`) } finally { setBajando(0) }
  }
  async function confirmarEliminar() {
    setBorrando(true)
    try { await apiDeleteDocumento(confirmar.id); setDocs((p) => p.filter((x) => x.id !== confirmar.id)); setConfirmar(null) }
    catch (e) { alert(`⚠️ ${e.message}`) } finally { setBorrando(false) }
  }

  return (
    <div className="prog-page">
      <div className="empresas-header">
        <div>
          <button className="eq-back" onClick={onBack}>← Equipo</button>
          <h1 className="empresas-title">📄 Contratos y documentos</h1>
          <p className="empresas-sub">Guarda contratos, boletas y archivos de cada colaborador en un solo lugar.</p>
        </div>
        <button className="btn-accent" style={{ flex: 'none' }} onClick={() => setModal(true)}>+ Subir documento</button>
      </div>

      <div className="pl-filters" style={{ marginBottom: 12 }}>
        <select className="form-input" value={filtroEmp} onChange={(e) => { setFiltroEmp(Number(e.target.value)); setFiltroColab(0) }} style={{ width: 200 }}>
          <option value={0}>Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.alias || e.razon_social || e.ruc}</option>)}
        </select>
        <select className="form-input" value={filtroColab} onChange={(e) => setFiltroColab(Number(e.target.value))} style={{ width: 220 }}>
          <option value={0}>Todos los colaboradores</option>
          {colabs.map((c) => <option key={c.id} value={c.id}>{c.nombre_completo}</option>)}
        </select>
      </div>

      {loading ? <div className="empresas-empty">Cargando…</div>
        : docs.length === 0 ? (
          <div className="empresas-empty">
            <div style={{ fontSize: 38 }}>📄</div>
            <h3>Sin documentos</h3>
            <p>Sube el contrato, la boleta o cualquier archivo de tus colaboradores.</p>
            <button className="btn-accent" style={{ marginTop: 14 }} onClick={() => setModal(true)}>+ Subir documento</button>
          </div>
        ) : (
          <div className="empresas-table">
            {docs.map((d) => (
              <div className="doc-row" key={d.id}>
                <div className="doc-icon" style={{ background: COLOR(d.tipo) }}>{ICON(d.tipo)}</div>
                <div>
                  <div className="empresa-name">{d.titulo || d.nombre_archivo}</div>
                  <div className="empresa-ruc">{d.colaborador_nombre || '—'}{d.descripcion ? ` · ${d.descripcion}` : ''}</div>
                </div>
                <div className="empresa-cell-muted">{(TIPO_MAP[d.tipo]?.l || 'Otro').replace(/^\S+\s/, '')}</div>
                <div className="empresa-cell-muted">{fmtSize(d.tamano)}<br />{fmtFecha(d.fecha_subida)}</div>
                <div className="empresa-actions">
                  <button className="btn-icon" title="Descargar" disabled={bajando === d.id} onClick={() => descargar(d)}>{bajando === d.id ? '⏳' : '⬇️'}</button>
                  <button className="btn-icon" title="Eliminar" onClick={() => setConfirmar(d)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}

      {modal && <UploadModal colaboradores={colabs} preColab={filtroColab || null}
        onClose={() => setModal(false)}
        onSaved={(doc) => {
          setModal(false)
          if ((!filtroColab || filtroColab === doc.colaborador_id) && (!filtroEmp || filtroEmp === doc.empresa_id)) setDocs((p) => [doc, ...p])
          else loadDocs()
        }} />}
      {confirmar && <ConfirmModal title="Eliminar documento" message="¿Eliminar este archivo? No se puede deshacer."
        detail={confirmar.titulo || confirmar.nombre_archivo} loading={borrando}
        onCancel={() => setConfirmar(null)} onConfirm={confirmarEliminar} />}
    </div>
  )
}
