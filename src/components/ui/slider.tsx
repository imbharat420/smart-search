import { cn } from '../../lib/utils'

interface SliderProps {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  label?: string
  format?: (value: number) => string
  className?: string
}

const THUMB =
  '[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-card [&::-moz-range-thumb]:shadow'

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  label,
  format,
  className,
}: SliderProps) {
  const filled = max === min ? 0 : ((value - min) / (max - min)) * 100
  const readout = format ? format(value) : String(value)

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-semibold tabular-nums text-foreground">{readout}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={readout}
        // No browser paints the filled part of a range input consistently, so the track is a gradient.
        // The filled part uses the strong brand shade: the brand tint itself sits at 1.15:1
        // against the track, which reads as an empty slider.
        style={{
          backgroundImage: `linear-gradient(to right, var(--primary-strong) ${filled}%, var(--border) ${filled}%)`,
        }}
        className={cn(
          'my-2 h-2 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-4',
          THUMB,
        )}
      />
    </div>
  )
}
