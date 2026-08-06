import type { ReactNode } from 'react'
import type { Citation } from '../../types'

interface MessageProseProps {
  content: string
  citations?: Citation[]
  streaming?: boolean
  onCitation: (citation: Citation) => void
}

// The model cites sources inline as [<trip uuid>] or [policy-cancellation] (the
// contract in backend/app/chat.py's SYSTEM_PROMPT). A raw id means nothing to a
// traveller, so the prose swaps each one for the same numbered marker the Sources
// row and the trip cards carry — tapping it jumps to the card the same way the
// pill does. An id whose citation has not streamed in yet is hidden rather than
// shown raw; the citations chunk arrives last, so during streaming that is every id.
const BRACKET_RE = /\[([^\[\]\n]{2,120})\]/g
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_SHAPE_RE = /^(?:trip|policy|guide)-[a-z0-9][a-z0-9_-]*$/i

const looksLikeId = (part: string) => UUID_RE.test(part) || ID_SHAPE_RE.test(part)

// A half-typed citation at the end of a streaming message — "…families [d45c55c" —
// would flash the raw id before the closing bracket arrives. One unbroken run of
// non-space characters after a "[" is an id being typed, never prose, so it is safe
// to hold back; "[either option or…" has spaces and stays visible.
const PARTIAL_ID_RE = /\[[^\s\]]*$/

// The model answers in light markdown whatever the prompt says, and the habit
// survives every fallback provider — so "* **Kerala Backwaters**" was reaching
// the reader as literal asterisks. Rather than ship a sanitising markdown
// renderer, normalise the three shapes that actually occur: leading */- bullets
// become bullet glyphs, headings become bold lines, and **…** runs become
// <strong> elements built as React nodes — no HTML ever parsed.
const BULLET_RE = /^(\s*)[*-]\s+/gm
const HEADING_RE = /^#{1,6}\s+(.+)$/gm
const BOLD_RE = /\*\*([^\n*][^\n]*?)\*\*/g

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(BOLD_RE)) {
    const at = match.index ?? 0
    out.push(text.slice(last, at))
    out.push(
      <strong key={`b-${at}`} className="font-semibold">
        {match[1]}
      </strong>,
    )
    last = at + match[0].length
  }
  out.push(text.slice(last))
  return out
}

export function MessageProse({ content, citations, streaming, onCitation }: MessageProseProps) {
  const bySource = new Map<string, { n: number; citation: Citation }>()
  citations?.forEach((citation, i) => bySource.set(citation.sourceId, { n: i + 1, citation }))

  let text = streaming ? content.replace(PARTIAL_ID_RE, '') : content
  text = text.replace(BULLET_RE, '$1• ').replace(HEADING_RE, '**$1**')
  // Mid-stream, an odd number of ** delimiters means the final bold run has no
  // closer yet — hold it back the same way PARTIAL_ID_RE holds back half ids.
  if (streaming && (text.match(/\*\*/g) ?? []).length % 2 === 1) {
    text = text.replace(/\*\*[^*]*$/, '')
  }
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of text.matchAll(BRACKET_RE)) {
    // A bracket is only a citation if every comma-separated part inside it is
    // id-shaped or a known source — "[sold out]" and friends stay ordinary prose.
    const parts = match[1].split(/[,;]\s*/).map((part) => part.trim())
    if (!parts.every((part) => bySource.has(part) || looksLikeId(part))) continue

    const at = match.index ?? 0
    let before = text.slice(cursor, at)
    cursor = at + match[0].length
    const known = parts.filter((part) => bySource.has(part))

    // Dropping the bracket entirely leaves its spacing behind — "1. [id] Tromsø"
    // must read "1. Tromsø", not "1.  Tromsø", and "families [id]." not "families .".
    if (known.length === 0) {
      if (text[cursor] === ' ') cursor += 1
      else before = before.replace(/ $/, '')
    }
    nodes.push(<span key={`t-${at}`}>{renderInline(before)}</span>)

    for (const part of known) {
      const { n, citation } = bySource.get(part)!
      nodes.push(
        <button
          key={`${at}-${part}`}
          type="button"
          onClick={() => onCitation(citation)}
          title={`Jump to ${citation.label}`}
          aria-label={`Source ${n}: ${citation.label}`}
          className="mx-0.5 inline-flex h-[18px] w-[18px] -translate-y-px cursor-pointer items-center justify-center rounded-full bg-primary align-middle text-[10px] font-bold tabular-nums text-primary-foreground transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {n}
        </button>,
      )
    }
  }

  nodes.push(<span key="tail">{renderInline(text.slice(cursor))}</span>)
  return <span className="whitespace-pre-wrap">{nodes}</span>
}
