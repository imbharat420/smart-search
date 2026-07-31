import { useEffect, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Sheet } from '../ui/sheet'

interface TripGalleryProps {
  title: string
  images: string[]
}

// The seeded catalogue asks Unsplash for 800px wide files, which is soft once an image fills
// the lightbox; the width lives in the query string, so ask for a bigger one there.
const large = (src: string): string => src.replace('w=800', 'w=1600')

export function TripGallery({ title, images }: TripGalleryProps) {
  const [openAt, setOpenAt] = useState<number | null>(null)

  // Suppliers and the CMS both send a hero shot, so the merged gallery can repeat itself.
  const shots = images.filter((src, i) => images.indexOf(src) === i)
  const thumbs = shots.slice(1, 4)
  const open = openAt !== null
  const current = openAt ?? 0

  useEffect(() => {
    if (!open) return

    const step = (delta: number) =>
      setOpenAt((at) => (at === null ? at : (at + delta + shots.length) % shots.length))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, shots.length])

  return (
    <section aria-label="Trip gallery">
      <div className="grid gap-3 lg:grid-cols-[1.65fr_1fr]">
        <button
          type="button"
          onClick={() => setOpenAt(0)}
          aria-label="Open the gallery"
          className="group cursor-pointer overflow-hidden rounded-3xl bg-accent"
        >
          <img
            src={shots[0]}
            alt={title}
            className="aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        </button>

        <div className="grid grid-cols-2 gap-3 lg:grid-rows-2">
          {thumbs.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setOpenAt(i + 1)}
              aria-label={`Open photo ${i + 2}`}
              className="group cursor-pointer overflow-hidden rounded-2xl bg-accent"
            >
              <img
                src={src}
                alt={`${title}, photo ${i + 2}`}
                loading="lazy"
                className="aspect-[4/3] h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04] lg:aspect-auto"
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpenAt(0)}
            className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border bg-panel text-xs font-semibold transition-colors hover:bg-accent lg:aspect-auto"
          >
            <Camera className="h-4 w-4" />
            <span className="tabular-nums">All {shots.length} photos</span>
          </button>
        </div>
      </div>

      <Sheet open={open} onClose={() => setOpenAt(null)} side="bottom" title="Gallery">
        <div className="flex flex-col gap-4 p-5">
          <div className="relative overflow-hidden rounded-2xl bg-accent">
            <img
              src={large(shots[current])}
              alt={`${title}, photo ${current + 1}`}
              className="aspect-[16/10] w-full object-cover"
            />
            <button
              type="button"
              onClick={() => setOpenAt((at) => ((at ?? 0) - 1 + shots.length) % shots.length)}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-background/90 transition-colors hover:bg-background"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpenAt((at) => ((at ?? 0) + 1) % shots.length)}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-background/90 transition-colors hover:bg-background"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Photo <span className="tabular-nums">{current + 1}</span> of{' '}
              <span className="tabular-nums">{shots.length}</span> &middot; the arrow keys move
              through the set
            </p>
            <div className="flex gap-2">
              {shots.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setOpenAt(i)}
                  aria-label={`Show photo ${i + 1}`}
                  aria-current={i === current ? 'true' : undefined}
                  className={cn(
                    'h-12 w-16 cursor-pointer overflow-hidden rounded-lg border-2 transition-opacity',
                    i === current
                      ? 'border-[var(--primary-strong)]'
                      : 'border-transparent opacity-60 hover:opacity-100',
                  )}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    </section>
  )
}
