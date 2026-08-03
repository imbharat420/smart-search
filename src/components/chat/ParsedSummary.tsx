import { ArrowRight, Search, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ParsedQuery } from '../../types'
import { pct } from '../../lib/format'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Chip } from '../ui/chip'
import { parsedChips, parsedToFilters, searchUrl } from './parsedFilters'

interface ParsedSummaryProps {
  parsed: ParsedQuery
  query: string
  total?: number
}

export function ParsedSummary({ parsed, query, total }: ParsedSummaryProps) {
  const chips = parsedChips(parsed)
  if (chips.length === 0) return null

  const byAi = parsed.source === 'ai'
  const label =
    total === undefined
      ? 'See matching trips'
      : total === 0
        ? 'No trip matches every filter — open Search'
        : `See all ${total} matches`

  return (
    <div className="rounded-2xl border bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">Read from your message</p>
        <Badge tone={byAi ? 'brand' : 'neutral'} size="sm">
          {byAi ? <Sparkles /> : <Search />}
          {byAi ? 'Read by AI' : 'Keyword match'}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {pct(parsed.confidence)} confidence
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <Chip key={chip.key} label={chip.label} />
        ))}
      </div>

      <div className="mt-3">
        <Button asChild variant="outline" size="sm">
          <Link to={searchUrl(query, parsedToFilters(parsed))}>
            {label}
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  )
}
