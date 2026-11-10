/**
 * The guide (开始) page card artwork for the taskboard.
 *
 * Same spec as the shipped guide artworks (`@deepseek-ai/dsh-client-ui-primitives`):
 * a 36x36 canvas of flat two-tone fills with no strokes and no gradients. The
 * glyph is a three-column board — the panel's own stage columns — so the card
 * reads as "kanban" next to the folder, terminal and globe cards while using
 * a palette none of them own (those are amber, indigo and blue).
 */
import type { ReactElement } from 'react';
/**
 * The card glyph.
 * @param props.size - square edge in px (the guide passes its own size).
 * @param props.className - extra class from the guide.
 * @returns the decorative artwork.
 */
export declare function GuideArtworkTaskboard({ size, className }: {
    size?: number;
    className?: string;
}): ReactElement;
