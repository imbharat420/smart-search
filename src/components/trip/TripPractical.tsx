import { ShieldCheck } from 'lucide-react'
import { POLICIES } from '../../mock/policies'

// /trips/{slug} returns policy ids, not policy prose, so the four booking documents are bundled
// with the app. A /policies endpoint reading the same CMS records would replace this import.
export function TripPractical({ policyIds }: { policyIds: string[] }) {
  const policies = POLICIES.filter((policy) => policyIds.includes(policy.id))
  if (policies.length === 0) return null

  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">Before you book</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">
        The conditions attached to this trip. These are the same documents the assistant quotes and
        cites, so an answer in chat and the small print here can never drift apart.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {policies.map((policy) => (
          <article key={policy.id} className="rounded-2xl border bg-card p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              {policy.label}
            </h3>
            <p className="mt-2.5 text-[15px] font-medium">{policy.summary}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{policy.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
