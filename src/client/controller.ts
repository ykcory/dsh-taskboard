/**
 * Board controller (framework-free store shared by the sidebar row and the
 * React board view). Owns the loaded board snapshot and every mutation; the
 * view reads getSnapshot() through useSyncExternalStore.
 *
 * Mutation flow: build the next board from the current snapshot, PUT it with
 * the observed revision, and adopt the server response (fresh revision). A
 * 409 reloads the server truth and raises the conflict notice; other
 * failures keep the local view and raise the save notice.
 */

import { makeId, randomStageColor, reorderColumnInBoard, reorderTaskInBoard, type BoardFile, type TaskItem } from '../core/board.ts'
import { ApiError, BoardApi, type BoardPayload } from './api.ts'

/** Why a notice is on screen. */
export type NoticeKind = 'conflict' | 'save' | 'load'

/** One transient status line above the board. */
export interface Notice {
  kind: NoticeKind
  /** Host-provided detail. */
  detail?: string
}

/** Load phase of the board. */
export type BoardPhase = 'idle' | 'loading' | 'ready' | 'error'

/** The observable controller state. */
export interface TaskboardSnapshot {
  phase: BoardPhase
  board: BoardFile | undefined
  workspace: { cwd: string; name: string } | undefined
  /** Milestone the board area shows; defaults to the first epic. */
  selectedEpicId: string | undefined
  /** True while a save round-trip is in flight. */
  saving: boolean
  notice: Notice | undefined
}

/** Result of a mutation the caller renders inline (popover, modal). */
export type MutationResult = 'ok' | 'blocked' | 'failed'

const INITIAL: TaskboardSnapshot = {
  phase: 'idle',
  board: undefined,
  workspace: undefined,
  selectedEpicId: undefined,
  saving: false,
  notice: undefined,
}

/** Board controller: one instance per client plugin apply. */
export class TaskboardController {
  private readonly api: BoardApi
  private readonly listeners = new Set<() => void>()
  private state: TaskboardSnapshot = INITIAL
  /** Cached so getSnapshot stays referentially stable between changes. */
  private snapshot: TaskboardSnapshot = INITIAL
  /** Monotonic load token: a superseded load's late response must not land. */
  private loadSeq = 0

  constructor(api: BoardApi) {
    this.api = api
  }

