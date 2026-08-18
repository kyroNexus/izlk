'use client'

import { Paperclip } from 'lucide-react'
import Icon from '@/components/Icon'
import { formatBytes } from '@/lib/format'

/** Общая форма вложения для чата (C1) и комментариев этапа (C3) — оба
 *  отдают её в одном виде: id/имя/размер/признак изображения/ссылка на
 *  выдающий файл маршрут (у каждого свой, но контракт одинаковый). */
export type AttachmentSummary = { id: string; fileName: string; sizeBytes: number; isImage: boolean; url: string }

/** Изображение — превью-миниатюра, всё остальное — строка с иконкой,
 *  именем и размером. Не новая дропзона — просто рендер уже сохранённого
 *  вложения, ссылка ведёт на авторизованный маршрут скачивания/показа. */
export default function AttachmentPreview({ attachment, className = '' }: { attachment: AttachmentSummary; className?: string }) {
	if (attachment.isImage) {
		return (
			<a href={attachment.url} target="_blank" rel="noopener noreferrer" className={`block max-w-[220px] overflow-hidden rounded-tight border border-line-soft ${className}`}>
				<img src={attachment.url} alt={attachment.fileName} className="block max-h-[220px] w-full object-cover" />
			</a>
		)
	}
	return (
		<a href={attachment.url} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1.5 rounded-tight border border-line-soft bg-surface/60 px-2 py-1.5 text-2xs hover:border-brand/40 ${className}`}>
			<Icon icon={Paperclip} size={12} className="flex-none text-faint" />
			<span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
			<span className="flex-none tnum text-faint">{formatBytes(attachment.sizeBytes)}</span>
		</a>
	)
}
