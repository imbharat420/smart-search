import { cloneElement, isValidElement } from 'react'
import type { ButtonHTMLAttributes, ReactElement } from 'react'
import { cn } from '../../lib/utils'

type ButtonVariant = 'primary' | 'brand' | 'outline' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  // styles the single child element instead of rendering a <button> — used to dress a router <Link>
  asChild?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--ink)] text-white hover:opacity-90',
  brand: 'bg-primary text-primary-foreground hover:opacity-90',
  outline: 'border bg-card text-foreground hover:bg-accent',
  ghost: 'text-foreground hover:bg-accent',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-4 text-xs',
  md: 'h-11 gap-2 px-5 text-sm',
  lg: 'h-12 gap-2 px-7 text-[15px]',
}

const BASE =
  'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0'

export function Button({
  variant = 'primary',
  size = 'md',
  asChild = false,
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], className)

  // asChild merges styling only, so handlers and aria belong on the child element.
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>
    return cloneElement(child, { className: cn(classes, child.props.className) })
  }

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  )
}
