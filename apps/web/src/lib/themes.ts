/**
 * Theme System for Inkrypt
 * 
 * Supports 40 themes from tweakcn.com with dynamic CSS loading.
 * Each theme has light and dark mode variants defined in CSS files.
 */

// All available theme IDs - matches CSS filenames in /themes/
export const THEME_IDS = [
  'default',
  'caffeine',
  'darkmatter',
  'graphite',
  'mocha-mousse',
  'vintage-paper',
  'supabase',
] as const

export type ThemeId = (typeof THEME_IDS)[number]

// Theme metadata with display names and swatch colors for preview
export type ThemeMeta = {
  id: ThemeId
  label: string
  // Preview swatch colors extracted from CSS
  swatch: {
    light: { primary: string; background: string; foreground: string }
    dark: { primary: string; background: string; foreground: string }
  }
}

// Theme metadata - extracted from CSS files
export const THEME_META: ThemeMeta[] = [
  {
    id: 'default',
    label: '默认',
    swatch: {
      light: { primary: 'oklch(0.21 0.006 285.885)', background: 'oklch(1 0 0)', foreground: 'oklch(0.141 0.005 285.823)' },
      dark: { primary: 'oklch(0.985 0 0)', background: 'oklch(0.141 0.005 285.823)', foreground: 'oklch(0.985 0 0)' },
    },
  },
  {
    id: 'caffeine',
    label: '咖啡因',
    swatch: {
      light: { primary: 'oklch(0.50 0.12 50)', background: 'oklch(0.98 0.02 50)', foreground: 'oklch(0.25 0.05 50)' },
      dark: { primary: 'oklch(0.68 0.10 50)', background: 'oklch(0.18 0.04 50)', foreground: 'oklch(0.92 0.02 50)' },
    },
  },
  {
    id: 'darkmatter',
    label: '暗物质',
    swatch: {
      light: { primary: 'oklch(0.55 0.15 260)', background: 'oklch(0.95 0.01 260)', foreground: 'oklch(0.20 0.03 260)' },
      dark: { primary: 'oklch(0.70 0.18 260)', background: 'oklch(0.08 0.02 260)', foreground: 'oklch(0.88 0.02 260)' },
    },
  },
  {
    id: 'graphite',
    label: '石墨',
    swatch: {
      light: { primary: 'oklch(0.45 0.03 250)', background: 'oklch(0.97 0.005 250)', foreground: 'oklch(0.20 0.01 250)' },
      dark: { primary: 'oklch(0.65 0.02 250)', background: 'oklch(0.12 0.01 250)', foreground: 'oklch(0.88 0.01 250)' },
    },
  },
  {
    id: 'mocha-mousse',
    label: '摩卡慕斯',
    swatch: {
      light: { primary: 'oklch(0.55 0.10 45)', background: 'oklch(0.97 0.02 45)', foreground: 'oklch(0.28 0.05 45)' },
      dark: { primary: 'oklch(0.70 0.08 45)', background: 'oklch(0.18 0.04 45)', foreground: 'oklch(0.90 0.02 45)' },
    },
  },
  {
    id: 'vintage-paper',
    label: '复古纸张',
    swatch: {
      light: { primary: 'oklch(0.50 0.10 60)', background: 'oklch(0.96 0.03 60)', foreground: 'oklch(0.28 0.04 60)' },
      dark: { primary: 'oklch(0.68 0.08 60)', background: 'oklch(0.20 0.03 60)', foreground: 'oklch(0.88 0.02 60)' },
    },
  },
  {
    id: 'supabase',
    label: 'Supabase',
    swatch: {
      light: { primary: 'oklch(0.70 0.18 160)', background: 'oklch(0.98 0.01 160)', foreground: 'oklch(0.20 0.04 160)' },
      dark: { primary: 'oklch(0.75 0.16 160)', background: 'oklch(0.12 0.03 160)', foreground: 'oklch(0.92 0.02 160)' },
    },
  },
]

/** 当前加载的主题 CSS 链接元素 */
let currentThemeLink: HTMLLinkElement | null = null

/**
 * 动态加载主题 CSS 文件
 * @param themeId - 主题 ID
 */
export function loadThemeCSS(themeId: ThemeId): void {
  if (typeof document === 'undefined') return
  
  // 移除已存在的主题 CSS
  const existingLink = document.getElementById('theme-css') as HTMLLinkElement | null
  if (existingLink) {
    existingLink.remove()
  }
  if (currentThemeLink && currentThemeLink.parentNode) {
    currentThemeLink.remove()
  }
  currentThemeLink = null
  
  // 默认主题不需要额外的 CSS（样式已在主 CSS 中定义）
  if (themeId === 'default') {
    return
  }
  
  // 创建并添加新的主题 CSS 链接
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `/themes/${themeId}.css`
  link.id = 'theme-css'
  document.head.appendChild(link)
  currentThemeLink = link
}

// Validate theme ID
export function isValidThemeId(id: string): id is ThemeId {
  return THEME_IDS.includes(id as ThemeId)
}
