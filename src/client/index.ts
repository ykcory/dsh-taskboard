/**
 * taskboard client entry — runs inside the dsh web GUI.
 *
 * Registers the taskboard locale dictionaries and contributes the board as a
 * docked right-Sidebar tab type with a card on the guide (开始) page. Failure
 * policy: registration problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin
 * must not take the GUI down.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { BoardApi } from './api.ts'
import { TaskboardController } from './controller.ts'
import { en, NS, setRuntimeTranslate, zh, type TaskboardKey } from './locales.ts'
import { registerTaskboardTab } from './right-panel.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** taskboard surface copy. */
    taskboard: TaskboardKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/** Structural face of the locale service (declared by the locale plugin). */
interface LocaleFace {
  register(namespace: string, dictionaries: Record<string, unknown>): () => void
  bind(namespace: string): ((key: TaskboardKey, values?: Record<string, string | number>) => string) | undefined
}

/** Structural face of the cordis effect seat. */
interface EffectFace {
  effect(fn: () => () => void, label?: string): unknown
}

/**
 * Mount the taskboard surfaces.
 * @param ctx - client root context (locale, slots, sidebarRightTabs).
 */
export function apply(ctx: ClientContext): void {
  const faces = ctx as ClientContext & Partial<LocaleFace & EffectFace>
  faces.effect?.(() => {
    try {
      return faces.locale?.register(NS, { zh, en }) ?? (() => {})
    } catch {
      return () => {}
    }
  }, 'taskboard: dictionaries')
  try {
    setRuntimeTranslate(faces.locale?.bind(NS))
  } catch {
    // locale missing: document-language fallback stays
  }
  const api = new BoardApi()
  const controller = new TaskboardController(api)
  try {
    faces.effect?.(() => registerTaskboardTab(ctx, controller, api), 'taskboard: right tab')
  } catch (error) {
    console.warn('[taskboard] right-sidebar registration failed:', error)
  }
}
