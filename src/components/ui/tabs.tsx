import { useRef } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface TabItem {
  id: string
  label: string
  icon?: ReactNode
}

interface TabsProps {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
  className?: string
}

// The panel belongs to the caller: render it with id={`panel-${active}`} and role="tabpanel".
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({})

  const step = (direction: 1 | -1) => {
    const current = tabs.findIndex((t) => t.id === active)
    const next = tabs[(current + direction + tabs.length) % tabs.length]
    onChange(next.id)
    buttons.current[next.id]?.focus()
  }

  return (
    <div role="tablist" className={cn('flex items-center gap-1 overflow-x-auto border-b', className)}>
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={(el) => {
              buttons.current[tab.id] = el
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              e.preventDefault()
              step(e.key === 'ArrowRight' ? 1 : -1)
            }}
            className={cn(
              'relative inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [&_svg]:size-4 [&_svg]:shrink-0',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon}
            {tab.label}
            <span
              className={cn(
                'absolute inset-x-2 -bottom-px h-[3px] rounded-full transition-colors',
                selected ? 'bg-primary' : 'bg-transparent',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
