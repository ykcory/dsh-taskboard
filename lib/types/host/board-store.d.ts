/**
 * Board file storage under `<workspace>/.dsh/taskboard/board.json`.
 *
 * One JSON document per workspace, whole-board CAS: every save names the
 * revision it observed, and the server refuses to overwrite when the file has
 * moved on — or when the file on disk is not valid JSON (a hand edit in
 * progress must never be silently clobbered; the agent half edits this file
 * with plain file tools).
 */
import { type BoardFile } from '../core/board.ts';
/** Absolute path of one workspace's board file. */
export declare function boardFilePath(workspace: string): string;
/** Result of reading one board file. */
export type BoardRead = {
    status: 'ok';
    board: BoardFile;
} | {
    status: 'missing';
} | {
    status: 'invalid';
    reason: string;
};
/**
 * Read and validate one workspace's board file.
 * @param workspace - absolute workspace root.
 * @returns the parsed board, missing when no file exists, invalid with the
 *   first failing reason when the file exists but is unusable.
 */
export declare function readBoard(workspace: string): Promise<BoardRead>;
/** Result of one CAS save. */
export type BoardSave = {
    ok: true;
    board: BoardFile;
} | {
    ok: false;
    httpStatus: number;
    error: string;
};
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
export declare function saveBoard(workspace: string, expectedRevision: number, incoming: unknown): Promise<BoardSave>;
/**
 * Read one board, creating the default one (five preset stages, revision 1)
 * when no file exists yet. An existing but invalid file is NOT replaced —
 * the caller answers the reason so the panel can surface it.
 * @param workspace - absolute workspace root.
 * @returns the board plus whether this call created the file.
 */
export declare function readOrInitBoard(workspace: string): Promise<{
    board: BoardFile;
    created: boolean;
} | {
    error: string;
}>;
