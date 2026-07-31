import { Link, useLocation } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { NAV_ITEMS, isNavActive } from './SideRail'

export function BottomTabs() {
  const { pathname } = useLocation()

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
        const active = isNavActive(pathname, to)
        return (
          <Link
            key={to}
            to={to}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="w-full truncate px-0.5 text-center text-[10px] font-medium leading-none">
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
