'use client'

import { useState } from 'react'
import FileDropField, { type SelectedFile } from '@/components/FileDropField'
import AttachmentPreview, { type AttachmentSummary } from '@/components/AttachmentPreview'
import { DOCUMENT_EXTENSIONS } from '@/lib/upload-constants'

// Задача C4: та же скрепка, что и у чата/комментариев этапа.
const MAX_TASK_ATTACHMENTS = 5

/**
 * Файлы, приложенные прямо к задаче (не к комментарию) — карточка задачи
 * серверная, поэтому сама загрузка вынесена в этот маленький клиентский
 * остров (тот же приём, что и у ChatPanel/StageCommentEditor): FileDropField
 * в режиме hideUploadButton только выбирает файлы, отправку делает fetch
 * на /api/tasks/[id]/attachments.
 */
export default function TaskAttachmentsBox({ taskId, initialAttachments, canEdit }: { taskId: string; initialAttachments: AttachmentSummary[]; canEdit: boolean }) {
	const [attachments, setAttachments] = useState(initialAttachments)
	const [pendingFiles, setPendingFiles] = useState<SelectedFile[]>([])
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')
	const [resetKey, setResetKey] = useState(0)

	function onFilesChange(items: SelectedFile[]) {
		setPendingFiles(items.filter((item) => item.status === 'pending'))
	}

	async function save() {
		if (!pendingFiles.length || saving) return
		setSaving(true)
		setError('')
		const body = new FormData()
		for (const item of pendingFiles) body.append('files', item.file, item.file.name)
		const response = await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body, headers: { Accept: 'application/json' } })
		const data = await response.json().catch(() => null)
		if (response.ok && data) {
			setAttachments((current) => [...current, ...data.attachments])
			setPendingFiles([])
			setResetKey((key) => key + 1)
		} else if (response.status === 429) {
			const retryAfter = Number(response.headers.get('Retry-After'))
			setError(retryAfter > 0 ? `Слишком много вложений подряд — попробуйте через ${retryAfter} сек.` : 'Слишком много вложений подряд, подождите немного.')
		} else {
			setError(data?.error || 'Не удалось сохранить вложение.')
		}
		setSaving(false)
	}

	if (!attachments.length && !canEdit) return null

	return (
		<div className="mt-[10px] border-t border-line pt-2.5">
			<div className="mb-1.5 text-xs font-bold text-muted">Вложения{attachments.length > 0 ? ` (${attachments.length})` : ''}</div>
			{attachments.length > 0 && (
				<div className="mb-2 flex flex-wrap gap-1.5">
					{attachments.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} canRename={canEdit} />)}
				</div>
			)}
			{canEdit && (
				<div className="flex flex-col gap-2">
					{error && <p className="rounded-tight border border-warn/25 bg-warn-bg px-2 py-1.5 text-xs text-warn">{error}</p>}
					<FileDropField
						key={resetKey}
						endpoint={`/api/tasks/${taskId}/attachments`}
						accept={DOCUMENT_EXTENSIONS}
						maxFiles={MAX_TASK_ATTACHMENTS}
						hideUploadButton
						onFilesChange={onFilesChange}
					/>
					{pendingFiles.length > 0 && (
						<button type="button" onClick={() => void save()} disabled={saving} className="h-control self-start rounded-tight border border-line bg-surface px-3.5 text-xs font-semibold transition hover:bg-raised disabled:opacity-50">
							{saving ? 'Отправка…' : `Прикрепить (${pendingFiles.length})`}
						</button>
					)}
				</div>
			)}
		</div>
	)
}
