export default function StatusBar({ espStatus, serverTime, theme, onToggleTheme, isAuthenticated, onLoginClick, onLogout, onChangePassword }) {
  const online = espStatus === 'online'

  return (
    <header className="sp-glass-sm sticky top-0 z-20 mx-3 mt-3 px-5 py-3">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">🌱</span>
          <h1 className="font-bold tracking-wider text-base sp-text-gradient">TATUFA</h1>
        </div>

        <div className="flex items-center gap-3 sm:gap-5 text-xs">
          <button
            onClick={onToggleTheme}
            className="p-1.5 rounded-lg hover:bg-(--sp-surface-raised-hover) transition-colors cursor-pointer"
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" style={{ color: 'var(--sp-warning)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" style={{ color: 'var(--sp-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {isAuthenticated ? (
            <>
              <button
                onClick={onChangePassword}
                className="hidden sm:inline px-2.5 py-1 rounded-lg text-xs font-medium text-(--sp-text-dim) border border-(--sp-border-subtle) hover:border-(--sp-accent-border) hover:text-(--sp-accent) transition-all"
              >
                Senha
              </button>
              <button
                onClick={onLogout}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-(--sp-text-muted) border border-(--sp-border-subtle) hover:border-red-500/30 hover:text-red-400 transition-all"
              >
                Sair
              </button>
            </>
          ) : (
            <button
              onClick={onLoginClick}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-(--sp-accent) border border-(--sp-accent-border) hover:bg-(--sp-accent-bg) transition-all"
            >
              Login
            </button>
          )}

          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {online && (
                <span className="sp-dot-ring absolute inline-flex h-full w-full rounded-full bg-amber-400/30" />
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 transition-colors duration-500 ${
                online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-red-400/60'
              }`} />
            </span>
            <span className="text-(--sp-text-dim) hidden sm:inline">
              ESP32{' '}
              <span className={online ? 'text-(--sp-accent) font-medium' : 'text-(--sp-danger-dim)'}>
                {espStatus}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-(--sp-accent-dim) font-mono tabular-nums">
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8" cy="5" r="1.5" fill="currentColor" />
              <path d="M8 6.5V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {serverTime || '--:--'}
          </div>
        </div>
      </div>
    </header>
  )
}
