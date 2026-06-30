import { useState, useEffect, useCallback } from 'react'
import Dashboard from './components/Dashboard.jsx'
import SchedulesView from './components/ScheduleList.jsx'
import ClimatePanel from './components/ClimatePanel.jsx'
import SensorCharts from './components/SensorCharts.jsx'
import StatusBar from './components/StatusBar.jsx'

const API = import.meta.env.BASE_URL + 'api'

const STORAGE_KEY = 'greenhouse-theme'

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY) || 'dark'
    }
    return 'dark'
  })
  const [tab, setTab] = useState('dashboard')
  const [zones, setZones] = useState({})
  const [sensors, setSensors] = useState({
    inside_temperature: '--', inside_humidity: '--',
    outside_temperature: '--', outside_humidity: '--',
  })
  const [schedules, setSchedules] = useState([])
  const [irrigation, setIrrigation] = useState({})
  const [zoneNames, setZoneNames] = useState({
    1: { name: 'Zona 1', icon: '🥬' },
    2: { name: 'Zona 2', icon: '🌿' },
    3: { name: 'Zona 3', icon: '🍓' }
  })
  const [espStatus, setEspStatus] = useState('offline')
  const [serverTime, setServerTime] = useState('')
  const [loading, setLoading] = useState(true)

  const [climateRules, setClimateRules] = useState(null)
  const [climateStatus, setClimateStatus] = useState(null)
  const [light, setLight] = useState({ state: 'off' })
  const [sensorHistory, setSensorHistory] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('24h')
  const [cameraUrl, setCameraUrl] = useState('')

  const fetchStatus = useCallback(async () => {
    try {
      const [zonesRes, sensorsRes, schedulesRes, irrigationRes, namesRes] = await Promise.all([
        fetch(`${API}/zones`),
        fetch(`${API}/sensors`),
        fetch(`${API}/schedules`),
        fetch(`${API}/irrigation`),
        fetch(`${API}/zones/names`)
      ])
      if (zonesRes.ok) setZones(await zonesRes.json())
      if (sensorsRes.ok) setSensors(await sensorsRes.json())
      if (schedulesRes.ok) setSchedules(await schedulesRes.json())
      if (irrigationRes.ok) setIrrigation(await irrigationRes.json())
      if (namesRes.ok) {
        const names = await namesRes.json()
        const nameMap = {}
        names.forEach(n => { nameMap[n.zone_id] = { name: n.name, icon: n.icon || '🌱' } })
        setZoneNames(nameMap)
      }
    } catch (err) {
      console.error('Fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchClimate = useCallback(async () => {
    try {
      const [rulesRes, statusRes, lightRes] = await Promise.all([
        fetch(`${API}/climate/rules`),
        fetch(`${API}/climate/status`),
        fetch(`${API}/light/status`)
      ])
      if (rulesRes.ok) setClimateRules(await rulesRes.json())
      if (statusRes.ok) setClimateStatus(await statusRes.json())
      if (lightRes.ok) setLight(await lightRes.json())
    } catch (err) {
      console.error('Climate fetch error:', err)
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const fetchHistory = useCallback(async (p) => {
    const period = p || chartPeriod
    try {
      const res = await fetch(`${API}/sensors/history?period=${period}`)
      if (res.ok) setSensorHistory(await res.json())
    } catch (err) {
      console.error('History fetch error:', err)
    }
  }, [chartPeriod])

  const handlePeriodChange = useCallback((p) => {
    setChartPeriod(p)
    fetchHistory(p)
  }, [fetchHistory])

  const handleClearHistory = useCallback(async () => {
    try {
      await fetch(`${API}/sensors/history`, { method: 'DELETE' })
      setSensorHistory(null)
      setTimeout(() => fetchHistory(), 500)
    } catch (err) {
      console.error('Clear history error:', err)
    }
  }, [fetchHistory])

  useEffect(() => {
    fetchStatus()
    fetchClimate()
    fetchHistory()
    const interval = setInterval(() => { fetchStatus(); fetchClimate() }, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchClimate, fetchHistory])

  useEffect(() => {
    const interval = setInterval(() => fetchHistory(), 30000)
    return () => clearInterval(interval)
  }, [fetchHistory])

  useEffect(() => {
    async function checkEsp() {
      try {
        const res = await fetch(`${API}/status`)
        if (res.ok) {
          const data = await res.json()
          setEspStatus(data.esp || 'offline')
        }
      } catch { setEspStatus('offline') }
    }
    async function fetchTime() {
      try {
        const res = await fetch(`${API}/time`)
        if (res.ok) {
          const data = await res.json()
          setServerTime(data.formatted || data.time || '')
        }
      } catch { /* keep previous time */ }
    }
    async function fetchCameraStatus() {
      try {
        const res = await fetch(`${API}/camera/status`)
        if (res.ok) {
          const data = await res.json()
          if (data.capture) setCameraUrl(data.capture)
        }
      } catch { /* keep previous url */ }
    }
    checkEsp()
    fetchTime()
    fetchCameraStatus()
    const interval = setInterval(() => { checkEsp(); fetchTime(); fetchCameraStatus() }, 5000)
    return () => clearInterval(interval)
  }, [])

  const toggleZone = async (zoneId) => {
    const current = zones[`zone${zoneId}`] === 'ON'
    const action = current ? 'off' : 'on'
    await fetch(`${API}/zones/${zoneId}/${action}`, { method: 'POST' })
    fetchStatus()
  }

  const createSchedule = async (data) => {
    await fetch(`${API}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    fetchStatus()
  }

  const updateSchedule = async (id, data) => {
    await fetch(`${API}/schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    fetchStatus()
  }

  const deleteSchedule = async (id) => {
    await fetch(`${API}/schedules/${id}`, { method: 'DELETE' })
    fetchStatus()
  }

  const renameZone = async (zoneId, name, icon) => {
    const body = {}
    if (name !== undefined) body.name = name
    if (icon !== undefined) body.icon = icon
    await fetch(`${API}/zones/${zoneId}/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    setZoneNames(prev => ({
      ...prev,
      [zoneId]: {
        name: name !== undefined ? name : prev[zoneId]?.name || `Zona ${zoneId}`,
        icon: icon !== undefined ? icon : prev[zoneId]?.icon || '🌱'
      }
    }))
  }

  const updateClimateRules = async (data) => {
    const res = await fetch(`${API}/climate/rules`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (res.ok) {
      const updated = await res.json()
      setClimateRules(updated)
    }
    fetchClimate()
  }

  const setFanMode = async (mode) => {
    await fetch(`${API}/climate/fan/${mode}`, { method: 'POST' })
    fetchClimate()
  }

  const toggleLight = async (state) => {
    await fetch(`${API}/light/${state}`, { method: 'POST' })
    fetchClimate()
  }

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: '🌱' },
    { key: 'schedules', label: 'Agendamentos', icon: '⏰' },
    { key: 'climate', label: 'Clima', icon: '🌡️' },
    { key: 'charts', label: 'Histórico', icon: '📊' },
  ]

  return (
    <div className="min-h-screen sp-bg relative">
      <StatusBar espStatus={espStatus} serverTime={serverTime} theme={theme} onToggleTheme={toggleTheme} />

      <div className="relative z-10">
        <div className="overflow-x-auto scrollbar-hide px-4 pt-5 max-w-5xl mx-auto">
          <div className="flex gap-0 min-w-max">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-5 py-2.5 font-medium text-sm transition-all duration-200 whitespace-nowrap flex-shrink-0 ${
                  tab === t.key
                    ? 'sp-tab-active'
                    : 'sp-tab-inactive'
                }`}
              >
                <span className="mr-1.5">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-(--sp-accent-border-light) min-h-[calc(100vh-100px)] bg-(--sp-tab-panel-bg)">
          <div className="max-w-5xl mx-auto p-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <div className="w-10 h-10 border-2 border-(--sp-loading-bg) border-t-(--sp-loading-accent) rounded-full animate-spin" />
                <span className="text-sm text-(--sp-accent-muted)">conectando...</span>
              </div>
            ) : tab === 'dashboard' ? (
              <Dashboard
                zones={zones}
                sensors={sensors}
                irrigation={irrigation}
                zoneNames={zoneNames}
                schedules={schedules}
                cameraUrl={cameraUrl}
                onToggle={toggleZone}
                onRename={renameZone}
              />
            ) : tab === 'schedules' ? (
              <SchedulesView
                schedules={schedules}
                zoneNames={zoneNames}
                onCreate={createSchedule}
                onUpdate={updateSchedule}
                onDelete={deleteSchedule}
              />
            ) : tab === 'charts' ? (
              <SensorCharts
                history={sensorHistory}
                period={chartPeriod}
                onPeriodChange={handlePeriodChange}
                onClearHistory={handleClearHistory}
              />
            ) : (
              <ClimatePanel
                climateRules={climateRules}
                climateStatus={climateStatus}
                light={light}
                onRuleUpdate={updateClimateRules}
                onFanModeSet={setFanMode}
                onLightToggle={toggleLight}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}