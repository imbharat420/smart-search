import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

type CardAspect = '4/3' | '4/5' | '16/10'

const ASPECTS: Record<CardAspect, string> = {
  '4/3': 'aspect-[4/3]',
  '4/5': 'aspect-[4/5]',
  '16/10': 'aspect-[16/10]',
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-md',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-1 flex-col gap-2 p-4', className)} {...props}>
      {children}
    </div>
  )
}

interface CardMediaProps {
  src: string
  alt: string
  aspect?: CardAspect
  badge?: ReactNode
  className?: string
}

export function CardMedia({ src, alt, aspect = '4/3', badge, className }: CardMediaProps) {
  return (
    <div className={cn('relative w-full overflow-hidden bg-accent', ASPECTS[aspect], className)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      />
      {badge && <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">{badge}</div>}
    </div>
  )
}
