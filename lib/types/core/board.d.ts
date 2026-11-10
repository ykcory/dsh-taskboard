/**
 * Board data model shared by the host half and the browser half.
 *
 * The board file lives at `<workspace>/.dsh/taskboard/board.json` and is one
 * JSON document: milestone tabs (epics), stage columns (columns), and task
 * cards (tasks) with a monotonically increasing `revision` for whole-board
 * CAS writes. Agents may edit the file directly with file tools; the plugin
 * never holds it in a database.
 *
 * Concept naming (project AGENTS.md): epics = 里程碑, tasks = 事项,
 * columns = 阶段.
 */
/** One milestone (the tab row). */
export interface Epic {
    id: string;
    name: string;
}
/** One stage column with its color. */
export interface BoardColumn {
    id: string;
    name: string;
    /** Hex color `#rrggbb` (the column head dot; the background is a light tint derived in the view). */
    color: string;
}
/** One task card under an epic, sitting in a stage column. */
export interface TaskItem {
    id: string;
    epicId: string;
    columnId: string;
    title: string;
    /** Epoch ms, set when the card is created. */
    createdAt: number;
}
/** The whole board file as written to disk. */
export interface BoardFile {
    revision: number;
    epics: Epic[];
    columns: BoardColumn[];
    tasks: TaskItem[];
}
/**
 * The milestone a fresh board starts with.
 *
 * A board always shows at least one tab (the last one cannot be removed), so
 * a new board opens on M1 rather than an empty tab row.
 */
export declare const DEFAULT_EPICS: readonly Epic[];
/**
 * The stages a fresh board starts with: the first four presets.
 *
 * The five-color preset list stays available in the stage color popover and
 * the palette, but a new board opens on this four-stage pipeline (the former
 * fifth stage, 失败, is not part of the default flow).
 */
export declare const DEFAULT_COLUMNS: readonly BoardColumn[];
/** The eight preset colors of the stage color popover (design palette). */
export declare const STAGE_PALETTE: readonly string[];
/** Hard size bounds keeping one board file small and the shape checks cheap. */
export declare const BOARD_LIMITS: {
    /** Max bytes of one board.json file the host accepts. */
    readonly fileBytes: number;
    /** Max bytes of one PUT request body. */
    readonly putBodyBytes: number;
    readonly epics: 100;
    readonly columns: 24;
    readonly tasks: 2000;
    /** Max characters of an epic/stage name. */
    readonly nameLength: 200;
    /** Max characters of a task title. */
    readonly titleLength: 500;
};
/** Outcome of a whole-board shape validation. */
export type BoardValidation = {
    ok: true;
    board: BoardFile;
} | {
    ok: false;
    reason: string;
};
/**
 * Validate one parsed board document (shape + referential integrity + id
 * uniqueness). The revision is checked for shape only — the store assigns a
 * fresh revision on save.
 * @param value - the parsed JSON value.
 * @returns the validated board or the first failing reason.
 */
export declare function validateBoard(value: unknown): BoardValidation;
/**
 * Ordering model: the position of a stage column IS its index in
 * `board.columns`, and the position of a task card within its stage (for one
 * milestone) IS its relative order in `board.tasks`. No separate order fields
 * — agents can reorder by editing the JSON file directly.
 */
/**
 * Move one task card to `toIndex` within the milestone's visible list of
 * `toColumnId` (same-stage reorder and cross-stage move share one function).
 * The task keeps its milestone. Returns the updated board, or undefined when
 * the task or the target stage does not exist.
 */
export declare function reorderTaskInBoard(board: BoardFile, taskId: string, toColumnId: string, toIndex: number): BoardFile | undefined;
/**
 * Move one stage column to `toIndex` within `board.columns`. Returns the
 * updated board, or undefined when the column does not exist. The index is
 * clamped so callers can pass the pointer-derived position unchecked.
 */
export declare function reorderColumnInBoard(board: BoardFile, columnId: string, toIndex: number): BoardFile | undefined;
/**
 * Guard applied on save when a save removes columns: a stage that still holds
 * tasks must not be removed (project AGENTS.md 删除防护).
 * @param current - the board currently on disk.
 * @param incoming - the validated replacement board.
 * @returns the first still-populated removed column name, or undefined.
 */
export declare function firstRemovedNonEmptyColumn(current: BoardFile, incoming: BoardFile): string | undefined;
/** Fresh board contents: revision 1, one milestone, the four preset stages, no work. */
export declare function defaultBoard(): BoardFile;
/**
 * One fresh unique id with a readable prefix.
 * @param prefix - `epic` / `col` / `task`.
 * @param random - injectable randomness source (defaults to Math.random).
 */
export declare function makeId(prefix: string, random?: () => number): string;
/** Pick one random palette color (used when a new stage is added). */
export declare function randomStageColor(random?: () => number): string;
