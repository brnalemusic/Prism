import React from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export type LoadingDotsSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg'

export interface LoadingDotsProps {
  /** Additional classes for the container */
  className?: string
  /**
   * Predefined size of the dots.
   * Enforces geometric uniformity for diameter, stroke, and gap.
   */
  size?: LoadingDotsSize
}

const SIZE_MAP: Record<LoadingDotsSize, { diameter: number; gap: number; stroke: number }> = {
  xxs: { diameter: 2, gap: 1.5, stroke: 0.5 },
  xs: { diameter: 4, gap: 3, stroke: 1 },
  sm: { diameter: 6, gap: 4, stroke: 1.5 },
  md: { diameter: 8, gap: 6, stroke: 2 },
  lg: { diameter: 12, gap: 8, stroke: 3 }
}

/**
 * A global, high-performance loading animation component.
 * Features physics-driven staggered motion and dynamic gradient phases.
 * Adheres to strict design system for geometry and aesthetic consistency.
 */
export function LoadingDots({ className, size = 'md' }: LoadingDotsProps): React.JSX.Element {
  const metrics = SIZE_MAP[size]

  return (
    <div
      className={cn('loading-dots-container', className)}
      role="status"
      aria-label="Loading"
      style={
        {
          '--loading-dot-diameter': `${metrics.diameter}px`,
          '--loading-dot-gap': `${metrics.gap}px`,
          '--loading-dot-stroke': `${metrics.stroke}px`
        } as React.CSSProperties
      }
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="loading-dot"
          style={
            {
              '--dot-index': i
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
