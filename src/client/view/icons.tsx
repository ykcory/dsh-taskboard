/**
 * Inline SVG icons from the v6 design frames.
 */

import type { ReactElement } from 'react'

/** The white droplet inside a stage color dot (design chipIcon). */
export function ChipDroplet(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.2 C6 1.2 2.4 5.4 2.4 8 a3.6 3.6 0 0 0 7.2 0 C9.6 5.4 6 1.2 6 1.2 Z" fill="#ffffff" />
    </svg>
  )
}

/** Column-head add button plus sign (design plusIcon). */
export function PlusIcon({ size = 12, stroke = '#4a4d52' }: { size?: number; stroke?: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 2.2 V9.8 M2.2 6 H9.8" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Select dropdown chevron (design chevronSvg). */
export function ChevronIcon(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="#6b7076" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
