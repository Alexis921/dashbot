import { useState, useEffect } from 'react'
import Colaboradores from './Colaboradores'
import Planilla from './Planilla'
import Talento from './Talento'
import { apiListColaboradores } from '../api'

const SUBMODULOS = [
  { id: 'colaboradores', icon: '🧑‍💼', titulo: 'Registro de colaboradores', desc: 'Personal alineado al PDT PLAME / T-Registro.', activo: true },
  { id: 'planilla', icon: '🧾', titulo: 'Planilla y remuneraciones', desc: 'Trabajadores 5ta + renta 4ta, con importar/exportar Excel.', activo: true },
  { id: 'talento', icon: '🌟', titulo: 'Gestión del talento', desc: 'Permisos, memos, horas extras, bonos, desempeño y fechas de pago.', activo: true },
  { id: 'contratos', icon: '📄', titulo: 'Contratos y documentos', desc: 'Contratos, boletas y archivos del colaborador.', activo: false },
]

function Stat({ icon, num, label, color }) {
  return (
    <div className="cm-stat">
      <div className="cm-stat-icon" style={{ color }}>{icon}</div>
      <div><div className="cm-stat-num" style={{ color }}>{num}</div><div className="cm-stat-label">{label}</div></div>
    </div>
  )
}

export default function Equipo() {
  const [view, setView] = useState('dashboard')
  const [colabs, setColabs] = useState([])

  useEffect(() => {
    apiListColaboradores().then((d) => setColabs(d.colaboradores || [])).catch(() => {})
  }, [view])

  if (view === 'colaboradores') return <Colaboradores onBack={() => setView('dashboard')} />
  if (view === 'planilla') return <Planilla onBack={() => setView('dashboard')} />
  if (view === 'talento') return <Talento onBack={() => setView('dashboard')} />

  const total = colabs.length
  const activos = colabs.filter((c) => c.situacion === 'activo').length
  const onp = colabs.filter((c) => c.regimen_pensionario === 'ONP').length
  const afp = colabs.filter((c) => c.regimen_pensionario === 'AFP').length

  return (
    <div className="cm-page">
      <div className="cm-hero">
        <div className="cm-bot">🧑‍💼</div>
        <div>
          <div className="cm-hello">Gestión de Equipo</div>
          <div className="cm-sub">Administra a tu personal y su información laboral, lista para tus declaraciones de planilla (PLAME).</div>
        </div>
      </div>

      <div className="cm-stats">
        <Stat icon="👥" num={total} label="Colaboradores" color="#1B3A6B" />
        <Stat icon="✅" num={activos} label="Activos" color="#00A651" />
        <Stat icon="🏛️" num={onp} label="En ONP" color="#0369a1" />
        <Stat icon="📊" num={afp} label="En AFP" color="#b45309" />
      </div>

      <div className="eq-grid">
        {SUBMODULOS.map((s) => (
          <button key={s.id} className={`eq-card ${s.activo ? '' : 'soon'}`}
            onClick={() => s.activo && setView(s.id)} disabled={!s.activo}>
            <div className="eq-card-icon">{s.icon}</div>
            <div className="eq-card-title">{s.titulo}</div>
            <div className="eq-card-desc">{s.desc}</div>
            {s.activo
              ? <span className="eq-card-go">Abrir →</span>
              : <span className="eq-card-soon">Próximamente</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
