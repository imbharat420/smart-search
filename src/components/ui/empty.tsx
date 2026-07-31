import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface EmptyProps {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}

export function Empty({ icon, title, body, action, className }: EmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 py-16 text-center',
        className,
      )}
    >
      {icon && (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-foreground [&_svg]:size-5">
          {icon}
        </span>
      )}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-[15px] text-muted-foreground">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
