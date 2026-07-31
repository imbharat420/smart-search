import { Link, useLocation } from 'react-router-dom'
import { Compass, Home, MessagesSquare, Search, SlidersHorizontal, Sparkles, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'

export const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/inspiration', icon: Sparkles, label: 'Inspiration' },
  { to: '/discover', icon: Compass, label: 'Discover' },
  { to: '/assistant', icon: MessagesSquare, label: 'Assistant' },
  { to: '/admin', icon: SlidersHorizontal, label: 'Admin' },
]

export function isNavActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/'
  // A trip page is always reached from results, so keep Search lit while reading one.
  if (to === '/search' && pathname.startsWith('/trip')) return true
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function SideRail() {
  const { pathname } = useLocation()

  return (
    <aside className="hidden h-[100vh] sticky top-0 w-16 shrink-0 flex-col items-center justify-between border-r bg-sidebar py-6 md:flex">
      <div className="flex flex-col items-center gap-6">
        <Link
          to="/"
          title="TravelIQ home"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-extrabold text-primary-foreground"
        >
          T
        </Link>
        <nav aria-label="Primary" className="flex flex-col items-center gap-1.5">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const active = isNavActive(pathname, to)
            return (
              <Link
                key={to}
                to={to}
                title={label}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <Icon className="h-5 w-5" />
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Accounts need the auth service, which this POC does not ship. */}
      {/* <button
        type="button"
        title="Traveller account"
        aria-label="Traveller account"
        onClick={() => toast.info('Traveller accounts arrive with the auth service — out of scope for this POC.')}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <UserRound className="h-5 w-5" />
      </button> */}
    </aside>
  )
}
