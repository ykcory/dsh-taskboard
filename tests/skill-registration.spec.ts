/**
 * The agent-facing runtime skill: official name grammar, trigger words in the
 * catalog summary, operational facts in the content, and defensive
 * registration into the host skills service.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  registerBoardSkill,
  TASKBOARD_SKILL,
  TASKBOARD_SKILL_NAME,
  type RuntimeSkillFace,
  type SkillsFace,
} from '../src/host/skill.ts'

/** The official skill name grammar (verified against @deepseek-ai/dsh-skill). */
const OFFICIAL_NAME_GRAMMAR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

describe('TASKBOARD_SKILL', () => {
  it('uses a name matching the official skill grammar', () => {
    expect(TASKBOARD_SKILL.name).toBe(TASKBOARD_SKILL_NAME)
    expect(TASKBOARD_SKILL.name).toMatch(OFFICIAL_NAME_GRAMMAR)
  })

  it('carries a non-empty description with discovery triggers', () => {
    expect(TASKBOARD_SKILL.description.length).toBeGreaterThan(0)
    expect(TASKBOARD_SKILL.description).toContain('board.json')
    expect(TASKBOARD_SKILL.description).toContain('任务看板')
    expect(TASKBOARD_SKILL.description).toContain('更新任务')
  })

  it('documents the board path, ordering model, and CAS revision rule', () => {
    const { content } = TASKBOARD_SKILL
    expect(content).toContain('.dsh/taskboard/board.json')
    expect(content).toContain('数组顺序即展示顺序')
    expect(content).toContain('revision')
    expect(content).toContain('[A-Za-z0-9][A-Za-z0-9_-]{0,63}')
  })

  it('keeps the field set to what validateRuntimeSkill accepts', () => {
    expect(Object.keys(TASKBOARD_SKILL).sort()).toEqual(['content', 'description', 'name'])
  })
})

describe('registerBoardSkill', () => {
  it('registers the skill and returns the service disposer', () => {
    const disposer = vi.fn()
    const register = vi.fn((skill: RuntimeSkillFace) => disposer)
    const skills: SkillsFace = { register }
    expect(registerBoardSkill(skills, () => {})).toBe(disposer)
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]?.[0]).toBe(TASKBOARD_SKILL)
  })

  it('returns undefined without calling anything when the service is absent', () => {
    expect(registerBoardSkill(undefined, () => {})).toBeUndefined()
    expect(registerBoardSkill({}, () => {})).toBeUndefined()
  })

  it('degrades to undefined with a warning when registration throws', () => {
    const warn = vi.fn()
    const skills: SkillsFace = { register: () => { throw new Error('registry closed') } }
    expect(registerBoardSkill(skills, warn)).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('registry closed')
  })

  it('tolerates a service that returns no disposer', () => {
    const skills: SkillsFace = { register: () => 'not-a-function' }
    expect(registerBoardSkill(skills, () => {})).toBeUndefined()
  })
})
