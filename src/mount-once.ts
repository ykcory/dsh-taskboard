// Vendored from the dsh-web family's shared single-instance guard for this
// standalone package.
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

/** Published cross-repository contract: package names currently mounted. */
const MOUNTED = Symbol.for('dsh-web.mounted-plugins')
/** Additive key this guard owns: refused mounts waiting for the name. */
const WAITERS = Symbol.for('dsh-web.mounted-plugins.waiters')

interface GuardContext {
  effect?: (fn: () => () => void, label?: string) => unknown
}

/** The shared name registry, always a `Set` whatever another build stored there. */
function mountedSet(): Set<string> {
  const registry = globalThis as typeof globalThis & { [MOUNTED]?: unknown }
  const existing = registry[MOUNTED]
  if (existing instanceof Set) return existing as Set<string>
  const created = new Set<string>()
  registry[MOUNTED] = created
  return created
}

/** Queue per package name for mounts refused while a holder was alive. */
function mountWaiters(): Map<string, Array<{ run: () => void }>> {
  const registry = globalThis as typeof globalThis & { [WAITERS]?: unknown }
  const existing = registry[WAITERS]
  if (existing instanceof Map) return existing as Map<string, Array<{ run: () => void }>>
  const created = new Map<string, Array<{ run: () => void }>>()
  registry[WAITERS] = created
  return created
}

/**
 * Wrap a cordis plugin apply so the package runs at most once per process.
 * The first mount registers normally and releases the name when its fiber
 * disposes; a mount refused while that name is held waits for the release and
 * then runs, unless its own fiber disposes first.
 * @param packageName - npm package identity shared by every install source.
 * @param fn - the original plugin apply.
 * @returns an apply of the same shape.
 */
export function mountOnce<T extends (...args: never[]) => unknown>(packageName: string, fn: T): T {
  const mount = (...args: Parameters<T>): unknown => {
    const mounted = mountedSet()
    const ctx = args[0] as GuardContext | undefined
    if (mounted.has(packageName)) {
      const waiters = mountWaiters()
      const queue = waiters.get(packageName) ?? []
      let alive = true
      const pending = {
        run: () => {
          if (alive) mount(...args)
        },
      }
      ctx?.effect?.(() => () => {
        alive = false
        const index = queue.indexOf(pending)
        if (index >= 0) queue.splice(index, 1)
      })
      queue.push(pending)
      waiters.set(packageName, queue)
      return undefined
    }
    mounted.add(packageName)
    ctx?.effect?.(() => () => {
      mounted.delete(packageName)
      const waiters = mountWaiters()
      const queue = waiters.get(packageName)
      if (queue === undefined) return
      waiters.delete(packageName)
      for (const waiter of queue.splice(0)) {
        queueMicrotask(() => {
          waiter.run()
        })
      }
    })
    return fn(...args)
  }
  return mount as unknown as T
}
