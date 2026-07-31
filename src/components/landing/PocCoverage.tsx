import { Link } from 'react-router-dom'

const areas = [
  {
    title: 'AI query understanding',
    detail:
      'A sentence becomes destination, month, duration, budget, theme and party size. When the model is slow the keyword layer answers instead, and the results header says which one did.',
  },
  {
    title: 'Instant search and filtering',
    detail:
      'Live facet counts, typo tolerance, predictive suggestions, and every filter held in the URL so a result set can be shared or bookmarked.',
  },
  {
    title: 'Unified product catalogue',
    detail:
      'The same trip arriving from the CMS, a supplier feed and an enrichment source is matched, merged and de-duplicated, with per-field source priority.',
  },
  {
    title: 'Admin control panel',
    detail:
      'Searchable fields and weights, pin, boost and hide, synonyms per market, feed health, and a review queue for matches the pipeline is unsure about.',
  },
  {
    title: 'Search analytics',
    detail:
      'Top searches, searches that returned nothing, click-through and conversion traced back to the search that produced the booking.',
  },
  {
    title: 'Postgres, SEO and security',
    detail:
      'Postgres is the system of record and the app still runs on the seeded catalogue without it. Readable filter URLs and numbered pagination are in; server rendering and canonical tags are documented as roadmap.',
  },
]

export function PocCoverage() {
  return (
    <section className="border-t bg-card py-16">
      <div className="mx-auto w-full max-w-6xl px-6 md:px-10">
        <div className="max-w-2xl">
          <h2 className="text-xl font-bold tracking-tight">What this POC covers</h2>
          <p className="mt-3 text-[15px] text-muted-foreground">
            The six feature areas from the TravelIQ product document, and how much of each is real
            in this build. Nothing here is a hardcoded demo path.
          </p>
        </div>

        <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => (
            <div key={area.title} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <div>
                <h3 className="font-semibold leading-snug">{area.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{area.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-sm text-muted-foreground">
          The panel that drives all of it is at{' '}
          <Link to="/admin" className="font-semibold text-foreground hover:underline">
            the control panel
          </Link>
          , open without sign-in for this POC.
        </p>
      </div>
    </section>
  )
}
