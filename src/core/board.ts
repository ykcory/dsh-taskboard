/**
 * Board data model shared by the host half and the browser half.
 *
 * The board file lives at `<workspace>/.dsh/taskboard/board.json` and is one
 * JSON document: milestone tabs (epics), stage columns (columns), and task
 * cards (tasks) with a monotonically increasing `revision` for whole-board
 * CAS writes. Agents may edit the file directly with file tools; the plugin
 * never holds it in a database.
 *
 * Concept naming (project AGENTS.md): epics = 里程碑, tasks = 事项,
 * columns = 阶段.
 */

/** One milestone (the tab row). */
export interface Epic {
  id: string
  name: string
}

/** One stage column with its color. */
export interface BoardColumn {
  id: string
  name: string
  /** Hex color `#rrggbb` (the column head dot; the background is a light tint derived in the view). */
  color: string
}

/** One task card under an epic, sitting in a stage column. */
export interface TaskItem {
  id: string
  epicId: string
  columnId: string
  title: string
  /** Epoch ms, set when the card is created. */
  createdAt: number
}

/** The whole board file as written to disk. */
export interface BoardFile {
  revision: number
  epics: Epic[]
  columns: BoardColumn[]
  tasks: TaskItem[]
}

/**
 * The milestone a fresh board starts with.
 *
 * A board always shows at least one tab (the last one cannot be removed), so
 * a new board opens on M1 rather than an empty tab row.
 */
export const DEFAULT_EPICS: readonly Epic[] = [{ id: 'epic-m1', name: 'M1' }] as const

/**
 * The stages a fresh board starts with: the first four presets.
 *
 * The five-color preset list stays available in the stage color popover and
 * the palette, but a new board opens on this four-stage pipeline (the former
 * fifth stage, 失败, is not part of the default flow).
 */
export const DEFAULT_COLUMNS: readonly BoardColumn[] = [
  { id: 'col-init', name: '初始化', color: '#7d8b99' },
  { id: 'col-run', name: '执行中', color: '#e2a53d' },
  { id: 'col-review', name: '待审核', color: '#3fa455' },
  { id: 'col-done', name: '已完成', color: '#4a72d8' },
] as const

/** The eight preset colors of the stage color popover (design palette). */
export const STAGE_PALETTE: readonly string[] = [
  '#7d8b99',
  '#e2a53d',
  '#3fa455',
  '#4a72d8',
  '#e05252',
  '#9a6bd8',
  '#e56aa2',
  '#2fb5c2',
] as const

/** Hard size bounds keeping one board file small and the shape checks cheap. */
export const BOARD_LIMITS = {
  /** Max bytes of one board.json file the host accepts. */
  fileBytes: 512 * 1024,
  /** Max bytes of one PUT request body. */
  putBodyBytes: 512 * 1024,
  epics: 100,
  columns: 24,
  tasks: 2000,
  /** Max characters of an epic/stage name. */
  nameLength: 200,
  /** Max characters of a task title. */
  titleLength: 500,
} as const

/** Id grammar shared by epics, columns and tasks (readable for agents). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Outcome of a whole-board shape validation. */
export type BoardValidation = { ok: true; board: BoardFile } | { ok: false; reason: string }

/**
 * Validate one parsed board document (shape + referential integrity + id
 * uniqueness). The revision is checked for shape only — the store assigns a
 * fresh revision on save.
 * @param value - the parsed JSON value.
 * @returns the validated board or the first failing reason.
 */
