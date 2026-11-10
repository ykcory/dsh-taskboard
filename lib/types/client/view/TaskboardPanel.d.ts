/**
 * The docked right-Sidebar panel: the same board controller, laid out for a
 * narrow column.
 *
 * Column width is fixed (the user's requirement), so the board scrolls
 * horizontally instead of stretching its stages. The toolbar wraps its two
 * groups onto separate rows when the column is too narrow for both.
 *
 * The root stays TRANSPARENT on purpose: the shell hangs the active tab chip
 * a few pixels into the body area, and an opaque background would cover the
 * chip's bottom edge (every shipped tab body is transparent for the same
 * reason).
 */
import { type ReactElement } from 'react';
import type { TaskboardController } from '../controller.ts';
import '../tailwind.gen.css';
/** Fixed stage-column width in the docked panel (the user's requirement). */
export declare const DOCKED_COLUMN_WIDTH = 240;
/** The board as a right-Sidebar tab body. */
export declare function TaskboardPanel({ controller }: {
    controller: TaskboardController;
}): ReactElement;
