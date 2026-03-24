import type { MutableRefObject, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import type { ModeId, ThemeId } from '../../state/store'
import { THEME_META } from '../../lib/themes'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SectionHeader } from './shared'

const MODE_OPTIONS: Array<{ id: ModeId; label: string; icon: ReactNode }> = [
  { id: 'light', label: '浅色', icon: <Sun className="h-4 w-4" /> },
  { id: 'dark', label: '深色', icon: <Moon className="h-4 w-4" /> },
  { id: 'system', label: '跟随系统', icon: <Monitor className="h-4 w-4" /> },
]

export function AppearanceSettingsSection({
  brandName,
  brandDraft,
  normalizedBrandDraft,
  brandDirty,
  setBrandDraft,
  onSetBrandName,
  theme,
  onSetTheme,
  mode,
  onSetMode,
  isDark,
  showThemes,
  setShowThemes,
  themeOptionRefs,
}: {
  brandName: string
  brandDraft: string
  normalizedBrandDraft: string
  brandDirty: boolean
  setBrandDraft: (value: string) => void
  onSetBrandName: (brandName: string) => void
  theme: ThemeId
  onSetTheme: (theme: ThemeId) => void
  mode: ModeId
  onSetMode: (mode: ModeId) => void
  isDark: boolean
  showThemes: boolean
  setShowThemes: (value: boolean) => void
  themeOptionRefs: MutableRefObject<Array<HTMLButtonElement | null>>
}) {
  const currentThemeMeta = THEME_META.find((item) => item.id === theme)

  return (
    <section className="space-y-5">
      <SectionHeader title="外观" description="自定义应用的视觉风格" />

      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">主题模式</Label>
        <div className="grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map((option) => (
            <Button
              key={option.id}
              variant={mode === option.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => onSetMode(option.id)}
              className="h-10 gap-2"
            >
              {option.icon}
              <span className="text-xs">{option.label}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">配色方案</Label>
        <button
          type="button"
          onClick={() => setShowThemes(!showThemes)}
          className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/50 hover:bg-accent/30 transition-colors"
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-xl overflow-hidden border border-border/50">
            {currentThemeMeta && (
              <div
                className="w-full h-full flex items-center justify-center gap-1"
                style={{ backgroundColor: (isDark ? currentThemeMeta.swatch.dark : currentThemeMeta.swatch.light).background }}
              >
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: (isDark ? currentThemeMeta.swatch.dark : currentThemeMeta.swatch.light).primary }}
                />
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: (isDark ? currentThemeMeta.swatch.dark : currentThemeMeta.swatch.light).foreground }}
                />
              </div>
            )}
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium">{currentThemeMeta?.label || '默认'}</div>
            <div className="text-xs text-muted-foreground">{THEME_META.length} 款主题可选</div>
          </div>
          <motion.div animate={{ rotate: showThemes ? 90 : 0 }} transition={{ duration: 0.2 }}>
            <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </motion.div>
        </button>

        <AnimatePresence>
          {showThemes && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="max-h-64 overflow-y-auto pt-2 pr-1">
                <div
                  className="grid grid-cols-4 gap-2"
                  role="radiogroup"
                  aria-label="主题配色"
                  onKeyDown={(event) => {
                    if (!THEME_META.length) return
                    const currentIndex = THEME_META.findIndex((item) => item.id === theme)
                    if (currentIndex < 0) return
                    const lastIndex = THEME_META.length - 1
                    let nextIndex = currentIndex
                    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1
                    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1
                    else if (event.key === 'Home') nextIndex = 0
                    else if (event.key === 'End') nextIndex = lastIndex
                    else return
                    event.preventDefault()
                    const nextTheme = THEME_META[nextIndex]
                    onSetTheme(nextTheme.id)
                    window.requestAnimationFrame(() => themeOptionRefs.current[nextIndex]?.focus())
                  }}
                >
                  {THEME_META.map((themeMeta, index) => {
                    const isActive = theme === themeMeta.id
                    const swatchColors = isDark ? themeMeta.swatch.dark : themeMeta.swatch.light
                    return (
                      <button
                        key={themeMeta.id}
                        className={cn(
                          'group relative cursor-pointer rounded-xl border transition-all overflow-hidden',
                          isActive ? 'border-primary ring-2 ring-primary/20' : 'border-border/50 hover:border-border hover:shadow-sm',
                        )}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onSetTheme(themeMeta.id)}
                        ref={(element) => {
                          themeOptionRefs.current[index] = element
                        }}
                      >
                        <div className="h-9 w-full relative" style={{ backgroundColor: swatchColors.background }}>
                          <div className="flex h-full items-center justify-center gap-1">
                            <div className="h-4 w-4 rounded" style={{ backgroundColor: swatchColors.primary }} />
                            <div className="h-4 w-4 rounded" style={{ backgroundColor: swatchColors.foreground }} />
                          </div>
                          {isActive && (
                            <div className="absolute top-1 right-1 rounded-full p-0.5" style={{ backgroundColor: swatchColors.primary }}>
                              <Check className="h-2 w-2" style={{ color: swatchColors.background }} />
                            </div>
                          )}
                        </div>
                        <div className="px-1.5 py-1 border-t border-border/30 bg-card">
                          <div className={cn('text-[10px] font-medium text-center truncate', isActive ? 'text-primary' : 'text-muted-foreground')}>
                            {themeMeta.label}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="space-y-3">
        <Label htmlFor="brand-name" className="text-xs text-muted-foreground">显示名称</Label>
        <div className="flex gap-2">
          <Input
            id="brand-name"
            value={brandDraft}
            onChange={(event) => setBrandDraft(event.target.value)}
            placeholder="例如：私人笔记库"
            maxLength={32}
            className="h-10"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setBrandDraft(brandName)
                window.requestAnimationFrame(() => event.currentTarget.select())
                return
              }
              if (event.key !== 'Enter') return
              if (!brandDirty) return
              event.preventDefault()
              onSetBrandName(normalizedBrandDraft)
            }}
          />
          <Button onClick={() => onSetBrandName(normalizedBrandDraft)} disabled={!brandDirty} size="sm" className="h-10 px-4">
            保存
          </Button>
        </div>
      </div>
    </section>
  )
}
