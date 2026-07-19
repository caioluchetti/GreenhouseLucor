import { useState, useEffect, useRef } from 'react'

export default function CameraFeed({ cameraUrl }) {
  const [connected, setConnected] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const retries = useRef(0)

  useEffect(() => {
    if (!cameraUrl) return
    setConnected(false)
    setLoadError(false)
    retries.current = 0
  }, [cameraUrl])

  if (!cameraUrl) {
    return (
      <div className="sp-glass p-4 text-center h-full flex flex-col justify-center">
        <div className="flex flex-col items-center gap-2 py-6">
          <svg className="w-8 h-8 text-(--sp-text-muted)" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M23 7l-5 4V7a2 2 0 00-2-2H3a2 2 0 00-2 2v10a2 2 0 002 2h13a2 2 0 002-2v-4l5 4V7z" />
          </svg>
          <span className="text-xs text-(--sp-text-muted)">Aguardando câmera...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="sp-glass overflow-hidden h-full flex flex-col">
      <div className="relative w-full" style={{ paddingBottom: '75%' }}>
        {loadError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-(--sp-surface)">
            <svg className="w-8 h-8 text-(--sp-text-muted)" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-(--sp-text-muted)">Câmera offline</span>
            <span className="text-[10px] text-(--sp-text-muted)">Verifique o ESP32-CAM</span>
          </div>
        ) : (
          <img
            src={cameraUrl}
            alt="Câmera da estufa"
            className="absolute inset-0 w-full h-full object-contain scale-x-[-1]"
            onError={() => setLoadError(true)}
            onLoad={() => { setConnected(true); setLoadError(false) }}
          />
        )}
      </div>
    </div>
  )
}
