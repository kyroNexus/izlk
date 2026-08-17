import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { MAX_PARSE_BYTES } from '@/lib/contract-parser'
import { parseEstimateWorkbook } from '@/lib/estimate-parser'
import { assertFileContentMatchesName } from '@/lib/storage'

export const runtime = 'nodejs'

/**
 * Задача B3: превью сметы до создания договора/ПР1 — тот же разбор
 * (parseEstimateWorkbook), что уже применяется при ручном создании сметы
 * на /contracts/[id]/estimates/new, но здесь только читает файл и ничего
 * не сохраняет и не создаёт. Вызывается из SmartDocumentUpload, когда среди
 * выбранных файлов классификатор находит смету, — чтобы срок в рабочих
 * днях подставился в поле ПР1 сам, без отдельного шага "создать смету".
 */
async function post(request: Request) {
	try {
		const form = await request.formData()
		const file = form.get('file')
		if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Файл сметы не передан' }, { status: 400 })
		if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return NextResponse.json({ error: 'Для разбора нужен Excel-файл: XLSX, XLS или CSV' }, { status: 400 })
		if (file.size > MAX_PARSE_BYTES) return NextResponse.json({ error: 'Для превью загрузите файл до 25 МБ' }, { status: 400 })
		const buffer = Buffer.from(await file.arrayBuffer())
		assertFileContentMatchesName(file.name, buffer)
		const result = parseEstimateWorkbook(buffer)
		return NextResponse.json(result)
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось прочитать смету' }, { status: 400 })
	}
}

export const POST = withApiAuth(post, { access: 'write', csrf: true, rateLimit: 'estimate-preview' })
