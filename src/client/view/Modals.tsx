/**
 * The board dialogs: 事项 (新建 + 编辑 share one form), 新建里程碑,
 * 添加阶段 and 重命名里程碑. All close on Escape, overlay clicks and the
 * close button; all share the design's modal metrics (440px card).
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { BoardColumn } from '../../core/board.ts'
import { t } from '../locales.ts'
import { ChevronIcon, ChipDroplet } from './icons.tsx'

/** Modal shell shared by both dialogs (overlay, card, close button). */
function ModalShell({
  title,
  onCancel,
  children,
  footer,
}: {
  title: string
  onCancel(): void
  children: React.ReactNode
  footer: React.ReactNode
}): ReactElement {
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('keydown', onKeydown)
    }
  }, [onCancel])

  return (
    <div
      className="absolute inset-0 z-[10] flex items-center justify-center bg-[rgba(15,17,20,0.4)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      data-dsh-part="overlay"
    >
      <div className="w-[440px] rounded-[14px] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)]" data-dsh-part="modal">
        <div className="flex items-center justify-between px-[20px] pb-[14px] pt-[18px]">
          <div className="text-[15px] font-semibold text-[#1e2126]">{title}</div>
          <button
            type="button"
            className="cursor-pointer text-[16px] leading-none text-[#9aa0a8] hover:text-[#4a4d52]"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-[14px] px-[20px] pb-[6px] pt-[2px]">{children}</div>
        <div className="flex justify-end gap-[10px] px-[20px] pb-[20px] pt-[14px]">{footer}</div>
      </div>
    </div>
  )
}

/** Cancel / primary footer pair; the submit label comes from the caller. */
function ModalFooter({
  canSubmit,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  canSubmit: boolean
  submitLabel: string
  onSubmit(): void
  onCancel(): void
}): ReactElement {
  return (
    <>
      <button
        type="button"
        className="cursor-pointer rounded-[8px] bg-[#f2f3f5] px-[16px] py-[9px] text-[13px] font-medium text-[#3a3d42] hover:opacity-80"
        onClick={onCancel}
      >
        {t('common.cancel')}
      </button>
      <button
        type="button"
        className={
          canSubmit
            ? 'cursor-pointer rounded-[8px] bg-[#1c1e21] px-[16px] py-[9px] text-[13px] font-medium text-white hover:opacity-90'
            : 'cursor-default rounded-[8px] bg-[#1c1e21] px-[16px] py-[9px] text-[13px] font-medium text-white opacity-40'
        }
        onClick={() => {
          if (canSubmit) onSubmit()
        }}
      >
        {submitLabel}
      </button>
    </>
  )
}

/**
 * 事项 dialog (新建 + 编辑 share one form): 事项标题 + 所属阶段
 * (color-dot dropdown). The heading, prefilled title and submit label
 * distinguish the two modes; the caller translates the submit into the right
 * controller mutation.
 */
