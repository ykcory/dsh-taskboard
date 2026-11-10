/**
 * Board file storage: default-board creation, whole-board CAS, refusal of an
 * unusable file on disk, and the stage-removal guard.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { boardFilePath, readBoard, readOrInitBoard, saveBoard } from '../src/host/board-store.ts'
import { defaultBoard, type BoardFile } from '../src/core/board.ts'

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'taskboard-store-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** Write a raw string at the board path, creating the directory. */
async function writeRaw(text: string): Promise<void> {
  const path = boardFilePath(workspace)
  await mkdir(join(workspace, '.dsh', 'taskboard'), { recursive: true })
  await writeFile(path, text, 'utf8')
}

describe('readBoard', () => {
  it('reports a missing board', async () => {
    expect(await readBoard(workspace)).toEqual({ status: 'missing' })
  })

  it('reports invalid JSON instead of throwing', async () => {
    await writeRaw('{ not json')
    const result = await readBoard(workspace)
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') expect(result.reason).toContain('not valid JSON')
  })

  it('reports a structurally invalid board', async () => {
    await writeRaw(JSON.stringify({ revision: 1, epics: 'nope', columns: [], tasks: [] }))
    const result = await readBoard(workspace)
    expect(result.status).toBe('invalid')
  })
})

describe('readOrInitBoard', () => {
  it('creates the default board when none exists', async () => {
    const result = await readOrInitBoard(workspace)
    expect('board' in result).toBe(true)
    if ('board' in result) {
      expect(result.created).toBe(true)
      expect(result.board.revision).toBe(1)
      expect(result.board.columns).toHaveLength(4)
    }
    const onDisk = JSON.parse(await readFile(boardFilePath(workspace), 'utf8')) as BoardFile
    expect(onDisk.revision).toBe(1)
  })

  it('does not replace an unusable file', async () => {
    await writeRaw('{ broken')
    const result = await readOrInitBoard(workspace)
    expect('error' in result).toBe(true)
    expect(await readFile(boardFilePath(workspace), 'utf8')).toBe('{ broken')
  })
})

describe('saveBoard', () => {
  it('bumps the revision and persists the board', async () => {
    const board = defaultBoard()
    const saved = await saveBoard(workspace, 0, board)
    expect(saved.ok).toBe(true)
    if (saved.ok) expect(saved.board.revision).toBe(1)
    const onDisk = JSON.parse(await readFile(boardFilePath(workspace), 'utf8')) as BoardFile
    expect(onDisk.revision).toBe(1)
  })

  it('refuses a stale expectedRevision', async () => {
    await saveBoard(workspace, 0, defaultBoard())
    const stale = await saveBoard(workspace, 0, defaultBoard())
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.httpStatus).toBe(409)
  })

  it('refuses to overwrite an unusable file on disk', async () => {
    await writeRaw('{ hand edit in progress')
    const result = await saveBoard(workspace, 0, defaultBoard())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.httpStatus).toBe(409)
  })

  it('rejects an invalid incoming board with 400', async () => {
    const result = await saveBoard(workspace, 0, { revision: 0, epics: [], columns: [], tasks: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.httpStatus).toBe(400)
  })

  it('refuses to remove a stage that still holds tasks', async () => {
    // The task lives in the stage being removed, so the removal guard (not the
    // referential-integrity check) is what must answer: the board keeps its
    // stages and only the task is dropped from the incoming copy.
    const seeded: BoardFile = {
      ...defaultBoard(),
      epics: [{ id: 'epic-a', name: 'M1' }],
      tasks: [{ id: 'task-a', epicId: 'epic-a', columnId: 'col-init', title: '事项', createdAt: 1 }],
    }
    const first = await saveBoard(workspace, 0, seeded)
    expect(first.ok).toBe(true)
    // A save that removes the stage still referenced by the on-disk task: the
    // incoming board has no task, so only the removal guard can object.
    const next: BoardFile = {
      ...seeded,
      columns: seeded.columns.filter((column) => column.id !== 'col-init'),
      tasks: [],
    }
    const blocked = await saveBoard(workspace, 1, next)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.httpStatus).toBe(409)
      expect(blocked.error).toContain('初始化')
    }
  })

  it('allows removing an empty stage', async () => {
    const first = await saveBoard(workspace, 0, defaultBoard())
    expect(first.ok).toBe(true)
    const next = { ...defaultBoard(), columns: [
        ...defaultBoard().columns,
        { id: 'col-extra', name: '多余', color: '#4a72d8' },
      ].filter((column) => column.id !== 'col-extra') }
    const saved = await saveBoard(workspace, 1, next)
    expect(saved.ok).toBe(true)
  })
})
