/**
 * Workspace enumeration for the per-workspace boards.
 *
 * The candidate set is the union of the running sessions' cwds (host
 * `sessions` service) and every cwd recorded in the session projection cache
 * (`~/.dsh/storages/session_projcache/sessions/session-*.json`,
 * `record.identity.cwd`), deduplicated by absolute path. The first session
 * cwd counts as the active workspace.
 */

import { readFile, readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'

/** One workspace row the panel can address. */
export interface WorkspaceEntry {
  /** Absolute workspace root. */
  cwd: string
  /** Directory name for display. */
  name: string
  /** True for the active (first session) workspace. */
  active: boolean
}

/** Cap on the projcache files read per request (a stale cache must not stall the route). */
const PROJCACHE_MAX_FILES = 500

/**
 * Deduplicate session cwds and projcache cwds into workspace rows. The first
 * session cwd is the active workspace; a cwd that also appears later keeps
 * one row. Entries that are not absolute paths are dropped.
 */
export function dedupeWorkspaces(sessionCwds: readonly string[], projcacheCwds: readonly string[]): WorkspaceEntry[] {
  const rows = new Map<string, WorkspaceEntry>()
  const add = (cwd: string, active: boolean): void => {
    const trimmed = cwd.trim()
    if (trimmed === '' || !isAbsolute(trimmed)) return
    const key = resolve(trimmed)
    if (rows.has(key)) return
    rows.set(key, { cwd: key, name: basename(key) || key, active })
  }
  sessionCwds.forEach((cwd, index) => {
    add(cwd, index === 0)
  })
  for (const cwd of projcacheCwds) add(cwd, false)
  return [...rows.values()]
}

/**
 * Read every projcache session record's identity cwd. The directory shape is
 * `<dshHome>/storages/session_projcache/sessions/session-*.json`; anything
 * unreadable degrades to an empty list (this source only widens the set —
 * the running sessions remain).
 * @param dshHome - the DSH home root.
 */
export async function projcacheCwds(dshHome: string): Promise<string[]> {
  const dir = join(dshHome, 'storages', 'session_projcache', 'sessions')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const cwds: string[] = []
  for (const name of names.slice(0, PROJCACHE_MAX_FILES)) {
    if (!name.endsWith('.json')) continue
    try {
      const text = await readFile(join(dir, name), 'utf8')
      const parsed = JSON.parse(text) as { record?: { identity?: { cwd?: unknown } } }
      const cwd = parsed.record?.identity?.cwd
      if (typeof cwd === 'string' && cwd !== '') cwds.push(cwd)
    } catch {
      // one unreadable record must not sink the rest
    }
  }
  return cwds
}

/**
 * Normalize one workspace root: absolute, no `.` / `..` segments, resolved.
 * The write routes create directories under this root, so a relative or
 * traversal path is refused rather than resolved against a surprise base.
 */
export function normalizeWorkspaceRoot(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '' || !isAbsolute(trimmed)) return undefined
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment !== '')
  if (segments.includes('.') || segments.includes('..')) return undefined
  return resolve(trimmed)
}