export function TaskFormModal({
  stages,
  initialStageId,
  initialTitle,
  heading,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  stages: BoardColumn[]
  initialStageId: string
  initialTitle: string
  heading: string
  submitLabel: string
  onCancel(): void
  onSubmit(input: { columnId: string; title: string }): void
}): ReactElement {
  const [title, setTitle] = useState(initialTitle)
  const [stageId, setStageId] = useState(initialStageId)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const selected = stages.find((stage) => stage.id === stageId) ?? stages[0]
  const canSubmit = title.trim() !== ''

  const submit = (): void => {
    if (!canSubmit) return
    onSubmit({ columnId: stageId, title: title.trim() })
  }

  return (
    <ModalShell
      title={heading}
      onCancel={onCancel}
      footer={
        <ModalFooter
          canSubmit={canSubmit}
          submitLabel={submitLabel}
          onSubmit={submit}
          onCancel={onCancel}
        />
      }
    >
      <div className="flex flex-col gap-[8px]">
        <label className="text-[13px] text-[#4a4d52]" htmlFor="taskboard-task-title">
          {t('modal.task.fieldTitle')}
        </label>
        <input
          id="taskboard-task-title"
          ref={inputRef}
          className="h-[40px] rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] outline-none placeholder:text-[#b3b8bf] focus:border-black/40"
          value={title}
          placeholder={t('modal.task.placeholderTitle')}
          onChange={(event) => {
            setTitle(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
      </div>
      <div className="flex flex-col gap-[8px]">
        <div className="text-[13px] text-[#4a4d52]">{t('modal.task.fieldStage')}</div>
        <div className="relative">
          <button
            type="button"
            className="flex h-[40px] w-full cursor-pointer items-center justify-between rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] hover:border-black/30"
            onClick={() => {
              setDropdownOpen((open) => !open)
            }}
          >
            <span className="flex items-center gap-[8px]">
              <span
                className="flex h-[20px] w-[20px] items-center justify-center rounded-full"
                style={{ background: selected?.color ?? '#7d8b99' }}
              >
                <ChipDroplet />
              </span>
              <span>{selected?.name ?? ''}</span>
            </span>
            <ChevronIcon />
          </button>
          {dropdownOpen ? (
            <div className="absolute left-0 right-0 top-[44px] z-[11] flex flex-col rounded-[10px] bg-white px-[6px] py-[6px] shadow-[0_8px_24px_rgba(0,0,0,0.15)]">
              {stages.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  className="flex cursor-pointer items-center gap-[8px] rounded-[8px] px-[6px] py-[8px] text-left text-[13px] text-[#33363b] hover:bg-[#f2f3f5]"
                  onClick={() => {
                    setStageId(stage.id)
                    setDropdownOpen(false)
                  }}
                >
                  <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full" style={{ background: stage.color }} />
                  <span className="truncate">{stage.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </ModalShell>
  )
}

/** 新建里程碑 dialog: 名称 only. */
export function CreateEpicModal({
  onCancel,
  onCreate,
}: {
  onCancel(): void
  onCreate(name: string): void
}): ReactElement {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const canCreate = name.trim() !== ''
  return (
    <ModalShell
      title={t('modal.epic.title')}
      onCancel={onCancel}
      footer={
        <ModalFooter
          canSubmit={canCreate}
          submitLabel={t('common.create')}
          onSubmit={() => {
            if (canCreate) onCreate(name.trim())
          }}
          onCancel={onCancel}
        />
      }
    >
      <div className="flex flex-col gap-[8px]">
        <label className="text-[13px] text-[#4a4d52]" htmlFor="taskboard-epic-name">
          {t('modal.epic.fieldName')}
        </label>
        <input
          id="taskboard-epic-name"
          ref={inputRef}
          className="h-[40px] rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] outline-none placeholder:text-[#b3b8bf] focus:border-black/40"
          value={name}
          placeholder={t('modal.epic.placeholderName')}
          onChange={(event) => {
            setName(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canCreate) onCreate(name.trim())
          }}
        />
      </div>
    </ModalShell>
  )
}

/** 添加阶段 dialog: 阶段名称 + a random palette color picked on creation. */
export function CreateStageModal({
  onCancel,
  onCreate,
}: {
  onCancel(): void
  onCreate(name: string): void
}): ReactElement {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const canCreate = name.trim() !== ''
  return (
    <ModalShell
      title={t('modal.stage.title')}
      onCancel={onCancel}
      footer={
        <ModalFooter
          canSubmit={canCreate}
          submitLabel={t('common.create')}
          onSubmit={() => {
            if (canCreate) onCreate(name.trim())
          }}
          onCancel={onCancel}
        />
      }
    >
      <div className="flex flex-col gap-[8px]">
        <label className="text-[13px] text-[#4a4d52]" htmlFor="taskboard-stage-name">
          {t('modal.stage.fieldName')}
        </label>
        <input
          id="taskboard-stage-name"
          ref={inputRef}
          className="h-[40px] rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] outline-none placeholder:text-[#b3b8bf] focus:border-black/40"
          value={name}
          placeholder={t('modal.stage.placeholderName')}
          onChange={(event) => {
            setName(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canCreate) onCreate(name.trim())
          }}
        />
      </div>
    </ModalShell>
  )
}

/** 重命名里程碑 dialog: 名称 prefilled with the current name. */
export function RenameEpicModal({
  initialName,
  onCancel,
  onSubmit,
}: {
  initialName: string
  onCancel(): void
  onSubmit(name: string): void
}): ReactElement {
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const canSubmit = name.trim() !== '' && name.trim() !== initialName
  return (
    <ModalShell
      title={t('epic.menu.rename')}
      onCancel={onCancel}
      footer={
        <ModalFooter
          canSubmit={canSubmit}
          submitLabel={t('common.create')}
          onSubmit={() => {
            if (canSubmit) onSubmit(name.trim())
          }}
          onCancel={onCancel}
        />
      }
    >
      <div className="flex flex-col gap-[8px]">
        <label className="text-[13px] text-[#4a4d52]" htmlFor="taskboard-epic-rename">
          {t('modal.epic.fieldName')}
        </label>
        <input
          id="taskboard-epic-rename"
          ref={inputRef}
          className="h-[40px] rounded-[8px] border border-[#e3e5e8] px-[12px] text-[13px] text-[#33363b] outline-none placeholder:text-[#b3b8bf] focus:border-black/40"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) onSubmit(name.trim())
          }}
        />
      </div>
    </ModalShell>
  )
}
