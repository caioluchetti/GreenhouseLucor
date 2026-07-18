import { useState, useEffect, useCallback, useRef } from 'react'

const STATUS_LABELS = {
  idle: 'Nenhuma atualização em andamento',
  starting: 'Iniciando atualização...',
  ok: 'Atualização concluída — dispositivo reiniciando',
  failed: 'Falha na atualização',
  no_update: 'Nenhuma atualização aplicada',
}

export default function FirmwarePanel({ api, authHeaders }) {
  const [file, setFile] = useState(null)
  const [version, setVersion] = useState('')
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)
  const [otaStatus, setOtaStatus] = useState(null)
  const [files, setFiles] = useState([])
  const pollRef = useRef(null)
  const [device, setDevice] = useState('greenhouse')
  const fetchStatus = useCallback(async () => {
    try {
        const res = await fetch(`${api}/firmware/status?device=${device}`)
      if (res.ok) {
        const data = await res.json()
        setOtaStatus(data)
        return data
      }
    } catch (err) {
      console.error('Firmware status fetch error:', err)
    }
    return null
  }, [api, device])

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${api}/firmware/list`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files || [])
      }
    } catch (err) {
      console.error('Firmware list fetch error:', err)
    }
  }, [api])

  useEffect(() => {
    fetchStatus()
    fetchFiles()
  }, [fetchStatus, fetchFiles])
  // Poll while an update is actively in progress
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const data = await fetchStatus()
      if (data && (data.status === 'ok' || data.status === 'failed' || data.status === 'no_update')) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }, 2000)
  }, [fetchStatus])

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])



  
  const handleUpload = async () => {
    if (!file || !version) return
    setUploading(true)
    setMessage(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await fetch(`${api}/firmware/upload?version=${encodeURIComponent(version)}&device=${device}`, 
      { method: 'POST', body: form, headers: authHeaders() })
      if (!uploadRes.ok) {
        setMessage({ type: 'error', text: 'Falha no envio do arquivo' })
        return
      }
      const uploaded = await uploadRes.json()
      await deploy(uploaded.filename, uploaded.version)
      await fetchFiles()
      setFile(null)
      setVersion('')
    } catch (err) {
      console.error('Upload error:', err)
      setMessage({ type: 'error', text: 'Erro de conexão ao enviar' })
    } finally {
      setUploading(false)
    }
  }

  const deploy = async (filename, ver) => {
    try {
        const res = await fetch(`${api}/firmware/deploy?filename=${encodeURIComponent(filename)}&version=${encodeURIComponent(ver)}&device=${device}`,
         { method: 'POST', headers: authHeaders() })
      if (res.ok) {
        setMessage({ type: 'ok', text: `Atualização para v${ver} enviada ao dispositivo` })
        startPolling()
      } else {
        setMessage({ type: 'error', text: 'Falha ao iniciar atualização' })
      }
    } catch (err) {
      console.error('Deploy error:', err)
      setMessage({ type: 'error', text: 'Erro de conexão ao iniciar atualização' })
    }
  }

  const redeploy = (filename) => {
    const match = filename.match(/(?:tatufa|camera|greenhouse)_v(.+)\.bin/)
    const ver = match ? match[1] : ''
    deploy(filename, ver)
  }

  const isBusy = otaStatus && otaStatus.status === 'starting'

  return (
    <div className="space-y-4">
      <div className="p-4 border rounded-lg border-(--sp-accent-border-light)">
        <h3 className="font-medium mb-3">Enviar novo firmware</h3>

        <div className="flex flex-col gap-2 max-w-sm">
          <select value={device} onChange={e => setDevice(e.target.value)} className="border rounded p-2 mb-2 w-full bg-transparent" disabled={uploading || isBusy}>
            <option value="greenhouse">Placa principal (Tatufa)</option>
            <option value="camera">Câmera (ESP32-CAM)</option>
          </select>
          <input
            type="text"
            placeholder="Versão (ex: 1.2.0)"
            value={version}
            onChange={e => setVersion(e.target.value)}
            className="border rounded p-2 bg-transparent"
            disabled={uploading || isBusy}
          />
          <input
            type="file"
            accept=".bin"
            onChange={e => setFile(e.target.files[0])}
            disabled={uploading || isBusy}
          />
          <button
            onClick={handleUpload}
            disabled={uploading || isBusy || !file || !version}
            className="px-4 py-2 rounded sp-tab-active disabled:opacity-50 w-fit"
          >
            {uploading ? 'Enviando...' : 'Enviar e atualizar'}
          </button>
        </div>

        {message && (
          <p className={`text-sm mt-3 ${message.type === 'error' ? 'text-red-500' : 'text-(--sp-accent-muted)'}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="p-4 border rounded-lg border-(--sp-accent-border-light)">
        <h3 className="font-medium mb-2">Status da atualização</h3>
        <div className="flex items-center gap-2 text-sm">
          {isBusy && (
            <div className="w-4 h-4 border-2 border-(--sp-loading-bg) border-t-(--sp-loading-accent) rounded-full animate-spin" />
          )}
          <span>{STATUS_LABELS[otaStatus?.status] || 'Carregando status...'}</span>
        </div>
        {otaStatus?.error && (
          <p className="text-sm text-red-500 mt-1">Erro: {otaStatus.error}</p>
        )}
        {otaStatus?.current_version && (
          <p className="text-sm text-(--sp-accent-muted) mt-2">
            Versão atual reportada pelo dispositivo: <strong>{otaStatus.current_version}</strong>
          </p>
        )}
      </div>

      {files.length > 0 && (
        <div className="p-4 border rounded-lg border-(--sp-accent-border-light)">
          <h3 className="font-medium mb-2">Firmwares já enviados</h3>
          <ul className="space-y-2">
            {files.map(f => (
              <li key={f} className="flex items-center justify-between text-sm">
                <span>{f}</span>
                <button
                  onClick={() => redeploy(f)}
                  disabled={isBusy}
                  className="px-3 py-1 rounded sp-tab-inactive disabled:opacity-50"
                >
                  Reenviar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}