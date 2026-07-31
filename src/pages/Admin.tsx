import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChartLine, Database, Lock, Megaphone, Repeat2, SlidersHorizontal } from 'lucide-react'
import { usePageMeta } from '../lib/meta'
import { Tabs } from '../components/ui/tabs'
import { AnalyticsPanel } from '../components/admin/AnalyticsPanel'
import { PromotionBoard } from '../components/admin/PromotionBoard'
import { ReviewQueue } from '../components/admin/ReviewQueue'
import { SearchSetup } from '../components/admin/SearchSetup'
import { SourceHealth } from '../components/admin/SourceHealth'
import { SynonymTable } from '../components/admin/SynonymTable'
import { TabPanel } from '../components/admin/TabPanel'

const TABS = [
  { id: 'setup', label: 'Search setup', icon: <SlidersHorizontal /> },
  { id: 'promotion', label: 'Promotion', icon: <Megaphone /> },
  { id: 'synonyms', label: 'Synonyms', icon: <Repeat2 /> },
  { id: 'sources', label: 'Data sources', icon: <Database /> },
  { id: 'analytics', label: 'Analytics', icon: <ChartLine /> },
]

export function Admin() {
  usePageMeta(
    'Control panel — TravelIQ',
    'Search setup, merchandising, synonyms, data sources and search analytics for TravelIQ, editable without a developer.',
  )

  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') ?? ''
  const active = TABS.some((tab) => tab.id === requested) ? requested : 'setup'

  const [mounted, setMounted] = useState<string[]>([active])
  const [synonymSeed, setSynonymSeed] = useState('')

  useEffect(() => {
    setMounted((prev) => (prev.includes(active) ? prev : [...prev, active]))
  }, [active])

  const goToTab = (id: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', id)
        return next
      },
      { replace: true },
    )
  }

  // Seeding the synonym form from an analytics row would re-fire its effect on every
  // parent render if this identity changed, so it is memoised.
  const clearSynonymSeed = useCallback(() => setSynonymSeed(''), [])

  const seedSynonym = (query: string) => {
    setSynonymSeed(query)
    goToTab('synonyms')
  }

  return (
    <div className="min-h-screen bg-panel">
      <div className="mx-auto max-w-7xl px-6 py-8 md:px-10 md:py-12">
        <header className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Control panel
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            Change how search behaves without a release
          </h1>
          <p className="mt-4 text-[15px] text-muted-foreground">
            Everything a merchandiser would normally raise a ticket for lives here: which fields are
            searched and how heavily, which trips lead a campaign, the words travellers use that the
            catalogue does not, where each field&apos;s truth comes from, and what people searched
            for and did not find. Edits go through the same API the storefront reads, so they take
            effect on the next search.
          </p>
          <p className="mt-4 flex items-start gap-2 rounded-2xl border bg-accent px-4 py-3 text-sm">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              Authentication and roles are out of scope for this POC — the route is open and no login
              is faked; a real deployment puts it behind SSO with an editor and approver split.
            </span>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            With the FastAPI service stopped, the typed client answers from the seeded fixtures in
            src/mock/admin.ts and edits live only until you reload.
          </p>
        </header>

        <div className="sticky top-0 z-20 -mx-6 mt-8 bg-panel px-6 md:-mx-10 md:px-10">
          <Tabs tabs={TABS} active={active} onChange={goToTab} />
        </div>

        <div className="mt-6">
          <TabPanel id="setup" active={active} mounted={mounted.includes('setup')}>
            <SearchSetup />
          </TabPanel>

          <TabPanel id="promotion" active={active} mounted={mounted.includes('promotion')}>
            <PromotionBoard />
          </TabPanel>

          <TabPanel id="synonyms" active={active} mounted={mounted.includes('synonyms')}>
            <SynonymTable seedTerm={synonymSeed} onSeedUsed={clearSynonymSeed} />
          </TabPanel>

          <TabPanel id="sources" active={active} mounted={mounted.includes('sources')}>
            <SourceHealth />
            <ReviewQueue />
          </TabPanel>

          <TabPanel id="analytics" active={active} mounted={mounted.includes('analytics')}>
            <AnalyticsPanel onAddSynonym={seedSynonym} />
          </TabPanel>
        </div>
      </div>
    </div>
  )
}
