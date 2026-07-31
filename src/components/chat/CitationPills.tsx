import type { Citation } from '../../types'

interface CitationPillsProps {
  citations: Citation[]
  onSelect: (citation: Citation) => void
}

export function CitationPills({ citations, onSelect }: CitationPillsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Sources</span>
      {citations.map((citation, i) => (
        <button
          key={citation.id}
          type="button"
          onClick={() => onSelect(citation)}
          title={`Jump to ${citation.label}`}
          className="inline-flex h-8 max-w-[15rem] cursor-pointer items-center gap-1.5 rounded-full border bg-card pl-1.5 pr-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold tabular-nums text-primary-foreground">
            {i + 1}
          </span>
          <span className="truncate">{citation.label}</span>
        </button>
      ))}
    </div>
  )
}
