import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CalendarRange,
  Clock,
  Compass,
  Info,
  MapPin,
  Plane,
  PoundSterling,
  Sparkles,
  Sun,
  Tag,
  TextSearch,
  Users,
} from 'lucide-react'
import type { ParsedQuery, SearchResponse } from '../../types'
import { pct } from '../../lib/format'
import { cn } from '../../lib/utils'
import { Chip } from '../ui/chip'
import { describeParsed, type ParsedChipKey } from './constraints'

const ICONS: Record<ParsedChipKey, ReactNode> = {
  destination: <MapPin />,
  theme: <Tag />,
  activity: <Compass />,
  month: <CalendarRange />,
  duration: <Clock />,
  budget: <PoundSterling />,
  audience: <Users />,
  climate: <Sun />,
  direct: <Plane />,
  group: <Users />,
}

interface UnderstandingPillProps {
  parsed: ParsedQuery
  mode: SearchResponse['mode']
}

export function UnderstandingPill({ parsed, mode }: UnderstandingPillProps) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()

  const understood = parsed.source === 'ai' && mode === 'semantic'
  const explanation = understood
    ? `A language model read your sentence and produced these filters (confidence ${pct(parsed.confidence)}), then the semantic index ranked every trip against it.`
    : parsed.source === 'ai'
      ? 'The language model read your sentence, but the semantic index was unavailable, so results are ranked by keyword match instead.'
      : 'The AI layer was unavailable or too slow, so TravelIQ read your sentence with keyword rules and ranked by keyword match. The results are real — they are just matched more literally.'

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        className={cn(
          'inline-flex h-8 cursor-help items-center gap-1.5 rounded-full pl-2.5 pr-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 [&_svg]:size-3.5',
          understood
            ? 'bg-primary text-primary-foreground'
            : 'border border-[var(--warning)]/50 bg-[var(--warning)]/20 text-foreground',
        )}
      >
        {understood ? <Sparkles /> : <TextSearch />}
        {understood ? 'Understood by AI' : 'Keyword fallback'}
        <Info className="opacity-60" />
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-2 w-72 rounded-2xl border bg-card p-3 text-xs font-normal leading-relaxed text-muted-foreground shadow-lg"
        >
          {explanation}
        </span>
      )}
    </span>
  )
}

interface ParsedChipsProps {
  parsed: ParsedQuery
  mode: SearchResponse['mode']
  onRemove: (key: ParsedChipKey) => void
}

export function ParsedChips({ parsed, mode, onRemove }: ParsedChipsProps) {
  const chips = describeParsed(parsed)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <UnderstandingPill parsed={parsed} mode={mode} />
      <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
      {chips.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing read from the sentence yet — name a month, a budget, who is travelling or a
          theme and the filters will appear here.
        </p>
      ) : (
        chips.map((chip) => (
          <Chip
            key={chip.key}
            label={chip.label}
            icon={ICONS[chip.key]}
            onRemove={() => onRemove(chip.key)}
          />
        ))
      )}
    </div>
  )
}
