/**
 * Board model validation: shape, referential integrity, the removal guard
 * and the fresh-board defaults.
 */

import { describe, expect, it } from 'vitest'
import {
  BOARD_LIMITS,
  DEFAULT_COLUMNS,
  STAGE_PALETTE,
  defaultBoard,
  firstRemovedNonEmptyColumn,
  makeId,
  randomStageColor,
  reorderColumnInBoard,
  reorderTaskInBoard,
  validateBoard,
  type BoardFile,
} from '../src/core/board.ts'

/** A minimal valid board. */
function validBoard(): BoardFile {
  return {
    revision: 3,
    epics: [{ id: 'epic-a', name: 'M1' }],
    columns: [{ id: 'col-a', name: '初始化', color: '#7d8b99' }],
    tasks: [{ id: 'task-a', epicId: 'epic-a', columnId: 'col-a', title: '事项', createdAt: 1 }],
  }
}

describe('validateBoard', () => {
  it('accepts a well-formed board', () => {
    const result = validateBoard(validBoard())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.board.revision).toBe(3)
  })

  it('rejects non-objects and a bad revision', () => {
    expect(validateBoard(null).ok).toBe(false)
    expect(validateBoard([]).ok).toBe(false)
    expect(validateBoard({ ...validBoard(), revision: -1 }).ok).toBe(false)
    expect(validateBoard({ ...validBoard(), revision: 1.5 }).ok).toBe(false)
  })

  it('rejects duplicate ids', () => {
    const board = validBoard()
    const duplicated = { ...board, epics: [board.epics[0], board.epics[0]] }
    const result = validateBoard(duplicated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('duplicated')
  })

  it('rejects a task pointing at a missing epic or column', () => {
    const board = validBoard()
    const missingEpic = { ...board, tasks: [{ ...board.tasks[0], epicId: 'nope' }] }
    const missingColumn = { ...board, tasks: [{ ...board.tasks[0], columnId: 'nope' }] }
    expect(validateBoard(missingEpic).ok).toBe(false)
    expect(validateBoard(missingColumn).ok).toBe(false)
  })

  it('rejects an invalid stage color and an over-long title', () => {
    const board = validBoard()
    expect(validateBoard({ ...board, columns: [{ ...board.columns[0], color: 'red' }] }).ok).toBe(false)
    expect(
      validateBoard({
        ...board,
        tasks: [{ ...board.tasks[0], title: 'x'.repeat(BOARD_LIMITS.titleLength + 1) }],
      }).ok,
    ).toBe(false)
  })

  it('accepts an empty stage name (a freshly added stage is unnamed)', () => {
    const board = validBoard()
    const result = validateBoard({ ...board, columns: [{ ...board.columns[0], name: '' }] })
    expect(result.ok).toBe(true)
  })
})

describe('firstRemovedNonEmptyColumn', () => {
  it('reports a removed stage that still holds tasks', () => {
    const current = validBoard()
    const incoming: BoardFile = { ...current, columns: [] }
    expect(firstRemovedNonEmptyColumn(current, incoming)).toBe('初始化')
  })

  it('allows removing an empty stage', () => {
    const current: BoardFile = { ...validBoard(), tasks: [] }
    const incoming: BoardFile = { ...current, columns: [] }
    expect(firstRemovedNonEmptyColumn(current, incoming)).toBeUndefined()
  })

  it('allows keeping the stage', () => {
    const current = validBoard()
    expect(firstRemovedNonEmptyColumn(current, current)).toBeUndefined()
  })
})

describe('defaultBoard', () => {
  it('starts at revision 1 with one milestone, the four preset stages and no work', () => {
    const board = defaultBoard()
    expect(board.revision).toBe(1)
    expect(board.columns.map((column) => column.name)).toEqual(['初始化', '执行中', '待审核', '已完成'])
    expect(board.epics).toEqual([{ id: 'epic-m1', name: 'M1' }])
    expect(board.tasks).toEqual([])
    expect(validateBoard(board).ok).toBe(true)
  })

  it('hands out a detached copy each call', () => {
    const first = defaultBoard()
    first.columns[0]!.name = 'changed'
    expect(defaultBoard().columns[0]!.name).toBe(DEFAULT_COLUMNS[0]!.name)
  })
})

describe('makeId / randomStageColor', () => {
  it('builds a prefixed id that matches the board id grammar', () => {
    const id = makeId('task')
    expect(id.startsWith('task-')).toBe(true)
    expect(validateBoard({ ...validBoard(), tasks: [{ ...validBoard().tasks[0], id }] }).ok).toBe(true)
  })

  it('picks a palette color', () => {
    expect(STAGE_PALETTE).toContain(randomStageColor())
  })
})

