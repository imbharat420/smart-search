import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../ui/button'

const sections = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Itineraries', href: '#itineraries' },
]

const pages = [
  { label: 'Guides', to: '/inspiration' },
  { label: 'Control panel', to: '/admin' },
]

export function LandingNav() {
  return (
    <nav className="flex items-center justify-between gap-4">
      <Link to="/" className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight">
        {/* The mark flips to white here: a yellow tile on the yellow band would disappear. */}
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-card text-lg">T</span>
        TravelIQ
      </Link>

      <div className="hidden items-center gap-8 text-sm font-medium md:flex">
        {sections.map((section) => (
          <a key={section.href} href={section.href} className="transition-opacity hover:opacity-70">
            {section.label}
          </a>
        ))}
        {pages.map((page) => (
          <Link key={page.to} to={page.to} className="transition-opacity hover:opacity-70">
            {page.label}
          </Link>
        ))}
      </div>

      {/* <Button
        variant="outline"
        onClick={() =>
          toast.info('Sign-in needs the auth service, which this POC does not ship. /admin is left open.')
        }
      >
        Log in
      </Button> */}
    </nav>
  )
}
