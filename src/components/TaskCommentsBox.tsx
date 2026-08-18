'use client'

import { useState } from 'react'
import FileDropField, { type SelectedFile } from '@/components/FileDropField'
import AttachmentPreview, { type AttachmentSummary } from '@/components/AttachmentPreview'
import { textareaClass } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { DOCUMENT_EXTENSIONS } from '@/lib/upload-constants'

// Задача C4: та же скрепка, что и у чата/комментариев этапа.
const MAX_TASK_COMMENT_ATTACHMENTS = 5

export type TaskCommentItem = { id: string; text: string | null; authorName: string; createdAt: string; attachments: AttachmentSummary[] }

/**
 * Список и форма комментариев задачи — клиентский остров по тому же
 * поводу, что и TaskAttachmentsBox: карточка задачи серверная, а вложение
 * к комментарию отправляется через fetch (пробовали протащить File через
 * серверный action формы addComment — Next теряет содержимое файла при
 * такой отправке, приходит пустой Blob с именем "blob"; тот же способ,
 * что и у ChatPanel/StageCommentEditor, работает надёжно).
 */
export default function TaskCommentsBox({ taskId, initialComments, canEdit }: { taskId: string; initialComments: TaskCommentItem[]; canEdit: boolean }) {
	const [comments, setComments] = useState(initialComments)
	const [text, setText] = useState('')
	const [pendingFiles, setPendingFiles] = useState<SelectedFile[]>([])
	const [attachOpen, setAttachOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')
	const [resetKey, setResetKey] = useState(0)

	function onFilesChange(items: SelectedFile[]) {
		setPendingFiles(items.filter((item) => item.status === 'pending'))
	}

	async function save() {
		if ((!text.trim() && !pendingFiles.length) || saving) return
		setSaving(true)
		setError('')
		const body = new FormData()
		if (text.trim()) body.append('text', text.trim())
		for (const item of pendingFiles) body.append('files', item.file, item.file.name)
		const response = await fetch(`/api/tasks/${taskId}/comments`, { method: 'POST', body, headers: { Accept: 'application/json' } })
		const data = await response.json().catch(() => null)
		if (response.ok && data) {
			setComments((current) => [...current, data])
			setText('')
			setPendingFiles([])
			setAttachOpen(false)
			setResetKey((key) => key + 1)
		} else if (response.status === 429) {
			const retryAfter = Number(response.headers.get('Retry-After'))
			setError(retryAfter > 0 ? `Слишком много сообщений подряд — попробуйте через ${retryAfter} сек.` : 'Слишком много сообщений подряд, подождите немного.')
		} else {
			setError(data?.error || 'Не удалось сохранить комментарий.')
		}
		setSaving(false)
	}

	return (
		<>
			<div className="max-h-[430px] overflow-auto">
				{comments.length === 0 ? (
					<div className="p-[22px] text-center text-sm text-faint">Комментариев пока нет</div>
				) : (
					comments.map((comment) => (
						<div key={comment.id} className="border-b border-line-soft px-3.5 py-2.5">
							<div className="flex items-center justify-between gap-2">
								<b className="text-xs">{comment.authorName}</b>
								<span className="text-2xs text-faint">{formatDateTime(comment.createdAt)}</span>
							</div>
							{comment.text && <div className="mt-[5px] whitespace-pre-wrap text-sm leading-5">{comment.text}</div>}
							{comment.attachments.length > 0 && (
								<div className="mt-1.5 flex flex-wrap gap-1.5">
									{comment.attachments.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} canRename={canEdit} />)}
								</div>
							)}
						</div>
					))
				)}
			</div>
			<div className="border-t border-line p-3">
				{error && <p className="mb-1.5 rounded-tight border border-warn/25 bg-warn-bg px-2 py-1.5 text-xs text-warn">{error}</p>}
				<textarea
					value={text}
					onChange={(event) => setText(event.target.value)}
					maxLength={1000}
					placeholder="Написать комментарий… (или просто приложите файл)"
					className={`${textareaClass} min-h-[72px]`}
				/>
				<button
					type="button"
					onClick={() => setAttachOpen((open) => !open)}
					aria-pressed={attachOpen}
					className={`mt-1.5 text-2xs font-semibold ${attachOpen || pendingFiles.length ? 'text-brand-ink' : 'text-muted hover:text-brand-ink'}`}
				>
					📎 {pendingFiles.length ? `Приложено файлов: ${pendingFiles.length}` : 'Прикрепить файл'}
				</button>
				{attachOpen && (
					<div className="mt-1.5">
						<FileDropField
							key={resetKey}
							endpoint={`/api/tasks/${taskId}/comments`}
							accept={DOCUMENT_EXTENSIONS}
							maxFiles={MAX_TASK_COMMENT_ATTACHMENTS}
							hideUploadButton
							onFilesChange={onFilesChange}
						/>
					</div>
				)}
				<button
					type="button"
					onClick={() => void save()}
					disabled={saving || (!text.trim() && !pendingFiles.length)}
					className="brand-gradient mt-[7px] h-[34px] w-full rounded-tight text-xs font-semibold text-white disabled:opacity-50"
				>
					{saving ? 'Отправка…' : 'Добавить комментарий'}
				</button>
			</div>
		</>
	)
}
