/**
 * The /api/dsh-taskboard route family: workspace enumeration, the per-
 * workspace board read (auto-creating the default board) and the whole-board
 * CAS write, plus a health row. Every route carries the loopback trust fence
 * (socket address, Host header, browser same-origin markers); the write
 * routes create files under the named workspace, so unpaired LAN clients
 * must not reach them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { BOARD_LIMITS } from '../core/board.ts'
import { asJsonObject, readJsonBody, writeJson } from '../http.ts'
import { isLoopbackRequest } from '../loopback.ts'
import type { BoardRead, BoardSave } from './board-store.ts'
import { dedupeWorkspaces, type WorkspaceEntry } from './workspaces.ts'

/** Route paths (client bundle mirrors these literals; tests assert both sides). */
export const ROUTES = {
  workspaces: '/api/dsh-taskboard/workspaces',
  board: '/api/dsh-taskboard/board',
  health: '/api/dsh-taskboard/health',
} as const

/** Route family dependencies (tests inject fakes). */
export interface BoardRoutesDeps {
  /** Running sessions' cwds in order (first = active). */
  sessionCwds(): string[]
  /** Session projection cache cwds. */
  projcacheCwds(): Promise<string[]>
  /** Resolve the request's ws override into an absolute workspace root. */
  resolveWorkspace(override: string | undefined): string | undefined
  /** Whole-board CAS save. */
  saveBoard(workspace: string, expectedRevision: number, board: unknown): Promise<BoardSave>
  /** Default-board create-on-read. */
  readOrInitBoard(workspace: string): Promise<{ board: unknown; created: boolean } | { error: string }>
  /** Skill registration outcome, for diagnosing the agent-facing skill from outside. */
  skillStatus(): string
  /** Service shape + failure stack for the skill registration (diagnostics). */
  skillDebug(): unknown
  /** Logger. */
  logger: { warn(error: unknown): void }
}

/** One wire workspace row: root, display name, active flag. */
export type WorkspaceRow = WorkspaceEntry

/**
 * Build every /api/dsh-taskboard route (exact paths).
 * @param ctx - host context (kept for family shape parity).
 * @param deps - injectable route dependencies.
 * @returns the route list for ctx.webServer.register.
 */
export function makeRoutes(ctx: Context, deps: BoardRoutesDeps): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isLoopbackRequest(req)) return true
    writeJson(res, 403, { error: 'loopback only' })
    return false
  }
  const workspacePayload = (workspace: string): { cwd: string; name: string } => ({
    cwd: workspace,
    name: workspace.split(/[\\/]+/).pop() || workspace,
  })
  return [
    {
      kind: 'exact',
      path: ROUTES.workspaces,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const sessions = deps.sessionCwds()
          const cached = await deps.projcacheCwds()
          const workspaces: WorkspaceRow[] = dedupeWorkspaces(sessions, cached)
          writeJson(res, 200, { workspaces })
        } catch (error) {
          deps.logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.board,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const override = url.searchParams.get('ws') ?? undefined
          const workspace = deps.resolveWorkspace(override)
          if (workspace === undefined) {
            writeJson(res, 400, { error: 'ws must be an absolute workspace path' })
            return
          }
          if (req.method === 'GET') {
            const result = await deps.readOrInitBoard(workspace)
            if ('error' in result) {
              // An unusable board file is reported, never replaced: hand edits win.
              writeJson(res, 409, { error: result.error })
              return
            }
            writeJson(res, 200, { workspace: workspacePayload(workspace), board: result.board })
            return
          }
          if (req.method === 'PUT') {
            const body = asJsonObject(await readJsonBody(req, { maxBytes: BOARD_LIMITS.putBodyBytes, objectOnly: true }))
            if (body === undefined) {
              writeJson(res, 400, { error: 'body must be a JSON object with expectedRevision and board' })
              return
            }
            const expectedRevision = body['expectedRevision']
            if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
              writeJson(res, 400, { error: 'expectedRevision must be a non-negative integer' })
              return
            }
            const saved = await deps.saveBoard(workspace, expectedRevision, body['board'])
            if (!saved.ok) {
              writeJson(res, saved.httpStatus, { error: saved.error })
              return
            }
            writeJson(res, 200, { workspace: workspacePayload(workspace), board: saved.board })
            return
          }
          writeJson(res, 405, { error: 'method not allowed' })
        } catch (error) {
          deps.logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        writeJson(res, 200, { ok: true, plugin: 'taskboard', skill: deps.skillStatus(), skillDebug: deps.skillDebug() })
      },
    },
  ]
}

/** Narrowing helper for the read result (re-exported for tests). */
export type { BoardRead }
