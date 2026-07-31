import type { SearchResult } from '../../types'
import { cn } from '../../lib/utils'
import { SkeletonCard } from '../ui/skeleton'
import { ResultCard } from './ResultCard'

const GRID = 'grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3'

interface ResultGridProps {
  results: SearchResult[]
  page: number
  pageSize: number
  dimmed?: boolean
  onSelect: (result: SearchResult, position: number) => void
}

export function ResultGrid({ results, page, pageSize, dimmed = false, onSelect }: ResultGridProps) {
  return (
    <div
      aria-busy={dimmed}
      className={cn(GRID, 'transition-opacity duration-200', dimmed && 'opacity-50')}
    >
      {results.map((result, i) => (
        <ResultCard
          key={result.trip.id}
          result={result}
          position={(page - 1) * pageSize + i + 1}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export function ResultGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={GRID} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
