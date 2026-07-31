import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface AdminSectionProps {
  title: string
  hint?: string
  action?: ReactNode
  bodyClassName?: string
  className?: string
  children: ReactNode
}

export function AdminSection({
  title,
  hint,
  action,
  bodyClassName,
  className,
  children,
}: AdminSectionProps) {
  return (
    <section className={cn('overflow-hidden rounded-2xl border bg-card', className)}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          {hint && <p className="mt-1 max-w-3xl text-[15px] text-muted-foreground">{hint}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}
