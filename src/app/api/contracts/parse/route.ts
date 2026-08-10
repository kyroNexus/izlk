import { NextResponse } from 'next/server'
import { canWrite, getActiveUser } from '@/lib/access'
import { parseContractFile, parseContractFolder, MAX_FOLDER_FILES, MAX_FOLDER_TOTAL_BYTES, MAX_PARSE_BYTES } from '@/lib/contract-parser'
import { isSameOriginRequest } from '@/lib/request-security'
import { isTransientSystemFile } from '@/lib/document-classifier'
import { assertFileContentMatchesName } from '@/lib/storage'

export const runtime = 'nodejs'

function parserErrorMessage(error: unknown) {
	const message = error instanceof Error ? error.message : ''
	if (/json\.parse|unexpected end of (json )?data/i.test(message)) {
		return 'Один из файлов имеет повреждённую внутреннюю структуру. Он не помешает импорту: выберите папку ещё раз, а проблемный файл система приложит без распознавания.'
	}
	return message || 'Не удалось прочитать файл'
}

export async function POST(request: Request) {
	if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
	const user = await getActiveUser()
	if (!user || !canWrite(user)) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })

	try {
		const form = await request.formData()
		const file = form.get('file')
		const folderFiles = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0)
		const relativePaths = form.getAll('relativePaths').map(String)
		if (folderFiles.length) {
			if (folderFiles.length > MAX_FOLDER_FILES) return NextResponse.json({ error: `За один раз можно проверить до ${MAX_FOLDER_FILES} файлов в папке.` }, { status: 400 })
			const totalBytes = folderFiles.reduce((sum, item) => sum + item.size, 0)
			if (totalBytes > MAX_FOLDER_TOTAL_BYTES) return NextResponse.json({ error: 'Папка больше 750 МБ. Для такого архива используйте Inbox на сервере.' }, { status: 400 })
			const uploads = [] as Array<{ fileName: string; relativePath: string; buffer: Buffer }>
			const rejectedFiles: Array<{ fileName: string; reason: string }> = []
			for (const [index, item] of folderFiles.entries()) {
				const buffer = Buffer.from(await item.arrayBuffer())
				try { assertFileContentMatchesName(item.name, buffer) }
				catch {
					rejectedFiles.push({ fileName: relativePaths[index] || item.name, reason: 'расширение не соответствует содержимому — файл пропущен для безопасности' })
					continue
				}
				uploads.push({ fileName: item.name, relativePath: relativePaths[index] || item.name, buffer })
			}
			if (!uploads.length) return NextResponse.json({ error: 'Ни один файл в папке не прошёл проверку формата. Проверьте расширения исходных файлов.' }, { status: 400 })
			const result = await parseContractFolder(uploads)
			if (rejectedFiles.length) {
				result.folder.totalFiles += rejectedFiles.length
				result.folder.skippedFiles.push(...rejectedFiles)
				result.folder.warnings.push(`Подозрительных файлов пропущено: ${rejectedFiles.length}. Они не будут загружены.`)
				result.parsed.warnings.push(`Файлов с неверным расширением пропущено: ${rejectedFiles.length}.`)
			}
			return NextResponse.json(result)
		}
		if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Выберите файл' }, { status: 400 })
		if (isTransientSystemFile(file.name)) return NextResponse.json({ error: 'Служебный временный файл Office нельзя распознавать как договор.' }, { status: 400 })
		if (file.size > MAX_PARSE_BYTES) return NextResponse.json({ error: 'Для распознавания загрузите файл до 25 МБ' }, { status: 400 })
		const buffer = Buffer.from(await file.arrayBuffer())
		assertFileContentMatchesName(file.name, buffer)
		const result = await parseContractFile(file.name, buffer)
		return NextResponse.json(result)
	} catch (error) {
		return NextResponse.json({ error: parserErrorMessage(error) }, { status: 400 })
	}
}
