import { useState } from 'react'
import ScheduleForm from './ScheduleForm.jsx'

const DAYS_MAP = {
  mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb', sun: 'Dom'
}

const ZONE_LABELS = { 1: 'Zona 1 · Hortaliças', 2: 'Zona 2 · Temperos', 3: 'Zona 3 · Frutas' }
const ZONE_ICONS = { 1: '🥬', 2: '🌿', 3: '🍓' }

export default function SchedulesView({ schedules, zoneNames, onCreate, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const grouped = {}
  for (const s of schedules) {
    const tt = s.target_type || 'zone'
    const key = tt === 'light' ? 'light' : `zone_${s.zone_id}`
    if (!grouped[key]) grouped[key] = { target_type: tt, zone_id: s.zone_id, schedules: [] }
    grouped[key].schedules.push(s)
  }

  const orderedKeys = Object.keys(grouped).sort((a, b) => {
    if (a === 'light') return 1
    if (b === 'light') return -1
    const za = parseInt(a.split('_')[1])
    const zb = parseInt(b.split('_')[1])
    return za - zb
  })

  const handleEdit = (s) => { setEditing(s); setShowForm(true) }
  const handleNew = () => { setEditing(null); setShowForm(true) }
  const handleSubmit = (data) => {
    if (editing) {
      onUpdate(editing.id, data)
    } else {
      onCreate(data)
    }
    setShowForm(false)
    setEditing(null)
  }

  const renderHeader = (group) => {
    if (group.target_type === 'light') {
      return (
        <h3 className="text-xs font-semibold text-(--sp-text-dim) tracking-wider uppercase flex items-center gap-2">
          <span>💡</span>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-(--sp-text-muted) tracking-wide">Dispositivo</span>
            <span>Luz</span>
          </div>
        </h3>
      )
    }
    const icon = zoneNames?.[group.zone_id]?.icon || ZONE_ICONS[group.zone_id] || '🌱'
    const customName = zoneNames?.[group.zone_id]?.name
    return (
      <h3 className="text-xs font-semibold text-(--sp-text-dim) tracking-wider uppercase flex items-center gap-2">
        <span>{icon}</span>
        <div className="flex flex-col">
          <span className="text-[10px] font-mono text-(--sp-text-muted) tracking-wide">Zona {group.zone_id}</span>
          <span>{customName || ZONE_LABELS[group.zone_id]}</span>
        </div>
      </h3>
    )
  }

  return (
    <div className="sp-fade-in space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold sp-text-gradient">Agendamentos</h2>
        <button
          onClick={handleNew}
          className="sp-btn-primary"
        >
          + Novo
        </button>
      </div>

      {orderedKeys.length === 0 && (
        <div className="sp-glass p-12 text-center">
          <div className="text-5xl mb-4 opacity-30">⏰</div>
          <p className="text-sm text-(--sp-text-dim)">Nenhum agendamento configurado.</p>
          <p className="text-xs text-(--sp-text-muted) mt-1">Crie um para automatizar a irrigação ou iluminação.</p>
        </div>
      )}

      {orderedKeys.map(k => {
        const group = grouped[k]
        return (
          <div key={k} className="space-y-2.5">
            {renderHeader(group)}
            <div className="space-y-2">
              {group.schedules.map(s => (
                <div
                  key={s.id}
                  className={`sp-glass-sm p-3.5 flex items-center gap-4 transition-all duration-300 ${
                    s.enabled ? '' : 'opacity-40'
                  }`}
                >
                  <label className="relative cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      className="sp-toggle"
                      checked={s.enabled}
                      onChange={() => onUpdate(s.id, { enabled: !s.enabled })}
                    />
                  </label>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5">
                      {s.days.split(',').map(d => (
                        <span
                          key={d}
                          className={`text-[10px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wide ${
                            s.enabled
                              ? 'bg-(--sp-accent-bg-light) text-(--sp-accent-dim) border border-(--sp-accent-border-light)'
                              : 'bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle)'
                          }`}
                        >
                          {DAYS_MAP[d.trim()] || d}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs whitespace-nowrap">
                    <span className="font-mono text-(--sp-text) font-medium">{s.time}</span>
                    <span className="text-(--sp-text-dim)">{s.duration}min</span>
                  </div>

                  <div className="flex gap-0.5">
                    <button
                      onClick={() => handleEdit(s)}
                      className="p-1.5 text-(--sp-text-muted) hover:text-(--sp-text) transition-colors rounded-lg hover:bg-(--sp-surface-raised-hover)"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onDelete(s.id)}
                      className="p-1.5 text-(--sp-text-muted) hover:text-(--sp-danger) transition-colors rounded-lg hover:bg-(--sp-surface-raised-hover)"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {showForm && (
        <ScheduleForm
          initial={editing}
          zoneNames={zoneNames}
          onSubmit={handleSubmit}
          onCancel={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </div>
  )
}