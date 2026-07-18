import { useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const PERIODS = [
  { key: '1h', label: '1h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
]

export default function SensorCharts({ history, onPeriodChange, period, onClearHistory, isGuest }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const tempData = buildTempDataset(history)
  const humData = buildHumidityDataset(history)

  const handleClear = async () => {
    setShowConfirm(false)
    if (onClearHistory) await onClearHistory()
  }

  if (!history || (!history.inside?.length && !history.outside?.length)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <span className="text-4xl">📊</span>
        <span className="text-sm text-(--sp-text-dim)">Aguardando dados dos sensores...</span>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => onPeriodChange(p.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                period === p.key
                  ? 'bg-(--sp-accent-bg) text-(--sp-accent) border border-(--sp-accent-border)'
                  : 'bg-(--sp-btn-secondary-bg) text-(--sp-btn-secondary-text) border border-(--sp-btn-secondary-border) hover:border-(--sp-border-subtle-strong)'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {!isGuest && (
          <button
            onClick={() => setShowConfirm(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all"
          >
            Limpar histórico
          </button>
        )}
      </div>

      <div className="sp-glass p-5">
        <h3 className="text-sm font-semibold text-(--sp-text) mb-1 flex items-center gap-2">
          <span>🌡️</span> Temperatura
        </h3>
        <p className="text-[10px] text-(--sp-text-dim) mb-4 tracking-wide uppercase">Dentro vs Fora</p>
        <div className="h-64">
          <Line data={tempData} options={chartOptions('°C')} />
        </div>
      </div>

      <div className="sp-glass p-5">
        <h3 className="text-sm font-semibold text-(--sp-text) mb-1 flex items-center gap-2">
          <span>💧</span> Umidade do Ar
        </h3>
        <p className="text-[10px] text-(--sp-text-dim) mb-4 tracking-wide uppercase">Dentro vs Fora</p>
        <div className="h-64">
          <Line data={humData} options={chartOptions('%')} />
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center sp-overlay">
          <div className="sp-glass p-6 max-w-sm w-full mx-4 animate-fade-in">
            <h3 className="text-sm font-semibold text-(--sp-text) mb-2">Limpar histórico?</h3>
            <p className="text-xs text-(--sp-text-dim) mb-5 leading-relaxed">
              Isso vai apagar <strong className="text-(--sp-text)">todos</strong> os dados de
              temperatura e umidade salvos até agora. Os gráficos ficarão vazios até
              novas leituras serem registradas.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium sp-btn-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={handleClear}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all"
              >
                Sim, limpar tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function buildTempDataset(history) {
  const labels = []
  const insideData = []
  const outsideData = []

  const extractPoints = (source) => {
    const metricEntry = history[source]?.find(m => m.metric === 'temperature')
    return metricEntry?.points || []
  }

  const insidePoints = extractPoints('inside')
  const outsidePoints = extractPoints('outside')

  const allPoints = [...insidePoints, ...outsidePoints].sort(
    (a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)
  )

  const seen = new Set()
  for (const point of allPoints) {
    const ts = point.recorded_at
    if (seen.has(ts)) continue
    seen.add(ts)
  }

  const sorted = [...new Set(allPoints.map(p => p.recorded_at))].sort(
    (a, b) => new Date(a) - new Date(b)
  )

  const insideMap = new Map(insidePoints.map(p => [p.recorded_at, p.value]))
  const outsideMap = new Map(outsidePoints.map(p => [p.recorded_at, p.value]))

  for (const ts of sorted) {
    labels.push(formatLabel(ts))
    insideData.push(insideMap.get(ts) ?? null)
    outsideData.push(outsideMap.get(ts) ?? null)
  }

  return {
    labels,
    datasets: [
      {
        label: 'Dentro',
        data: insideData,
        borderColor: 'rgb(250, 140, 60)',
        backgroundColor: 'rgba(250, 140, 60, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 1,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
      {
        label: 'Fora',
        data: outsideData,
        borderColor: 'rgb(96, 165, 250)',
        backgroundColor: 'rgba(96, 165, 250, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 1,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
    ],
  }
}

function buildHumidityDataset(history) {
  const labels = []
  const insideData = []
  const outsideData = []

  const extractPoints = (source) => {
    const metricEntry = history[source]?.find(m => m.metric === 'humidity')
    return metricEntry?.points || []
  }

  const insidePoints = extractPoints('inside')
  const outsidePoints = extractPoints('outside')

  const sorted = [...new Set(
    [...insidePoints, ...outsidePoints].map(p => p.recorded_at)
  )].sort((a, b) => new Date(a) - new Date(b))

  const insideMap = new Map(insidePoints.map(p => [p.recorded_at, p.value]))
  const outsideMap = new Map(outsidePoints.map(p => [p.recorded_at, p.value]))

  for (const ts of sorted) {
    labels.push(formatLabel(ts))
    insideData.push(insideMap.get(ts) ?? null)
    outsideData.push(outsideMap.get(ts) ?? null)
  }

  return {
    labels,
    datasets: [
      {
        label: 'Dentro',
        data: insideData,
        borderColor: 'rgb(52, 211, 153)',
        backgroundColor: 'rgba(52, 211, 153, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 1,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
      {
        label: 'Fora',
        data: outsideData,
        borderColor: 'rgb(147, 197, 253)',
        backgroundColor: 'rgba(147, 197, 253, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 1,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
    ],
  }
}

function formatLabel(iso) {
  try {
    const d = new Date(iso)
    const hours = d.getHours()
    const mins = d.getMinutes()
    if (mins === 0) return `${hours}h`
    return `${hours}:${String(mins).padStart(2, '0')}`
  } catch {
    return iso
  }
}

const chartOptions = (unit) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false,
  },
  plugins: {
    legend: {
      position: 'top',
      labels: {
        color: '#8b8f85',
        font: { size: 11 },
        usePointStyle: true,
        padding: 16,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(12, 22, 14, 0.9)',
      titleColor: '#e5e7db',
      bodyColor: '#c0c7bb',
      borderColor: 'rgba(74, 222, 128, 0.2)',
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10,
      callbacks: {
        label(ctx) {
          return `${ctx.dataset.label}: ${ctx.parsed.y} ${unit}`
        },
      },
    },
  },
  scales: {
    x: {
      display: true,
      grid: { color: 'rgba(255, 255, 255, 0.04)' },
      ticks: { color: '#5c6256', font: { size: 10 }, maxTicksLimit: 12 },
    },
    y: {
      display: true,
      grid: { color: 'rgba(255, 255, 255, 0.04)' },
      ticks: {
        color: '#5c6256',
        font: { size: 10 },
        callback(v) { return `${v} ${unit}` },
      },
    },
  },
  elements: {
    line: {
      borderJoinStyle: 'round',
      borderCapStyle: 'round',
    },
  },
})