export function validateBoard(value: unknown): BoardValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'board must be a JSON object' }
  }
  const raw = value as Record<string, unknown>
  const revision = raw['revision']
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    return { ok: false, reason: 'board.revision must be a non-negative integer' }
  }
  const epics = raw['epics']
  if (!Array.isArray(epics)) return { ok: false, reason: 'board.epics must be an array' }
  if (epics.length > BOARD_LIMITS.epics) return { ok: false, reason: `board.epics exceeds ${BOARD_LIMITS.epics} entries` }
  const epicIds = new Set<string>()
  for (const entry of epics) {
    const fail = validateEpic(entry, epicIds)
    if (fail !== undefined) return { ok: false, reason: fail }
  }
  const columns = raw['columns']
  if (!Array.isArray(columns)) return { ok: false, reason: 'board.columns must be an array' }
  if (columns.length > BOARD_LIMITS.columns) return { ok: false, reason: `board.columns exceeds ${BOARD_LIMITS.columns} entries` }
  const columnIds = new Set<string>()
  for (const entry of columns) {
    const fail = validateColumn(entry, columnIds)
    if (fail !== undefined) return { ok: false, reason: fail }
  }
  const tasks = raw['tasks']
  if (!Array.isArray(tasks)) return { ok: false, reason: 'board.tasks must be an array' }
  if (tasks.length > BOARD_LIMITS.tasks) return { ok: false, reason: `board.tasks exceeds ${BOARD_LIMITS.tasks} entries` }
  const taskIds = new Set<string>()
  for (const entry of tasks) {
    const fail = validateTask(entry, taskIds, epicIds, columnIds)
    if (fail !== undefined) return { ok: false, reason: fail }
  }
  return {
    ok: true,
    board: {
      revision,
      epics: epics as Epic[],
      columns: columns as BoardColumn[],
      tasks: tasks as TaskItem[],
    },
  }
}

/** Validate one epic entry; a string result is the failure reason. */
function validateEpic(value: unknown, ids: Set<string>): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'board.epics entries must be objects'
  const epic = value as Record<string, unknown>
  const id = epic['id']
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return 'board.epics[].id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}'
  if (ids.has(id)) return `board.epics[].id duplicated: ${id}`
  const name = epic['name']
  if (typeof name !== 'string' || name.length > BOARD_LIMITS.nameLength) {
    return `board.epics[].name must be a string of at most ${BOARD_LIMITS.nameLength} characters`
  }
  ids.add(id)
  return undefined
}

/** Validate one column entry; a string result is the failure reason. */
function validateColumn(value: unknown, ids: Set<string>): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'board.columns entries must be objects'
  const column = value as Record<string, unknown>
  const id = column['id']
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return 'board.columns[].id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}'
  if (ids.has(id)) return `board.columns[].id duplicated: ${id}`
  // A freshly added stage starts unnamed (inline rename names it), so an
  // empty string is valid; the length bound still applies.
  const name = column['name']
  if (typeof name !== 'string' || name.length > BOARD_LIMITS.nameLength) {
    return `board.columns[].name must be a string of at most ${BOARD_LIMITS.nameLength} characters`
  }
  const color = column['color']
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return 'board.columns[].color must be a #rrggbb hex color'
  ids.add(id)
  return undefined
}

/** Validate one task entry; a string result is the failure reason. */
function validateTask(value: unknown, taskIds: Set<string>, epicIds: Set<string>, columnIds: Set<string>): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'board.tasks entries must be objects'
  const task = value as Record<string, unknown>
  const id = task['id']
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return 'board.tasks[].id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}'
  if (taskIds.has(id)) return `board.tasks[].id duplicated: ${id}`
  const epicId = task['epicId']
  if (typeof epicId !== 'string' || !epicIds.has(epicId)) return 'board.tasks[].epicId must reference an existing epic'
  const columnId = task['columnId']
  if (typeof columnId !== 'string' || !columnIds.has(columnId)) return 'board.tasks[].columnId must reference an existing column'
  const title = task['title']
  if (typeof title !== 'string' || title.length === 0 || title.length > BOARD_LIMITS.titleLength) {
    return `board.tasks[].title must be a non-empty string of at most ${BOARD_LIMITS.titleLength} characters`
  }
  const createdAt = task['createdAt']
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    return 'board.tasks[].createdAt must be a finite number (epoch ms)'
  }
  taskIds.add(id)
  return undefined
}

