/**
 * The agent-facing taskboard skill, registered into the host `skills` service
 * at plugin apply (runtime source, rank 250 — any project/user skill of the
 * same name outranks it). This is the discoverability channel for AI agents:
 * the session skill catalog always carries the summary, and an agent asked to
 * "update the board" loads the full content before touching board.json.
 *
 * Registered globally from the unscoped host context, so it appears in every
 * workspace's sessions regardless of whether a board file exists there yet
 * (the content tells the agent where the board WOULD live).
 */

/** Structural face of the runtime skill this plugin registers. */
export interface RuntimeSkillFace {
  /** Official skill name grammar: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. */
  name: string
  /** Catalog summary the agent sees without loading the skill; carries the trigger words. */
  description: string
  /**
   * Origin bucket (`SkillSource`); official docs make it REQUIRED on a
   * registration (only `invocation`/`provider` are optional) and prompt-visible.
   */
  source: 'runtime'
  /** Full instructions handed to the agent when the skill is invoked. */
  content: string
}

/** Structural face of the host skills service this plugin registers into. */
export interface SkillsFace {
  register?: (skill: RuntimeSkillFace) => unknown
}

/** Stable skill name (official grammar, lowercase kebab). */
export const TASKBOARD_SKILL_NAME = 'taskboard'

/**
 * The skill body. Facts mirror src/core/board.ts (validation limits, id
 * grammar, ordering model) and src/host/board-store.ts (CAS revision,
 * corrupt-JSON refusal) — update both sides together.
 */
export const TASKBOARD_SKILL: RuntimeSkillFace = {
  name: TASKBOARD_SKILL_NAME,
  source: 'runtime',
  description:
    '操作本工作区的任务看板（任务看板面板的数据文件，存于 <工作区>/.dsh/taskboard/board.json）。' +
    '当用户要求更新任务、新增/移动/删除事项、调整里程碑或阶段、改看板排序，或提到任务看板、board.json 时使用。',
  content: `任务看板数据存于 <工作区>/.dsh/taskboard/board.json，单个 JSON 文档，无数据库，AI 可直接用文件工具读写。

结构（概念：epics=里程碑页签，columns=阶段，tasks=事项）：
- \`epics[]\`：\`{ id, name }\`。
- \`columns[]\`：\`{ id, name, color }\`，color 为 #rrggbb。
- \`tasks[]\`：\`{ id, epicId, columnId, title, createdAt }\`，epicId/columnId 必须引用已存在条目，createdAt 为 epoch ms。

操作规则：
- 数组顺序即展示顺序：\`columns\` 数组顺序 = 阶段列顺序；\`tasks\` 数组顺序 = 同一里程碑同一阶段内卡片顺序。排序/移动 = 调整数组位置；跨阶段移动改 \`columnId\`。
- 改前先重新读一次文件，改完整体写回；\`revision\` 必须在原值上 +1（面板靠它做并发防护，不递增会被面板的下一次保存覆盖）。
- 整个文件必须保持合法 JSON：写坏会让看板面板拒绝加载，且宿主拒绝一切保存。
- \`id\` 在各自集合内唯一，且匹配 \`[A-Za-z0-9][A-Za-z0-9_-]{0,63}\`，建议前缀 epic- / col- / task-。
- 容量上限：里程碑 100、阶段 24、事项 2000；name ≤200 字符，title 非空且 ≤500 字符。
- 删除阶段前先移走或删除该阶段内全部事项（保存路径会拒绝删除非空阶段）。
- 面板不轮询文件：直接改文件后，面板需重新加载才可见。`,
}

/** Outcome of one registration attempt (surfaced on the health route for diagnosis). */
export type SkillRegistrationOutcome =
  | { status: 'registered'; disposer?: () => void }
  | { status: 'service-missing' }
  | { status: 'failed'; error: string; stack?: string }

/**
 * Register the skill into the host skills service. Defensive by design: the
 * inject list guarantees the service at apply time, but a degraded registry
 * (missing register, throwing call) must never take the board routes down
 * with it — the outcome is reported instead.
 * @param skills - the skills service face (may be undefined).
 * @param warn - sink for registration failures (plugin logger).
 * @returns what happened, including the service disposer when registered.
 */
export function registerBoardSkill(
  skills: SkillsFace | undefined,
  warn: (message: string) => void,
): SkillRegistrationOutcome {
  const register = skills?.register
  if (typeof register !== 'function') return { status: 'service-missing' }
  try {
    const result: unknown = register(TASKBOARD_SKILL)
    return { status: 'registered', disposer: typeof result === 'function' ? (result as () => void) : undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack?.split('\n').slice(0, 6).join('\n') : undefined
    warn(`taskboard skill registration failed: ${message}`)
    return { status: 'failed', error: message, stack }
  }
}
