import { cn } from '../../lib/utils'

const RADII = [5, 10, 25, 50]

interface RadiusControlProps {
  value: number
  onChange: (miles: number) => void
}

// Native radios rather than buttons, so the group is one tab stop with arrow-key
// selection; the pills are the labels.
export function RadiusControl({ value, onChange }: RadiusControlProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-muted-foreground">Radius</span>
      <div
        role="group"
        aria-label="Search radius in miles"
        className="flex items-center gap-1 rounded-full border bg-card p-1"
      >
        {RADII.map((miles) => {
          const active = miles === value
          return (
            <label
              key={miles}
              className={cn(
                'flex h-10 min-w-11 cursor-pointer items-center justify-center rounded-full px-3 text-xs font-semibold tabular-nums transition-colors focus-within:ring-2 focus-within:ring-[var(--ring)]',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <input
                type="radio"
                name="discover-radius"
                value={miles}
                checked={active}
                onChange={() => onChange(miles)}
                className="sr-only"
              />
              {miles}
            </label>
          )
        })}
        <span className="px-2 text-xs text-muted-foreground">miles</span>
      </div>
    </div>
  )
}
