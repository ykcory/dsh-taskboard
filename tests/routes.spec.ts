/**
 * Host route family: the loopback fence, workspace enumeration, board read
 * and the CAS write contract, exercised through the exported route handlers
 * with fake request/response objects.
 */

import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { ROUTES, makeRoutes, type BoardRoutesDeps } from '../src/host/routes.ts'
import { resolveRequestedWorkspace } from '../src/index.ts'
import { defaultBoard, type BoardFile } from '../src/core/board.ts'

/** Captured response written by a route handler. */
interface Captured {
  status: number
  body: unknown
}

/** Build a fake incoming message with loopback defaults. */
function fakeRequest(init: {
  method?: string
  url?: string
  remoteAddress?: string
  host?: string
  origin?: string
  body?: string
} = {}): IncomingMessage {
  const chunks = init.body === undefined ? [] : [Buffer.from(init.body, 'utf8')]
  return {
    method: init.method ?? 'GET',
    url: init.url ?? '/',
    headers: {
      host: init.host ?? '127.0.0.1:50333',
      ...(init.origin === undefined ? {} : { origin: init.origin }),
    },
    socket: { remoteAddress: init.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
    destroy() {},
  } as unknown as IncomingMessage
}

/** Build a fake server response that records the write. */
function fakeResponse(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: undefined }
  const res = {
    writeHead(status: number) {
      captured.status = status
      return res
    },
    end(body: string) {
      captured.body = body === undefined ? undefined : JSON.parse(body)
      return res
    },
  } as unknown as ServerResponse
  return { res, captured }
}

/** Route dependencies over an in-memory board, with the real strict resolver. */
function makeDeps(overrides: Partial<BoardRoutesDeps> = {}): BoardRoutesDeps {
  let board: BoardFile = defaultBoard()
  return {
    sessionCwds: () => ['/w/demo'],
    projcacheCwds: async () => ['/w/other'],
    // The REAL resolver: a ws-less request resolves to nothing and the route
    // refuses it — no default workspace is ever guessed.
    resolveWorkspace: resolveRequestedWorkspace,
    readOrInitBoard: async () => ({ board, created: false }),
    skillStatus: () => 'registered', skillDebug: () => ({}),
    saveBoard: async (_workspace, expectedRevision, incoming) => {
      if (expectedRevision !== board.revision) {
        return { ok: false, httpStatus: 409, error: 'revision conflict' }
      }
      board = { ...(incoming as BoardFile), revision: board.revision + 1 }
      return { ok: true, board }
    },
    logger: { warn: () => {} },
    ...overrides,
  }
}

/** Find one route by path. */
function route(path: string, deps: BoardRoutesDeps) {
  const routes = makeRoutes({} as Context, deps)
  const found = routes.find((entry) => entry.path === path)
  if (found === undefined) throw new Error(`route missing: ${path}`)
  return found
}

describe('route paths', () => {
  it('mirrors the client literals', () => {
    expect(ROUTES.workspaces).toBe('/api/dsh-taskboard/workspaces')
    expect(ROUTES.board).toBe('/api/dsh-taskboard/board')
    expect(ROUTES.health).toBe('/api/dsh-taskboard/health')
  })
})

describe('loopback fence', () => {
  it('refuses a non-loopback socket', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.health, makeDeps()).handler(fakeRequest({ remoteAddress: '10.0.0.5' }), res)
    expect(captured.status).toBe(403)
  })

  it('refuses a proxied request', async () => {
    const { res, captured } = fakeResponse()
    const req = fakeRequest()
    req.headers['x-forwarded-for'] = '1.2.3.4'
    await route(ROUTES.health, makeDeps()).handler(req, res)
    expect(captured.status).toBe(403)
  })

  it('refuses a cross-site origin', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.health, makeDeps()).handler(
      fakeRequest({ host: '127.0.0.1:50333', origin: 'http://evil.example' }),
      res,
    )
    expect(captured.status).toBe(403)
  })

  it('admits a same-origin loopback request', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.health, makeDeps()).handler(
      fakeRequest({ host: '127.0.0.1:50333', origin: 'http://127.0.0.1:50333' }),
      res,
    )
    expect(captured.status).toBe(200)
  })
})

