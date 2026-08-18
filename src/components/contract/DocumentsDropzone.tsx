'use client'

import { useRouter } from 'next/navigation'
import FileDropField, { type FileDropFieldResult } from '@/components/FileDropField'
import { DOCUMENT_EXTENSIONS } from '@/lib/upload-constants'

/**
 * Задача C5: перетащить файл прямо на вкладку "Документы" — без перехода на
 * /contracts/[id]/upload. Экран /contracts/[id]/upload НЕ удаляется — он
 * остаётся для сложных случаев (подтверждение ПР1, конфиденциальность,
 * привязка к разделу исполнительной, к конкретному ДС/счёту) и как fallback
 * без JS: этот блок — клиентский остров (карточка договора серверная), без
 * гидратации его тут просто не будет, а обычная форма загрузки по ссылкам
 * ниже на вкладке всё ещё работает.
 *
 * Вид и версия документа не спрашиваются — сервер определяет их сам по
 * имени файла (тот же AUTO-путь, что и на /upload, когда там ничего не
 * переопределили явно). Кому нужно переопределить вид, ПР1 или доступ —
 * идёт на полную форму по ссылкам рядом ("+ Добавить", "Загрузить в эту
 * папку", "Загрузить ПР1").
 */
export default function DocumentsDropzone({ contractId }: { contractId: string }) {
	const router = useRouter()

	function onDone(result: FileDropFieldResult) {
		// Файлы уже на сервере — обновляем только серверные данные страницы,
		// чтобы новые документы появились в разделах ниже. Свои статусы
		// "Готово"/"Ошибка" на самих строках FileDropField не трогает.
		if (result.uploadedCount > 0) router.refresh()
	}

	return (
		<FileDropField
			endpoint={`/api/contracts/${contractId}/documents`}
			accept={DOCUMENT_EXTENSIONS}
			maxFiles={100}
			onDone={onDone}
			uploadLabel="Загрузить"
			hint="Вид и версию документа система определит сама по названию файла. Для ПР1, конфиденциальных файлов и привязки к разделу исполнительной — форма «Загрузка документа» по ссылкам ниже."
		/>
	)
}
