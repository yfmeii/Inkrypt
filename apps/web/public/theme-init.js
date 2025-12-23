;(() => {
  const DEFAULT_THEME = 'ocean'
  const BASE_THEME = 'violet'

  let theme = DEFAULT_THEME
  try {
    const raw = localStorage.getItem('inkrypt_theme')
    if (raw === 'violet' || raw === 'ocean' || raw === 'emerald' || raw === 'rose' || raw === 'amber') theme = raw
  } catch {
    // ignore
  }

  if (theme !== BASE_THEME) document.documentElement.setAttribute('data-theme', theme)

  try {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      const colors = {
        violet: { light: '#FEF7FF', dark: '#141218' },
        ocean: { light: '#F8FAFF', dark: '#111318' },
        emerald: { light: '#F7FBF2', dark: '#10140F' },
        rose: { light: '#FFFBFF', dark: '#171214' },
        amber: { light: '#FFF8F4', dark: '#18120E' },
      }
      const bg = (colors[theme] || colors.violet)[isDark ? 'dark' : 'light']
      meta.setAttribute('content', bg)
    }
  } catch {
    // ignore
  }
})()

