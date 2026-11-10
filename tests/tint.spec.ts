// @vitest-environment jsdom
/**
 * Column tint: the stage color is laid over white at a low opacity, so a
 * saturated palette color yields the same soft wash as the presets instead of
 * a vivid block.
 */

import { describe, expect, it } from 'vitest'
import { COLUMN_TINT_ALPHA, parseHexColor, tintBackground } from '../src/client/view/tint.ts'
import { STAGE_PALETTE } from '../src/core/board.ts'

describe('parseHexColor', () => {
  it('parses a hex color with and without the leading hash', () => {
    expect(parseHexColor('#7d8b99')).toEqual({ r: 125, g: 139, b: 153 })
    expect(parseHexColor('7d8b99')).toEqual({ r: 125, g: 139, b: 153 })
  })

  it('rejects anything that is not six hex digits', () => {
    expect(parseHexColor('#fff')).toBeUndefined()
    expect(parseHexColor('red')).toBeUndefined()
    expect(parseHexColor('')).toBeUndefined()
  })
})

describe('tintBackground', () => {
  it('emits the stage color at the column alpha', () => {
    expect(tintBackground('#e2a53d')).toBe('rgba(226, 165, 61, 0.08)')
  })

  it('keeps every palette color at the same low alpha', () => {
    for (const color of STAGE_PALETTE) {
      const tint = tintBackground(color)
      expect(tint).toContain(`, ${COLUMN_TINT_ALPHA})`)
      // No pre-blending: the channels are the stage color verbatim.
      const channels = parseHexColor(color)!
      expect(tint).toBe(`rgba(${channels.r}, ${channels.g}, ${channels.b}, ${COLUMN_TINT_ALPHA})`)
    }
  })

  it('is faint enough to sit behind white cards', () => {
    // A vivid red over white must still read as a wash, not a block: the
    // effective color stays close to white on every channel.
    const channels = parseHexColor('#e05252')!
    const effective = {
      r: Math.round(255 + (channels.r - 255) * COLUMN_TINT_ALPHA),
      g: Math.round(255 + (channels.g - 255) * COLUMN_TINT_ALPHA),
      b: Math.round(255 + (channels.b - 255) * COLUMN_TINT_ALPHA),
    }
    expect(effective.r).toBeGreaterThan(240)
    expect(effective.g).toBeGreaterThan(240)
    expect(effective.b).toBeGreaterThan(240)
  })

  it('falls back to the neutral wash for an unusable value', () => {
    expect(tintBackground('not-a-color')).toBe('#f2f3f5')
  })
})
