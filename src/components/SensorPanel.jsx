export default function SensorPanel({ sensors }) {
  const hasInside = sensors.inside_temperature !== '--' || sensors.inside_humidity !== '--'
  const hasOutside = sensors.outside_temperature !== '--' || sensors.outside_humidity !== '--'

  if (!hasInside && !hasOutside) return null

  return (
    <div>
      <h3 className="text-xs font-semibold text-(--sp-text-dim) mb-3 tracking-widest uppercase flex items-center gap-2">
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Sensores
      </h3>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <ClimateBox
          label="Dentro"
          icon="🏠"
          temperature={sensors.inside_temperature}
          humidity={sensors.inside_humidity}
          gradient="var(--sp-gradient-temp)"
        />
        <ClimateBox
          label="Fora"
          icon="🌤️"
          temperature={sensors.outside_temperature}
          humidity={sensors.outside_humidity}
          gradient="var(--sp-gradient-humid)"
        />
      </div>
    </div>
  )
}

function ClimateBox({ label, icon, temperature, humidity, gradient }) {
  const hasTemp = temperature !== '--' && temperature !== undefined
  const hasHum = humidity !== '--' && humidity !== undefined

  return (
    <div className="sp-glass-sm p-3 sm:p-4" style={{ backgroundImage: gradient }}>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-sm">{icon}</span>
        <span className="text-[11px] sm:text-xs font-semibold text-(--sp-text) uppercase tracking-wide">{label}</span>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base sm:text-lg">🌡️</span>
          <div className="flex flex-col">
            <span className="text-[9px] sm:text-[10px] text-(--sp-text-dim) uppercase tracking-wide">Temperatura</span>
            <span className="text-base sm:text-xl font-bold font-mono text-(--sp-text)">
              {hasTemp ? temperature : '--'}<span className="text-[10px] sm:text-xs font-normal text-(--sp-text-dim) ml-0.5">°C</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-base sm:text-lg">💧</span>
          <div className="flex flex-col">
            <span className="text-[9px] sm:text-[10px] text-(--sp-text-dim) uppercase tracking-wide">Umidade</span>
            <span className="text-base sm:text-xl font-bold font-mono text-(--sp-text)">
              {hasHum ? humidity : '--'}<span className="text-[10px] sm:text-xs font-normal text-(--sp-text-dim) ml-0.5">%</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
