// Test-environment glue (adapted from the dsh-web family's shared vitest
// setup for this standalone package).
//
// Browser-module loader: the client half bundle is a closure factory
// registered through window.__ModuleLoader__ (the GUI's module system).
// Under vitest there is no real loader, so this setup provides a minimal one:
// factory(require) executes with a require backed by Node's resolver. The
// module's exports are the factory's return value.
//
// Storage global: Node 25+ defines `localStorage` on the global object, and
// without a usable `--localstorage-file` its getter returns an empty object.
// A DOM environment gets a usable Storage; a run without a DOM has the stub
// removed.
import { createRequire } from 'node:module'

interface LoaderEntry {
  id: string
  factory: (require: (spec: string) => unknown) => unknown
}

const nodeRequire = createRequire(import.meta.url)
const modules = new Map<string, { exports: unknown }>()

function req(spec: string): unknown {
  const cached = modules.get(spec)
  if (cached) return cached.exports
  return nodeRequire(spec)
}

const loader = {
  load(entry: LoaderEntry): unknown {
    const cached = modules.get(entry.id)
    if (cached) return cached.exports
    // Register the placeholder first so circular factory requires resolve.
    const module = { exports: {} as unknown }
    modules.set(entry.id, module)
    module.exports = entry.factory(req) ?? module.exports
    return module.exports
  },
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__ModuleLoader__', {
    value: loader,
    configurable: true,
    writable: true,
  })
}

/** The Storage a DOM environment would have provided. */
class MemoryStorage implements Pick<Storage, 'length' | 'clear' | 'getItem' | 'key' | 'removeItem' | 'setItem'> {
  private readonly entries = new Map<string, string>()

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(String(key)) ?? null
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(String(key))
  }

  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value))
  }
}

if (typeof globalThis.localStorage?.getItem !== 'function') {
  if (typeof document === 'undefined') {
    delete (globalThis as { localStorage?: Storage }).localStorage
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    })
  }
}
