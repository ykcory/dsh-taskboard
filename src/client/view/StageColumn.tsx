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

import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { STAGE_PALETTE, type BoardColumn, type TaskItem } from '../../core/board.ts'
import type { MutationResult, TaskboardController } from '../controller.ts'
import { t } from '../locales.ts'
import { beginDrag, endDrag, getDragPayload, onDragEnd, readDraggedTaskId, TASK_ID_MIME } from './dnd.ts'
import { ChipDroplet, GripIcon, PlusIcon } from './icons.tsx'
import { tintBackground } from './tint.ts'

/** One draggable task card with its grip handle; right-click bubbles up. */
export function TaskCard({
  task,
  onContextMenu,
}: {
  task: TaskItem
  onContextMenu(task: TaskItem, event: React.MouseEvent): void
}): ReactElement {
  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    const transfer = event.dataTransfer
    if (transfer === null) return
    beginDrag({ kind: 'task', taskId: task.id })
    transfer.effectAllowed = 'move'
    transfer.setData(TASK_ID_MIME, task.id)
    transfer.setData('text/plain', task.id)
  }
  return (
    <div
      className="group flex cursor-grab items-start gap-[8px] rounded-[10px] border border-black/[0.06] bg-white px-[10px] py-[12px] text-[13px] leading-[1.55] text-[#33363b] active:cursor-grabbing"
      draggable
      onDragStart={onDragStart}
      onDragEnd={endDrag}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(task, event)
      }}
      data-dsh-part="card"
    >
      <span className="mt-[1px] shrink-0 opacity-40 transition-opacity group-hover:opacity-100" data-dsh-part="card-handle">
        <GripIcon />
      </span>
      <span className="min-w-0">{task.title}</span>
    </div>
  )
}

/** The thin insertion bar shown at a valid drop position. */
export function DropHint({ vertical = false }: { vertical?: boolean }): ReactElement {
  return (
    <div
      className={
        vertical
          ? 'w-[2px] shrink-0 self-stretch rounded-[1px] bg-[#1c1e21]/25'
          : 'h-[2px] shrink-0 rounded-[1px] bg-[#1c1e21]/25'
      }
      data-dsh-part="drop-hint"
    />
  )
}

