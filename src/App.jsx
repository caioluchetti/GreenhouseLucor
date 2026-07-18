import { useState, useEffect, useCallback } from 'react'
import Dashboard from './components/Dashboard.jsx'
import SchedulesView from './components/ScheduleList.jsx'
import ClimatePanel from './components/ClimatePanel.jsx'
import SensorCharts from './components/SensorCharts.jsx'
import StatusBar from './components/StatusBar.jsx'
import FirmwarePanel from './components/FirmwarePanel.jsx'
import Login from './components/Login.jsx'

const API = import.meta.env.BASE_URL + 'api'
const THEME_KEY = 'greenhouse-theme'
const TOKEN_KEY = 'greenhouse-auth-token'

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(THEME_KEY) || 'dark'
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
  const [cameraUrl] = useState(() => `${API}/camera/proxy`)

  const [authToken, setAuthToken] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(TOKEN_KEY) || null
    }
    return null
  })
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')

  const authHeaders = useCallback(() => {
    if (!authToken) return {}
    return { 'Authorization': `Bearer ${authToken}` }
  }, [authToken])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    async function verify() {
      const token = localStorage.getItem(TOKEN_KEY)
      if (!token) {
        setAuthChecked(true)
        return
      }
      setAuthToken(token)
      try {
        const res = await fetch(`${API}/auth/verify`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.ok && (await res.json()).authenticated) {
          setIsAuthenticated(true)
        } else {
          localStorage.removeItem(TOKEN_KEY)
          setAuthToken(null)
        }
      } catch {
        setIsAuthenticated(true)
      }
      setAuthChecked(true)
    }
    verify()
  }, [])

  const handleLogin = useCallback((token) => {
    localStorage.setItem(TOKEN_KEY, token)
    setAuthToken(token)
    setIsAuthenticated(true)
    setShowLogin(false)
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setAuthToken(null)
    setIsAuthenticated(false)
    setTab('dashboard')
  }, [])

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
      await fetch(`${API}/sensors/history`, {
        method: 'DELETE',
        headers: authHeaders()
      })
      setSensorHistory(null)
      setTimeout(() => fetchHistory(), 500)
    } catch (err) {
      console.error('Clear history error:', err)
    }
  }, [fetchHistory, authHeaders])

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
    checkEsp()
    fetchTime()
    const interval = setInterval(() => { checkEsp(); fetchTime() }, 5000)
    return () => clearInterval(interval)
  }, [])

  const toggleZone = async (zoneId) => {
    const current = zones[`zone${zoneId}`] === 'ON'
    const action = current ? 'off' : 'on'
    await fetch(`${API}/zones/${zoneId}/${action}`, {
      method: 'POST',
      headers: authHeaders()
    })
    fetchStatus()
  }

  const createSchedule = async (data) => {
    await fetch(`${API}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data)
    })
    fetchStatus()
  }

  const updateSchedule = async (id, data) => {
    await fetch(`${API}/schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data)
    })
    fetchStatus()
  }

  const deleteSchedule = async (id) => {
    await fetch(`${API}/schedules/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    })
    fetchStatus()
  }

  const renameZone = async (zoneId, name, icon) => {
    const body = {}
    if (name !== undefined) body.name = name
    if (icon !== undefined) body.icon = icon
    await fetch(`${API}/zones/${zoneId}/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data)
    })
    if (res.ok) {
      const updated = await res.json()
      setClimateRules(updated)
    }
    fetchClimate()
  }

  const setFanMode = async (mode) => {
    await fetch(`${API}/climate/fan/${mode}`, {
      method: 'POST',
      headers: authHeaders()
    })
    fetchClimate()
  }

  const toggleLight = async (state) => {
    await fetch(`${API}/light/${state}`, {
      method: 'POST',
      headers: authHeaders()
    })
    fetchClimate()
  }

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setPwError('')
    setPwSuccess('')
    try {
      const res = await fetch(`${API}/auth/set-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw })
      })
      if (res.ok) {
        setPwSuccess('Senha alterada com sucesso!')
        setCurrentPw('')
        setNewPw('')
        setTimeout(() => { setPwSuccess(''); setChangingPassword(false) }, 1500)
      } else {
        const data = await res.json()
        setPwError(data.detail || 'Erro ao alterar senha')
      }
    } catch {
      setPwError('Sem conexão com o servidor')
    }
  }

  const guest = !isAuthenticated
  const apiFetch = (url, opts = {}) =>
    fetch(url, { ...opts, headers: { ...opts.headers, ...authHeaders() } })

  const allTabs = [
    { key: 'dashboard', label: 'Dashboard', icon: '🌱' },
    { key: 'schedules', label: 'Agendamentos', icon: '⏰' },
    { key: 'climate', label: 'Clima', icon: '🌡️' },
    { key: 'charts', label: 'Histórico', icon: '📊' },
    { key: 'firmware', label: 'Firmware', icon: '🔧' },
  ]

  const guestTabs = allTabs.filter(t => t.key === 'dashboard' || t.key === 'charts')
  const tabs = guest ? guestTabs : allTabs

  if (!authChecked) {
    return (
      <div className="min-h-screen sp-bg relative flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-(--sp-loading-bg) border-t-(--sp-loading-accent) rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen sp-bg relative">
      <StatusBar
        espStatus={espStatus}
        serverTime={serverTime}
        theme={theme}
        onToggleTheme={toggleTheme}
        isAuthenticated={isAuthenticated}
        onLoginClick={() => setShowLogin(true)}
        onLogout={handleLogout}
        onChangePassword={() => setChangingPassword(true)}
      />

      {showLogin && (
        <Login api={API} onLogin={handleLogin} onClose={() => setShowLogin(false)} />
      )}

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
                light={light}
                onToggle={toggleZone}
                onRename={renameZone}
                onLightToggle={toggleLight}
                isGuest={guest}
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
                isGuest={guest}
              />
            ) : tab === 'firmware' ? (
              <FirmwarePanel api={API} authHeaders={authHeaders} />
            ) : (
              <ClimatePanel
                climateRules={climateRules}
                climateStatus={climateStatus}
                onRuleUpdate={updateClimateRules}
                onFanModeSet={setFanMode}
              />
            )}
          </div>
        </div>
      </div>

      {isAuthenticated && changingPassword && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(4,8,5,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setChangingPassword(false); setPwError(''); setPwSuccess('') } }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setChangingPassword(false); setPwError(''); setPwSuccess('') } }}
        >
          <div className="sp-glass-modal p-6 sm:p-7 max-w-sm w-full animate-fade-in max-h-[90vh] overflow-y-auto relative">
            <button
              onClick={() => { setChangingPassword(false); setPwError(''); setPwSuccess('') }}
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg text-(--sp-text-muted) hover:text-(--sp-text) hover:bg-(--sp-surface-raised-hover) transition-colors"
              aria-label="Fechar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-sm font-semibold text-(--sp-text) mb-5">Alterar senha</h3>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-(--sp-text-dim) mb-1.5">Senha atual</label>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className="sp-input w-full text-sm py-2.5 px-3" autoFocus />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-(--sp-text-dim) mb-1.5">Nova senha</label>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className="sp-input w-full text-sm py-2.5 px-3" />
              </div>
              {pwError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{pwError}</p>}
              {pwSuccess && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{pwSuccess}</p>}
              <div className="flex gap-3 justify-end pt-1">
                <button type="button" onClick={() => { setChangingPassword(false); setPwError(''); setPwSuccess('') }} className="px-4 py-2 rounded-lg text-xs font-medium sp-btn-secondary">Cancelar</button>
                <button type="submit" disabled={!currentPw || !newPw} className="px-4 py-2 rounded-lg text-xs font-medium sp-btn-primary disabled:opacity-40">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {guest && !showLogin && (
        <div className="fixed bottom-4 left-0 right-0 flex justify-center z-30 sm:hidden">
          <button
            onClick={() => setShowLogin(true)}
            className="px-4 py-2 rounded-full text-xs font-semibold sp-glass-sm text-(--sp-accent) border border-(--sp-accent-border) hover:bg-(--sp-accent-bg) transition-all flex items-center gap-2 shadow-lg"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Fazer login
          </button>
        </div>
      )}
    </div>
  )
}