describe('GET /workspaces', () => {
  it('lists the session and cache workspaces, active first', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.workspaces, makeDeps()).handler(fakeRequest(), res)
    expect(captured.status).toBe(200)
    const body = captured.body as { workspaces: Array<{ cwd: string; active: boolean }> }
    expect(body.workspaces.map((row) => row.cwd)).toEqual(['/w/demo', '/w/other'])
    expect(body.workspaces[0]?.active).toBe(true)
  })
})

describe('GET /board', () => {
  it('refuses a ws-less read instead of guessing a default workspace', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.board, makeDeps()).handler(fakeRequest(), res)
    expect(captured.status).toBe(400)
    expect((captured.body as { error: string }).error).toBe('ws must be an absolute workspace path')
  })

  it('serves the board of the named workspace', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.board, makeDeps()).handler(fakeRequest({ url: `${ROUTES.board}?ws=/w/demo` }), res)
    expect(captured.status).toBe(200)
    const body = captured.body as { workspace: { cwd: string }; board: BoardFile }
    expect(body.workspace.cwd).toBe('/w/demo')
    expect(body.board.columns).toHaveLength(4)
  })

  it('reports an unusable board file with 409 instead of replacing it', async () => {
    const { res, captured } = fakeResponse()
    const deps = makeDeps({ readOrInitBoard: async () => ({ error: 'board file is not valid JSON' }) })
    await route(ROUTES.board, deps).handler(fakeRequest({ url: `${ROUTES.board}?ws=/w/demo` }), res)
    expect(captured.status).toBe(409)
  })

  it('rejects a non-absolute ws override', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.board, makeDeps()).handler(fakeRequest({ url: '/api/dsh-taskboard/board?ws=relative' }), res)
    expect(captured.status).toBe(400)
  })
})

describe('PUT /board', () => {
  it('saves a whole board and bumps the revision', async () => {
    const { res, captured } = fakeResponse()
    const body = JSON.stringify({ expectedRevision: 1, board: { ...defaultBoard(), revision: 1 } })
    await route(ROUTES.board, makeDeps()).handler(
      fakeRequest({ method: 'PUT', url: `${ROUTES.board}?ws=/w/demo`, body }),
      res,
    )
    expect(captured.status).toBe(200)
    expect((captured.body as { board: BoardFile }).board.revision).toBe(2)
  })

  it('answers 409 on a stale revision', async () => {
    const { res, captured } = fakeResponse()
    const body = JSON.stringify({ expectedRevision: 7, board: defaultBoard() })
    await route(ROUTES.board, makeDeps()).handler(
      fakeRequest({ method: 'PUT', url: `${ROUTES.board}?ws=/w/demo`, body }),
      res,
    )
    expect(captured.status).toBe(409)
  })

  it('rejects a body without a usable expectedRevision', async () => {
    const { res, captured } = fakeResponse()
    const body = JSON.stringify({ board: defaultBoard() })
    await route(ROUTES.board, makeDeps()).handler(
      fakeRequest({ method: 'PUT', url: `${ROUTES.board}?ws=/w/demo`, body }),
      res,
    )
    expect(captured.status).toBe(400)
  })

  it('rejects a non-object body', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.board, makeDeps()).handler(
      fakeRequest({ method: 'PUT', url: `${ROUTES.board}?ws=/w/demo`, body: '[]' }),
      res,
    )
    expect(captured.status).toBe(400)
  })

  it('answers 405 for another method', async () => {
    const { res, captured } = fakeResponse()
    await route(ROUTES.board, makeDeps()).handler(
      fakeRequest({ method: 'DELETE', url: `${ROUTES.board}?ws=/w/demo` }),
      res,
    )
    expect(captured.status).toBe(405)
  })
})

describe('resolveRequestedWorkspace', () => {
  it('resolves and normalizes an explicit absolute workspace', () => {
    expect(resolveRequestedWorkspace('/w/demo')).toBe('/w/demo')
    expect(resolveRequestedWorkspace('  /w/demo/  ')).toBe('/w/demo')
  })

  it('refuses a missing or blank workspace', () => {
    expect(resolveRequestedWorkspace(undefined)).toBeUndefined()
    expect(resolveRequestedWorkspace('   ')).toBeUndefined()
  })

  it('refuses relative and traversal paths', () => {
    expect(resolveRequestedWorkspace('relative/path')).toBeUndefined()
    expect(resolveRequestedWorkspace('/w/../etc')).toBeUndefined()
    expect(resolveRequestedWorkspace('/w/./x')).toBeUndefined()
  })
})
