import { Link } from 'react-router-dom'

const explore = [
  { to: '/search', label: 'Search trips' },
  { to: '/inspiration', label: 'Guides and collections' },
  { to: '/discover', label: 'Things to do nearby' },
  { to: '/assistant', label: 'Ask TravelIQ' },
]

export function SiteFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-12 md:grid-cols-[1.5fr_1fr_1.2fr] md:px-10">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">
              T
            </span>
            <span className="text-lg font-bold tracking-tight">TravelIQ</span>
          </div>
          <p className="mt-4 max-w-sm text-[15px] text-muted-foreground">
            One sentence in, the right trip out. TravelIQ reads a traveller&rsquo;s intent, merges
            your CMS and supplier feeds into a single catalogue, and falls back to keyword search
            the moment the AI layer is slow.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Prices shown in GBP per person, based on a seeded demo catalogue.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-bold">Explore</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {explore.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-bold">Booking and protection</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Booking and payment terms</li>
            <li>Cancellations and amendments</li>
            <li>Baggage and travel documents</li>
            <li>ATOL financial protection</li>
          </ul>
          {/* Policy text exists as retrieval documents for the assistant; standalone pages are not in scope. */}
          <p className="mt-3 text-xs text-muted-foreground">
            These four policies are indexed for the assistant to quote and cite. Standalone policy
            pages would come from the CMS in a production build.
          </p>
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-10">
          <span>Copyright 2026 TravelIQ &mdash; proof of concept, not a bookable service</span>
          <span>Search, catalogue and analytics are running against the POC backend</span>
        </div>
      </div>
    </footer>
  )
}
