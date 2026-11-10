/**
 * Board controller: load, every mutation, CAS conflict recovery and the
 * stage-removal block. A fake BoardApi keeps the round-trips synchronous
 * from the test's point of view.
 */

import { describe, expect, it } from 'vitest'
import { defaultBoard, type BoardFile } from '../src/core/board.ts'
import { TaskboardController } from '../src/client/controller.ts'
import { ApiError, type BoardApi, type BoardPayload } from '../src/client/api.ts'

/** A BoardApi double that keeps one board in memory and honors the CAS. */
class FakeApi {
  board: BoardFile
  workspace = { cwd: '/w/demo', name: 'demo' }
  /** Set to make the next putBoard reject. */
  failNextPut: ApiError | undefined
  puts = 0

  constructor(board: BoardFile = defaultBoard()) {
    this.board = board
  }

  private payload(): BoardPayload {
    return { workspace: this.workspace, board: this.board }
  }

  async listWorkspaces(): Promise<{ workspaces: Array<{ cwd: string; name: string; active: boolean }> }> {
    return { workspaces: [{ ...this.workspace, active: true }] }
  }

  async getBoard(): Promise<BoardPayload> {
    return this.payload()
  }

  async putBoard(input: { expectedRevision: number; board: BoardFile }): Promise<BoardPayload> {
    this.puts += 1
    const failure = this.failNextPut
    if (failure !== undefined) {
      this.failNextPut = undefined
      throw failure
    }
    if (input.expectedRevision !== this.board.revision) {
      throw new ApiError(409, 'revision conflict')
    }
    this.board = { ...input.board, revision: this.board.revision + 1 }
    return this.payload()
  }
}

/** Build a controller over the fake. */
function makeController(api: FakeApi): TaskboardController {
  return new TaskboardController(api as unknown as BoardApi)
}

describe('TaskboardController load', () => {
  it('loads the board and selects the first milestone', async () => {
    const api = new FakeApi({ ...defaultBoard(), epics: [{ id: 'epic-a', name: 'M0' }] })
    const controller = makeController(api)
    await controller.load()
    const snapshot = controller.getSnapshot()
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.workspace).toEqual({ cwd: '/w/demo', name: 'demo' })
    expect(snapshot.selectedEpicId).toBe('epic-a')
  })

  it('reports a load failure as a notice', async () => {
    const api = new FakeApi()
    api.getBoard = async () => {
      throw new ApiError(500, 'boom')
    }
    const controller = makeController(api)
    await controller.load()
    const snapshot = controller.getSnapshot()
    expect(snapshot.phase).toBe('error')
    expect(snapshot.notice?.kind).toBe('load')
  })
})

