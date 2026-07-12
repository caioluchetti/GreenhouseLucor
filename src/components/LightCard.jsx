import { useState } from 'react'

export default function LightCard({ state, onToggle }) {
  const [animating, setAnimating] = useState(false)
  const isOn = state === 'on'

  const handleToggle = () => {
    setAnimating(true)
    onToggle()
    setTimeout(() => setAnimating(false), 700)
  }

  return (
    <div
      className={`sp-glass p-2.5 sm:p-5 transition-all duration-500 relative overflow-hidden flex flex-col items-center text-center ${
        isOn ? '' : ''
      }`}
      style={isOn ? { boxShadow: '0 0 24px rgba(251,191,36,0.18)' } : undefined}
    >
      {isOn && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
      )}

      <div
        className={`w-7 h-7 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-base sm:text-lg transition-colors duration-500 flex-shrink-0 ${
          isOn ? 'bg-amber-500/15' : 'bg-(--sp-surface-raised)'
        }`}
      >
        💡
      </div>

      <div className="mt-1.5 sm:mt-2 max-w-full">
        <span className="font-semibold text-[11px] sm:text-sm text-(--sp-text) block max-w-full">
          Luz
        </span>
      </div>

      <span
        className={`text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full font-mono uppercase tracking-wide transition-all duration-500 mt-1.5 sm:mt-2 ${
          isOn
            ? 'bg-amber-500/15 text-amber-300 border border-amber-400/30'
            : 'bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle)'
        }`}
      >
        {isOn ? 'ON' : 'OFF'}
      </span>

      {isOn ? (
        <button
          onClick={handleToggle}
          disabled={animating}
          className="mt-1.5 w-full py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all uppercase tracking-wide"
        >
          Desligar
        </button>
      ) : (
        <button
          onClick={handleToggle}
          disabled={animating}
          className="mt-2 sm:mt-3 w-full py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-semibold uppercase tracking-wide transition-all duration-300 bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle) hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-400/30"
        >
          {animating ? '⌛' : 'Ligar'}
        </button>
      )}
    </div>
  )
}