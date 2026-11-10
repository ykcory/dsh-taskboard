/**
 * Workspace enumeration: session/projcache dedupe, path normalization and the
 * projcache record shape the host actually writes.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dedupeWorkspaces, normalizeWorkspaceRoot, projcacheCwds } from '../src/host/workspaces.ts'

let dshHome = ''

beforeEach(async () => {
  dshHome = await mkdtemp(join(tmpdir(), 'taskboard-ws-'))
})

afterEach(async () => {
  await rm(dshHome, { recursive: true, force: true })
})

describe('dedupeWorkspaces', () => {
  it('marks the first session cwd active and drops duplicates', () => {
    const rows = dedupeWorkspaces(['/w/a', '/w/b', '/w/a'], ['/w/c', '/w/b'])
    expect(rows.map((row) => row.cwd)).toEqual(['/w/a', '/w/b', '/w/c'])
    expect(rows.map((row) => row.active)).toEqual([true, false, false])
  })

  it('names a row after its directory', () => {
    expect(dedupeWorkspaces(['/Users/x/code/erp'], [])[0]!.name).toBe('erp')
  })

  it('drops relative and empty cwds', () => {
    expect(dedupeWorkspaces(['', 'relative/path', '/abs'], [])).toEqual([
      { cwd: '/abs', name: 'abs', active: false },
    ])
  })
})

describe('normalizeWorkspaceRoot', () => {
  it('accepts an absolute path', () => {
    expect(normalizeWorkspaceRoot('/Users/x/code/erp')).toBe('/Users/x/code/erp')
  })

  it('refuses relative and traversal paths', () => {
    expect(normalizeWorkspaceRoot('code/erp')).toBeUndefined()
    expect(normalizeWorkspaceRoot('/Users/x/../etc')).toBeUndefined()
    expect(normalizeWorkspaceRoot('   ')).toBeUndefined()
  })
})

describe('projcacheCwds', () => {
  it('reads record.identity.cwd from every session record', async () => {
    const dir = join(dshHome, 'storages', 'session_projcache', 'sessions')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'session-1.json'),
      JSON.stringify({ version: 7, record: { identity: { cwd: '/Users/x/code/erp' } } }),
      'utf8',
    )
    await writeFile(
      join(dir, 'session-2.json'),
      JSON.stringify({ version: 7, record: { identity: { cwd: '/Users/x/code/other' } } }),
      'utf8',
    )
    expect((await projcacheCwds(dshHome)).sort()).toEqual(['/Users/x/code/erp', '/Users/x/code/other'])
  })

  it('degrades to an empty list when the cache is absent', async () => {
    expect(await projcacheCwds(join(dshHome, 'nope'))).toEqual([])
  })

  it('skips unreadable records instead of failing', async () => {
    const dir = join(dshHome, 'storages', 'session_projcache', 'sessions')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'session-broken.json'), '{ not json', 'utf8')
    await writeFile(join(dir, 'session-ok.json'), JSON.stringify({ record: { identity: { cwd: '/ok' } } }), 'utf8')
    expect(await projcacheCwds(dshHome)).toEqual(['/ok'])
  })
})
