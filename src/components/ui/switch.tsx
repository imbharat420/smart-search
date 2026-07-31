import { cn } from '../../lib/utils'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  className?: string
}

export function Switch({ checked, onChange, label, className }: SwitchProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2',
        checked ? 'bg-primary' : 'bg-border',
        !label && className,
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-card shadow transition-transform',
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  )

  if (!label) return control

  return (
    <label
      className={cn(
        'flex min-h-10 cursor-pointer select-none items-center justify-between gap-4 text-sm text-foreground',
        className,
      )}
    >
      <span>{label}</span>
      {control}
    </label>
  )
}
