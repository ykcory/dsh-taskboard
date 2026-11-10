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
export const TASK_ID_MIME = 'application/x-taskboard-task'

/** DataTransfer mime carrying the dragged stage column id. */
export const COLUMN_ID_MIME = 'application/x-taskboard-column'

/** What is currently being dragged. */
export type DragPayload = { kind: 'task'; taskId: string } | { kind: 'column'; columnId: string }

let current: DragPayload | null = null

const DRAG_END_EVENT = 'taskboard:dragend'

/** Remember the item a dragstart picked up. */
export function beginDrag(payload: DragPayload): void {
  current = payload
}

/** Clear the slot and tell every listener the drag is over. */
export function endDrag(): void {
  current = null
  window.dispatchEvent(new Event(DRAG_END_EVENT))
}

/** The payload of the drag in flight, if any. */
export function getDragPayload(): DragPayload | null {
  return current
}

/** Subscribe to drag end (drop or cancel); returns the unsubscribe function. */
export function onDragEnd(listener: () => void): () => void {
  window.addEventListener(DRAG_END_EVENT, listener)
  return () => {
    window.removeEventListener(DRAG_END_EVENT, listener)
  }
}

/** Read the dragged task id out of a drop event (fallback: text/plain). */
export function readDraggedTaskId(event: { dataTransfer: DataTransfer | null }): string | undefined {
  const transfer = event.dataTransfer
  if (transfer === null) return undefined
  const dragged = transfer.getData(TASK_ID_MIME) || transfer.getData('text/plain')
  return dragged === '' ? undefined : dragged
}
