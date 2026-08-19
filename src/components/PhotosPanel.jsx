import { useEffect, useMemo, useRef, useState } from 'react'
import IlluminationPanel from './IlluminationPanel.jsx'

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

export default function PhotosPanel({ api, authHeaders }) {
  const [folders, setFolders] = useState([])
  const [activeFolder, setActiveFolder] = useState('daily')
  const [photos, setPhotos] = useState([])
  const [imageUrls, setImageUrls] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeView, setActiveView] = useState('gallery')
  const touchStartX = useRef(null)

  useEffect(() => {
    fetch(`${api}/photos`, { headers: authHeaders() })
      .then(res => {
        if (!res.ok) throw new Error('Não foi possível carregar as pastas')
        return res.json()
      })
      .then(data => setFolders(data))
      .catch(err => setError(err.message))
  }, [api, authHeaders])

  useEffect(() => {
    let cancelled = false
    let urls = {}
    setLoading(true)
    setError('')

    async function loadPhotos() {
      try {
        const response = await fetch(`${api}/photos/${activeFolder}`, { headers: authHeaders() })
        if (!response.ok) throw new Error('Não foi possível carregar as fotos')
        const data = await response.json()
        if (cancelled) return
        setPhotos(data.photos)

        await Promise.all(data.photos.map(async photo => {
          const image = await fetch(`${api}${photo.url.replace('/api', '')}`, { headers: authHeaders() })
          if (image.ok && !cancelled) urls[photo.name] = URL.createObjectURL(await image.blob())
        }))
        if (!cancelled) setImageUrls(urls)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPhotos()
    return () => {
      cancelled = true
      Object.values(urls).forEach(url => URL.revokeObjectURL(url))
      setImageUrls({})
    }
  }, [activeFolder, api, authHeaders, refreshKey])

  const activeLabel = folders.find(folder => folder.id === activeFolder)?.label || activeFolder
  const selectedInFolder = useMemo(
    () => photos.filter(photo => selected.has(`${activeFolder}/${photo.name}`)),
    [activeFolder, photos, selected]
  )

  const toggleSelected = (photo) => {
    const key = `${photo.folder}/${photo.name}`
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = () => {
    setSelected(previous => {
      const next = new Set(previous)
      const allSelected = photos.length > 0 && photos.every(photo => next.has(`${activeFolder}/${photo.name}`))
      photos.forEach(photo => {
        const key = `${activeFolder}/${photo.name}`
        if (allSelected) next.delete(key)
        else next.add(key)
      })
      return next
    })
  }

  const downloadZip = async (folder, filenames) => {
    setDownloading(true)
    try {
      const response = await fetch(`${api}/photos/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ folder, filenames }),
      })
      if (!response.ok) throw new Error((await response.json()).detail || 'Erro ao preparar download')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `greenhouse-${folder || 'fotos-selecionadas'}.zip`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  const downloadOne = async (photo) => {
    try {
      const response = await fetch(`${api}/photos/${photo.folder}/${encodeURIComponent(photo.name)}`, { headers: authHeaders() })
      if (!response.ok) throw new Error('Erro ao baixar a foto')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = photo.name
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    }
  }

  const generateGif = async () => {
    const selectedPhotos = [...selected].map(key => {
      const separator = key.indexOf('/')
      return { folder: key.slice(0, separator), name: key.slice(separator + 1) }
    }).filter(photo => photo.folder === 'daily' || photo.folder === 'interval')

    if (selectedPhotos.length < 2) return
    setDownloading(true)
    setError('')
    try {
      const response = await fetch(`${api}/photos/gif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ photos: selectedPhotos }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Erro ao gerar GIF')
      setSelected(new Set())
      setActiveFolder('gifs')
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  const deleteSelected = async () => {
    if (!selected.size || !window.confirm(`Excluir ${selected.size} arquivo${selected.size === 1 ? '' : 's'} permanentemente?`)) return
    const selectedPhotos = [...selected].map(key => {
      const separator = key.indexOf('/')
      return { folder: key.slice(0, separator), name: key.slice(separator + 1) }
    })

    setDeleting(true)
    setError('')
    try {
      const response = await fetch(`${api}/photos/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ photos: selectedPhotos }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Erro ao excluir arquivos')
      setSelected(new Set())
      setPreview(null)
      setRefreshKey(value => value + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const previewIndex = preview ? photos.findIndex(photo => photo.name === preview.name) : -1

  const showPrevious = () => {
    if (previewIndex < 0 || !photos.length) return
    setPreview(photos[(previewIndex - 1 + photos.length) % photos.length])
  }

  const showNext = () => {
    if (previewIndex < 0 || !photos.length) return
    setPreview(photos[(previewIndex + 1) % photos.length])
  }

  useEffect(() => {
    if (!preview) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'ArrowLeft') showPrevious()
      if (event.key === 'ArrowRight') showNext()
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const handleTouchStart = (event) => {
    touchStartX.current = event.touches[0].clientX
  }

  const handleTouchEnd = (event) => {
    if (touchStartX.current === null) return
    const distance = event.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(distance) < 50) return
    if (distance < 0) showNext()
    else showPrevious()
  }

  return (
    <section className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-(--sp-accent-muted)">Galeria da estufa</p>
          <h2 className="text-2xl font-semibold text-(--sp-text)">Fotos</h2>
          <p className="text-sm text-(--sp-text-dim) mt-1">Acompanhe as capturas pelo celular.</p>
        </div>
        <div className="flex gap-2">
          {folders.map(folder => (
            <button key={folder.id} onClick={() => { setActiveFolder(folder.id); setActiveView('gallery') }} className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${activeView === 'gallery' && activeFolder === folder.id ? 'sp-btn-primary' : 'sp-btn-secondary'}`}>
              {folder.label}
            </button>
          ))}
          <button onClick={() => setActiveView('illumination')} className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${activeView === 'illumination' ? 'sp-btn-primary' : 'sp-btn-secondary'}`}>
            Iluminação
          </button>
        </div>
      </div>

      {activeView === 'illumination' && <IlluminationPanel api={api} authHeaders={authHeaders} />}

      {activeView === 'gallery' && <>
      <div className="sp-glass-sm p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-(--sp-text-dim)">
          <button onClick={toggleAll} disabled={!photos.length} className="sp-btn-secondary px-3 py-2 rounded-lg">
            {selectedInFolder.length === photos.length && photos.length ? 'Desmarcar todas' : 'Selecionar todas'}
          </button>
          <span>{photos.length} foto{photos.length === 1 ? '' : 's'}</span>
          {selected.size > 0 && <strong className="text-(--sp-accent)">{selected.size} selecionada{selected.size === 1 ? '' : 's'}</strong>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => downloadZip(activeFolder)} disabled={downloading || !photos.length} className="sp-btn-secondary px-3 py-2 rounded-lg text-xs disabled:opacity-40">
            Baixar {activeLabel}
          </button>
          <button onClick={() => downloadZip(null, [...selected].map(key => key.split('/').pop()))} disabled={downloading || !selected.size} className="sp-btn-primary px-3 py-2 rounded-lg text-xs disabled:opacity-40">
            {downloading ? 'Preparando...' : 'Baixar selecionadas'}
          </button>
          <button onClick={generateGif} disabled={downloading || selected.size < 2 || activeFolder === 'gifs'} className="px-3 py-2 rounded-lg text-xs border border-(--sp-warning)/30 text-(--sp-warning) hover:bg-(--sp-warning-bg) disabled:opacity-40">
            {downloading ? 'Gerando...' : 'Gerar GIF'}
          </button>
          <button onClick={deleteSelected} disabled={downloading || deleting || !selected.size} className="px-3 py-2 rounded-lg text-xs border border-(--sp-danger)/30 text-(--sp-danger) hover:bg-red-500/10 disabled:opacity-40">
            {deleting ? 'Excluindo...' : 'Excluir selecionadas'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-(--sp-danger)">{error}</div>}

      {loading ? (
        <div className="sp-glass rounded-2xl py-20 text-center text-sm text-(--sp-text-dim)">Carregando fotos...</div>
      ) : photos.length === 0 ? (
        <div className="sp-glass rounded-2xl py-20 text-center text-sm text-(--sp-text-dim)">Nenhuma foto nesta pasta.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map(photo => {
            const key = `${photo.folder}/${photo.name}`
            const isSelected = selected.has(key)
            return (
              <article key={key} className={`sp-glass-sm overflow-hidden transition-all ${isSelected ? 'ring-2 ring-(--sp-accent)' : ''}`}>
                <button onClick={() => setPreview(photo)} className="relative block w-full aspect-square bg-black/20" aria-label={`Visualizar ${photo.name}`}>
                  {imageUrls[photo.name] ? <img src={imageUrls[photo.name]} alt={photo.name} className="w-full h-full object-cover" /> : <div className="w-full h-full animate-pulse bg-(--sp-surface-raised)" />}
                  <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-1 text-[10px] font-medium text-white shadow-lg backdrop-blur-sm">{formatDate(photo.modified_at)}</span>
                </button>
                <div className="p-2.5">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(photo)} className="mt-0.5 accent-(--sp-accent)" aria-label={`Selecionar ${photo.name}`} />
                    <div className="min-w-0">
                      <p className="text-xs text-(--sp-text) truncate">{formatDate(photo.modified_at)}</p>
                      <p className="text-[10px] text-(--sp-text-muted)">{formatSize(photo.size)}</p>
                    </div>
                  </div>
                  <button onClick={() => downloadOne(photo)} className="mt-2 text-[10px] text-(--sp-accent) hover:underline">Baixar foto</button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {preview && imageUrls[preview.name] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8" style={{ backgroundColor: 'var(--sp-overlay-bg)' }} onClick={event => { if (event.target === event.currentTarget) setPreview(null) }}>
          <div
            className="sp-glass-modal max-w-5xl w-full max-h-[95vh] p-3 sm:p-4 relative flex flex-col gap-3"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <button onClick={() => setPreview(null)} className="absolute right-3 top-3 z-10 w-9 h-9 rounded-full bg-black/50 text-white text-xl" aria-label="Fechar visualização">×</button>
            <div className="relative flex items-center justify-center min-h-0">
              <button
                onClick={showPrevious}
                disabled={photos.length < 2}
                className="absolute left-2 sm:-left-5 z-10 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/55 text-white text-3xl leading-none transition-opacity hover:bg-black/75 disabled:opacity-20"
                aria-label="Foto anterior"
              >
                ‹
              </button>
              <div className="relative max-h-[78vh] w-full flex justify-center">
                <img src={imageUrls[preview.name]} alt={preview.name} className="max-h-[78vh] w-full object-contain rounded-xl bg-black/20 select-none" draggable="false" />
                <span className="absolute bottom-3 left-3 rounded-md bg-black/65 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-sm">{formatDate(preview.modified_at)}</span>
              </div>
              <button
                onClick={showNext}
                disabled={photos.length < 2}
                className="absolute right-2 sm:-right-5 z-10 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/55 text-white text-3xl leading-none transition-opacity hover:bg-black/75 disabled:opacity-20"
                aria-label="Próxima foto"
              >
                ›
              </button>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
              <div><p className="text-sm text-(--sp-text)">{formatDate(preview.modified_at)}</p><p className="text-xs text-(--sp-text-dim)">{preview.name}</p><p className="text-[10px] text-(--sp-accent-muted) mt-0.5">{previewIndex + 1} de {photos.length} · deslize ou use as setas</p></div>
              <button onClick={() => downloadOne(preview)} className="sp-btn-primary px-4 py-2 rounded-lg text-xs">Baixar foto</button>
            </div>
          </div>
        </div>
      )}
      </>}
    </section>
  )
}
