import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

type ChipTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger'

const TONES: Record<ChipTone, string> = {
  brand: 'bg-accent text-foreground',
  neutral: 'border bg-card text-muted-foreground',
  success: 'bg-[var(--success)]/15 text-foreground',
  warning: 'bg-[var(--warning)]/20 text-foreground',
  danger: 'bg-destructive/10 text-foreground',
}

interface ChipProps {
  label: string
  onRemove?: () => void
  icon?: ReactNode
  tone?: ChipTone
  className?: string
}

export function Chip({ label, onRemove, icon, tone = 'brand', className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-1.5 rounded-full pl-3 text-xs font-medium',
        onRemove ? 'pr-1.5' : 'pr-3',
        TONES[tone],
        className,
      )}
    >
      {icon && <span className="flex shrink-0 [&_svg]:size-3.5">{icon}</span>}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove filter ${label}`}
          // The pseudo-element widens the tap target to ~40px without inflating the chip.
          className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  )
}
