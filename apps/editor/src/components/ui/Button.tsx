import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { IconCoins } from './Icons'

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
 * A priced action. The cost rides inside the button, on the same baseline as
 * the verb, so nobody can spend without having read the price. A free cost
 * renders as an explicit "gratis" rather than an absent badge: silence would
 * be indistinguishable from an unpriced action.
 */
export function ActionButton({
  cost,
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  ...rest
}: BaseProps & { cost?: number }) {
  const priced = typeof cost === 'number'
  return (
    <button
      {...rest}
      className={`press inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {icon}
      <span>{children}</span>
      {priced && (
        <span
          className={`tnum ml-1 inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[11.5px] leading-4 ${
            variant === 'primary'
              ? 'border-white/35 bg-white/15 text-white'
              : cost === 0
                ? 'border-ok-ink/25 bg-ok-bg text-ok-ink'
                : 'border-rule bg-ground-sunken text-ink-muted'
          }`}
        >
          {cost !== 0 && <IconCoins className="h-3 w-3" />}
          {cost === 0 ? 'gratis' : `−${cost}`}
        </span>
      )}
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
