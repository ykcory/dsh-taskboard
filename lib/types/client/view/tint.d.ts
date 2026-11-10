/**
 * Column background tint.
 *
 * The stage color is laid over white at a low opacity rather than blended by
 * hand, so every palette color (and every agent-written hex) yields the same
 * soft wash the five preset stages show — no per-color tuning, no surprise
 * saturation when a saturated color is picked.
 *
 * The alpha is deliberately small: the column is a container behind white
 * cards, and the stage dot already carries the color at full strength.
 */
/** Opacity of the stage color over white for a column background. */
export declare const COLUMN_TINT_ALPHA = 0.08;
/** Parsed `#rrggbb` channels. */
export interface RgbChannels {
    r: number;
    g: number;
    b: number;
}
/**
 * Parse `#rrggbb` into channels.
 * @param color - hex color, with or without the leading `#`.
 * @returns the channels, or undefined when the value is not a hex color.
 */
export declare function parseHexColor(color: string): RgbChannels | undefined;
/**
 * One column's background for its stage color: the color at
 * {@link COLUMN_TINT_ALPHA} over white. The alpha is emitted as `rgba` rather
 * than pre-blended so the wash stays identical over any surface the column
 * is composited onto.
 * @param color - the stage color (`#rrggbb`).
 * @returns a CSS color, or the neutral fallback for an unusable value.
 */
export declare function tintBackground(color: string): string;
