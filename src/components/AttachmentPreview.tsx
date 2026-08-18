'use client'

import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import Icon from '@/components/Icon'
import { formatBytes } from '@/lib/format'
import RenameFileButton, { type FileEntityType } from '@/components/RenameFileButton'

/** Общая форма вложения для чата (C1) и комментариев этапа (C3) — оба
 *  отдают её в одном виде: id/имя/размер/признак изображения/ссылка на
 *  выдающий файл маршрут (у каждого свой, но контракт одинаковый). */
export type AttachmentSummary = { id: string; fileName: string; sizeBytes: number; isImage: boolean; url: string }

/** Изображение — превью-миниатюра, всё остальное — строка с иконкой,
 *  именем и размером. Не новая дропзона — просто рендер уже сохранённого
 *  вложения, ссылка ведёт на авторизованный маршрут скачивания/показа. */
function entityType(url: string): FileEntityType | null {
	if (url.includes('/api/chats/attachments/')) return 'chat-attachment'
	if (url.includes('/api/stage-comments/attachments/')) return 'stage-attachment'
	if (url.includes('/api/tasks/comment-attachments/')) return 'task-comment-attachment'
	if (url.includes('/api/tasks/attachments/')) return 'task-attachment'
	if (url.includes('/api/site-photos/')) return 'site-photo'
	if (url.includes('/api/documents/')) return 'document'
	return null
}

export default function AttachmentPreview({ attachment, className = '', canRename = false }: { attachment: AttachmentSummary; className?: string; canRename?: boolean }) {
	const [fileName, setFileName] = useState(attachment.fileName)
	const type = entityType(attachment.url)
	if (attachment.isImage) {
		return (
			<span className={`block max-w-[220px] rounded-tight border border-line-soft ${className}`}>
				<a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-t-[inherit]"><img src={attachment.url} alt={fileName} className="block max-h-[220px] w-full object-cover" /></a>
				<span className="flex items-center gap-1 px-2 py-1"><span className="min-w-0 flex-1 truncate text-2xs" title={fileName}>{fileName}</span>{canRename && type && <RenameFileButton type={type} id={attachment.id} fileName={fileName} onRenamed={setFileName} />}</span>
			</span>
		)
	}
	return (
		<span className={`flex items-center gap-1.5 rounded-tight border border-line-soft bg-surface/60 px-2 py-1.5 text-2xs hover:border-brand/40 ${className}`}>
			<a href={attachment.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5"><Icon icon={Paperclip} size={12} className="flex-none text-faint" /><span className="min-w-0 flex-1 truncate" title={fileName}>{fileName}</span><span className="flex-none tnum text-faint">{formatBytes(attachment.sizeBytes)}</span></a>
			{canRename && type && <RenameFileButton type={type} id={attachment.id} fileName={fileName} onRenamed={setFileName} />}
		</span>
	)
}