/** A board with two milestones, three stages and six tasks in mixed stages. */
function orderingBoard(): BoardFile {
  const task = (id: string, epicId: string, columnId: string): BoardFile['tasks'][number] => ({
    id,
    epicId,
    columnId,
    title: id,
    createdAt: 1,
  })
  return {
    revision: 7,
    epics: [
      { id: 'epic-a', name: 'M1' },
      { id: 'epic-b', name: 'M2' },
    ],
    columns: [
      { id: 'col-a', name: '一', color: '#7d8b99' },
      { id: 'col-b', name: '二', color: '#e2a53d' },
      { id: 'col-c', name: '三', color: '#3fa455' },
    ],
    tasks: [
      task('task-1', 'epic-a', 'col-a'),
      task('task-2', 'epic-a', 'col-a'),
      task('task-3', 'epic-a', 'col-b'),
      task('task-4', 'epic-a', 'col-a'),
      task('task-5', 'epic-b', 'col-a'),
      task('task-6', 'epic-a', 'col-b'),
    ],
  }
}

/** The ids of one milestone's visible list in one stage, in board order. */
function visibleIds(board: BoardFile, epicId: string, columnId: string): string[] {
  return board.tasks.filter((task) => task.epicId === epicId && task.columnId === columnId).map((task) => task.id)
}

describe('reorderTaskInBoard', () => {
  it('moves a card within its stage to the given visible index', () => {
    const next = reorderTaskInBoard(orderingBoard(), 'task-1', 'col-a', 2)
    expect(next?.tasks.map((task) => task.id)).toEqual(['task-2', 'task-3', 'task-4', 'task-1', 'task-5', 'task-6'])
    expect(visibleIds(next as BoardFile, 'epic-a', 'col-a')).toEqual(['task-2', 'task-4', 'task-1'])
  })

  it('moves a card across stages to the front of the target list', () => {
    const next = reorderTaskInBoard(orderingBoard(), 'task-3', 'col-c', 0)
    expect(next?.tasks.find((task) => task.id === 'task-3')?.columnId).toBe('col-c')
    expect(visibleIds(next as BoardFile, 'epic-a', 'col-c')).toEqual(['task-3'])
    expect(visibleIds(next as BoardFile, 'epic-a', 'col-b')).toEqual(['task-6'])
  })

  it('moves a card across stages between existing target cards', () => {
    const next = reorderTaskInBoard(orderingBoard(), 'task-1', 'col-b', 1)
    expect(visibleIds(next as BoardFile, 'epic-a', 'col-b')).toEqual(['task-3', 'task-1', 'task-6'])
    expect(visibleIds(next as BoardFile, 'epic-a', 'col-a')).toEqual(['task-2', 'task-4'])
  })

  it('never crosses milestone boundaries with the drop index', () => {
    const next = reorderTaskInBoard(orderingBoard(), 'task-5', 'col-b', 1)
    // epic-a already owns two col-b cards; the epic-b card lands AFTER them.
    expect(visibleIds(next as BoardFile, 'epic-b', 'col-b')).toEqual(['task-5'])
    expect(visibleIds(next as BoardFile, 'epic-a', 'col-b')).toEqual(['task-3', 'task-6'])
  })

  it('clamps out-of-range indexes to append at the end', () => {
    const next = reorderTaskInBoard(orderingBoard(), 'task-1', 'col-a', 99)
    expect(visibleIds(next as BoardFile, 'epic-a', 'col-a')).toEqual(['task-2', 'task-4', 'task-1'])
    const negative = reorderTaskInBoard(orderingBoard(), 'task-1', 'col-a', -3)
    expect(visibleIds(negative as BoardFile, 'epic-a', 'col-a')).toEqual(['task-1', 'task-2', 'task-4'])
  })

  it('returns undefined for a missing task or target stage', () => {
    expect(reorderTaskInBoard(orderingBoard(), 'task-x', 'col-a', 0)).toBeUndefined()
    expect(reorderTaskInBoard(orderingBoard(), 'task-1', 'col-x', 0)).toBeUndefined()
  })
})

describe('reorderColumnInBoard', () => {
  it('moves a stage column to the given index', () => {
    const next = reorderColumnInBoard(orderingBoard(), 'col-c', 0)
    expect(next?.columns.map((column) => column.id)).toEqual(['col-c', 'col-a', 'col-b'])
  })

  it('clamps out-of-range indexes', () => {
    const next = reorderColumnInBoard(orderingBoard(), 'col-a', 99)
    expect(next?.columns.map((column) => column.id)).toEqual(['col-b', 'col-c', 'col-a'])
  })

  it('returns undefined for a missing column', () => {
    expect(reorderColumnInBoard(orderingBoard(), 'col-x', 0)).toBeUndefined()
  })
})
