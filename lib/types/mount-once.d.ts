/**
 * Host single-instance guard. The aggregate family bundle and a standalone
 * install of the same package can coexist in one profile, so a second host
 * apply must be a no-op instead of re-registering the same webserver routes
 * and failing the boot.
 *
 * A no-op is only safe while the holder is ALIVE. The Host reloads a profile
 * by creating the new loader entries before the old ones are torn down, so
 * the new entry may mount while the previous one still owns the name; a
 * refused mount dropped there would lose the plugin for good. The refused
 * mount is therefore QUEUED, not dropped, and replayed the moment the holder
 * releases the name — if the waiting fiber is still alive then.
 *
 * The registry rides a global symbol so two module instances of the same
 * package (npm copy vs repository link) still share one verdict.
 *
 * cordis `ctx.effect` runs its callback immediately and treats the callback's
 * return value as the fiber disposer, so the unmarker is returned, not run.
 */
/**
 * Wrap a cordis plugin apply so the package runs at most once per process.
 * The first mount registers normally and releases the name when its fiber
 * disposes; a mount refused while that name is held waits for the release and
 * then runs, unless its own fiber disposes first.
 * @param packageName - npm package identity shared by every install source.
 * @param fn - the original plugin apply.
 * @returns an apply of the same shape.
 */
export declare function mountOnce<T extends (...args: never[]) => unknown>(packageName: string, fn: T): T;
