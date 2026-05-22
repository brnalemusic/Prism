import React from 'react'
import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'

export type SpinnerSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg'

export interface SpinnerProps {
  className?: string
  size?: SpinnerSize
}

const SIZE_MAP: Record<SpinnerSize, number> = {
  xxs: 10,
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20
}

export function Spinner({ className, size = 'md' }: SpinnerProps): React.JSX.Element {
  const iconSize = SIZE_MAP[size]

  return (
    <div className={clsx('flex items-center justify-center', className)} role="status" aria-label="Loading">
      <Loader2 size={iconSize} className="animate-spin text-accent-primary" />
    </div>
  )
}
