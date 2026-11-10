/**
 * Board API client (browser half). Talks to the host route family over
 * same-origin fetch; the host enforces the loopback trust fence on its side.
 *
 * Route paths are DOCUMENT-RELATIVE on purpose (no leading slash): the GUI is
 * served with `<base href="./">`, so a sub-path deployment is the entry
 * directory; a root-absolute path would escape that prefix.
 */

import type { BoardFile } from '../core/board.ts'

/** Route paths mirrored from the host (src/host/routes.ts ROUTES). */
const API = {
  workspaces: 'api/dsh-taskboard/workspaces',
  board: 'api/dsh-taskboard/board',
} as const

/** One thrown API error with the host-provided message and status. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** One wire workspace row served by GET /workspaces. */
export interface WorkspaceRow {
  cwd: string
  name: string
  active: boolean
}

/** Workspace list payload. */
export interface WorkspacesPayload {
  workspaces: WorkspaceRow[]
}

/** Board payload served by GET and PUT /board. */
export interface BoardPayload {
  workspace: { cwd: string; name: string }
  board: BoardFile
}

/** Request timeout for the localhost round-trips (generous; the host is local). */
const REQUEST_TIMEOUT_MS = 15_000

/** Board API client. */
export class BoardApi {
  /** List the known workspaces (running sessions ∪ projection cache). */
  async listWorkspaces(): Promise<WorkspacesPayload> {
    return await this.request<WorkspacesPayload>(API.workspaces)
  }

  /**
   * Read one board (default ws: the active session workspace). A workspace
   * without a board yet gets its default board created by the host.
   */
  async getBoard(ws?: string): Promise<BoardPayload> {
    return await this.request<BoardPayload>(`${API.board}${this.suffix(ws)}`)
  }

  /** Whole-board CAS write: the server bumps the revision on success. */
  async putBoard(input: { ws?: string; expectedRevision: number; board: BoardFile }): Promise<BoardPayload> {
    return await this.request<BoardPayload>(`${API.board}${this.suffix(input.ws)}`, {
      method: 'PUT',
      body: { expectedRevision: input.expectedRevision, board: input.board },
    })
  }

  private suffix(ws: string | undefined): string {
    return typeof ws === 'string' && ws.trim() !== '' ? `?ws=${encodeURIComponent(ws)}` : ''
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers = options.body === undefined ? new Headers() : new Headers({ 'content-type': 'application/json' })
    let response: Response
    try {
      response = await fetch(path, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      throw new ApiError(0, error instanceof Error ? error.message : String(error))
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }
    if (!response.ok) {
      const record = (typeof payload === 'object' && payload !== null ? payload : {}) as { error?: unknown }
      const message = typeof record['error'] === 'string' ? record['error'] : `HTTP ${response.status}`
      throw new ApiError(response.status, message)
    }
    return payload as T
  }
}
