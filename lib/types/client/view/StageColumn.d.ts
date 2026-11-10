/**
 * One stage column: head (drag handle, color popover, inline rename, count,
 * add button), the card list with drag-and-drop reordering, and the
 * empty-stage hint.
 *
 * Cards drag by a grip handle within their stage and across stages; the
 * column head handle drags the whole stage left/right. Drop positions show
 * as a thin insertion bar. The column talks to the controller directly for
 * its own mutations (move, rename, recolor, remove) so the popover feedback
 * stays local; opening the create-task dialog belongs to the page (it owns
 * the modal state).
 */
import { type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import { type BoardColumn, type TaskItem } from '../../core/board.ts';
import type { TaskboardController } from '../controller.ts';
/** One draggable task card with its grip handle; right-click bubbles up. */
export declare function TaskCard({ task, onContextMenu, }: {
    task: TaskItem;
    onContextMenu(task: TaskItem, event: React.MouseEvent): void;
}): ReactElement;
/** The thin insertion bar shown at a valid drop position. */
export declare function DropHint({ vertical }: {
    vertical?: boolean;
}): ReactElement;
/** One stage column. */
export declare function StageColumn({ column, tasks, controller, onOpenCreateTask, onTaskContextMenu, }: {
    column: BoardColumn;
    tasks: TaskItem[];
    controller: TaskboardController;
    onOpenCreateTask(columnId: string): void;
    /** Right-click on a card; the page owns the context menu. */
    onTaskContextMenu(task: TaskItem, event: ReactMouseEvent): void;
}): ReactElement;
