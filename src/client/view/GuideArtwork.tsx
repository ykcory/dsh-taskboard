/**
 * The guide (开始) page card artwork for the taskboard.
 *
 * Same spec as the shipped guide artworks (`@deepseek-ai/dsh-client-ui-primitives`):
 * a 36x36 canvas of flat two-tone fills with no strokes and no gradients. The
 * glyph is a three-column board — the panel's own stage columns — so the card
 * reads as "kanban" next to the folder, terminal and globe cards while using
 * a palette none of them own (those are amber, indigo and blue).
 */

import type { ReactElement } from 'react'

/** Back column: the lightest tone. */
const TONE_BACK = '#B9A6FB'

/** Front column: the base tone. */
const TONE_FRONT = '#7C5CF0'

/** Middle column: between the two. */
const TONE_MID = '#9B7DF5'

/**
 * The card glyph.
 * @param props.size - square edge in px (the guide passes its own size).
 * @param props.className - extra class from the guide.
 * @returns the decorative artwork.
 */
export function GuideArtworkTaskboard({ size = 36, className }: { size?: number; className?: string }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Left column, tallest. */}
      <rect x="5.5" y="9" width="7" height="18" rx="2.4" fill={TONE_FRONT} />
      {/* Middle column, shortest: the one in progress. */}
      <rect x="14.5" y="15" width="7" height="12" rx="2.4" fill={TONE_MID} />
      {/* Right column, mid height. */}
      <rect x="23.5" y="12" width="7" height="15" rx="2.4" fill={TONE_BACK} />
    </svg>
  )
}
