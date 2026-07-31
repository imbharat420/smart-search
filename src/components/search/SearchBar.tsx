import { useEffect, useId, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import { LoaderCircle, Search as SearchIcon, X } from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  busy?: boolean
}

// Shown while the field is short: the three sentences the product was designed around, so a
// first-time visitor can see what "describe it" actually means.
const EXAMPLES = [
  'northern lights trip for a family next winter, not too expensive',
  '7 day walking holiday in italy with small groups',
  'somewhere warm in november under 1200 direct flights',
]

const SUGGEST_DEBOUNCE_MS = 180

export function SearchBar({ value, onChange, onSubmit, busy = false }: SearchBarProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const requestId = useRef(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const listId = useId()

  const term = value.trim()
  const options = term.length < 2 ? EXAMPLES : suggestions
  const showList = open && options.length > 0

  useEffect(() => {
    if (term.length < 2) {
      setSuggestions([])
      return
    }
    const id = ++requestId.current
    const timer = window.setTimeout(() => {
      void api.suggest(term).then((hits) => {
        // Guards against out-of-order responses when the user types quickly.
        if (id === requestId.current) setSuggestions(hits)
      })
    }, SUGGEST_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [term])

  useEffect(() => setActive(-1), [value])

  const pick = (option: string) => {
    setOpen(false)
    setActive(-1)
    onSubmit(option)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
      return
    }
    if (e.key === 'Enter') {
      pick(active >= 0 ? options[active] : value)
      return
    }
    if (options.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
    }
  }

  // The dropdown holds focusable buttons, so it may only close when focus leaves the whole field.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!wrapper.current?.contains(e.relatedTarget)) setOpen(false)
  }

  return (
    <div ref={wrapper} className="relative" onBlur={onBlur}>
      <div className="flex h-14 items-center gap-3 rounded-full border bg-card pl-5 pr-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-[var(--ring)] md:h-16 md:gap-4 md:pl-7 md:pr-3">
        <SearchIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          placeholder="Describe the trip you want, in your own words"
          aria-label="Describe the trip you want"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground md:text-lg"
        />
        {busy && (
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
          />
        )}
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              onSubmit('')
            }}
            aria-label="Clear the sentence"
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <Button
          onClick={() => pick(value)}
          className="shrink-0 md:h-12 md:px-7 md:text-[15px]"
        >
          Search
        </Button>
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-3xl border bg-card p-2 shadow-lg"
        >
          <li
            role="presentation"
            className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {term.length < 2 ? 'Try a whole sentence' : 'Suggestions'}
          </li>
          {options.map((option, i) => (
            <li key={option} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(option)}
                className={cn(
                  'flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-sm transition-colors',
                  i === active ? 'bg-accent' : 'hover:bg-accent',
                )}
              >
                <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{option}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
