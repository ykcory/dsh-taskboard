/**
 * Board controller (framework-free store shared by the sidebar row and the
 * React board view). Owns the loaded board snapshot and every mutation; the
 * view reads getSnapshot() through useSyncExternalStore.
 *
 * Mutation flow: build the next board from the current snapshot, PUT it with
 * the observed revision, and adopt the server response (fresh revision). A
 * 409 reloads the server truth and raises the conflict notice; other
 * failures keep the local view and raise the save notice.
 */
import { type BoardFile } from '../core/board.ts';
import { BoardApi } from './api.ts';
/** Why a notice is on screen. */
export type NoticeKind = 'conflict' | 'save' | 'load';
/** One transient status line above the board. */
export interface Notice {
    kind: NoticeKind;
    /** Host-provided detail. */
    detail?: string;
}
/** Load phase of the board. */
export type BoardPhase = 'idle' | 'loading' | 'ready' | 'error';
/** The observable controller state. */
export interface TaskboardSnapshot {
    phase: BoardPhase;
    board: BoardFile | undefined;
    workspace: {
        cwd: string;
        name: string;
    } | undefined;
    /** Milestone the board area shows; defaults to the first epic. */
    selectedEpicId: string | undefined;
    /** True while a save round-trip is in flight. */
    saving: boolean;
    notice: Notice | undefined;
}
/** Result of a mutation the caller renders inline (popover, modal). */
export type MutationResult = 'ok' | 'blocked' | 'failed';
/** Board controller: one instance per client plugin apply. */
export declare class TaskboardController {
    private readonly api;
    private readonly listeners;
    private state;
    /** Cached so getSnapshot stays referentially stable between changes. */
    private snapshot;
    /** Monotonic load token: a superseded load's late response must not land. */
    private loadSeq;
    constructor(api: BoardApi);
    getSnapshot(): TaskboardSnapshot;
    subscribe(fn: () => void): () => void;
    private set;
    /** Dismiss the transient notice line. */
    dismissNotice(): void;
    /**
     * Load the board of one workspace — the active session's workspace root,
     * read by the tab body from the framework session list (the same source the
     * shipped files tab uses). Always explicit: the host refuses a board read
     * without a workspace, so no default is ever guessed here. A newer load
     * supersedes an in-flight one; its late response is dropped.
     */
    load(workspace: string): Promise<void>;
    /** Select the milestone tab the board area shows. */
    selectEpic(epicId: string): void;
    /** Create a milestone (tab); the new tab becomes the selected one. */
    createEpic(name: string): Promise<MutationResult>;
    /**
     * Add one stage column with the given name and a random palette color.
     * The name is required: the add-stage dialog collects it up front, so a
     * stage never sits unnamed on the board.
     */
    addStage(name: string): Promise<MutationResult>;
    /** Inline-rename one stage column. */
    renameStage(columnId: string, name: string): Promise<MutationResult>;
    /** Re-color one stage column from the popover palette. */
    setStageColor(columnId: string, color: string): Promise<MutationResult>;
    /**
     * Remove one stage column. The client refuses up front when the stage still
     * holds tasks of ANY epic (the server enforces the same rule); the caller
     * renders the blocked feedback.
     */
    removeStage(columnId: string): Promise<MutationResult>;
    /** Create one task card under the milestone, in the given stage. */
    createTask(input: {
        epicId: string;
        columnId: string;
        title: string;
    }): Promise<MutationResult>;
    /**
     * Edit one task card: a new title and/or a new stage. A stage change moves
     * the card to the END of the target stage's visible list (the edit dialog
     * is about the card's fields, not its order); one CAS commit covers both
     * changes. A no-op edit resolves without a round-trip.
     */
    editTask(taskId: string, input: {
        title?: string;
        columnId?: string;
    }): Promise<MutationResult>;
    /** Remove one task card (no guard: a card has no dependents). */
    removeTask(taskId: string): Promise<MutationResult>;
    /**
     * Move one task card to `toIndex` in the milestone's visible list of
     * `columnId` — same-stage reorder and cross-stage move share the path.
     * Without an index the card appends to the target stage. A no-op move
     * (same list position) resolves without a round-trip.
     */
    moveTask(taskId: string, columnId: string, toIndex?: number): Promise<MutationResult>;
    /**
     * Move one stage column to `toIndex` (drag by the column-head handle).
     * Out-of-range indexes clamp; a no-op move resolves without a round-trip.
     */
    moveStage(columnId: string, toIndex: number): Promise<MutationResult>;
    /** Rename one milestone tab. */
    renameEpic(epicId: string, name: string): Promise<MutationResult>;
    /**
     * Remove one milestone tab. The LAST milestone cannot be removed (a board
     * always shows at least one tab); a milestone that still holds tasks of any
     * stage is refused up front, matching the server's column-removal guard.
     */
    removeEpic(epicId: string): Promise<MutationResult>;
    /** Adopt one host payload: board plus workspace, keeping a valid selection. */
    private adopt;
    /** Re-read the server truth after a conflict. */
    private reload;
    /** Build, send, adopt. Returns whether the save landed. */
    private commit;
}
