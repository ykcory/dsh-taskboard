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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import type { BoardColumn, TaskItem } from '../../core/board.ts'
import type { NoticeKind, TaskboardController } from '../controller.ts'
import { getDragPayload, onDragEnd } from './dnd.ts'
import { t, type TaskboardKey } from '../locales.ts'
import '../tailwind.gen.css'
import { PlusIcon } from './icons.tsx'
import { CreateEpicModal, CreateStageModal, RenameEpicModal, TaskFormModal } from './Modals.tsx'
import { DropHint, StageColumn } from './StageColumn.tsx'

/** Fixed stage-column width in the docked panel (the user's requirement). */
export const DOCKED_COLUMN_WIDTH = 240

/** Notice kind to locale key. */
const NOTICE_KEYS: Record<NoticeKind, TaskboardKey> = {
  conflict: 'error.conflict',
  save: 'error.save',
  load: 'error.load',
}

/** Ref + outside-mousedown dismissal shared by the pointer-positioned menus. */
function useDismissOnOutside(open: boolean, close: () => void): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const onMousedown = (event: MouseEvent): void => {
      if (ref.current !== null && event.target instanceof Node && ref.current.contains(event.target)) return
      close()
    }
    document.addEventListener('mousedown', onMousedown)
    return () => {
      document.removeEventListener('mousedown', onMousedown)
    }
  }, [open, close])
  return ref
}

/** The pointer-positioned menu shell both context menus share. */
function ContextMenu({
  x,
  y,
  menuRef,
  part,
  children,
}: {
  x: number
  y: number
  menuRef: RefObject<HTMLDivElement>
  part: string
  children: ReactNode
}): ReactElement {
  return (
    <div
      ref={menuRef}
      className="fixed z-[20] flex min-w-[140px] flex-col rounded-[10px] bg-white py-[4px] shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
      style={{ left: x, top: y }}
      data-dsh-part={part}
    >
      {children}
    </div>
  )
}

/** One menu row; `danger` turns the label red, `disabled` grays it out. */
function MenuItem({
  label,
  hint,
  danger = false,
  disabled = false,
  onClick,
}: {
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onClick(): void
}): ReactElement {
  const color = disabled ? 'text-[#c9ccd1]' : danger ? 'text-[#e05252]' : 'text-[#33363b]'
  return (
    <button
      type="button"
      className={`px-[14px] py-[8px] text-left text-[13px] ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-[#f2f3f5]'} ${color}`}
      onClick={() => {
        if (disabled) return
        onClick()
      }}
    >
      {label}
      {hint !== undefined ? <span className="ml-[6px] text-[11px] text-[#9aa0a8]">{hint}</span> : null}
    </button>
  )
}

