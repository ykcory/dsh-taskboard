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
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { BoardApi } from './api.ts';
import type { TaskboardController } from './controller.ts';
/** Implementation identity of this tab type (unique across every registration). */
export declare const TASKBOARD_TAB_ID = "dsh-client-ui-taskboard";
/** Type discriminator: what the tabs of this type are, and what `openTab` names. */
export declare const TASKBOARD_TAB_KIND = "taskboard";
/** The injected face the tab body receives (mirrors the family's `inject`). */
export interface TaskboardTabFace {
    controller: TaskboardController;
    api: BoardApi;
}
/**
 * Register the taskboard's tab type, its guide card, and its tab body/title.
 * @param ctx - client root context (services: slots, sidebarRightTabs).
 * @param controller - the board controller the body drives.
 * @param api - the board API client handed through the slot inject face.
 * @returns disposer releasing every registration.
 */
export declare function registerTaskboardTab(ctx: ClientContext, controller: TaskboardController, api: BoardApi): () => void;
