'use client'

import { useRouter } from 'next/navigation'
import FileDropField, { type FileDropFieldResult } from '@/components/FileDropField'
import { DOCUMENT_EXTENSIONS } from '@/lib/upload-constants'

/**
 * Задача (2026-08-18): точечное поле загрузки по месту — для раздела
 * документов (версия задаётся state) или для конкретной строки ДС/счёта
 * (agreementId/invoiceId + жёсткий kind, та же связка, что раньше слала
 * только страница /contracts/[id]/upload через SmartDocumentUpload).
 * Можно нажать и выбрать файл, можно перетащить прямо на поле — обе
 * возможности уже есть в FileDropField, ничего нового не потребовалось,
 * только компактный вид (compact) вместо полноразмерной зоны.
 */
export default function InlineDocumentUpload({
	contractId,
	extraFields,
	maxFiles = 20,
}: {
	contractId: string
	extraFields: Record<string, string>
	maxFiles?: number
}) {
	const router = useRouter()

	function onDone(result: FileDropFieldResult) {
		if (result.uploadedCount > 0) router.refresh()
	}

	return (
		<FileDropField
			compact
			endpoint={`/api/contracts/${contractId}/documents`}
			accept={DOCUMENT_EXTENSIONS}
			maxFiles={maxFiles}
			extraFields={extraFields}
			uploadLabel="Загрузить"
			onDone={onDone}
		/>
	)
}
