import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'

// Tinted fills keep the label in ink: success and warning are too light to read as text on white.
const TONES: Record<BadgeTone, string> = {
  neutral: 'border bg-card text-muted-foreground',
  brand: 'bg-primary text-primary-foreground',
  success: 'bg-[var(--success)]/15 text-foreground',
  warning: 'bg-[var(--warning)]/20 text-foreground',
  danger: 'bg-destructive/10 text-foreground',
}

interface BadgeProps {
  tone?: BadgeTone
  size?: 'sm' | 'md'
  className?: string
  children: ReactNode
}

export function Badge({ tone = 'neutral', size = 'md', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
