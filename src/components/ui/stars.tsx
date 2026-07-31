import { Star } from 'lucide-react'
import { cn } from '../../lib/utils'

interface StarsProps {
  value: number
  size?: number
  className?: string
}

export function Stars({ value, size = 14, className }: StarsProps) {
  const halves = Math.round(value * 2) / 2

  return (
    <span
      role="img"
      aria-label={`Rated ${value.toFixed(1)} out of 5`}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.min(1, Math.max(0, halves - i))
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star
              size={size}
              strokeWidth={0}
              fill="currentColor"
              className="absolute inset-0 text-muted-foreground/25"
            />
            {fill > 0 && (
              // A clipped overlay is what gives the half star its exact width.
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star
                  size={size}
                  strokeWidth={0}
                  fill="currentColor"
                  className="text-[var(--primary-strong)]"
                />
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

interface RatingLineProps {
  value: number
  count?: number
  className?: string
}

export function RatingLine({ value, count, className }: RatingLineProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <Stars value={value} />
      <span aria-hidden="true" className="font-semibold tabular-nums text-foreground">
        {value.toFixed(1)}
      </span>
      {typeof count === 'number' && (
        <span className="tabular-nums">({count.toLocaleString('en-GB')} reviews)</span>
      )}
    </span>
  )
}
