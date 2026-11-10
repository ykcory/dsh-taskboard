/**
 * Right-sidebar tab registration for the taskboard.
 *
 * The board is a docked tab type in the right Sidebar, reached from the
 * guide (开始) page's card row — the same mechanism the shipped 工作区文件 /
 * 新建终端 / 浏览器 cards use. Two stages, exactly like every other type:
 *
 * 1. `sidebarRightTabs.register(definition)` — what the type IS: its kind,
 *    priority band, tab chip title, and the guide card(s) it contributes.
 * 2. `slots.inject('sidebar.right.pane.tab')` (+ `.title`) — the body and the
 *    live chip title, dispatched under the definition's own `id`.
 *
 * Registration problems are logged, never thrown: the web shell fails the
 * whole boot when a plugin apply throws, and an external plugin must not take
 * the GUI down.
 */

import { useEffect, type ComponentType, type ReactElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoardApi } from './api.ts'
import type { TaskboardController } from './controller.ts'
import { t } from './locales.ts'
import { GuideArtworkTaskboard } from './view/GuideArtwork.tsx'
import { TaskboardPanel } from './view/TaskboardPanel.tsx'

/** Implementation identity of this tab type (unique across every registration). */
export const TASKBOARD_TAB_ID = 'dsh-client-ui-taskboard'

/** Type discriminator: what the tabs of this type are, and what `openTab` names. */
export const TASKBOARD_TAB_KIND = 'taskboard'

/** Position of the guide card among every type's entries (files is 10, terminal later). */
const GUIDE_ORDER = 30

/** Structural face of the sidebar-right tab registry (declared by ui-sidebar-right). */
interface TabRegistryFace {
  register(definition: {
    id: string
    kind: string
    priority?: 'extension' | 'builtin' | 'fallback'
    title: (address: string) => string
    guide?: ReadonlyArray<{
      id: string
      order: number
      title: () => string
      description?: () => string
      /** Optional glyph; the guide draws its cube placeholder without one. */
      icon?: ComponentType<{ size?: number; className?: string }>
    }>
  }): () => void
}

/** Structural face of the shell slot service. */
interface SlotsFace {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** Structural face of the cordis effect seat. */
interface EffectFace {
  effect(fn: () => () => void, label?: string): unknown
}

/** What the right Sidebar exposes on the client context. */
interface SidebarRightFace {
  sidebarRightTabs?: TabRegistryFace
}

/** The injected face the tab body receives (mirrors the family's `inject`). */
export interface TaskboardTabFace {
  controller: TaskboardController
  api: BoardApi
}

/**
 * The session standard kit the framework adds to a `scope: 'session'` slot
 * body (ui-session's `SessionStandardProps` + `GlobalStandardProps`,
 * structural slice — the same source the shipped files tab reads its
 * workspace root from). A shell always provides both for a session-scoped
 * key; they stay optional here so a shape drift degrades to the status line
 * instead of a crash.
 */
interface SessionStandardFace {
  /** The framework-resolved id of the session this tab occurrence is in. */
  sessionId: string
  /** Session-list selector hook; every list row carries the session's cwd. */
  useSessions: <Selected>(
    selector: (sessions: { byId: Record<string, { cwd?: string | undefined } | undefined> }) => Selected,
  ) => Selected
}

/** Absent-kit stand-in keeping the hook call order fixed: reads nothing. */
const useSessionsAbsent: SessionStandardFace['useSessions'] = () => undefined as never

/**
 * Register the taskboard's tab type, its guide card, and its tab body/title.
 * @param ctx - client root context (services: slots, sidebarRightTabs).
 * @param controller - the board controller the body drives.
 * @param api - the board API client handed through the slot inject face.
 * @returns disposer releasing every registration.
 */
export function registerTaskboardTab(ctx: ClientContext, controller: TaskboardController, api: BoardApi): () => void {
  const faces = ctx as ClientContext & Partial<SidebarRightFace & EffectFace>
  const slots = (ctx as { slots?: SlotsFace }).slots
  const disposers: Array<() => void> = []

  // Stage one: the type itself plus its guide card. Absent on a shell that
  // does not serve the right Sidebar — the board is then simply not offered.
  const registry = faces.sidebarRightTabs
  if (registry === undefined) return () => {}
  faces.effect?.(
    () =>
      registry.register({
        id: TASKBOARD_TAB_ID,
        kind: TASKBOARD_TAB_KIND,
        // A type from outside the product: the highest band, so it can take
        // over a builtin kind and outranks every viewer shipped here.
        priority: 'extension',
        // The chip text captured at open time; a page type opens by kind, so
        // there is no address to name.
        title: () => t('entry.label'),
        guide: [
          {
            id: 'board',
            order: GUIDE_ORDER,
            title: () => t('entry.label'),
            description: () => t('guide.description'),
            // Same artwork spec as the shipped guide cards (36x36 flat
            // two-tone); without one the guide draws its grey cube placeholder.
            icon: GuideArtworkTaskboard,
          },
        ],
      }),
    'taskboard: tab type',
  )

  if (slots === undefined) return () => {}

  // Stage two: the body and the live chip title under this type's id.
  disposers.push(
    slots.inject('sidebar.right.pane.tab', () =>
      slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: TASKBOARD_TAB_ID,
          inject: (): TaskboardTabFace => ({ controller, api }),
        },
        TaskboardTabBody as never,
      ),
    ),
  )
  disposers.push(
    slots.inject('sidebar.right.pane.tab.title', () =>
      slots.register(
        {
          name: 'sidebar.right.pane.tab.title',
          key: TASKBOARD_TAB_ID,
        },
        TaskboardTabTitle as never,
      ),
    ),
  )

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/**
 * The docked tab body: resolve the session's workspace root from the
 * framework session list (exactly the shipped files tab's read:
 * `useSessions(s => s.byId[sessionId]?.cwd)`), load that workspace's board,
 * and re-load when the session switch changes the root. Without a resolved
 * root the body shows the status line — the board is never loaded against a
 * guessed workspace (the host refuses a ws-less read anyway).
 */
function TaskboardTabBody(props: TaskboardTabFace & Partial<SessionStandardFace>): ReactElement | null {
  const { controller, sessionId, useSessions } = props
  const sessions = useSessions ?? useSessionsAbsent
  const workspace = sessions((list) => (sessionId === undefined ? undefined : list.byId[sessionId]?.cwd))

  useEffect(() => {
    if (workspace === undefined) return
    void controller.load(workspace)
  }, [controller, workspace])

  if (workspace === undefined) {
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-[12px] text-[#b0b6bd]"
        data-dsh-part="taskboard-no-workspace"
      >
        {t('status.noWorkspace')}
      </div>
    )
  }
  return <TaskboardPanel controller={controller} />
}

/** The tab chip text. */
function TaskboardTabTitle(): ReactElement {
  return <>{t('entry.label')}</>
}