/** The board as a right-Sidebar tab body. */
export function TaskboardPanel({ controller }: { controller: TaskboardController }): ReactElement {
  const snapshot = useSyncExternalStore(
    (onChange) => controller.subscribe(onChange),
    () => controller.getSnapshot(),
  )
  const [taskModalStage, setTaskModalStage] = useState<string | null>(null)
  const [epicModalOpen, setEpicModalOpen] = useState(false)
  const [stageModalOpen, setStageModalOpen] = useState(false)
  /** Milestone whose context menu is open (positioned at the pointer). */
  const [epicMenu, setEpicMenu] = useState<{ epicId: string; x: number; y: number } | null>(null)
  /** Task whose context menu is open (positioned at the pointer). */
  const [taskMenu, setTaskMenu] = useState<{ taskId: string; x: number; y: number } | null>(null)
  /** Task being edited in the shared task form modal. */
  const [editTaskState, setEditTaskState] = useState<{ id: string; title: string; columnId: string } | null>(null)
  const [renameEpicId, setRenameEpicId] = useState<string | null>(null)
  /** Gap index a dragged stage column would drop at in the strip. */
  const [columnDropHint, setColumnDropHint] = useState<number | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)

  const closeEpicMenu = useCallback((): void => {
    setEpicMenu(null)
  }, [])
  const closeTaskMenu = useCallback((): void => {
    setTaskMenu(null)
  }, [])
  const epicMenuRef = useDismissOnOutside(epicMenu !== null, closeEpicMenu)
  const taskMenuRef = useDismissOnOutside(taskMenu !== null, closeTaskMenu)

  // A docked tab mounts its body on first reveal; load once.
  useEffect(() => {
    if (controller.getSnapshot().phase === 'idle') void controller.load()
  }, [controller])

  const board = snapshot.board
  const epics = board?.epics ?? []
  const columns = board?.columns ?? []
  const selectedEpicId = snapshot.selectedEpicId

  /** Cards of the selected milestone in one column, in board (display) order. */
  const tasksByColumn = useMemo(() => {
    const grouped = new Map<string, TaskItem[]>()
    if (board === undefined || selectedEpicId === undefined) return grouped
    for (const task of board.tasks) {
      if (task.epicId !== selectedEpicId) continue
      const bucket = grouped.get(task.columnId)
      if (bucket === undefined) grouped.set(task.columnId, [task])
      else bucket.push(task)
    }
    return grouped
  }, [board, selectedEpicId])

  const openTaskModal = useCallback(
    (columnId?: string): void => {
      if (selectedEpicId === undefined || columns.length === 0) return
      const initial =
        typeof columnId === 'string' && columns.some((column) => column.id === columnId)
          ? columnId
          : (columns[0] as BoardColumn).id
      setTaskModalStage(initial)
    },
    [columns, selectedEpicId],
  )

  const notice = snapshot.notice
  const noticeText = notice === undefined ? '' : t(NOTICE_KEYS[notice.kind])
  const canCreateTask = selectedEpicId !== undefined

  // Any drag ending anywhere (drop or cancel) clears the stage-column hint.
  useEffect(() => onDragEnd(() => setColumnDropHint(null)), [])

  /** The gap index a stage-column drag at `clientX` would drop at. */
  const columnHintAt = (clientX: number): number => {
    const strip = stripRef.current
    if (strip === null) return columns.length
    const slots = strip.querySelectorAll<HTMLElement>('[data-dsh-part="column-slot"]')
    for (let index = 0; index < slots.length; index += 1) {
      const rect = (slots[index] as HTMLElement).getBoundingClientRect()
      if (clientX < rect.left + rect.width / 2) return index
    }
    return slots.length
  }

  const onStripDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (getDragPayload()?.kind !== 'column') return
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    setColumnDropHint(columnHintAt(event.clientX))
  }

  const onStripDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    const strip = stripRef.current
    if (strip !== null && event.relatedTarget instanceof Node && strip.contains(event.relatedTarget)) return
    setColumnDropHint(null)
  }

  const onStripDrop = (event: DragEvent<HTMLDivElement>): void => {
    const payload = getDragPayload()
    if (payload?.kind !== 'column') return
    event.preventDefault()
    const hint = columnDropHint
    setColumnDropHint(null)
    void controller.moveStage(payload.columnId, hint ?? columns.length)
  }

  const epicBeingMenued = epicMenu === null ? undefined : epics.find((epic) => epic.id === epicMenu.epicId)
  const taskBeingMenued = taskMenu === null || board === undefined ? undefined : board.tasks.find((task) => task.id === taskMenu.taskId)
  const isLastEpic = epics.length <= 1
  const menuedEpicTaskCount =
    epicBeingMenued === undefined || board === undefined
      ? 0
      : board.tasks.filter((task) => task.epicId === epicBeingMenued.id).length

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden px-[12px] pb-[12px] pt-[14px]" data-dsh-plugin="taskboard">
      {notice !== undefined ? (
        <div className="mb-[8px] flex shrink-0 items-center gap-[6px] text-[12px] text-[#e05252]" data-dsh-part="notice">
          <span className="truncate">{noticeText}</span>
          <button
            type="button"
            className="cursor-pointer text-[14px] leading-none text-[#9aa0a8] hover:text-[#4a4d52]"
            onClick={() => {
              controller.dismissNotice()
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Toolbar: tabs on their own row, actions right-aligned below on a
          narrow column. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-[8px]">
        <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
          {epics.map((epic) => (
            <button
              key={epic.id}
              type="button"
              className={
                epic.id === selectedEpicId
                  ? 'cursor-pointer rounded-full bg-[#1c1e21] px-[12px] py-[6px] text-[12px] font-medium text-white'
                  : 'cursor-pointer rounded-full bg-[#f2f3f5] px-[12px] py-[6px] text-[12px] font-medium text-[#4a4d52] hover:text-[#1c1e21]'
              }
              data-dsh-part="epic-tab"
              onClick={() => {
                controller.selectEpic(epic.id)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setEpicMenu({ epicId: epic.id, x: event.clientX, y: event.clientY })
              }}
            >
              {epic.name}
            </button>
          ))}
          <button
            type="button"
            className="cursor-pointer rounded-full bg-[#f2f3f5] px-[10px] py-[5px] text-[13px] text-[#9aa0a8] hover:text-[#4a4d52]"
            data-dsh-part="epic-add"
            onClick={() => {
              setEpicModalOpen(true)
            }}
          >
            {t('tab.add')}
          </button>
        </div>
        <div className="ml-auto flex items-center gap-[6px]">
          <button
            type="button"
            className="flex cursor-pointer items-center gap-[4px] rounded-full border border-[#e3e5e8] bg-white px-[12px] py-[6px] text-[12px] font-medium text-[#4a4d52] hover:opacity-80"
            data-dsh-part="stage-add"
            onClick={() => {
              setStageModalOpen(true)
            }}
          >
            <PlusIcon size={10} stroke="#6b7076" />
            <span>{t('action.addStage')}</span>
          </button>
          <button
            type="button"
            className={
              canCreateTask
                ? 'cursor-pointer rounded-full bg-[#1c1e21] px-[14px] py-[7px] text-[12px] font-medium text-white hover:opacity-90'
                : 'cursor-default rounded-full bg-[#1c1e21] px-[14px] py-[7px] text-[12px] font-medium text-white opacity-40'
            }
            data-dsh-part="task-add"
            onClick={() => {
              openTaskModal()
            }}
          >
            {t('action.newTask')}
          </button>
        </div>
      </div>

      {/* Fixed-width stages, horizontally scrollable in a narrow column.
          A stage-column drag anywhere over the strip drops at the hovered
          gap, shown as a vertical insertion bar. */}
      <div className="mt-[10px] min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div
          ref={stripRef}
          className="flex h-full gap-[10px]"
          onDragOver={onStripDragOver}
          onDragLeave={onStripDragLeave}
          onDrop={onStripDrop}
        >
          {Array.from({ length: columns.length + 1 }, (_, index) => (
            <Fragment key={columns[index]?.id ?? `hint-tail-${index}`}>
              {columnDropHint === index ? <DropHint vertical /> : null}
              {columns[index] !== undefined ? (
                <div
                  className="h-full shrink-0"
                  style={{ width: DOCKED_COLUMN_WIDTH }}
                  data-dsh-part="column-slot"
                >
                  <StageColumn
                    column={columns[index] as BoardColumn}
                    tasks={tasksByColumn.get((columns[index] as BoardColumn).id) ?? []}
                    controller={controller}
                    onOpenCreateTask={openTaskModal}
                    onTaskContextMenu={(task, event) => {
                      setTaskMenu({ taskId: task.id, x: event.clientX, y: event.clientY })
                    }}
                  />
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>

      {taskModalStage !== null ? (
        <TaskFormModal
          stages={columns}
          initialStageId={taskModalStage}
          initialTitle=""
          heading={t('modal.task.title')}
          submitLabel={t('common.create')}
          onCancel={() => {
            setTaskModalStage(null)
          }}
          onSubmit={(input) => {
            setTaskModalStage(null)
            if (selectedEpicId === undefined) return
            void controller.createTask({ epicId: selectedEpicId, columnId: input.columnId, title: input.title })
          }}
        />
      ) : null}
      {editTaskState !== null ? (
        <TaskFormModal
          stages={columns}
          initialStageId={editTaskState.columnId}
          initialTitle={editTaskState.title}
          heading={t('modal.task.editTitle')}
          submitLabel={t('common.save')}
          onCancel={() => {
            setEditTaskState(null)
          }}
          onSubmit={(input) => {
            setEditTaskState(null)
            void controller.editTask(editTaskState.id, { title: input.title, columnId: input.columnId })
          }}
        />
      ) : null}
      {stageModalOpen ? (
        <CreateStageModal
          onCancel={() => {
            setStageModalOpen(false)
          }}
          onCreate={(name) => {
            setStageModalOpen(false)
            void controller.addStage(name)
          }}
        />
      ) : null}
      {epicModalOpen ? (
        <CreateEpicModal
          onCancel={() => {
            setEpicModalOpen(false)
          }}
          onCreate={(name) => {
            setEpicModalOpen(false)
            void controller.createEpic(name)
          }}
        />
      ) : null}
      {renameEpicId !== null ? (
        <RenameEpicModal
          initialName={epics.find((epic) => epic.id === renameEpicId)?.name ?? ''}
          onCancel={() => {
            setRenameEpicId(null)
          }}
          onSubmit={(name) => {
            setRenameEpicId(null)
            void controller.renameEpic(renameEpicId, name)
          }}
        />
      ) : null}
      {epicMenu !== null && epicBeingMenued !== undefined ? (
        <ContextMenu x={epicMenu.x} y={epicMenu.y} menuRef={epicMenuRef} part="epic-menu">
          <MenuItem
            label={t('epic.menu.rename')}
            onClick={() => {
              setRenameEpicId(epicBeingMenued.id)
              setEpicMenu(null)
            }}
          />
          <MenuItem
            label={t('epic.menu.delete')}
            danger
            disabled={isLastEpic || menuedEpicTaskCount > 0}
            hint={
              isLastEpic
                ? t('epic.menu.lastBlocked')
                : menuedEpicTaskCount > 0
                  ? t('epic.menu.deleteBlocked')
                  : undefined
            }
            onClick={() => {
              setEpicMenu(null)
              void controller.removeEpic(epicBeingMenued.id)
            }}
          />
        </ContextMenu>
      ) : null}
      {taskMenu !== null && taskBeingMenued !== undefined ? (
        <ContextMenu x={taskMenu.x} y={taskMenu.y} menuRef={taskMenuRef} part="task-menu">
          <MenuItem
            label={t('task.menu.edit')}
            onClick={() => {
              setEditTaskState({ id: taskBeingMenued.id, title: taskBeingMenued.title, columnId: taskBeingMenued.columnId })
              setTaskMenu(null)
            }}
          />
          <MenuItem
            label={t('task.menu.delete')}
            danger
            onClick={() => {
              setTaskMenu(null)
              void controller.removeTask(taskBeingMenued.id)
            }}
          />
        </ContextMenu>
      ) : null}
    </div>
  )
}
