/**
 * taskboard — host half. Serves the per-workspace milestone board: the
 * /api/dsh-taskboard route family (workspace enumeration, board read with
 * default-board creation, whole-board CAS write, health) over the loopback
 * trust fence. The board file is plain JSON at
 * `<workspace>/.dsh/taskboard/board.json`, equally writable by agents with
 * file tools. The browser half (./client) renders the board panel.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Stable cordis plugin name. */
export declare const name = "taskboard";
/** Services required before the board routes can mount. */
export declare const inject: string[];
/** Host-side plugin config. */
export interface Config {
    /** Master switch for the plugin (routes). */
    enabled?: boolean;
    /** User dsh config root override (defaults to $DSH_HOME or ~/.dsh). */
    dshHome?: string;
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
export declare function resolveRequestedWorkspace(override: string | undefined): string | undefined;
/**
 * Mount the board routes.
 * @param ctx - host plugin context carrying webServer/sessions.
 * @param config - resolved plugin config.
 */
declare function applyImpl(ctx: Context, config?: Config): void;
/**
 * Single-instance guard: the aggregate family bundle and a standalone install
 * of this package can coexist in one profile, so the second host apply must
 * be a no-op instead of re-registering the same routes and failing the boot.
 */
export declare const apply: typeof applyImpl;
export {};
