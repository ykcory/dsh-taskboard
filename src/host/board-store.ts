/**
 * Board file storage under `<workspace>/.dsh/taskboard/board.json`.
 *
 * One JSON document per workspace, whole-board CAS: every save names the
 * revision it observed, and the server refuses to overwrite when the file has
 * moved on — or when the file on disk is not valid JSON (a hand edit in
 * progress must never be silently clobbered; the agent half edits this file
 * with plain file tools).
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  BOARD_LIMITS,
  defaultBoard,
  firstRemovedNonEmptyColumn,
  validateBoard,
  type BoardFile,
} from '../core/board.ts'

/** Absolute path of one workspace's board file. */
export function boardFilePath(workspace: string): string {
  return join(workspace, '.dsh', 'taskboard', 'board.json')
}

/** Result of reading one board file. */
export type BoardRead = { status: 'ok'; board: BoardFile } | { status: 'missing' } | { status: 'invalid'; reason: string }

/**
 * Read and validate one workspace's board file.
 * @param workspace - absolute workspace root.
 * @returns the parsed board, missing when no file exists, invalid with the
 *   first failing reason when the file exists but is unusable.
 */
export async function readBoard(workspace: string): Promise<BoardRead> {
  const path = boardFilePath(workspace)
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return { status: 'missing' }
  }
  if (size > BOARD_LIMITS.fileBytes) {
    return { status: 'invalid', reason: `board file exceeds ${BOARD_LIMITS.fileBytes} bytes` }
  }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : String(error) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      status: 'invalid',
      reason: `board file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const checked = validateBoard(parsed)
  return checked.ok ? { status: 'ok', board: checked.board } : { status: 'invalid', reason: checked.reason }
}

/** Result of one CAS save. */
export type BoardSave = { ok: true; board: BoardFile } | { ok: false; httpStatus: number; error: string }

/**
 * Save one whole board with optimistic concurrency.
 *
 * - A missing file starts from revision 0, so a first save may name 0.
 * - An existing file that is not valid JSON refuses every save (the human or
 *   agent editing it by hand wins over the GUI).
 * - `expectedRevision` must equal the revision on disk; the written revision
 *   is that value plus one.
 * - A save that removes a column which still holds tasks is refused.
 * @param workspace - absolute workspace root.
 * @param expectedRevision - the revision the caller based the edit on.
 * @param incoming - the replacement board (its revision field is overwritten).
 * @returns the saved board with its fresh revision, or the HTTP status and
 *   error message to answer with.
 */
export async function saveBoard(workspace: string, expectedRevision: number, incoming: unknown): Promise<BoardSave> {
  const current = await readBoard(workspace)
  if (current.status === 'invalid') {
    return { ok: false, httpStatus: 409, error: 'board file on disk is not usable; fix or remove it before saving' }
  }
  const currentRevision = current.status === 'ok' ? current.board.revision : 0
  if (expectedRevision !== currentRevision) {
    return {
      ok: false,
      httpStatus: 409,
      error: `revision conflict: expected ${expectedRevision}, current ${currentRevision}; reload the board and retry`,
    }
  }
  const checked = validateBoard(incoming)
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.reason }
  if (current.status === 'ok') {
    const blocked = firstRemovedNonEmptyColumn(current.board, checked.board)
    if (blocked !== undefined) {
      return { ok: false, httpStatus: 409, error: `stage "${blocked}" still has items; move or remove them first` }
    }
  }
  const board: BoardFile = { ...checked.board, revision: currentRevision + 1 }
  try {
    await writeBoardFile(workspace, board)
  } catch (error) {
    return { ok: false, httpStatus: 500, error: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, board }
}

/**
 * Atomically write one board file: mkdir -p, write a unique temp file in the
 * same directory, rename over the target. A crashed write therefore never
 * leaves a half-written board behind.
 */
async function writeBoardFile(workspace: string, board: BoardFile): Promise<void> {
  const path = boardFilePath(workspace)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  const body = `${JSON.stringify(board, null, 2)}\n`
  await writeFile(temp, body, 'utf8')
  await rename(temp, path)
}

/**
 * Read one board, creating the default one (five preset stages, revision 1)
 * when no file exists yet. An existing but invalid file is NOT replaced —
 * the caller answers the reason so the panel can surface it.
 * @param workspace - absolute workspace root.
 * @returns the board plus whether this call created the file.
 */
export async function readOrInitBoard(
  workspace: string,
): Promise<{ board: BoardFile; created: boolean } | { error: string }> {
  const current = await readBoard(workspace)
  if (current.status === 'ok') return { board: current.board, created: false }
  if (current.status === 'invalid') return { error: current.reason }
  const saved = await saveBoard(workspace, 0, defaultBoard())
  if (!saved.ok) return { error: saved.error }
  return { board: saved.board, created: true }
}
