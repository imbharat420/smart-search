import { Check } from 'lucide-react'

export function TripIncluded({ items }: { items: string[] }) {
  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">What&rsquo;s included</h2>
      <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-[15px]">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-3 w-3" />
            </span>
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs text-muted-foreground">
        Travel insurance, visas and airport parking are not included. Insurance is a condition of
        booking on our walking, trekking and winter trips &mdash; see the booking conditions below.
      </p>
    </section>
  )
}
