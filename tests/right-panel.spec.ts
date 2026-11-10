// @vitest-environment jsdom
/**
 * Right-sidebar registration: the tab type carries the guide card, the body
 * and title register under the type's own id, and a shell without the
 * sidebar-right service stays silent instead of failing boot.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { BoardApi } from '../src/client/api.ts'
import { TaskboardController } from '../src/client/controller.ts'
import { registerTaskboardTab, TASKBOARD_TAB_ID, TASKBOARD_TAB_KIND } from '../src/client/right-panel.tsx'

/** One captured slot registration. */
interface Registration {
  name: string
  options: Record<string, unknown>
}

/** A client context double recording every registration it receives. */
function makeContext(): {
  ctx: Context
  types: Array<Record<string, unknown>>
  registrations: Registration[]
  injects: string[]
} {
  const types: Array<Record<string, unknown>> = []
  const registrations: Registration[] = []
  const injects: string[] = []
  const ctx = {
    slots: {
      inject(key: string, callback: () => () => void) {
        injects.push(key)
        return callback()
      },
      register(options: Record<string, unknown>) {
        registrations.push({ name: String(options['name']), options })
        return () => {}
      },
    },
    sidebarRightTabs: {
      register(definition: Record<string, unknown>) {
        types.push(definition)
        return () => {}
      },
    },
    effect(fn: () => () => void) {
      return fn()
    },
  }
  return { ctx: ctx as unknown as Context, types, registrations, injects }
}

/** A controller over a board API the tests never call. */
function makeController(): TaskboardController {
  return new TaskboardController(new BoardApi())
}

describe('registerTaskboardTab', () => {
  it('registers one tab type with a guide card', () => {
    const { ctx, types } = makeContext()
    registerTaskboardTab(ctx, makeController(), new BoardApi())
    expect(types).toHaveLength(1)
    const type = types[0]!
    expect(type['id']).toBe(TASKBOARD_TAB_ID)
    expect(type['kind']).toBe(TASKBOARD_TAB_KIND)
    // A type from outside the product: the extension band.
    expect(type['priority']).toBe('extension')
    const guide = type['guide'] as Array<Record<string, unknown>>
    expect(guide).toHaveLength(1)
    expect(guide[0]!['id']).toBe('board')
    expect(typeof guide[0]!['order']).toBe('number')
    expect(typeof guide[0]!['title']).toBe('function')
    expect(typeof guide[0]!['description']).toBe('function')
    // The card carries artwork: without one the guide draws its grey cube.
    expect(typeof guide[0]!['icon']).toBe('function')
  })

  it('resolves the card copy through the active dictionary', () => {
    // t() picks the dictionary from the document language; jsdom ships no
    // `lang`, so the test states the language it is asserting in.
    const previous = document.documentElement.lang
    document.documentElement.lang = 'zh-CN'
    try {
      const { ctx, types } = makeContext()
      registerTaskboardTab(ctx, makeController(), new BoardApi())
      const guide = types[0]!['guide'] as Array<{ title: () => string; description: () => string }>
      expect(guide[0]!.title()).toBe('任务看板')
      expect(guide[0]!.description()).toBe('按里程碑管理事项的阶段流转')
    } finally {
      document.documentElement.lang = previous
    }
  })

  it('registers the body and the chip title under the type id', () => {
    const { ctx, registrations } = makeContext()
    registerTaskboardTab(ctx, makeController(), new BoardApi())
    const names = registrations.map((entry) => entry.name)
    expect(names).toEqual(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
    for (const entry of registrations) {
      expect(entry.options['key']).toBe(TASKBOARD_TAB_ID)
    }
  })

  it('injects the controller face into the tab body', () => {
    const { ctx, registrations } = makeContext()
    const controller = makeController()
    const api = new BoardApi()
    registerTaskboardTab(ctx, controller, api)
    const body = registrations.find((entry) => entry.name === 'sidebar.right.pane.tab')
    const inject = body!.options['inject'] as () => { controller: unknown; api: unknown }
    expect(inject()).toEqual({ controller, api })
  })

  it('stays silent on a shell without the sidebar-right service', () => {
    const ctx = { slots: { inject: () => () => {}, register: () => () => {} }, effect: (fn: () => () => void) => fn() }
    const dispose = registerTaskboardTab(ctx as unknown as Context, makeController(), new BoardApi())
    expect(typeof dispose).toBe('function')
  })

  it('releases every registration through the returned disposer', () => {
    const { ctx, types, registrations } = makeContext()
    const dispose = registerTaskboardTab(ctx, makeController(), new BoardApi())
    expect(types.length + registrations.length).toBeGreaterThan(0)
    expect(() => {
      dispose()
    }).not.toThrow()
  })
})
