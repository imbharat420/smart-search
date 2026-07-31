import { forwardRef } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../../lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, className, ...props },
  ref,
) {
  return (
    <div className="relative flex w-full items-center">
      {icon && (
        <span className="pointer-events-none absolute left-4 flex text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          'h-11 w-full rounded-full border bg-card text-[15px] text-foreground transition-shadow placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-40',
          icon ? 'pl-11 pr-4' : 'px-4',
          className,
        )}
        {...props}
      />
    </div>
  )
})

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  icon?: ReactNode
  trailing?: ReactNode
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, icon, trailing, className, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'flex h-12 w-full items-center gap-3 rounded-full border bg-card px-5 transition-shadow focus-within:ring-2 focus-within:ring-[var(--ring)]',
        className,
      )}
    >
      <span className="flex shrink-0 text-muted-foreground [&_svg]:size-4">{icon ?? <Search />}</span>
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
    </div>
  )
})
