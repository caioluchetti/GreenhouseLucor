import { useState } from 'react'

const DAYS = [
  { key: 'mon', label: 'S' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'Q' },
  { key: 'thu', label: 'Q' },
  { key: 'fri', label: 'S' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'D' }
]

const DAY_LABELS = {
  mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta',
  fri: 'Sexta', sat: 'Sábado', sun: 'Domingo'
}

const ZONE_EMOJIS = { 1: '🥬', 2: '🌿', 3: '🍓' }

export default function ScheduleForm({ initial, onSubmit, onCancel, zoneNames }) {
  const [targetType, setTargetType] = useState(initial?.target_type || 'zone')
  const [zoneId, setZoneId] = useState(initial?.zone_id || 1)
  const [days, setDays] = useState(new Set(initial?.days?.split(',') || []))
  const [time, setTime] = useState(initial?.time || '06:00')
  const [duration, setDuration] = useState(initial?.duration || 5)

  const toggleDay = (key) => {
    const next = new Set(days)
    next.has(key) ? next.delete(key) : next.add(key)
    setDays(next)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (days.size === 0) return
    const payload = {
      target_type: targetType,
      days: Array.from(days).join(','),
      time,
      duration,
      enabled: initial?.enabled ?? true
    }
    if (targetType === 'zone') {
      payload.zone_id = zoneId
    }
    onSubmit(payload)
  }

  const selectZone = (id) => {
    setZoneId(id)
    setTargetType('zone')
  }

  const zoneIcon = (id) => zoneNames?.[id]?.icon || ZONE_EMOJIS[id] || '🌱'
  const zoneLabel = (id) => zoneNames?.[id]?.name || `Zona ${id}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sp-overlay">
      <div className="sp-glass-modal p-7 w-full max-w-md mx-4 sp-fade-in shadow-2xl">
        <h3 className="text-lg font-bold sp-text-gradient mb-6">
          {initial ? 'Editar Agendamento' : 'Novo Agendamento'}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] text-(--sp-text-dim) mb-2 tracking-widest uppercase">Alvo</label>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3].map(id => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectZone(id)}
                  className={`py-2.5 px-3 rounded-xl text-sm font-medium transition-all duration-200 text-left flex items-center gap-2 min-w-0 ${
                    targetType === 'zone' && zoneId === id
                      ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-(--sp-accent) border border-(--sp-accent-border) shadow-[0_0_16px_rgba(74,222,128,0.1)]'
                      : 'bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle) hover:bg-(--sp-surface-raised-hover-strong) hover:text-(--sp-text-dim)'
                  }`}
                >
                  <span className="text-lg flex-shrink-0">{zoneIcon(id)}</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-mono text-(--sp-text-dim) uppercase tracking-wide">Zona {id}</span>
                    <span className="truncate">{zoneLabel(id)}</span>
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setTargetType('light')}
                className={`py-2.5 px-3 rounded-xl text-sm font-medium transition-all duration-200 text-left flex items-center gap-2 ${
                  targetType === 'light'
                    ? 'bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-amber-300 border border-amber-400/30 shadow-[0_0_16px_rgba(251,191,36,0.1)]'
                    : 'bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle) hover:bg-(--sp-surface-raised-hover-strong) hover:text-(--sp-text-dim)'
                }`}
                title="Luz"
              >
                <span className="text-lg flex-shrink-0">💡</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-mono text-(--sp-text-dim) uppercase tracking-wide">Dispositivo</span>
                  <span className="truncate">Luz</span>
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-(--sp-text-dim) mb-2 tracking-widest uppercase">Dias</label>
            <div className="flex gap-1.5">
              {DAYS.map(d => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  title={DAY_LABELS[d.key]}
                  className={`w-10 h-10 rounded-xl text-sm font-semibold transition-all duration-200 ${
                    days.has(d.key)
                      ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-(--sp-accent) border border-(--sp-accent-border)'
                      : 'bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle) hover:bg-(--sp-surface-raised-hover-strong)'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-(--sp-text-dim) mb-2 tracking-widest uppercase">Horário</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="sp-input w-full"
                style={{ colorScheme: 'var(--color-scheme, dark)' }}
              />
            </div>
            <div>
              <label className="block text-[10px] text-(--sp-text-dim) mb-2 tracking-widest uppercase">Duração (min)</label>
              <input
                type="number"
                min={1}
                max={120}
                value={duration}
                onChange={e => setDuration(parseInt(e.target.value) || 1)}
                className="sp-input w-full"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 sp-btn-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={days.size === 0}
              className="flex-1 sp-btn-primary"
            >
              {initial ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
