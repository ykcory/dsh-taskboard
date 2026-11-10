import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
const root = new Context()
const reg = new SkillRegistry(root, {})
root.skills = reg

// 场景 1：在 root 的 effect 回调内注册（近似宿主 apply 时序）
root.effect(() => {
  try {
    root.skills.register({ name: 'taskboard', description: 'd', source: 'runtime', content: 'c' })
    console.log('场景1 root.effect 内注册: 成功')
  } catch (e) {
    console.log('场景1 复现:', e.message)
    console.log(e.stack.split('\n').slice(0, 6).join('\n'))
  }
})

// 场景 2：在 extend 出的行级子 ctx 的 effect 内注册（近似 loader 行 ctx）
const row = root.extend({ name: 'taskboard-row' })
row.effect(() => {
  try {
    root.skills.register({ name: 'taskboard2', description: 'd', source: 'runtime', content: 'c' })
    console.log('场景2 子ctx.effect 内注册: 成功')
  } catch (e) {
    console.log('场景2 复现:', e.message)
    console.log(e.stack.split('\n').slice(0, 6).join('\n'))
  }
})