/** One stage column. */
export function StageColumn({
  column,
  tasks,
  controller,
  onOpenCreateTask,
  onTaskContextMenu,
}: {
  column: BoardColumn
  tasks: TaskItem[]
  controller: TaskboardController
  onOpenCreateTask(columnId: string): void
  /** Right-click on a card; the page owns the context menu. */
  onTaskContextMenu(task: TaskItem, event: ReactMouseEvent): void
}): ReactElement {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popoverBlocked, setPopoverBlocked] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [dropping, setDropping] = useState(false)
  /** Position the hovered pointer would drop a card at (gap index). */
  const [dropHint, setDropHint] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const closePopover = useCallback((): void => {
    setPopoverOpen(false)
    setPopoverBlocked(false)
  }, [])

  // Close the popover on a click outside this column.
  useEffect(() => {
    if (!popoverOpen) return undefined
    const onMousedown = (event: MouseEvent): void => {
      const host = rootRef.current
      if (host !== null && event.target instanceof Node && host.contains(event.target)) return
      closePopover()
    }
    document.addEventListener('mousedown', onMousedown)
    return () => {
      document.removeEventListener('mousedown', onMousedown)
    }
  }, [popoverOpen, closePopover])

  // Any drag ending anywhere (drop or cancel) clears the insertion hint.
  useEffect(() => onDragEnd(() => setDropHint(null)), [])

  // Focus the rename input once it replaces the stage name.
  useEffect(() => {
    if (!renaming) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renaming])

  const togglePopover = (): void => {
    setPopoverOpen((open) => !open)
    setPopoverBlocked(false)
  }

  const pickColor = async (color: string): Promise<void> => {
    await controller.setStageColor(column.id, color)
    closePopover()
  }

  const removeStage = async (): Promise<void> => {
    const result: MutationResult = await controller.removeStage(column.id)
    if (result === 'blocked') {
      setPopoverBlocked(true)
      return
    }
    closePopover()
  }

  const startRename = (): void => {
    setRenameDraft(column.name)
    setRenaming(true)
  }

  const commitRename = async (): Promise<void> => {
    if (!renaming) return
    setRenaming(false)
    const next = renameDraft.trim()
    if (next === column.name) return
    await controller.renameStage(column.id, next)
  }

  /** The gap index a task drag at `clientY` would drop at. */
  const hintAt = (clientY: number): number => {
    const body = bodyRef.current
    if (body === null) return tasks.length
    const cards = body.querySelectorAll<HTMLElement>('[data-dsh-part="card"]')
    for (let index = 0; index < cards.length; index += 1) {
      const rect = (cards[index] as HTMLElement).getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return index
    }
    return cards.length
  }

  const onCardDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (getDragPayload()?.kind !== 'task') return
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    setDropping(true)
    setDropHint(hintAt(event.clientY))
  }

  const onCardDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    const body = bodyRef.current
    if (body !== null && event.relatedTarget instanceof Node && body.contains(event.relatedTarget)) return
    setDropping(false)
    setDropHint(null)
  }

  const onCardDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDropping(false)
    const hint = dropHint
    setDropHint(null)
    const payload = getDragPayload()
    const taskId = payload?.kind === 'task' ? payload.taskId : readDraggedTaskId(event)
    if (taskId === undefined || taskId === '') return
    await controller.moveTask(taskId, column.id, hint ?? tasks.length)
  }

  const onColumnHandleDragStart = (event: DragEvent<HTMLSpanElement>): void => {
    const transfer = event.dataTransfer
    if (transfer === null) return
    beginDrag({ kind: 'column', columnId: column.id })
    transfer.effectAllowed = 'move'
    transfer.setData('application/x-taskboard-column', column.id)
    const root = rootRef.current
    if (root !== null) {
      try {
        transfer.setDragImage(root, 120, 20)
      } catch {
        // The default handle-sized drag image is fine when setDragImage fails.
      }
    }
  }

  const bodyClass = dropping
    ? 'flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[10px] pb-[10px] outline outline-1 -outline-offset-2 outline-[#1c1e21]/20'
    : 'flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[10px] pb-[10px]'

  // Cards interleaved with the insertion bar at the hovered gap position.
  const bodyChildren: ReactElement[] = []
  for (let index = 0; index <= tasks.length; index += 1) {
    if (dropHint === index) bodyChildren.push(<DropHint key={`hint-${index}`} />)
    const task = tasks[index]
    if (task !== undefined) bodyChildren.push(<TaskCard key={task.id} task={task} onContextMenu={onTaskContextMenu} />)
  }

  return (
    <div
      ref={rootRef}
      className="relative flex h-full w-full flex-col rounded-[12px]"
      // The tint is a translucent wash: the column paints white beneath it so
      // the result does not depend on whatever surface the panel sits on.
      style={{ background: `linear-gradient(${tintBackground(column.color)}, ${tintBackground(column.color)}), #ffffff` }}
      data-dsh-part="column"
    >
      <div className="flex items-center gap-[8px] px-[10px] pb-[10px] pt-[14px]">
        <span
          className="flex h-[16px] w-[14px] shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
          draggable
          onDragStart={onColumnHandleDragStart}
          onDragEnd={endDrag}
          data-dsh-part="stage-handle"
        >
          <GripIcon />
        </span>
        <button
          type="button"
          className="flex h-[20px] w-[20px] shrink-0 cursor-pointer items-center justify-center rounded-full"
          style={{ background: column.color }}
          onClick={togglePopover}
          data-dsh-part="stage-color"
        >
          <ChipDroplet />
        </button>
        {renaming ? (
          <input
            ref={renameInputRef}
            className="min-w-0 flex-1 rounded-[6px] border border-[#e3e5e8] px-[6px] text-[13px] font-semibold text-[#2f3237] outline-none focus:border-black/40"
            value={renameDraft}
            onChange={(event) => {
              setRenameDraft(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitRename()
              if (event.key === 'Escape') setRenaming(false)
            }}
            onBlur={() => void commitRename()}
          />
        ) : (
          <span
            className="cursor-text truncate text-[13px] font-semibold text-[#2f3237]"
            title={column.name}
            onClick={startRename}
          >
            {column.name === '' ? '\u00a0' : column.name}
          </span>
        )}
        <span className="text-[12px] text-[#9aa0a8]">{tasks.length}</span>
        <button
          type="button"
          className="ml-auto flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white hover:bg-[#f5f6f7]"
          onClick={() => {
            onOpenCreateTask(column.id)
          }}
        >
          <PlusIcon />
        </button>
      </div>
      {popoverOpen ? (
        <div
          className="absolute left-[12px] top-[44px] z-[5] flex w-[236px] flex-col gap-[10px] rounded-[10px] bg-white px-[12px] pb-[8px] pt-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
          data-dsh-part="stage-popover"
        >
          <div className="flex gap-[9px]">
            {STAGE_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                className="h-[18px] w-[18px] cursor-pointer rounded-full"
                style={{
                  background: color,
                  boxShadow:
                    color.toLowerCase() === column.color.toLowerCase()
                      ? '0 0 0 2px #ffffff, 0 0 0 4px #1c1e21'
                      : undefined,
                }}
                onClick={() => void pickColor(color)}
              />
            ))}
          </div>
          <button
            type="button"
            className="cursor-pointer text-left text-[12px] text-[#e05252] hover:opacity-80"
            onClick={() => void removeStage()}
          >
            {t('stage.delete')}
          </button>
          {popoverBlocked ? <div className="text-[11px] leading-[1.4] text-[#9aa0a8]">{t('stage.notEmpty')}</div> : null}
        </div>
      ) : null}
      <div
        ref={bodyRef}
        className={bodyClass}
        onDragOver={onCardDragOver}
        onDragLeave={onCardDragLeave}
        onDrop={(event) => {
          void onCardDrop(event)
        }}
      >
        {bodyChildren}
        {tasks.length === 0 && dropHint === null ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-[#b0b6bd]">{t('stage.empty')}</div>
        ) : null}
      </div>
    </div>
  )
}
