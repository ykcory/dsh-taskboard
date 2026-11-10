/**
 * taskboard surface copy: zh is the key source, en mirrors every key.
 * The dictionaries register under the `taskboard` locale namespace through
 * ctx.locale.register; module-level t() reads the active language at call
 * time so the sidebar row follows the Language setting without a reload.
 */
export declare const NS = "taskboard";
export declare const zh: {
    readonly 'entry.label': "任务看板";
    readonly 'guide.description': "按里程碑管理事项的阶段流转";
    readonly 'tab.add': "+";
    readonly 'action.addStage': "添加阶段";
    readonly 'action.newTask': "新建事项";
    readonly 'stage.empty': "此阶段暂无事项";
    readonly 'stage.delete': "删除阶段";
    readonly 'stage.notEmpty': "此阶段仍有事项，移走后再删除";
    readonly 'modal.task.title': "新建事项";
    readonly 'modal.task.editTitle': "编辑事项";
    readonly 'modal.task.fieldTitle': "事项标题";
    readonly 'modal.task.placeholderTitle': "输入事项标题";
    readonly 'modal.task.fieldStage': "所属阶段";
    readonly 'modal.stage.title': "添加阶段";
    readonly 'modal.stage.fieldName': "阶段名称";
    readonly 'modal.stage.placeholderName': "输入阶段名称";
    readonly 'modal.epic.title': "新建里程碑";
    readonly 'modal.epic.fieldName': "名称";
    readonly 'modal.epic.placeholderName': "输入里程碑名称";
    readonly 'epic.menu.rename': "重命名";
    readonly 'epic.menu.delete': "删除里程碑";
    readonly 'task.menu.edit': "编辑";
    readonly 'task.menu.delete': "删除";
    readonly 'epic.menu.deleteBlocked': "此里程碑仍有事项，移走后再删除";
    readonly 'epic.menu.lastBlocked': "至少保留一个里程碑";
    readonly 'common.cancel': "取消";
    readonly 'common.create': "创建";
    readonly 'common.save': "保存";
    readonly 'error.load': "看板加载失败";
    readonly 'error.conflict': "保存冲突，已重新加载";
    readonly 'error.save': "保存失败";
};
export type TaskboardKey = keyof typeof zh;
export declare const en: Record<TaskboardKey, string>;
/** Active dictionary, picked by the document language at call time. */
export declare function dictionary(): Record<TaskboardKey, string>;
type TranslateFn = (key: TaskboardKey, values?: Record<string, string | number>) => string;
/** Wire the SDK translate seat; pass undefined to restore the document-language pick. */
export declare function setRuntimeTranslate(t: TranslateFn | undefined): void;
/** Translate a key with optional {name} template params (current language). */
export declare function t(key: TaskboardKey, values?: Record<string, string | number>): string;
export {};
