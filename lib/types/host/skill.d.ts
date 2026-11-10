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
    name: string;
    /** Catalog summary the agent sees without loading the skill; carries the trigger words. */
    description: string;
    /**
     * Origin bucket (`SkillSource`); official docs make it REQUIRED on a
     * registration (only `invocation`/`provider` are optional) and prompt-visible.
     */
    source: 'runtime';
    /** Full instructions handed to the agent when the skill is invoked. */
    content: string;
}
/** Structural face of the host skills service this plugin registers into. */
export interface SkillsFace {
    register?: (skill: RuntimeSkillFace) => unknown;
}
/** Stable skill name (official grammar, lowercase kebab). */
export declare const TASKBOARD_SKILL_NAME = "taskboard";
/**
 * The skill body. Facts mirror src/core/board.ts (validation limits, id
 * grammar, ordering model) and src/host/board-store.ts (CAS revision,
 * corrupt-JSON refusal) — update both sides together.
 */
export declare const TASKBOARD_SKILL: RuntimeSkillFace;
/** Outcome of one registration attempt (surfaced on the health route for diagnosis). */
export type SkillRegistrationOutcome = {
    status: 'registered';
    disposer?: () => void;
} | {
    status: 'service-missing';
} | {
    status: 'failed';
    error: string;
    stack?: string;
};
/**
 * Register the skill into the host skills service. Defensive by design: the
 * inject list guarantees the service at apply time, but a degraded registry
 * (missing register, throwing call) must never take the board routes down
 * with it — the outcome is reported instead.
 * @param skills - the skills service face (may be undefined).
 * @param warn - sink for registration failures (plugin logger).
 * @returns what happened, including the service disposer when registered.
 */
export declare function registerBoardSkill(skills: SkillsFace | undefined, warn: (message: string) => void): SkillRegistrationOutcome;
