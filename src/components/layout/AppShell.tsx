import { Outlet, useLocation } from 'react-router-dom'
import { BottomTabs } from './BottomTabs'
import { SideRail } from './SideRail'
import { SiteFooter } from './SiteFooter'

export function AppShell() {
  const { pathname } = useLocation()
  // The assistant is a full-height split view; a footer under it would fight the composer.
  const showFooter = pathname !== '/assistant'

  return (
    <div className="flex min-h-screen bg-background">
      <SideRail />
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
        {showFooter && <SiteFooter />}
      </div>
      <BottomTabs />
    </div>
  )
}
