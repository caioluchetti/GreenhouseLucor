import { useState, useEffect, useRef } from 'react'

export default function ZoneCard({ id, label, icon, state, irrigationRemaining, irrigationTotal, nextIrrigation, onToggle, onRename, onIconChange }) {
  const [animating, setAnimating] = useState(false)
  const [localSeconds, setLocalSeconds] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editingIcon, setEditingIcon] = useState(false)
  const [editValue, setEditValue] = useState(label)
  const [editIcon, setEditIcon] = useState(icon)
  const inputRef = useRef(null)
  const iconInputRef = useRef(null)
  const isOn = state === 'ON'

  useEffect(() => {
    if (irrigationTotal > 0 && irrigationRemaining > 0) {
      setLocalSeconds(Math.round(irrigationRemaining * 60))
    } else {
      setLocalSeconds(0)
    }
  }, [irrigationRemaining, irrigationTotal])

  useEffect(() => {
    if (!isOn || irrigationTotal <= 0) return
    const interval = setInterval(() => {
      setLocalSeconds(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [isOn, irrigationTotal])

  useEffect(() => { setEditValue(label) }, [label])
  useEffect(() => { setEditIcon(icon) }, [icon])
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() } }, [editing])
  useEffect(() => { if (editingIcon && iconInputRef.current) { iconInputRef.current.focus(); iconInputRef.current.select() } }, [editingIcon])

  const handleToggle = () => { setAnimating(true); onToggle(); setTimeout(() => setAnimating(false), 700) }

  const handleSaveName = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== label) onRename(trimmed)
    setEditing(false)
  }
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSaveName()
    if (e.key === 'Escape') { setEditValue(label); setEditing(false) }
  }
  const handleSaveIcon = () => {
    const trimmed = editIcon.trim()
    if (trimmed && trimmed !== icon) onIconChange(trimmed)
    setEditingIcon(false)
  }
  const handleIconKeyDown = (e) => {
    if (e.key === 'Enter') handleSaveIcon()
    if (e.key === 'Escape') { setEditIcon(icon); setEditingIcon(false) }
  }

  const irrigationActive = isOn && irrigationTotal > 0 && irrigationRemaining > 0
  const progressPercent = irrigationActive ? (irrigationRemaining / irrigationTotal) * 100 : 0

  const formatTime = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60)
    const s = Math.max(0, totalSeconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className={`sp-glass p-2.5 sm:p-5 transition-all duration-500 relative overflow-hidden flex flex-col items-center text-center ${
      isOn ? 'sp-glow-green' : ''
    }`}>
      {isOn && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
      )}

      {editingIcon ? (
        <input
          ref={iconInputRef}
          value={editIcon}
          onChange={e => setEditIcon(e.target.value)}
          onBlur={handleSaveIcon}
          onKeyDown={handleIconKeyDown}
          className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-base sm:text-lg text-center sp-input p-0 flex-shrink-0"
          maxLength={4}
        />
      ) : (
        <div
          className={`w-7 h-7 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-base sm:text-lg transition-colors duration-500 flex-shrink-0 cursor-pointer hover:bg-(--sp-accent-bg-light) ${
            isOn ? 'bg-(--sp-accent-bg)' : 'bg-(--sp-surface-raised)'
          }`}
          onClick={() => { setEditIcon(icon); setEditingIcon(true) }}
          title="Clique para mudar o ícone"
        >
          {icon}
        </div>
      )}

      <div className="mt-1.5 sm:mt-2 max-w-full">
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={handleKeyDown}
            className="sp-input text-[11px] sm:text-sm font-semibold py-0.5 px-1.5 w-full"
            maxLength={30}
          />
        ) : (
          <span
            className="font-semibold text-[11px] sm:text-sm text-(--sp-text) truncate cursor-pointer hover:text-(--sp-accent) transition-colors block max-w-full"
            onClick={() => setEditing(true)}
            title="Clique para renomear"
          >
            {label}
          </span>
        )}
      </div>

      <span className={`text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full font-mono uppercase tracking-wide transition-all duration-500 mt-1.5 sm:mt-2 ${
        isOn
          ? 'bg-(--sp-accent-bg) text-(--sp-accent) border border-(--sp-accent-border)'
          : 'bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle)'
      }`}>
        {isOn ? 'ON' : 'OFF'}
      </span>

      {nextIrrigation && !irrigationActive && (
        <span className="text-[9px] sm:text-[10px] text-(--sp-accent-muted) flex items-center gap-0.5 mt-1.5 leading-tight">
          <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="7" /><path d="M8 4v4l3 2" strokeLinecap="round" />
          </svg>
          {nextIrrigation}
        </span>
      )}

      {irrigationActive ? (
        <div className="mt-2 w-full space-y-1">
          <div className="sp-irrigation-bar h-1.5 sm:h-2">
            <div className="sp-irrigation-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="text-[10px] sm:text-[11px] font-mono font-medium text-(--sp-accent)">
            {formatTime(localSeconds)}
          </div>
        </div>
      ) : (
        <button
          onClick={handleToggle}
          disabled={animating}
          className="mt-2 sm:mt-3 w-full py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-semibold uppercase tracking-wide transition-all duration-300 bg-(--sp-surface-raised) text-(--sp-text-muted) border border-(--sp-border-subtle) hover:bg-(--sp-accent-bg-light) hover:text-(--sp-accent) hover:border-(--sp-accent-border)"
        >
          {animating ? '⌛' : 'Ligar'}
        </button>
      )}

      {irrigationActive && (
        <button
          onClick={handleToggle}
          disabled={animating}
          className="mt-1.5 w-full py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all uppercase tracking-wide"
        >
          Desligar
        </button>
      )}
    </div>
  )
}
