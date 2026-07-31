import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  label?: string
  className?: string
}

export function Select({ value, onChange, options, label, className }: SelectProps) {
  return (
    <label
      className={cn(
        'inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border bg-card pl-4 pr-2 transition-shadow focus-within:ring-2 focus-within:ring-[var(--ring)]',
        className,
      )}
    >
      {label && <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{label}</span>}
      <span className="relative flex items-center">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 cursor-pointer appearance-none bg-transparent pr-7 text-sm font-semibold text-foreground outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 h-4 w-4 text-muted-foreground" />
      </span>
    </label>
  )
}
