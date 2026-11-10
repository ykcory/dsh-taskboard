// @vitest-environment jsdom
/**
 * Right-sidebar registration: the tab type carries the guide card, the body
 * and title register under the type's own id, and a shell without the
 * sidebar-right service stays silent instead of failing boot.
 */

import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { BoardApi, type BoardPayload } from '../src/client/api.ts'
import { TaskboardController } from '../src/client/controller.ts'
import { registerTaskboardTab, TASKBOARD_TAB_ID, TASKBOARD_TAB_KIND } from '../src/client/right-panel.tsx'
import { defaultBoard } from '../src/core/board.ts'

// React 18's act needs the explicit environment flag; without it createRoot
// defers every render to the scheduler and nothing mounts in the test.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** One captured slot registration. */
interface Registration {
  name: string
  options: Record<string, unknown>
  /** The component handed to slots.register (the tab body or title). */
  component?: unknown
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
      register(options: Record<string, unknown>, component?: unknown) {
        registrations.push({ name: String(options['name']), options, component })
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

/** Standard-props double: the framework session kit the slot adds to the body. */
function sessionKit(cwd: string | undefined): Record<string, unknown> {
  return {
    sessionId: 's1',
    useSessions: (selector: (sessions: { byId: Record<string, { cwd?: string | undefined } | undefined> }) => unknown) =>
      selector({ byId: cwd === undefined ? {} : { s1: { cwd } } }),
  }
}

/** A board API double recording every getBoard ws. */
function recordingApi(): { api: BoardApi; gets: Array<string | undefined> } {
  const gets: Array<string | undefined> = []
  const api = {
    async getBoard(ws?: string): Promise<BoardPayload> {
      gets.push(ws)
      return { workspace: { cwd: ws ?? '/w/none', name: 'none' }, board: defaultBoard() }
    },
    async putBoard(): Promise<BoardPayload> {
      throw new Error('no puts expected')
    },
  } as unknown as BoardApi
  return { api, gets }
}

/** Mount the registered tab body with the given standard props. */
async function mountBody(api: BoardApi, standard: Record<string, unknown>): Promise<{
  container: HTMLElement
  unmount: () => Promise<void>
}> {
  const { ctx, registrations } = makeContext()
  // The controller drives the SAME api double, so every read is observable.
  const controller = new TaskboardController(api)
  registerTaskboardTab(ctx, controller, api)
  const body = registrations.find((entry) => entry.name === 'sidebar.right.pane.tab')!.component
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(body as never, { controller, api, ...standard }))
  })
  // One more drain so a load resolved during the mount act commits its state.
  await act(async () => {})
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
    },
  }
}

describe('TaskboardTabBody workspace resolution', () => {
  it('loads the resolved session workspace and renders the board', async () => {
    const { api, gets } = recordingApi()
    const mounted = await mountBody(api, sessionKit('/w/session'))
    // The read names the workspace, exactly like the shipped files tab's read.
    expect(gets).toEqual(['/w/session'])
    expect(mounted.container.querySelector('[data-dsh-part="taskboard-no-workspace"]')).toBeNull()
    await mounted.unmount()
  })

  it('shows the status line and loads nothing without a workspace', async () => {
    const { api, gets } = recordingApi()
    const mounted = await mountBody(api, sessionKit(undefined))
    const status = mounted.container.querySelector('[data-dsh-part="taskboard-no-workspace"]')
    expect(status).not.toBeNull()
    // The shell ships no lang; t() falls back to the en dictionary.
    expect(status!.textContent).toBe('No workspace for the current session')
    expect(gets).toEqual([])
    await mounted.unmount()
  })

  it('degrades to the status line when the shell omits the session kit', async () => {
    const { api, gets } = recordingApi()
    const mounted = await mountBody(api, {})
    expect(mounted.container.querySelector('[data-dsh-part="taskboard-no-workspace"]')).not.toBeNull()
    expect(gets).toEqual([])
    await mounted.unmount()
  })
})
