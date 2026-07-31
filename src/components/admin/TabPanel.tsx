import type { ReactNode } from 'react'

interface TabPanelProps {
  id: string
  active: string
  mounted: boolean
  children: ReactNode
}

// A visited panel stays in the tree and is hidden rather than unmounted, so an
// unsaved draft on the search-setup tab survives a trip to the analytics tab.
export function TabPanel({ id, active, mounted, children }: TabPanelProps) {
  if (!mounted) return null

  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      hidden={id !== active}
      className="space-y-6"
    >
      {children}
    </div>
  )
}
