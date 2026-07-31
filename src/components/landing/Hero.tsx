import { Link } from 'react-router-dom'
import { ArrowRight, MessagesSquare } from 'lucide-react'
import { Button } from '../ui/button'
import { LandingNav } from './LandingNav'

// The first worked example from the product document, so the primary CTA lands on a
// search that already has filters on screen rather than an empty box.
const EXAMPLE_QUERY = 'northern lights trip for a family next winter, not too expensive'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-primary">
      <div className="mx-auto w-full max-w-7xl px-6 pb-24 pt-6 md:px-10 md:pb-32">
        <LandingNav />

        <div className="mt-16 grid items-center gap-10 md:mt-24 md:grid-cols-2">
          <div>
            <h1 className="text-5xl font-extrabold leading-[0.95] tracking-tight md:text-7xl">
              Search the way
              <br />
              travellers talk.
            </h1>
            <p className="mt-6 max-w-md text-lg">
              One sentence becomes precise filters &mdash; destination, month, duration, budget,
              party and climate &mdash; before a single result is fetched.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to={`/search?q=${encodeURIComponent(EXAMPLE_QUERY)}`}>
                  Try a search
                  <ArrowRight />
                </Link>
              </Button>
              {/* A yellow pill on the yellow band has no contrast, so the second action is bordered white. */}
              <Button asChild variant="outline" size="lg">
                <Link to="/assistant">
                  <MessagesSquare />
                  Ask the assistant
                </Link>
              </Button>
            </div>

            <p className="mt-5 max-w-md text-sm text-foreground/75">
              That button opens search already parsing &ldquo;{EXAMPLE_QUERY}&rdquo;.
            </p>
          </div>

          <div className="hidden md:block">
            <img
              src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1000&q=80"
              alt="An open road running towards mountains in early light"
              className="aspect-[4/3] w-full rounded-3xl object-cover shadow-xl"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
