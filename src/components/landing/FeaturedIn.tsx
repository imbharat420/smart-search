const titles = ['Skift', 'PhocusWire', 'Travolution', 'TTG Media', 'Travel Weekly', 'WiT']

export function FeaturedIn() {
  return (
    <section className="border-t py-16">
      <div className="mx-auto w-full max-w-6xl px-6 text-center md:px-10">
        <h2 className="text-xl font-bold tracking-tight">As featured in</h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 font-serif text-xl text-muted-foreground opacity-80 md:text-2xl">
          {titles.map((title) => (
            <span key={title}>{title}</span>
          ))}
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          Placeholder row: these are the trade titles a launch would target, not coverage we hold.
          Real logos and links would come from the CMS.
        </p>
      </div>
    </section>
  )
}
