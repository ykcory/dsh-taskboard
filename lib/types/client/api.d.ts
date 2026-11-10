/**
 * Board API client (browser half). Talks to the host route family over
 * same-origin fetch; the host enforces the loopback trust fence on its side.
 *
 * Route paths are DOCUMENT-RELATIVE on purpose (no leading slash): the GUI is
 * served with `<base href="./">`, so a sub-path deployment is the entry
 * directory; a root-absolute path would escape that prefix.
 */
import type { BoardFile } from '../core/board.ts';
/** One thrown API error with the host-provided message and status. */
export declare class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/** One wire workspace row served by GET /workspaces. */
export interface WorkspaceRow {
    cwd: string;
    name: string;
    active: boolean;
}
/** Workspace list payload. */
export interface WorkspacesPayload {
    workspaces: WorkspaceRow[];
}
/** Board payload served by GET and PUT /board. */
export interface BoardPayload {
    workspace: {
        cwd: string;
        name: string;
    };
    board: BoardFile;
}
/** Board API client. */
export declare class BoardApi {
    /** List the known workspaces (running sessions ∪ projection cache). */
    listWorkspaces(): Promise<WorkspacesPayload>;
    /**
     * Read one board (default ws: the active session workspace). A workspace
     * without a board yet gets its default board created by the host.
     */
    getBoard(ws?: string): Promise<BoardPayload>;
    /** Whole-board CAS write: the server bumps the revision on success. */
    putBoard(input: {
        ws?: string;
        expectedRevision: number;
        board: BoardFile;
    }): Promise<BoardPayload>;
    private suffix;
    private request;
}
