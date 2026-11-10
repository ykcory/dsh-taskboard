/**
 * taskboard client entry — runs inside the dsh web GUI.
 *
 * Registers the taskboard locale dictionaries and contributes the board as a
 * docked right-Sidebar tab type with a card on the guide (开始) page. Failure
 * policy: registration problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin
 * must not take the GUI down.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type TaskboardKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** taskboard surface copy. */
        taskboard: TaskboardKey;
    }
}
/** Required services (fiber inject waiting — the runtime must be up first). */
export declare const inject: string[];
/**
 * Mount the taskboard surfaces.
 * @param ctx - client root context (locale, slots, sidebarRightTabs).
 */
export declare function apply(ctx: ClientContext): void;
