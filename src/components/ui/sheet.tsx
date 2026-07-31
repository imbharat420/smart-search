import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

type SheetSide = 'right' | 'bottom'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  side?: SheetSide
  className?: string
  children: ReactNode
}

const SIDES: Record<SheetSide, { panel: string; hidden: string }> = {
  right: { panel: 'inset-y-0 right-0 h-full w-full max-w-md border-l', hidden: 'translate-x-full' },
  bottom: {
    panel: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl border-t',
    hidden: 'translate-y-full',
  },
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Sheet({ open, onClose, title, side = 'right', className, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null)
  const [slidIn, setSlidIn] = useState(false)

  useEffect(() => {
    if (!open) {
      setSlidIn(false)
      return
    }
    const opener = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    panel.current?.focus()
    // One frame off-screen, so the panel slides in rather than appearing fully formed.
    const frame = requestAnimationFrame(() => setSlidIn(true))

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panel.current) return
    const stops = panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (stops.length === 0) return
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-foreground/30 transition-opacity duration-200',
          slidIn ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn(
          'absolute flex flex-col bg-background shadow-2xl transition-transform duration-200 ease-out focus:outline-none',
          SIDES[side].panel,
          slidIn ? 'translate-x-0 translate-y-0' : SIDES[side].hidden,
          className,
        )}
      >
        <div className="flex items-center gap-3 border-b px-5 py-3">
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </h2>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="ml-auto flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
