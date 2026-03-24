import type { ElementType } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

export function ActionItem({
  icon: Icon,
  label,
  description,
  onClick,
  disabled,
}: {
  icon: ElementType
  label: string
  description?: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-4 p-4 rounded-xl transition-colors text-left',
        'hover:bg-accent/50 active:bg-accent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
      )}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground truncate">{description}</div>}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  )
}
