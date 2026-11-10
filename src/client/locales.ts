/**
 * taskboard surface copy: zh is the key source, en mirrors every key.
 * The dictionaries register under the `taskboard` locale namespace through
 * ctx.locale.register; module-level t() reads the active language at call
 * time so the sidebar row follows the Language setting without a reload.
 */

export const NS = 'taskboard'

export const zh = {
  'entry.label': '任务看板',
  'guide.description': '按里程碑管理事项的阶段流转',
  'tab.add': '+',
  'action.addStage': '添加阶段',
  'action.newTask': '新建事项',
  'stage.empty': '此阶段暂无事项',
  'stage.delete': '删除阶段',
  'stage.notEmpty': '此阶段仍有事项，移走后再删除',
  'modal.task.title': '新建事项',
  'modal.task.editTitle': '编辑事项',
  'modal.task.fieldTitle': '事项标题',
  'modal.task.placeholderTitle': '输入事项标题',
  'modal.task.fieldStage': '所属阶段',
  'modal.stage.title': '添加阶段',
  'modal.stage.fieldName': '阶段名称',
  'modal.stage.placeholderName': '输入阶段名称',
  'modal.epic.title': '新建里程碑',
  'modal.epic.fieldName': '名称',
  'modal.epic.placeholderName': '输入里程碑名称',
  'epic.menu.rename': '重命名',
  'epic.menu.delete': '删除里程碑',
  'task.menu.edit': '编辑',
  'task.menu.delete': '删除',
  'epic.menu.deleteBlocked': '此里程碑仍有事项，移走后再删除',
  'epic.menu.lastBlocked': '至少保留一个里程碑',
  'common.cancel': '取消',
  'common.create': '创建',
  'common.save': '保存',
  'error.load': '看板加载失败',
  'error.conflict': '保存冲突，已重新加载',
  'error.save': '保存失败',
} as const

export type TaskboardKey = keyof typeof zh

export const en: Record<TaskboardKey, string> = {
  'entry.label': 'Taskboard',
  'guide.description': 'Track items across stages by milestone',
  'tab.add': '+',
  'action.addStage': 'Add stage',
  'action.newTask': 'New task',
  'stage.empty': 'No tasks in this stage',
  'stage.delete': 'Delete stage',
  'stage.notEmpty': 'This stage still has tasks; move them out first',
  'modal.task.title': 'New task',
  'modal.task.editTitle': 'Edit task',
  'modal.task.fieldTitle': 'Task title',
  'modal.task.placeholderTitle': 'Enter a task title',
  'modal.task.fieldStage': 'Stage',
  'modal.stage.title': 'Add stage',
  'modal.stage.fieldName': 'Stage name',
  'modal.stage.placeholderName': 'Enter a stage name',
  'modal.epic.title': 'New milestone',
  'modal.epic.fieldName': 'Name',
  'modal.epic.placeholderName': 'Enter a milestone name',
  'epic.menu.rename': 'Rename',
  'epic.menu.delete': 'Delete milestone',
  'task.menu.edit': 'Edit',
  'task.menu.delete': 'Delete',
  'epic.menu.deleteBlocked': 'This milestone still has tasks; move them out first',
  'epic.menu.lastBlocked': 'Keep at least one milestone',
  'common.cancel': 'Cancel',
  'common.create': 'Create',
  'common.save': 'Save',
  'error.load': 'Failed to load the board',
  'error.conflict': 'Save conflict; the board was reloaded',
  'error.save': 'Failed to save',
}

/** Active dictionary, picked by the document language at call time. */
export function dictionary(): Record<TaskboardKey, string> {
  let language = 'en'
  try {
    language = document.documentElement.lang || 'en'
  } catch {
    language = 'en'
  }
  return language.toLowerCase().startsWith('zh') ? (zh as unknown as Record<TaskboardKey, string>) : en
}

type TranslateFn = (key: TaskboardKey, values?: Record<string, string | number>) => string

let runtimeTranslate: TranslateFn | undefined

/** Wire the SDK translate seat; pass undefined to restore the document-language pick. */
export function setRuntimeTranslate(t: TranslateFn | undefined): void {
  runtimeTranslate = t
}

/** Translate a key with optional {name} template params (current language). */
export function t(key: TaskboardKey, values?: Record<string, string | number>): string {
  if (runtimeTranslate !== undefined) {
    try {
      return runtimeTranslate(key, values)
    } catch {
      // fall through to the dictionary pick
    }
  }
  const text = dictionary()[key] ?? key
  if (values === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
}
