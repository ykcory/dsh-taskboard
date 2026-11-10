/**
 * The board dialogs: 事项 (新建 + 编辑 share one form), 新建里程碑,
 * 添加阶段 and 重命名里程碑. All close on Escape, overlay clicks and the
 * close button; all share the design's modal metrics (440px card).
 */
import { type ReactElement } from 'react';
import type { BoardColumn } from '../../core/board.ts';
/**
 * 事项 dialog (新建 + 编辑 share one form): 事项标题 + 所属阶段
 * (color-dot dropdown). The heading, prefilled title and submit label
 * distinguish the two modes; the caller translates the submit into the right
 * controller mutation.
 */
export declare function TaskFormModal({ stages, initialStageId, initialTitle, heading, submitLabel, onCancel, onSubmit, }: {
    stages: BoardColumn[];
    initialStageId: string;
    initialTitle: string;
    heading: string;
    submitLabel: string;
    onCancel(): void;
    onSubmit(input: {
        columnId: string;
        title: string;
    }): void;
}): ReactElement;
/** 新建里程碑 dialog: 名称 only. */
export declare function CreateEpicModal({ onCancel, onCreate, }: {
    onCancel(): void;
    onCreate(name: string): void;
}): ReactElement;
/** 添加阶段 dialog: 阶段名称 + a random palette color picked on creation. */
export declare function CreateStageModal({ onCancel, onCreate, }: {
    onCancel(): void;
    onCreate(name: string): void;
}): ReactElement;
/** 重命名里程碑 dialog: 名称 prefilled with the current name. */
export declare function RenameEpicModal({ initialName, onCancel, onSubmit, }: {
    initialName: string;
    onCancel(): void;
    onSubmit(name: string): void;
}): ReactElement;
