import { useState, useEffect } from 'react'

export default function Login({ api, onLogin, onClose }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!password || loading) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${api}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (res.ok) {
        const data = await res.json()
        onLogin(data.access_token)
      } else if (res.status === 401) {
        setError('Senha incorreta')
      } else {
        setError('Erro ao conectar')
      }
    } catch {
      setError('Sem conexão com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(4,8,5,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="sp-glass-modal p-6 sm:p-7 max-w-sm w-full animate-fade-in max-h-[90vh] overflow-y-auto relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg text-(--sp-text-muted) hover:text-(--sp-text) hover:bg-(--sp-surface-raised-hover) transition-colors"
          aria-label="Fechar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🌱</span>
          <h2 className="text-base font-bold sp-text-gradient">TATUFA</h2>
        </div>

        <p className="text-xs text-(--sp-text-dim) mb-5 leading-relaxed">
          Faça login para controlar zonas, agendamentos, clima e firmware.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-(--sp-text-dim) mb-1.5">
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="Digite a senha..."
              className="sp-input w-full text-sm py-2.5 px-3"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all sp-btn-primary disabled:opacity-40"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