describe('TaskboardController mutations', () => {
  it('creates a milestone and selects it', async () => {
    const api = new FakeApi()
    const controller = makeController(api)
    await controller.load()
    // A fresh board already carries M1; the new tab becomes the selected one.
    expect(await controller.createEpic('M2')).toBe('ok')
    const snapshot = controller.getSnapshot()
    expect(snapshot.board?.epics.map((epic) => epic.name)).toEqual(['M1', 'M2'])
    expect(snapshot.selectedEpicId).toBe(snapshot.board?.epics[1]?.id)
  })

  it('adds a named stage with a palette color', async () => {
    const api = new FakeApi()
    const controller = makeController(api)
    await controller.load()
    const before = controller.getSnapshot().board?.columns.length ?? 0
    expect(await controller.addStage('审核中')).toBe('ok')
    const columns = controller.getSnapshot().board?.columns ?? []
    expect(columns).toHaveLength(before + 1)
    const added = columns[columns.length - 1]!
    expect(added.name).toBe('审核中')
    expect(added.color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('refuses to add a stage without a name', async () => {
    const api = new FakeApi()
    const controller = makeController(api)
    await controller.load()
    const before = controller.getSnapshot().board?.columns.length ?? 0
    expect(await controller.addStage('   ')).toBe('failed')
    expect(controller.getSnapshot().board?.columns).toHaveLength(before)
  })

  it('renames and recolors a stage', async () => {
    const api = new FakeApi()
    const controller = makeController(api)
    await controller.load()
    expect(await controller.renameStage('col-init', '准备')).toBe('ok')
    expect(await controller.setStageColor('col-init', '#9a6bd8')).toBe('ok')
    const column = controller.getSnapshot().board?.columns.find((entry) => entry.id === 'col-init')
    expect(column?.name).toBe('准备')
    expect(column?.color).toBe('#9a6bd8')
  })

  it('creates a task in the given stage', async () => {
    const api = new FakeApi({ ...defaultBoard(), epics: [{ id: 'epic-a', name: 'M1' }] })
    const controller = makeController(api)
    await controller.load()
    expect(await controller.createTask({ epicId: 'epic-a', columnId: 'col-init', title: ' 联调 ' })).toBe('ok')
    const task = controller.getSnapshot().board?.tasks[0]
    expect(task?.title).toBe('联调')
    expect(task?.columnId).toBe('col-init')
  })

  it('edits a task title and stage in one commit, moving to the end of the target stage', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      columns: [
        { id: 'col-init', name: '初始化', color: '#7d8b99' },
        { id: 'col-doing', name: '进行中', color: '#4a72d8' },
      ],
      tasks: [
        { id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '甲', createdAt: 1 },
        { id: 'task-b', epicId: 'epic-a', columnId: 'col-init', title: '乙', createdAt: 2 },
        { id: 'task-c', epicId: 'epic-a', columnId: 'col-doing', title: '丙', createdAt: 3 },
      ],
    })
    const controller = makeController(api)
    await controller.load()
    const putsBefore = api.puts
    expect(await controller.editTask('task-a', { title: ' 甲改 ', columnId: 'col-doing' })).toBe('ok')
    expect(api.puts).toBe(putsBefore + 1)
    const tasks = controller.getSnapshot().board?.tasks ?? []
    expect(tasks.map((task) => task.id)).toEqual(['task-b', 'task-c', 'task-a'])
    const edited = tasks.find((task) => task.id === 'task-a')
    expect(edited?.title).toBe('甲改')
    expect(edited?.columnId).toBe('col-doing')
  })

  it('refuses to edit a task to an empty title, or into a missing stage', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      tasks: [{ id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '甲', createdAt: 1 }],
    })
    const controller = makeController(api)
    await controller.load()
    const putsBefore = api.puts
    expect(await controller.editTask('task-a', { title: '   ' })).toBe('failed')
    expect(await controller.editTask('task-a', { columnId: 'col-x' })).toBe('failed')
    expect(api.puts).toBe(putsBefore)
    expect(controller.getSnapshot().board?.tasks[0]?.title).toBe('甲')
  })

  it('skips the round-trip on a no-op task edit', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      tasks: [{ id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '甲', createdAt: 1 }],
    })
    const controller = makeController(api)
    await controller.load()
    const putsBefore = api.puts
    expect(await controller.editTask('task-a', { title: '甲', columnId: 'col-init' })).toBe('ok')
    expect(api.puts).toBe(putsBefore)
  })

  it('removes a task and refuses to remove a missing one', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      tasks: [
        { id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '甲', createdAt: 1 },
        { id: 'task-b', epicId: 'epic-a', columnId: 'col-run', title: '乙', createdAt: 2 },
      ],
    })
    const controller = makeController(api)
    await controller.load()
    expect(await controller.removeTask('task-x')).toBe('failed')
    expect(await controller.removeTask('task-a')).toBe('ok')
    expect(controller.getSnapshot().board?.tasks.map((task) => task.id)).toEqual(['task-b'])
  })

  it('moves a task between stages', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      columns: [
        { id: 'col-init', name: '初始化', color: '#7d8b99' },
        { id: 'col-doing', name: '进行中', color: '#4a72d8' },
      ],
      tasks: [{ id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '事项', createdAt: 1 }],
    })
    const controller = makeController(api)
    await controller.load()
    expect(await controller.moveTask('task-a', 'col-doing')).toBe('ok')
    expect(controller.getSnapshot().board?.tasks[0]?.columnId).toBe('col-doing')
  })

  it('reorders a task within its stage without an extra round-trip on a no-op', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      tasks: [
        { id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '甲', createdAt: 1 },
        { id: 'task-b', epicId: 'epic-a', columnId: 'col-init', title: '乙', createdAt: 2 },
        { id: 'task-c', epicId: 'epic-a', columnId: 'col-init', title: '丙', createdAt: 3 },
      ],
    })
    const controller = makeController(api)
    await controller.load()
    expect(await controller.moveTask('task-a', 'col-init', 2)).toBe('ok')
    expect(controller.getSnapshot().board?.tasks.map((task) => task.id)).toEqual(['task-b', 'task-c', 'task-a'])
    const putsAfterReorder = api.puts
    expect(await controller.moveTask('task-a', 'col-init', 2)).toBe('ok')
    expect(api.puts).toBe(putsAfterReorder)
  })

  it('moves a task across stages to a specific visible position', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      columns: [
        { id: 'col-init', name: '初始化', color: '#7d8b99' },
        { id: 'col-doing', name: '进行中', color: '#4a72d8' },
      ],
      tasks: [
        { id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '甲', createdAt: 1 },
        { id: 'task-b', epicId: 'epic-a', columnId: 'col-doing', title: '乙', createdAt: 2 },
        { id: 'task-c', epicId: 'epic-a', columnId: 'col-doing', title: '丙', createdAt: 3 },
      ],
    })
    const controller = makeController(api)
    await controller.load()
    expect(await controller.moveTask('task-a', 'col-doing', 1)).toBe('ok')
    expect(controller.getSnapshot().board?.tasks.filter((task) => task.columnId === 'col-doing').map((task) => task.id)).toEqual([
      'task-b',
      'task-a',
      'task-c',
    ])
  })

  it('reorders stage columns and skips the round-trip on a no-op', async () => {
    const api = new FakeApi()
    const controller = makeController(api)
    await controller.load()
    expect(await controller.moveStage('col-done', 0)).toBe('ok')
    expect(controller.getSnapshot().board?.columns.map((column) => column.id)).toEqual([
      'col-done',
      'col-init',
      'col-run',
      'col-review',
    ])
    const putsAfterMove = api.puts
    expect(await controller.moveStage('col-done', 0)).toBe('ok')
    expect(api.puts).toBe(putsAfterMove)
    expect(await controller.moveStage('col-x', 0)).toBe('failed')
  })

  it('blocks removing a stage that still holds tasks, without a round-trip', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      tasks: [{ id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '事项', createdAt: 1 }],
    })
    const controller = makeController(api)
    await controller.load()
    const before = api.puts
    expect(await controller.removeStage('col-init')).toBe('blocked')
    expect(api.puts).toBe(before)
  })

  it('removes an empty stage', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      columns: [
        { id: 'col-init', name: '初始化', color: '#7d8b99' },
        { id: 'col-extra', name: '多余', color: '#4a72d8' },
      ],
    })
    const controller = makeController(api)
    await controller.load()
    expect(await controller.removeStage('col-extra')).toBe('ok')
    expect(controller.getSnapshot().board?.columns.map((column) => column.id)).not.toContain('col-extra')
  })

  it('reloads the server truth and raises a conflict notice on 409', async () => {
    const api = new FakeApi()
    const controller = makeController(api)
    await controller.load()
    // Another writer bumps the board behind this controller's back.
    api.board = { ...api.board, revision: 99, epics: [{ id: 'epic-other', name: 'M9' }] }
    expect(await controller.createEpic('M1')).toBe('failed')
    const snapshot = controller.getSnapshot()
    expect(snapshot.notice?.kind).toBe('conflict')
    expect(snapshot.board?.revision).toBe(99)
    expect(snapshot.board?.epics.map((epic) => epic.name)).toEqual(['M9'])
  })

  it('keeps the local view and raises a save notice on other failures', async () => {
    const api = new FakeApi()
    const controller = makeController(api)
    await controller.load()
    api.failNextPut = new ApiError(500, 'disk full')
    expect(await controller.createEpic('M2')).toBe('failed')
    const snapshot = controller.getSnapshot()
    expect(snapshot.notice?.kind).toBe('save')
    // The board keeps the default milestone it started with.
    expect(snapshot.board?.epics).toEqual([{ id: 'epic-m1', name: 'M1' }])
    expect(snapshot.saving).toBe(false)
  })

  it('notifies subscribers on every state change', async () => {
    const api = new FakeApi()
    const controller = makeController(api)
    let calls = 0
    const unsubscribe = controller.subscribe(() => {
      calls += 1
    })
    await controller.load()
    expect(calls).toBeGreaterThan(0)
    unsubscribe()
    const seen = calls
    await controller.addStage('新阶段')
    expect(calls).toBe(seen)
  })
})

