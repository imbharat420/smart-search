import { cn } from '../../lib/utils'

interface TagToggleProps {
  label: string
  active: boolean
  onClick: () => void
  count?: number
}

export function TagToggle({ label, active, onClick, count }: TagToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2',
        active
          ? 'bg-primary text-primary-foreground'
          : 'border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {label}
      {count !== undefined && (
        <span className="text-[11px] tabular-nums opacity-70">{count}</span>
      )}
    </button>
  )
}
