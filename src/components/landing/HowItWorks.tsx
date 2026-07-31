const steps = [
  {
    title: 'Install package',
    detail:
      'The TravelIQ packages are added to your application, and the database and search infrastructure are set up.',
  },
  {
    title: 'Configure',
    detail:
      'Searchable fields, filters, sorting, ranking and widget appearance are set in the admin panel to match your brand and range.',
  },
  {
    title: 'Connect APIs',
    detail:
      'Your CMS and supplier feeds are connected. Products are cleaned, matched, merged, de-duplicated and indexed.',
  },
  {
    title: 'Ready',
    detail:
      'Search goes live. Your team runs promotion and merchandising from the panel, without a development release.',
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl px-6 py-20 md:px-10">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">How it works</h2>
        <p className="mt-4 text-[15px] text-muted-foreground">
          TravelIQ installs into your application rather than replacing it. Four steps from package
          to live search, in the order a team actually does them.
        </p>
      </div>

      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.title} className="rounded-2xl border bg-card p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground tabular-nums">
              {i + 1}
            </span>
            <h3 className="mt-4 font-semibold leading-snug">{step.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{step.detail}</p>
          </li>
        ))}
      </ol>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        This POC demonstrates steps two to four against a seeded catalogue. Step one is a script run
        and a connection string, not a screen.
      </p>
    </section>
  )
}
