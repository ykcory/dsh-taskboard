/**
 * One stage column: head (whole-row drag, color popover, inline rename,
 * count, add button), the card list with drag-and-drop reordering, and the
 * empty-stage hint.
 *
 * Cards drag anywhere on the card (no handle) within their stage and across
 * stages; the whole column head drags the stage left/right. While a drag is
 * in flight the source fades to 45% opacity, and hovering a column tints its
 * outline with the stage color. Drop positions still show as a thin
 * insertion bar. The column talks to the controller directly for its own
 * mutations (rename, recolor, remove) so the popover feedback stays local;
 * opening the create-task dialog belongs to the page (it owns the modal
 * state).
 */
import { type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import { type BoardColumn, type TaskItem } from '../../core/board.ts';
import type { TaskboardController } from '../controller.ts';
/** One draggable task card; delete lives in the hover-revealed corner ×. */
export declare function TaskCard({ task, onDelete, onContextMenu, }: {
    task: TaskItem;
    onDelete(task: TaskItem): void;
    onContextMenu(task: TaskItem, event: React.MouseEvent): void;
}): ReactElement;
/** The thin insertion bar shown at a valid drop position. */
export declare function DropHint({ vertical }: {
    vertical?: boolean;
}): ReactElement;
/** One stage column. */
export declare function StageColumn({ column, tasks, controller, onOpenCreateTask, onTaskDelete, onTaskContextMenu, }: {
    column: BoardColumn;
    tasks: TaskItem[];
    controller: TaskboardController;
    onOpenCreateTask(columnId: string): void;
    /** The corner × on a card; the page owns the controller call. */
    onTaskDelete(task: TaskItem): void;
    /** Right-click on a card; the page owns the context menu. */
    onTaskContextMenu(task: TaskItem, event: ReactMouseEvent): void;
}): ReactElement;
