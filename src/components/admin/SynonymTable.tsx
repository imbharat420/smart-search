import { useEffect, useRef, useState } from 'react'
import { CircleCheck, FlaskConical, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { Synonym } from '../../types'
import { api } from '../../lib/api'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select } from '../ui/select'
import { Skeleton } from '../ui/skeleton'
import { AdminSection } from './AdminSection'

const MARKETS = [
  { value: 'en-GB', label: 'en-GB' },
  { value: 'en-US', label: 'en-US' },
  { value: 'de-DE', label: 'de-DE' },
  { value: 'fr-FR', label: 'fr-FR' },
  { value: 'es-ES', label: 'es-ES' },
]

const EMPTY_DRAFT = { term: '', alternatives: '', market: 'en-GB' }

interface TestOutcome {
  term: string
  total: number
  mode: string
  tookMs: number
}

interface SynonymTableProps {
  seedTerm: string
  onSeedUsed: () => void
}

export function SynonymTable({ seedTerm, onSeedUsed }: SynonymTableProps) {
  const [synonyms, setSynonyms] = useState<Synonym[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [seeded, setSeeded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [testTerm, setTestTerm] = useState('')
  const [testing, setTesting] = useState(false)
  const [outcome, setOutcome] = useState<TestOutcome | null>(null)
  const termRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    api.synonyms().then((list) => {
      if (cancelled) return
      setSynonyms(list)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Arriving from a zero-result row on the analytics tab: prefill the term and take focus.
  useEffect(() => {
    if (!seedTerm) return
    setDraft({ ...EMPTY_DRAFT, term: seedTerm })
    setSeeded(true)
    setTestTerm(seedTerm)
    termRef.current?.focus()
    onSeedUsed()
  }, [seedTerm, onSeedUsed])

  const add = async () => {
    const term = draft.term.trim()
    const alternatives = draft.alternatives
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    if (!term || alternatives.length === 0) {
      toast.error('A synonym needs a term and at least one alternative')
      return
    }

    setAdding(true)
    const created = await api.addSynonym({ term, alternatives, market: draft.market })
    setSynonyms((prev) => [created, ...prev])
    setDraft(EMPTY_DRAFT)
    setSeeded(false)
    setAdding(false)
    toast.success(`"${created.term}" now also matches ${created.alternatives.length} phrases`)
  }

  const remove = async (synonym: Synonym) => {
    await api.deleteSynonym(synonym.id)
    setSynonyms((prev) => prev.filter((s) => s.id !== synonym.id))
    toast.success(`Removed the synonyms for "${synonym.term}"`)
  }

  const runTest = async () => {
    const term = testTerm.trim()
    if (!term) return
    setTesting(true)
    const res = await api.search({ query: term, pageSize: 1 })
    setOutcome({ term, total: res.total, mode: res.mode, tookMs: res.tookMs })
    setTesting(false)
  }

  return (
    <AdminSection
      title="Synonyms"
      hint="The words travellers use that the catalogue does not. Expansion happens at query time, so a new row changes results on the next search with no re-index."
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="w-56 px-5 py-3 font-semibold">
                Term
              </th>
              <th scope="col" className="px-5 py-3 font-semibold">
                Also matches
              </th>
              <th scope="col" className="w-36 px-5 py-3 font-semibold">
                Market
              </th>
              <th scope="col" className="w-20 px-5 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b bg-panel align-top">
              <td className="px-5 py-4">
                <Input
                  ref={termRef}
                  value={draft.term}
                  onChange={(e) => setDraft({ ...draft, term: e.target.value })}
                  placeholder="northern lights"
                  aria-label="New synonym term"
                />
                {seeded && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Prefilled from a zero-result search — trim it to the term travellers actually
                    mean.
                  </p>
                )}
              </td>
              <td className="px-5 py-4">
                <Input
                  value={draft.alternatives}
                  onChange={(e) => setDraft({ ...draft, alternatives: e.target.value })}
                  placeholder="aurora, aurora borealis, polar lights"
                  aria-label="Alternative phrases, comma separated"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">Separate phrases with commas.</p>
              </td>
              <td className="px-5 py-4">
                <Select
                  value={draft.market}
                  onChange={(market) => setDraft({ ...draft, market })}
                  options={MARKETS}
                  className="w-full justify-between"
                />
              </td>
              <td className="px-5 py-4">
                <Button size="sm" onClick={add} disabled={adding}>
                  <Plus />
                  Add
                </Button>
              </td>
            </tr>

            {loading
              ? [0, 1, 2].map((row) => (
                  <tr key={row} className="border-b last:border-b-0">
                    <td className="px-5 py-4">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="px-5 py-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                    <td className="px-5 py-4">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-5 py-4" />
                  </tr>
                ))
              : synonyms.map((synonym) => (
                  <tr key={synonym.id} className="border-b align-top last:border-b-0">
                    <th scope="row" className="px-5 py-4 text-[15px] font-semibold">
                      {synonym.term}
                    </th>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {synonym.alternatives.map((alternative) => (
                          <Badge key={alternative} tone="neutral" size="sm">
                            {alternative}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-4 tabular-nums text-muted-foreground">
                      {synonym.market}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => remove(synonym)}
                        aria-label={`Delete the synonyms for ${synonym.term}`}
                        className="flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <div className="border-t bg-panel px-5 py-5">
        <h3 className="text-sm font-semibold">Test it</h3>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Runs the phrase through the same /search endpoint the storefront uses and reports how many
          trips came back, so the effect of a row above is observable rather than assumed.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="w-full sm:max-w-sm">
            <Input
              value={testTerm}
              onChange={(e) => setTestTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runTest()
              }}
              icon={<FlaskConical />}
              placeholder="aurora"
              aria-label="Phrase to test"
            />
          </div>
          <Button variant="outline" size="md" onClick={runTest} disabled={testing}>
            {testing ? 'Running' : 'Run test'}
          </Button>
        </div>

        {outcome && (
          <p className="mt-3 flex items-start gap-2 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
            {outcome.total > 0 ? (
              <CircleCheck className="text-[var(--success)]" />
            ) : (
              <TriangleAlert className="text-[var(--warning)]" />
            )}
            <span>
              <span className="font-semibold">&quot;{outcome.term}&quot;</span> matched{' '}
              <span className="tabular-nums">{outcome.total}</span>{' '}
              {outcome.total === 1 ? 'trip' : 'trips'} in{' '}
              <span className="tabular-nums">{outcome.tookMs}</span> ms via the{' '}
              {outcome.mode === 'semantic' ? 'semantic' : 'keyword fallback'} layer.
              {outcome.total === 0 &&
                ' Add the phrase as an alternative above and test again to see it resolve.'}
            </span>
          </p>
        )}
      </div>
    </AdminSection>
  )
}