  getSnapshot(): TaskboardSnapshot {
    return this.snapshot
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private set(patch: Partial<TaskboardSnapshot>): void {
    this.state = { ...this.state, ...patch }
    this.snapshot = this.state
    for (const fn of [...this.listeners]) fn()
  }

  /** Dismiss the transient notice line. */
  dismissNotice(): void {
    if (this.state.notice === undefined) return
    this.set({ notice: undefined })
  }

  /**
   * Load the board of one workspace — the active session's workspace root,
   * read by the tab body from the framework session list (the same source the
   * shipped files tab uses). Always explicit: the host refuses a board read
   * without a workspace, so no default is ever guessed here. A newer load
   * supersedes an in-flight one; its late response is dropped.
   */
  async load(workspace: string): Promise<void> {
    const seq = ++this.loadSeq
    this.set({ phase: 'loading', notice: undefined })
    try {
      const payload = await this.api.getBoard(workspace)
      if (seq !== this.loadSeq) return
      this.adopt(payload)
      this.set({ phase: 'ready' })
    } catch (error) {
      if (seq !== this.loadSeq) return
      this.set({
        phase: 'error',
        notice: { kind: 'load', detail: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  /** Select the milestone tab the board area shows. */
  selectEpic(epicId: string): void {
    if (this.state.selectedEpicId === epicId) return
    this.set({ selectedEpicId: epicId })
  }

  /** Create a milestone (tab); the new tab becomes the selected one. */
  async createEpic(name: string): Promise<MutationResult> {
    const trimmed = name.trim()
    const board = this.state.board
    if (board === undefined || trimmed === '') return 'failed'
    const epic = { id: makeId('epic'), name: trimmed }
    const next: BoardFile = { ...board, epics: [...board.epics, epic] }
    const saved = await this.commit(next)
    if (saved) this.set({ selectedEpicId: epic.id })
    return saved ? 'ok' : 'failed'
  }

  /**
   * Add one stage column with the given name and a random palette color.
   * The name is required: the add-stage dialog collects it up front, so a
   * stage never sits unnamed on the board.
   */
  async addStage(name: string): Promise<MutationResult> {
    const board = this.state.board
    const trimmed = name.trim()
    if (board === undefined || trimmed === '') return 'failed'
    const column = { id: makeId('col'), name: trimmed, color: randomStageColor() }
    const next: BoardFile = { ...board, columns: [...board.columns, column] }
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /** Inline-rename one stage column. */
  async renameStage(columnId: string, name: string): Promise<MutationResult> {
    const board = this.state.board
    if (board === undefined) return 'failed'
    if (!board.columns.some((column) => column.id === columnId)) return 'failed'
    const next: BoardFile = {
      ...board,
      columns: board.columns.map((column) => (column.id === columnId ? { ...column, name } : column)),
    }
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /** Re-color one stage column from the popover palette. */
  async setStageColor(columnId: string, color: string): Promise<MutationResult> {
    const board = this.state.board
    if (board === undefined) return 'failed'
    if (!board.columns.some((column) => column.id === columnId)) return 'failed'
    const next: BoardFile = {
      ...board,
      columns: board.columns.map((column) => (column.id === columnId ? { ...column, color } : column)),
    }
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /**
   * Remove one stage column. The client refuses up front when the stage still
   * holds tasks of ANY epic (the server enforces the same rule); the caller
   * renders the blocked feedback.
   */
  async removeStage(columnId: string): Promise<MutationResult> {
    const board = this.state.board
    if (board === undefined) return 'failed'
    if (!board.columns.some((column) => column.id === columnId)) return 'failed'
    if (board.tasks.some((task) => task.columnId === columnId)) return 'blocked'
    const next: BoardFile = { ...board, columns: board.columns.filter((column) => column.id !== columnId) }
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /** Create one task card under the milestone, in the given stage. */
  async createTask(input: { epicId: string; columnId: string; title: string }): Promise<MutationResult> {
    const board = this.state.board
    const trimmed = input.title.trim()
    if (board === undefined || trimmed === '') return 'failed'
    if (!board.epics.some((epic) => epic.id === input.epicId)) return 'failed'
    if (!board.columns.some((column) => column.id === input.columnId)) return 'failed'
    const task: TaskItem = {
      id: makeId('task'),
      epicId: input.epicId,
      columnId: input.columnId,
      title: trimmed,
      createdAt: Date.now(),
    }
    const next: BoardFile = { ...board, tasks: [...board.tasks, task] }
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /**
   * Edit one task card: a new title and/or a new stage. A stage change moves
   * the card to the END of the target stage's visible list (the edit dialog
   * is about the card's fields, not its order); one CAS commit covers both
   * changes. A no-op edit resolves without a round-trip.
   */
  async editTask(taskId: string, input: { title?: string; columnId?: string }): Promise<MutationResult> {
    const board = this.state.board
    if (board === undefined) return 'failed'
    const task = board.tasks.find((candidate) => candidate.id === taskId)
    if (task === undefined) return 'failed'
    const title = input.title?.trim()
    if (title !== undefined && title === '') return 'failed'
    const columnId = input.columnId
    if (columnId !== undefined && !board.columns.some((column) => column.id === columnId)) return 'failed'
    const titleChanged = title !== undefined && title !== task.title
    const stageChanged = columnId !== undefined && columnId !== task.columnId
    if (!titleChanged && !stageChanged) return 'ok'
    let next: BoardFile = titleChanged
      ? { ...board, tasks: board.tasks.map((candidate) => (candidate.id === taskId ? { ...candidate, title: title as string } : candidate)) }
      : board
    if (stageChanged) {
      const moved = reorderTaskInBoard(next, taskId, columnId as string, Number.POSITIVE_INFINITY)
      if (moved !== undefined) next = moved
    }
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /** Remove one task card (no guard: a card has no dependents). */
  async removeTask(taskId: string): Promise<MutationResult> {
    const board = this.state.board
    if (board === undefined) return 'failed'
    if (!board.tasks.some((task) => task.id === taskId)) return 'failed'
    const next: BoardFile = { ...board, tasks: board.tasks.filter((task) => task.id !== taskId) }
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /**
   * Move one task card to `toIndex` in the milestone's visible list of
   * `columnId` — same-stage reorder and cross-stage move share the path.
   * Without an index the card appends to the target stage. A no-op move
   * (same list position) resolves without a round-trip.
   */
  async moveTask(taskId: string, columnId: string, toIndex?: number): Promise<MutationResult> {
    const board = this.state.board
    if (board === undefined) return 'failed'
    const next = reorderTaskInBoard(board, taskId, columnId, toIndex ?? Number.POSITIVE_INFINITY)
    if (next === undefined) return 'failed'
    const unchanged =
      next.tasks.length === board.tasks.length &&
      next.tasks.every((task, position) => task.id === board.tasks[position]?.id && task.columnId === board.tasks[position]?.columnId)
    if (unchanged) return 'ok'
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /**
   * Move one stage column to `toIndex` (drag by the column-head handle).
   * Out-of-range indexes clamp; a no-op move resolves without a round-trip.
   */
  async moveStage(columnId: string, toIndex: number): Promise<MutationResult> {
    const board = this.state.board
    if (board === undefined) return 'failed'
    const next = reorderColumnInBoard(board, columnId, toIndex)
    if (next === undefined) return 'failed'
    if (next.columns.every((column, position) => column.id === board.columns[position]?.id)) return 'ok'
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /** Rename one milestone tab. */
  async renameEpic(epicId: string, name: string): Promise<MutationResult> {
    const board = this.state.board
    const trimmed = name.trim()
    if (board === undefined || trimmed === '') return 'failed'
    if (!board.epics.some((epic) => epic.id === epicId)) return 'failed'
    const next: BoardFile = {
      ...board,
      epics: board.epics.map((epic) => (epic.id === epicId ? { ...epic, name: trimmed } : epic)),
    }
    return (await this.commit(next)) ? 'ok' : 'failed'
  }

  /**
   * Remove one milestone tab. The LAST milestone cannot be removed (a board
   * always shows at least one tab); a milestone that still holds tasks of any
   * stage is refused up front, matching the server's column-removal guard.
   */
  async removeEpic(epicId: string): Promise<MutationResult> {
    const board = this.state.board
    if (board === undefined) return 'failed'
    if (!board.epics.some((epic) => epic.id === epicId)) return 'failed'
    if (board.epics.length <= 1) return 'blocked'
    if (board.tasks.some((task) => task.epicId === epicId)) return 'blocked'
    const next: BoardFile = {
      ...board,
      epics: board.epics.filter((epic) => epic.id !== epicId),
      tasks: board.tasks.filter((task) => task.epicId !== epicId),
    }
    const saved = await this.commit(next)
    if (saved) {
      // The removed tab may be the selected one: fall back to the first tab.
      const remaining = next.epics[0]?.id
      if (this.state.selectedEpicId === epicId && remaining !== undefined) this.set({ selectedEpicId: remaining })
    }
    return saved ? 'ok' : 'failed'
  }

  /** Adopt one host payload: board plus workspace, keeping a valid selection. */
  private adopt(payload: BoardPayload): void {
    const board = payload.board
    const selected = this.state.selectedEpicId
    const selectedEpicId =
      selected !== undefined && board.epics.some((epic) => epic.id === selected)
        ? selected
        : (board.epics[0]?.id ?? undefined)
    this.set({ board, workspace: payload.workspace, selectedEpicId })
  }

  /** Re-read the server truth after a conflict. */
  private async reload(): Promise<void> {
    try {
      const payload = await this.api.getBoard(this.state.workspace?.cwd)
      this.adopt(payload)
      if (this.state.phase !== 'ready') this.set({ phase: 'ready' })
    } catch {
      // the previous view stays; the notice already reports the conflict
    }
  }

  /** Build, send, adopt. Returns whether the save landed. */
  private async commit(next: BoardFile): Promise<boolean> {
    const board = this.state.board
    if (board === undefined) return false
    this.set({ saving: true })
    try {
      const payload = await this.api.putBoard({
        ws: this.state.workspace?.cwd,
        expectedRevision: board.revision,
        board: next,
      })
      this.adopt(payload)
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await this.reload()
        this.set({ notice: { kind: 'conflict' } })
      } else {
        this.set({ notice: { kind: 'save', detail: error instanceof Error ? error.message : String(error) } })
      }
      return false
    } finally {
      this.set({ saving: false })
    }
  }
}
