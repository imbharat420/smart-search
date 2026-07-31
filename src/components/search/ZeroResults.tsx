import { Link } from 'react-router-dom'
import { RotateCcw, SearchX, Sparkles } from 'lucide-react'
import type { ParsedQuery } from '../../types'
import { Chip } from '../ui/chip'
import { describeParsed } from './constraints'

export interface RelaxAction {
  id: string
  label: string
  onApply: () => void
}

interface ZeroResultsProps {
  query: string
  parsed: ParsedQuery
  suggestions: string[]
  relaxations: RelaxAction[]
  onSuggestion: (query: string) => void
}

export function ZeroResults({
  query,
  parsed,
  suggestions,
  relaxations,
  onSuggestion,
}: ZeroResultsProps) {
  const chips = describeParsed(parsed)

  return (
    <div className="rounded-2xl border border-dashed bg-card p-6 md:p-10">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
        <SearchX className="h-5 w-5" />
      </span>
      <h2 className="mt-5 text-xl font-bold tracking-tight">No trips match that yet</h2>
      {query && (
        <p className="mt-2 text-[15px] text-muted-foreground">
          Nothing in the catalogue satisfies every part of{' '}
          <span className="font-medium text-foreground">“{query}”</span>. It is almost always one
          constraint too many.
        </p>
      )}

      {chips.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What TravelIQ read from your sentence
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <Chip key={chip.key} label={chip.label} tone="neutral" />
            ))}
          </div>
        </div>
      )}

      {relaxations.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Loosen one thing
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {relaxations.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.onApply}
                className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Or try one of these
          </p>
          <div className="mt-2 flex flex-col items-start gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestion(suggestion)}
                className="max-w-full cursor-pointer text-left text-[15px] font-medium underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 flex flex-wrap items-center gap-1.5 border-t pt-5 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4" />
        Not sure how to narrow it down?
        <Link
          to="/assistant"
          className="font-semibold text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
        >
          Ask the assistant
        </Link>
        and it will suggest trips with its sources.
      </p>
    </div>
  )
}
