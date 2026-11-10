/**
 * Workspace enumeration for the per-workspace boards.
 *
 * The candidate set is the union of the running sessions' cwds (host
 * `sessions` service) and every cwd recorded in the session projection cache
 * (`~/.dsh/storages/session_projcache/sessions/session-*.json`,
 * `record.identity.cwd`), deduplicated by absolute path. The first session
 * cwd counts as the active workspace.
 */
/** One workspace row the panel can address. */
export interface WorkspaceEntry {
    /** Absolute workspace root. */
    cwd: string;
    /** Directory name for display. */
    name: string;
    /** True for the active (first session) workspace. */
    active: boolean;
}
/**
 * Deduplicate session cwds and projcache cwds into workspace rows. The first
 * session cwd is the active workspace; a cwd that also appears later keeps
 * one row. Entries that are not absolute paths are dropped.
 */
export declare function dedupeWorkspaces(sessionCwds: readonly string[], projcacheCwds: readonly string[]): WorkspaceEntry[];
/**
 * Read every projcache session record's identity cwd. The directory shape is
 * `<dshHome>/storages/session_projcache/sessions/session-*.json`; anything
 * unreadable degrades to an empty list (this source only widens the set —
 * the running sessions remain).
 * @param dshHome - the DSH home root.
 */
export declare function projcacheCwds(dshHome: string): Promise<string[]>;
/**
 * Normalize one workspace root: absolute, no `.` / `..` segments, resolved.
 * The write routes create directories under this root, so a relative or
 * traversal path is refused rather than resolved against a surprise base.
 */
export declare function normalizeWorkspaceRoot(value: string): string | undefined;
