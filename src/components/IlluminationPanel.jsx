import { useEffect, useMemo, useState } from 'react'

function formatTimestamp(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

const DAY_START_MINUTES = 5 * 60 + 30
const DAY_END_MINUTES = 18 * 60 + 30

function nearestPhotoIndex(photos, minutes) {
  if (!photos?.length) return 0
  return photos.reduce((closest, photo, index) => {
    const timestamp = new Date(photo.timestamp)
    const photoMinutes = timestamp.getHours() * 60 + timestamp.getMinutes()
    const closestTimestamp = new Date(photos[closest].timestamp)
    const closestMinutes = closestTimestamp.getHours() * 60 + closestTimestamp.getMinutes()
    return Math.abs(photoMinutes - minutes) < Math.abs(closestMinutes - minutes) ? index : closest
  }, 0)
}

function BrightnessChart({ series, selectedIndex }) {
  if (!series?.length) return null
  const width = 720
  const height = 180
  const padding = 18
  const max = Math.max(...series.map(point => point.value), 0.01)
  const points = series.map((point, index) => {
    const x = padding + (index / Math.max(series.length - 1, 1)) * (width - padding * 2)
    const y = height - padding - (point.value / max) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')
  const selected = series[selectedIndex]
  const selectedX = padding + (selectedIndex / Math.max(series.length - 1, 1)) * (width - padding * 2)

  return (
    <div className="sp-glass-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-(--sp-text)">Intensidade ao longo do dia</h3>
        <span className="text-[10px] text-(--sp-text-muted)">relativa · 0 a 1</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Gráfico de intensidade luminosa">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--sp-border-subtle-strong)" />
        <polyline points={points} fill="none" stroke="var(--sp-accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={selectedX} y1={padding} x2={selectedX} y2={height - padding} stroke="var(--sp-warning)" strokeDasharray="4 4" />
        <text x={padding} y={height - 3} fill="var(--sp-text-muted)" fontSize="10">{series[0].label}</text>
        <text x={width - padding} y={height - 3} fill="var(--sp-text-muted)" fontSize="10" textAnchor="end">{series.at(-1).label}</text>
        {selected && <circle cx={selectedX} cy={height - padding - (selected.value / max) * (height - padding * 2)} r="5" fill="var(--sp-warning)" />}
      </svg>
    </div>
  )
}

export default function IlluminationPanel({ api, authHeaders }) {
  const [data, setData] = useState(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [mode, setMode] = useState('today')
  const [sliderMinutes, setSliderMinutes] = useState(DAY_START_MINUTES)
  const [photoUrl, setPhotoUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ mode, index: '0' })
    if (selectedDate) params.set('date', selectedDate)
    const query = `?${params.toString()}`
    fetch(`${api}/illumination${query}`, { headers: authHeaders() })
      .then(response => response.json().then(body => ({ response, body })))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.detail || 'Não foi possível analisar as fotos')
        if (cancelled) return
        setData(body)
        if (!selectedDate && body.date) setSelectedDate(body.date)
        setError('')
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, authHeaders, selectedDate, mode])

  const analyze = async () => {
    setAnalyzing(true)
    setError('')
    try {
      const params = new URLSearchParams({ mode })
      if (selectedDate) params.set('date', selectedDate)
      const response = await fetch(`${api}/illumination/analyze?${params.toString()}`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const contentType = response.headers.get('content-type') || ''
      const body = contentType.includes('application/json')
        ? await response.json()
        : { detail: await response.text() }
      if (!response.ok) throw new Error(body.detail || 'Não foi possível analisar as fotos')
      setData(body)
      if (body.date) setSelectedDate(body.date)
      setSliderMinutes(DAY_START_MINUTES)
    } catch (err) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const selectedIndex = nearestPhotoIndex(data?.photos, sliderMinutes)
  const selectedPhoto = data?.photos?.[selectedIndex]

  useEffect(() => {
    if (!selectedPhoto) return undefined
    let objectUrl = ''
    fetch(`${api}${selectedPhoto.url.replace('/api', '')}`, { headers: authHeaders() })
      .then(response => response.blob())
      .then(blob => {
        objectUrl = URL.createObjectURL(blob)
        setPhotoUrl(objectUrl)
      })
      .catch(() => setPhotoUrl(''))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [api, authHeaders, selectedPhoto])

  const dateOptions = useMemo(() => data?.dates || [], [data])

  if (loading && !data) return <div className="sp-glass rounded-2xl py-20 text-center text-sm text-(--sp-text-dim)">Calculando iluminação...</div>
  if (error) return <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-(--sp-danger)">{error}</div>
  if (!data?.photos?.length) return (
    <section className="space-y-4 animate-fade-in">
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-(--sp-accent-muted)">Análise das capturas</p>
        <h2 className="text-2xl font-semibold text-(--sp-text)">Iluminação</h2>
        <p className="text-sm text-(--sp-text-dim) mt-1">A análise não roda automaticamente. Escolha o dia e execute quando quiser.</p>
      </div>
      <div className="sp-glass rounded-2xl p-6 space-y-4">
        <div className="flex gap-2">
          <button onClick={() => { setMode('today'); setSliderMinutes(DAY_START_MINUTES) }} className={`px-3 py-2 rounded-lg text-xs ${mode === 'today' ? 'sp-btn-primary' : 'sp-btn-secondary'}`}>Hoje</button>
          <button onClick={() => { setMode('always'); setSliderMinutes(DAY_START_MINUTES) }} className={`px-3 py-2 rounded-lg text-xs ${mode === 'always' ? 'sp-btn-primary' : 'sp-btn-secondary'}`}>Sempre</button>
        </div>
        <label className="block text-xs text-(--sp-text-dim)">
          Dia
          <select value={selectedDate} onChange={event => { setSliderMinutes(DAY_START_MINUTES); setSelectedDate(event.target.value) }} className="sp-input block mt-1">
            {dateOptions.map(date => <option key={date} value={date}>{new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')}</option>)}
          </select>
        </label>
        <p className="text-sm text-(--sp-text-dim)">{data?.message || 'Nenhuma foto intervalada disponível.'}</p>
        {dateOptions.length > 0 && <button onClick={analyze} disabled={analyzing} className="sp-btn-primary px-4 py-2 rounded-lg text-xs disabled:opacity-50">{analyzing ? 'Analisando...' : mode === 'today' ? 'Analisar hoje' : 'Analisar sempre'}</button>}
      </div>
    </section>
  )

  return (
    <section className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-(--sp-accent-muted)">Análise das capturas</p>
          <h2 className="text-2xl font-semibold text-(--sp-text)">Iluminação</h2>
          <p className="text-sm text-(--sp-text-dim) mt-1">{mode === 'today' ? 'Somente as fotos do dia selecionado.' : 'Todas as fotos intervaladas disponíveis.'} Os valores são relativos.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex gap-1">
            <button onClick={() => { setMode('today'); setSliderMinutes(DAY_START_MINUTES) }} className={`px-3 py-2 rounded-lg text-xs ${mode === 'today' ? 'sp-btn-primary' : 'sp-btn-secondary'}`}>Hoje</button>
            <button onClick={() => { setMode('always'); setSliderMinutes(DAY_START_MINUTES) }} className={`px-3 py-2 rounded-lg text-xs ${mode === 'always' ? 'sp-btn-primary' : 'sp-btn-secondary'}`}>Sempre</button>
          </div>
          <label className="text-xs text-(--sp-text-dim)">
            Dia
            <select value={selectedDate} onChange={event => { setSliderMinutes(DAY_START_MINUTES); setSelectedDate(event.target.value) }} className="sp-input block mt-1">
              {dateOptions.map(date => <option key={date} value={date}>{new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')}</option>)}
            </select>
          </label>
          <button onClick={analyze} disabled={analyzing} className="sp-btn-primary px-3 py-2 rounded-lg text-xs disabled:opacity-50">{analyzing ? 'Analisando...' : 'Reanalisar'}</button>
        </div>
      </div>

      <div className="sp-glass-sm p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <label htmlFor="illumination-time" className="text-sm font-medium text-(--sp-text)">Horário: {String(Math.floor(sliderMinutes / 60)).padStart(2, '0')}:{String(sliderMinutes % 60).padStart(2, '0')} · foto mais próxima {selectedPhoto.label}</label>
          <span className="text-xs text-(--sp-text-muted)">{selectedIndex + 1} de {data.photos.length}</span>
        </div>
        <input id="illumination-time" type="range" min={DAY_START_MINUTES} max={DAY_END_MINUTES} step="30" value={sliderMinutes} onChange={event => setSliderMinutes(Number(event.target.value))} className="w-full accent-(--sp-accent)" />
        <div className="flex justify-between text-[10px] text-(--sp-text-muted) mt-1"><span>05:30</span><span>18:30</span></div>
      </div>

      <div className="sp-glass-sm p-3">
        <div className="flex items-center justify-between gap-2 mb-3"><h3 className="text-sm font-semibold text-(--sp-text)">Foto selecionada</h3><span className="text-xs text-(--sp-text-dim)">{formatTimestamp(selectedPhoto.timestamp)}</span></div>
        {photoUrl && <img src={photoUrl} alt={`Captura de ${selectedPhoto.label}`} className="w-full max-h-[560px] object-contain rounded-xl bg-black/20" />}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <article className="sp-glass-sm p-3">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div><h3 className="text-sm font-semibold text-(--sp-text)">Dia típico</h3><p className="text-xs text-(--sp-text-dim)">Mediana por pixel, somente plantas.</p></div>
            <span className="text-xs text-(--sp-accent)">{data.typical_average.toFixed(3)}</span>
          </div>
          <img src={data.typical_heatmap} alt="Mapa de calor do dia típico" className="w-full rounded-xl bg-black/20" />
        </article>
        <article className="sp-glass-sm p-3">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div><h3 className="text-sm font-semibold text-(--sp-text)">Exposição diária</h3><p className="text-xs text-(--sp-text-dim)">Acúmulo por pixel, somente plantas.</p></div>
            <span className="text-xs text-(--sp-warning)">{data.daily_exposure_average.toFixed(3)}</span>
          </div>
          <img src={data.exposure_heatmap} alt="Mapa de calor da exposição diária" className="w-full rounded-xl bg-black/20" />
        </article>
      </div>

      <BrightnessChart series={data.series} selectedIndex={selectedIndex} />
      {data.vegetation_mask && <details className="sp-glass-sm p-4">
        <summary className="cursor-pointer text-sm font-semibold text-(--sp-text)">Máscara automática de plantas ({(data.vegetation_coverage * 100).toFixed(1)}% da imagem)</summary>
        <p className="text-xs text-(--sp-text-dim) mt-2 mb-3">Branco indica pixels usados na análise; preto indica pixels excluídos. Revise a máscara, pois a classificação é baseada apenas na cor.</p>
        <img src={data.vegetation_mask} alt="Máscara automática de vegetação" className="w-full rounded-xl bg-black" />
      </details>}
      <div className="sp-glass-sm p-4 text-xs text-(--sp-text-dim) space-y-1">
        <p><strong className="text-(--sp-text)">Como é calculado:</strong> cada ponto do mapa corresponde ao mesmo pixel nas fotos. No modo Dia típico, usamos a mediana desse pixel ao longo do tempo.</p>
        <p>A máscara automática prioriza pixels verdes e saturados. Os números exibidos ao lado dos mapas são a média geral dos pixels classificados como planta; terra escura, vasos e áreas neutras são excluídos quando a máscara funciona corretamente.</p>
      </div>
      <p className="text-[11px] text-(--sp-text-muted)">A exposição diária é uma estimativa relativa. Exposição automática, nuvens e reflexos do plástico podem alterar a comparação entre horários.</p>
    </section>
  )
}
