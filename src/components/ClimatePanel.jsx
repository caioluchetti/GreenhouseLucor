import { useState, useEffect } from 'react'

export default function ClimatePanel({ climateRules, climateStatus, onRuleUpdate, onFanModeSet }) {
  const [tempHigh, setTempHigh] = useState('')
  const [tempLow, setTempLow] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (climateRules) {
      setTempHigh(climateRules.temp_high?.toString() ?? '')
      setTempLow(climateRules.temp_low?.toString() ?? '')
    }
  }, [climateRules])

  const handleSave = () => {
    setSaving(true)
    onRuleUpdate({
      temp_high: tempHigh !== '' ? parseFloat(tempHigh) : null,
      temp_low: tempLow !== '' ? parseFloat(tempLow) : null
    }).finally(() => setSaving(false))
  }

  const fanOn = climateStatus?.fan === 'on'
  const mode = climateStatus?.mode || climateRules?.fan_mode || 'auto'
  const reason = climateStatus?.reason || ''
  const temp = climateStatus?.temp ?? '--'
  const hum = climateStatus?.hum ?? '--'

  const MODES = [
    { key: 'auto', label: 'Auto', icon: '🤖', activeClass: 'bg-(--sp-accent-bg) text-(--sp-accent) border-(--sp-accent-border)' },
    { key: 'on', label: 'Ligar', icon: '⚡', activeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
    { key: 'off', label: 'Desligar', icon: '⭕', activeClass: 'bg-(--sp-surface-raised) text-(--sp-text-muted) border-(--sp-border-subtle)' }
  ]

  const reasonLabel = (r) => {
    if (!r) return ''
    if (r === 'temp_high') return 'Temperatura acima do limite'
    if (r === 'temp_low') return 'Temperatura abaixo do limite'
    if (r === 'hysteresis') return 'Em histerese'
    if (r === 'manual_on') return 'Forçado ligado'
    if (r === 'manual_off') return 'Forçado desligado'
    return r
  }

  return (
    <div className="sp-fade-in space-y-5">
      <h2 className="text-lg font-bold sp-text-gradient">Clima</h2>

      {/* ── Sensor readouts + Fan status ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Temp */}
        <div className="sp-glass-sm p-4 text-center" style={{ backgroundImage: 'var(--sp-gradient-temp)' }}>
          <div className="text-2xl mb-1">🌡️</div>
          <div className="text-[10px] text-(--sp-text-dim) tracking-wide uppercase mb-1">Temperatura</div>
          <div className="text-2xl font-bold font-mono text-(--sp-text)">
            {temp}<span className="text-sm font-normal text-(--sp-text-dim) ml-0.5">°C</span>
          </div>
        </div>

        {/* Humidity */}
        <div className="sp-glass-sm p-4 text-center" style={{ backgroundImage: 'var(--sp-gradient-humid)' }}>
          <div className="text-2xl mb-1">💧</div>
          <div className="text-[10px] text-(--sp-text-dim) tracking-wide uppercase mb-1">Umidade Ar</div>
          <div className="text-2xl font-bold font-mono text-(--sp-text)">
            {hum}<span className="text-sm font-normal text-(--sp-text-dim) ml-0.5">%</span>
          </div>
        </div>

        {/* Fan status */}
        <div className={`sp-glass p-4 transition-all duration-500 relative overflow-hidden ${fanOn ? 'sp-glow-green' : ''}`}>
          {fanOn && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
          )}
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] text-(--sp-text-dim) tracking-wide uppercase">Ventilador</div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wide ${
              fanOn
                ? 'bg-(--sp-accent-bg) text-(--sp-accent) border border-(--sp-accent-border)'
                : 'bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle)'
            }`}>
              {fanOn ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="text-2xl mb-1">{fanOn ? '🌀' : '🛑'}</div>
          <div className="text-[11px] text-(--sp-text-dim)">
            Modo: <span className="font-mono">{mode}</span>
          </div>
          {reason && (
            <div className="text-[10px] text-(--sp-text-muted) mt-1">{reasonLabel(reason)}</div>
          )}
        </div>
      </div>

      {/* ── Manual override ── */}
      <div className="sp-glass p-5">
        <h3 className="text-xs font-semibold text-(--sp-text-dim) mb-3 tracking-widest uppercase">
          Modo de operação
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => onFanModeSet(m.key)}
              className={`py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border ${
                mode === m.key
                  ? m.activeClass
                  : 'bg-(--sp-surface-raised) text-(--sp-text-muted) border-(--sp-border-subtle) hover:bg-(--sp-surface-raised-hover-strong)'
              }`}
            >
              <span className="mr-1">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Threshold editor ── */}
      <div className="sp-glass p-5">
        <h3 className="text-xs font-semibold text-(--sp-text-dim) mb-3 tracking-widest uppercase">
          Limites de temperatura (auto)
        </h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[10px] text-(--sp-text-dim) mb-2 tracking-widest uppercase">Ligar acima de (°C)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="60"
              value={tempHigh}
              onChange={e => setTempHigh(e.target.value)}
              className="sp-input w-full"
            />
          </div>
          <div>
            <label className="block text-[10px] text-(--sp-text-dim) mb-2 tracking-widest uppercase">Desligar abaixo de (°C)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="60"
              value={tempLow}
              onChange={e => setTempLow(e.target.value)}
              className="sp-input w-full"
            />
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="sp-btn-primary w-full sm:w-auto"
        >
          {saving ? '⌛ Salvando...' : 'Salvar limites'}
        </button>
        <p className="text-[10px] text-(--sp-text-muted) mt-2">
          Diferença entre ligar/desligar = histerese (evita liga/desliga rápido).
        </p>
      </div>
    </div>
  )
}
