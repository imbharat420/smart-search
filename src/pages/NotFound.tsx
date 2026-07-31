import { Link } from 'react-router-dom'
import { usePageMeta } from '../lib/meta'

export function NotFound() {
  usePageMeta(
    'Page not found — TravelIQ',
    'That page is not part of TravelIQ. Search trips or head back to the home page.',
  )

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start px-6 py-24 md:px-10 md:py-32">
      <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold tracking-wide text-accent-foreground tabular-nums">
        404
      </span>
      <h1 className="mt-6 text-3xl font-extrabold tracking-tight md:text-4xl">
        We could not find that page
      </h1>
      <p className="mt-4 text-[15px] text-muted-foreground">
        The link may be out of date, or the trip it pointed at has left the catalogue. Search again
        and TravelIQ will read your sentence and rebuild the filters for you.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          to="/search"
          className="inline-flex h-11 items-center rounded-full bg-ink px-6 text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          Search trips
        </Link>
        <Link
          to="/"
          className="inline-flex h-11 items-center rounded-full border bg-card px-6 text-sm font-semibold transition-colors hover:bg-accent"
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
