/**
 * taskboard — host half. Serves the per-workspace milestone board: the
 * /api/dsh-taskboard route family (workspace enumeration, board read with
 * default-board creation, whole-board CAS write, health) over the loopback
 * trust fence. The board file is plain JSON at
 * `<workspace>/.dsh/taskboard/board.json`, equally writable by agents with
 * file tools. Besides the routes, the plugin registers a runtime skill
 * (`taskboard`) into the host skills registry so every session's agent
 * discovers how to operate the board file. The browser half (./client)
 * renders the board panel.
 */

import { homedir } from 'node:os'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { readOrInitBoard, saveBoard } from './host/board-store.ts'
import { makeRoutes } from './host/routes.ts'
import { registerBoardSkill, type SkillsFace } from './host/skill.ts'
import { normalizeWorkspaceRoot, projcacheCwds as readProjcacheCwds } from './host/workspaces.ts'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name. */
export const name = 'taskboard'

/**
 * Services required before the board routes can mount. `skills` guarantees the
 * registry exists when the agent-facing skill registers (same hard-inject
 * pattern the official skill center plugin uses).
 */
export const inject = ['webServer', 'skills', 'sessions']

/** Structural face of the host sessions service this plugin reads. */
interface SessionsFace {
  list?: () => Array<{ header?: { cwd?: unknown } }>
}

/** Structural face of the host webserver service this plugin registers into. */
interface WebServerFace {
  register(route: unknown): () => void
}

/** Host-side plugin config. */
export interface Config {
  /** Master switch for the plugin (routes). */
  enabled?: boolean
  /** User dsh config root override (defaults to $DSH_HOME or ~/.dsh). */
  dshHome?: string
}

/**
 * Resolve the workspace one request addresses: the explicit ws override,
 * strictly normalized. There is NO default — a request without a usable ws
 * is refused by the route (400), because the panel and every agent caller
 * name the workspace they mean; guessing one (first session, process cwd)
 * silently read and wrote a foreign workspace's board.
 * @param override - the request's ws parameter.
 * @returns the absolute workspace root, or undefined when absent/unusable.
 */
export function resolveRequestedWorkspace(override: string | undefined): string | undefined {
  if (override === undefined || override.trim() === '') return undefined
  return normalizeWorkspaceRoot(override)
}

/**
 * Mount the board routes.
 * @param ctx - host plugin context carrying webServer/sessions.
 * @param config - resolved plugin config.
 */
function applyImpl(ctx: Context, config?: Config): void {
  if (config?.enabled === false) return
  const hostCtx = ctx as Context & { webServer: WebServerFace; sessions?: SessionsFace; skills?: SkillsFace }
  const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? `${homedir()}${sep}.dsh`

  /** Running session cwds, degraded to [] when the registry is unavailable. */
  const sessionCwds = (): string[] => {
    try {
      const sessions = hostCtx.sessions
      if (typeof sessions?.list !== 'function') return []
      return sessions
        .list()
        .map((session) => session.header?.cwd)
        .filter((cwd): cwd is string => typeof cwd === 'string' && cwd.trim() !== '')
    } catch {
      return []
    }
  }

  /**
   * The workspace a request addresses: the ws override, or nothing — the
   * route refuses a ws-less board read/write (see resolveRequestedWorkspace).
   */
  const resolveWorkspace = resolveRequestedWorkspace

  /** Skill registration outcome, read by the health route for outside diagnosis. */
  let skillStatus = 'not-applied'
  /** Shape of the host skills service + failure stack, for diagnosing the host-side gap. */
  let skillDebug: Record<string, unknown> = {}

  const routes = makeRoutes(hostCtx, {
    sessionCwds,
    projcacheCwds: () => readProjcacheCwds(dshHome),
    resolveWorkspace,
    saveBoard: (workspace, expectedRevision, board) => saveBoard(workspace, expectedRevision, board),
    readOrInitBoard: (workspace) => readOrInitBoard(workspace),
    skillStatus: () => skillStatus,
    skillDebug: () => skillDebug,
    logger: { warn: (error) => ctx.logger.warn(error) },
  })
  ctx.effect(() => {
    skillDebug = {
      serviceType: hostCtx.skills?.constructor?.name ?? typeof hostCtx.skills,
      registerType: typeof hostCtx.skills?.register,
      prototypeChain: (() => {
        const names: string[] = []
        let proto = hostCtx.skills ? Object.getPrototypeOf(hostCtx.skills) : undefined
        while (proto && proto !== Object.prototype && names.length < 4) {
          names.push(proto.constructor?.name ?? '(anon)')
          proto = Object.getPrototypeOf(proto)
        }
        return names.join(' → ')
      })(),
    }
    const outcome = registerBoardSkill(hostCtx.skills, (message) => ctx.logger.warn(message))
    if (outcome.status === 'failed') {
      skillStatus = `failed: ${outcome.error}`
      skillDebug.stack = outcome.stack
    } else {
      skillStatus = outcome.status
    }
    const disposers = routes.map((route) => hostCtx.webServer.register(route))
    return () => {
      if (outcome.status === 'registered') outcome.disposer?.()
      for (const dispose of disposers) dispose()
    }
  }, 'taskboard: routes and skill')
}

/**
 * Single-instance guard: the aggregate family bundle and a standalone install
 * of this package can coexist in one profile, so the second host apply must
 * be a no-op instead of re-registering the same routes and failing the boot.
 */
export const apply = mountOnce('dsh-client-ui-taskboard', applyImpl)
