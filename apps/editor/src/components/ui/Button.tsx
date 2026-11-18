import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-action text-white border border-action hover:bg-action-hover hover:border-action-hover',
  secondary:
    'bg-ground text-ink-body border border-rule-strong hover:bg-ground-sunken hover:border-ink-meta',
  ghost:
    'bg-transparent text-ink-muted border border-transparent hover:bg-ground-sunken hover:text-ink',
  danger: 'bg-danger-ink text-white border border-danger-ink hover:brightness-110',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-meta gap-1.5',
  md: 'h-9 px-3.5 text-body gap-2',
}

interface BaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

/**
 * The app's action button.
 *
 * It used to take a `cost` and render a coin badge beside the verb, because
 * spending was the thing a user had to be warned about. There are no coins, so
 * the prop is gone rather than left defaulted — a `cost` that renders nothing
 * would be a trap for the next person who passes one expecting it to mean
 * something.
 */
export function ActionButton({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  ...rest
}: BaseProps) {
  return (
    <button
      {...rest}
      className={`press inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

export function IconButton({
  label,
  children,
  className = '',
  ...rest
}: BaseProps & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`press inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-ink-meta hover:bg-ground-sunken hover:text-ink ${className}`}
    >
      {children}
    </button>
  )
}