/**
 * Ordering model: the position of a stage column IS its index in
 * `board.columns`, and the position of a task card within its stage (for one
 * milestone) IS its relative order in `board.tasks`. No separate order fields
 * — agents can reorder by editing the JSON file directly.
 */

/**
 * Move one task card to `toIndex` within the milestone's visible list of
 * `toColumnId` (same-stage reorder and cross-stage move share one function).
 * The task keeps its milestone. Returns the updated board, or undefined when
 * the task or the target stage does not exist.
 */
export function reorderTaskInBoard(board: BoardFile, taskId: string, toColumnId: string, toIndex: number): BoardFile | undefined {
  const task = board.tasks.find((candidate) => candidate.id === taskId)
  if (task === undefined) return undefined
  if (!board.columns.some((column) => column.id === toColumnId)) return undefined
  // The insertion index is relative to the target list WITHOUT the dragged
  // card, so the card can land anywhere including its own edges.
  const without = board.tasks.filter((candidate) => candidate.id !== taskId)
  const siblings = without
    .map((candidate, position) => ({ candidate, position }))
    .filter((entry) => entry.candidate.epicId === task.epicId && entry.candidate.columnId === toColumnId)
  const index = Math.max(0, Math.min(Math.round(toIndex), siblings.length))
  let insertAt: number
  if (siblings.length === 0) insertAt = without.length
  else if (index === siblings.length) insertAt = (siblings[siblings.length - 1] as { position: number }).position + 1
  else insertAt = (siblings[index] as { position: number }).position
  const tasks = [...without]
  tasks.splice(insertAt, 0, { ...task, columnId: toColumnId })
  return { ...board, tasks }
}

/**
 * Move one stage column to `toIndex` within `board.columns`. Returns the
 * updated board, or undefined when the column does not exist. The index is
 * clamped so callers can pass the pointer-derived position unchecked.
 */
export function reorderColumnInBoard(board: BoardFile, columnId: string, toIndex: number): BoardFile | undefined {
  const from = board.columns.findIndex((column) => column.id === columnId)
  if (from < 0) return undefined
  const index = Math.max(0, Math.min(Math.round(toIndex), board.columns.length - 1))
  const columns = [...board.columns]
  const [moved] = columns.splice(from, 1)
  columns.splice(index, 0, moved as BoardColumn)
  return { ...board, columns }
}

/**
 * Guard applied on save when a save removes columns: a stage that still holds
 * tasks must not be removed (project AGENTS.md 删除防护).
 * @param current - the board currently on disk.
 * @param incoming - the validated replacement board.
 * @returns the first still-populated removed column name, or undefined.
 */
export function firstRemovedNonEmptyColumn(current: BoardFile, incoming: BoardFile): string | undefined {
  const kept = new Set(incoming.columns.map((column) => column.id))
  const removedIds = new Set(current.columns.filter((column) => !kept.has(column.id)).map((column) => column.id))
  if (removedIds.size === 0) return undefined
  const blocked = current.tasks.find((task) => removedIds.has(task.columnId))
  if (blocked === undefined) return undefined
  return current.columns.find((column) => column.id === blocked.columnId)?.name ?? blocked.columnId
}

/** Fresh board contents: revision 1, one milestone, the four preset stages, no work. */
export function defaultBoard(): BoardFile {
  return {
    revision: 1,
    epics: DEFAULT_EPICS.map((epic) => ({ ...epic })),
    columns: DEFAULT_COLUMNS.map((column) => ({ ...column })),
    tasks: [],
  }
}

/**
 * One fresh unique id with a readable prefix.
 * @param prefix - `epic` / `col` / `task`.
 * @param random - injectable randomness source (defaults to Math.random).
 */
export function makeId(prefix: string, random: () => number = Math.random): string {
  const salt = random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${prefix}-${salt}`
}

/** Pick one random palette color (used when a new stage is added). */
export function randomStageColor(random: () => number = Math.random): string {
  return STAGE_PALETTE[Math.floor(random() * STAGE_PALETTE.length)] as string
}
