/**
 * The /api/dsh-taskboard route family: workspace enumeration, the per-
 * workspace board read (auto-creating the default board) and the whole-board
 * CAS write, plus a health row. Every route carries the loopback trust fence
 * (socket address, Host header, browser same-origin markers); the write
 * routes create files under the named workspace, so unpaired LAN clients
 * must not reach them.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { BoardRead, BoardSave } from './board-store.ts';
import { type WorkspaceEntry } from './workspaces.ts';
/** Route paths (client bundle mirrors these literals; tests assert both sides). */
export declare const ROUTES: {
    readonly workspaces: "/api/dsh-taskboard/workspaces";
    readonly board: "/api/dsh-taskboard/board";
    readonly health: "/api/dsh-taskboard/health";
};
/** Route family dependencies (tests inject fakes). */
export interface BoardRoutesDeps {
    /** Running sessions' cwds in order (first = active). */
    sessionCwds(): string[];
    /** Session projection cache cwds. */
    projcacheCwds(): Promise<string[]>;
    /** Resolve the request's ws override into an absolute workspace root. */
    resolveWorkspace(override: string | undefined): string | undefined;
    /** Whole-board CAS save. */
    saveBoard(workspace: string, expectedRevision: number, board: unknown): Promise<BoardSave>;
    /** Default-board create-on-read. */
    readOrInitBoard(workspace: string): Promise<{
        board: unknown;
        created: boolean;
    } | {
        error: string;
    }>;
    /** Skill registration outcome, for diagnosing the agent-facing skill from outside. */
    skillStatus(): string;
    /** Service shape + failure stack for the skill registration (diagnostics). */
    skillDebug(): unknown;
    /** Logger. */
    logger: {
        warn(error: unknown): void;
    };
}
/** One wire workspace row: root, display name, active flag. */
export type WorkspaceRow = WorkspaceEntry;
/**
 * Build every /api/dsh-taskboard route (exact paths).
 * @param ctx - host context (kept for family shape parity).
 * @param deps - injectable route dependencies.
 * @returns the route list for ctx.webServer.register.
 */
export declare function makeRoutes(ctx: Context, deps: BoardRoutesDeps): WebRoute[];
/** Narrowing helper for the read result (re-exported for tests). */
export type { BoardRead };
