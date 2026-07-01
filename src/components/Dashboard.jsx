import ZoneCard from './ZoneCard.jsx'
import SensorPanel from './SensorPanel.jsx'
import CameraFeed from './CameraFeed.jsx'

const DAY_MAP = { 'seg': 1, 'ter': 2, 'qua': 3, 'qui': 4, 'sex': 5, 'sab': 6, 'dom': 0 }
const DAY_NAMES = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab', 0: 'dom' }

function getNextIrrigation(zoneId, schedules) {
  const now = new Date()
  let nextDate = null

  for (const s of schedules) {
    if (!s.enabled || s.target_type !== 'zone' || s.zone_id !== zoneId) continue
    const days = s.days.split(',').map(d => d.trim().toLowerCase())
    const [h, m] = s.time.split(':').map(Number)

    for (let offset = 0; offset <= 7; offset++) {
      const check = new Date(now)
      check.setDate(check.getDate() + offset)
      const dayName = DAY_NAMES[check.getDay()]
      if (!days.includes(dayName)) continue
      check.setHours(h, m, 0, 0)
      if (check > now && (!nextDate || check < nextDate)) {
        nextDate = check
        break
      }
    }
  }

  return nextDate
}

function formatNextIrrigation(date) {
  if (!date) return null
  const now = new Date()
  const diff = date - now
  const minutes = Math.floor(diff / 60000)

  const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  if (minutes < 1) return 'Agora'
  if (minutes < 60) return `Em ${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (date.getDay() !== now.getDay()) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (date.getDay() === tomorrow.getDay()) return `Amanhã ${timeStr}`
    if (hours > 24) return `${timeStr}`
  }
  return `Hoje ${timeStr}`
}

export default function Dashboard({ zones, sensors, irrigation, zoneNames, schedules, cameraUrl, onToggle, onRename }) {
  return (
    <div className="animate-fade-in space-y-4 sm:space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4 lg:items-stretch">
        <div className="lg:col-span-3 order-2 lg:order-1">
          <CameraFeed cameraUrl={cameraUrl} />
        </div>
        <div className="lg:col-span-2 order-1 lg:order-2">
          <SensorPanel sensors={sensors} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4 order-3">
        {[1, 2, 3].map(id => (
          <ZoneCard
            key={id}
            id={id}
            label={zoneNames[id]?.name || `Zona ${id}`}
            icon={zoneNames[id]?.icon || '🌱'}
            state={zones[`zone${id}`] || 'OFF'}
            irrigationRemaining={irrigation[`zone${id}`]?.remaining || 0}
            irrigationTotal={irrigation[`zone${id}`]?.total || 0}
            nextIrrigation={formatNextIrrigation(getNextIrrigation(id, schedules))}
            onToggle={() => onToggle(id)}
            onRename={(name) => onRename(id, name, undefined)}
            onIconChange={(icon) => onRename(id, undefined, icon)}
          />
        ))}
      </div>
    </div>
  )
}