describe('TaskboardController milestones', () => {
  it('renames a milestone', async () => {
    const api = new FakeApi({ ...defaultBoard(), epics: [{ id: 'epic-a', name: 'M1' }] })
    const controller = makeController(api)
    await controller.load()
    expect(await controller.renameEpic('epic-a', '  里程碑一  ')).toBe('ok')
    expect(controller.getSnapshot().board?.epics[0]?.name).toBe('里程碑一')
  })

  it('refuses to rename a milestone to an empty name', async () => {
    const api = new FakeApi({ ...defaultBoard(), epics: [{ id: 'epic-a', name: 'M1' }] })
    const controller = makeController(api)
    await controller.load()
    expect(await controller.renameEpic('epic-a', '   ')).toBe('failed')
    expect(controller.getSnapshot().board?.epics[0]?.name).toBe('M1')
  })

  it('removes an empty milestone and moves the selection to the first tab', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [
        { id: 'epic-a', name: 'M0' },
        { id: 'epic-b', name: 'M1' },
      ],
    })
    const controller = makeController(api)
    await controller.load()
    controller.selectEpic('epic-b')
    expect(await controller.removeEpic('epic-b')).toBe('ok')
    const snapshot = controller.getSnapshot()
    expect(snapshot.board?.epics.map((epic) => epic.id)).toEqual(['epic-a'])
    expect(snapshot.selectedEpicId).toBe('epic-a')
  })

  it('refuses to remove the last milestone', async () => {
    const api = new FakeApi({ ...defaultBoard(), epics: [{ id: 'epic-a', name: 'M1' }] })
    const controller = makeController(api)
    await controller.load()
    const before = api.puts
    expect(await controller.removeEpic('epic-a')).toBe('blocked')
    expect(api.puts).toBe(before)
    expect(controller.getSnapshot().board?.epics).toHaveLength(1)
  })

  it('refuses to remove a milestone that still holds tasks', async () => {
    const api = new FakeApi({
      ...defaultBoard(),
      epics: [
        { id: 'epic-a', name: 'M0' },
        { id: 'epic-b', name: 'M1' },
      ],
      tasks: [{ id: 'task-a', epicId: 'epic-b', columnId: 'col-init', title: '事项', createdAt: 1 }],
    })
    const controller = makeController(api)
    await controller.load()
    const before = api.puts
    expect(await controller.removeEpic('epic-b')).toBe('blocked')
    expect(api.puts).toBe(before)
    expect(controller.getSnapshot().board?.epics).toHaveLength(2)
  })
})
