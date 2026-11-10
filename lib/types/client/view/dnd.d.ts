/**
 * Drag-and-drop plumbing shared by the stage columns and the task cards.
 *
 * HTML5 drag events cannot read the DataTransfer payload during `dragover`
 * (protected mode), so the dragged item travels in this module-level slot —
 * one drag lives in one window, so a single mutable slot is enough. `endDrag`
 * also dispatches a window event so columns and the column strip can clear
 * their insertion hints when a drag ends anywhere (drop OR cancel).
 */
/** DataTransfer mime carrying the dragged task id (kept for inspectors). */
export declare const TASK_ID_MIME = "application/x-taskboard-task";
/** DataTransfer mime carrying the dragged stage column id. */
export declare const COLUMN_ID_MIME = "application/x-taskboard-column";
/** What is currently being dragged. */
export type DragPayload = {
    kind: 'task';
    taskId: string;
} | {
    kind: 'column';
    columnId: string;
};
/** Remember the item a dragstart picked up. */
export declare function beginDrag(payload: DragPayload): void;
/** Clear the slot and tell every listener the drag is over. */
export declare function endDrag(): void;
/** The payload of the drag in flight, if any. */
export declare function getDragPayload(): DragPayload | null;
/** Subscribe to drag end (drop or cancel); returns the unsubscribe function. */
export declare function onDragEnd(listener: () => void): () => void;
/** Read the dragged task id out of a drop event (fallback: text/plain). */
export declare function readDraggedTaskId(event: {
    dataTransfer: DataTransfer | null;
}): string | undefined;
