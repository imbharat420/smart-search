import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  // Every page is a real href, because the docx asks for crawlable pagination rather than
  // infinite scroll.
  hrefFor: (page: number) => string
}

const STEP = 'inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm font-semibold tabular-nums transition-colors'

function pageWindow(page: number, pages: number): (number | 'gap')[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1])
  const numbers = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  numbers.forEach((n, i) => {
    if (i > 0 && n - numbers[i - 1] > 1) out.push('gap')
    out.push(n)
  })
  return out
}

export function Pagination({ page, pageSize, total, hrefFor }: PaginationProps) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null

  const arrow = (target: number, label: string, icon: ReactNode) =>
    target >= 1 && target <= pages ? (
      <Link to={hrefFor(target)} aria-label={label} className={cn(STEP, 'border hover:bg-accent')}>
        {icon}
      </Link>
    ) : (
      <span aria-hidden="true" className={cn(STEP, 'border text-muted-foreground/40')}>
        {icon}
      </span>
    )

  return (
    <nav aria-label="Search result pages" className="flex flex-wrap items-center justify-center gap-1.5">
      {arrow(page - 1, 'Previous page', <ChevronLeft className="h-4 w-4" />)}
      {pageWindow(page, pages).map((entry, i) =>
        entry === 'gap' ? (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-sm text-muted-foreground">
            …
          </span>
        ) : (
          <Link
            key={entry}
            to={hrefFor(entry)}
            aria-current={entry === page ? 'page' : undefined}
            aria-label={`Page ${entry}`}
            className={cn(
              STEP,
              entry === page ? 'bg-[var(--ink)] text-white' : 'border hover:bg-accent',
            )}
          >
            {entry}
          </Link>
        ),
      )}
      {arrow(page + 1, 'Next page', <ChevronRight className="h-4 w-4" />)}
    </nav>
  )
}
