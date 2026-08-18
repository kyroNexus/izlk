import { NextResponse } from 'next/server'
import type { DocumentKind, DocumentState } from '@prisma/client'
import { assertContractAccess, contractScope, type SessionUser } from '@/lib/access'
import { writeAudit, writeImportEvent } from '@/lib/audit'
import { classifyDocumentPath, documentStateForPath } from '@/lib/document-classifier'
import { DOCUMENT_KIND_ORDER } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { assertSafeDocumentUpload, MAX_UPLOAD_BYTES, saveContractFile, sha256Buffer } from '@/lib/storage'
import { orNull, parseDate } from '@/lib/validation'
import { confirmSignedPr1Workflow, trySyncWorkflowAfterDocumentUpload } from '@/lib/contract-workflow'
import { configuredPublicOrigin } from '@/lib/request-security'
import { withApiAuth } from '@/lib/api-auth'
import { createVersionedDocument } from '@/lib/document-versioning'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * Docker receives the request on port 3000, while users open the public site
 * on port 80. Next therefore sometimes exposes request.url as localhost.
 * Build redirects from the browser-facing Host/Referer instead of that
 * internal address.
 */
function publicOrigin(request: Request) {
	return configuredPublicOrigin(request)
}

function uploadUrl(request: Request, contractId: string, message: string, executiveId = '', agreementId = '', invoiceId = '') {
	const url = new URL(`/contracts/${contractId}/upload`, publicOrigin(request))
	if (executiveId) url.searchParams.set('executive', executiveId)
	if (agreementId) url.searchParams.set('agreement', agreementId)
	if (invoiceId) url.searchParams.set('invoice', invoiceId)
	url.searchParams.set('error', message)
	return url
}

/** FileDropField шлёт Accept: application/json — этому клиенту отвечаем JSON
 *  вместо редиректа на страницу с ?error=. Форма без JS редиректом и остаётся. */
function errorResponse(wantsJson: boolean, message: string, redirectTarget: URL, status = 400) {
	if (wantsJson) return NextResponse.json({ error: message }, { status })
	return NextResponse.redirect(redirectTarget, 303)
}

async function post(request: Request, { user, requestId }: { user: SessionUser; requestId: string }, { params }: { params: { id: string } }) {
	const contractId = params.id
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json')
	let executiveId = ''
	let agreementIdRaw = ''
	let invoiceIdRaw = ''
	try {
		const formData = await request.formData()
		executiveId = String(formData.get('executiveDocId') ?? '')
		agreementIdRaw = String(formData.get('agreementId') ?? '')
		invoiceIdRaw = String(formData.get('invoiceId') ?? '')
		const requestedProjectSectionId = String(formData.get('projectSectionId') ?? '')
		const projectSection = requestedProjectSectionId ? await prisma.projectSection.findFirst({ where: { id: requestedProjectSectionId, contractId, deletedAt: null, ...(user.role === 'DESIGNER' ? { responsibleId: user.id } : {}) }, select: { id: true, code: true } }) : null
		if (user.role === 'DESIGNER') {
			if (!projectSection) return errorResponse(wantsJson, 'Раздел проекта не найден или недоступен', new URL('/projects', publicOrigin(request)))
		} else if (user.role === 'BUILDER') {
			// Строитель загружает файлы (площадки/исполнительная/график проектирования) на любой
			// видимый ему договор — без общего canWrite, как и у DESIGNER выше.
			const buildable = await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null, ...contractScope(user) }, select: { id: true } })
			if (!buildable) return errorResponse(wantsJson, 'Договор не найден или недоступен', new URL('/contracts', publicOrigin(request)))
		} else if (user.role === 'ACCOUNTING') {
			// Задача C2: у бухгалтерии нет общего canWrite (как у DESIGNER/BUILDER
			// выше) — только узкий доступ приложить скан к КОНКРЕТНОМУ счёту,
			// который она явно указала, а не запись в договор вообще.
			const invoiceCheck = invoiceIdRaw ? await prisma.invoice.findFirst({ where: { id: invoiceIdRaw, contractId, deletedAt: null }, select: { id: true } }) : null
			if (!invoiceCheck) return errorResponse(wantsJson, 'Счёт не найден или недоступен', new URL('/contracts', publicOrigin(request)))
		} else {
			await assertContractAccess(contractId, user, { write: true })
		}

		const uploads: File[] = []
		for (const item of formData.getAll('files')) {
			if (item instanceof File && item.size > 0) uploads.push(item)
		}
		if (uploads.length === 0) return errorResponse(wantsJson, 'Выберите хотя бы один файл', uploadUrl(request, contractId, 'Выберите хотя бы один файл', executiveId, agreementIdRaw, invoiceIdRaw))
		if (uploads.length > 100) return errorResponse(wantsJson, 'За один раз можно загрузить не больше 100 файлов', uploadUrl(request, contractId, 'За один раз можно загрузить не больше 100 файлов', executiveId, agreementIdRaw, invoiceIdRaw))
		const confirmPr1Signed = user.role !== 'DESIGNER' && user.role !== 'BUILDER' && user.role !== 'ACCOUNTING' && formData.get('confirmPr1Signed') === 'on'
		// kind/state из формы — это ПЕРЕОПРЕДЕЛЕНИЕ на всю пачку, а не значение по
		// умолчанию: явный выбор (не AUTO) побеждает для всех файлов, как и раньше.
		// Если поле осталось на AUTO (новое значение по умолчанию в форме) — вид и
		// версия каждого файла определяются classifyDocumentPath/documentStateForPath
		// по имени файла отдельно для каждого файла в цикле ниже.
		const kindRaw = String(formData.get('kind') ?? 'AUTO')
		const selectedKind: DocumentKind = (DOCUMENT_KIND_ORDER as readonly string[]).includes(kindRaw) ? kindRaw as DocumentKind : 'OTHER'
		const isAutoKind = !(DOCUMENT_KIND_ORDER as readonly string[]).includes(kindRaw)
		// Задача B2: с JS клиент уже посчитал вид каждого файла (тем же изоморфным
		// классификатором) и прислал его явно — сервер просто проверяет, что это
		// валидный DocumentKind, а не пересчитывает классификатор заново. Без JS
		// (обычная форма) это поле пустое — тогда работает сервер-side автоопределение
		// из задачи B1, ниже в цикле.
		const kindsRaw = formData.getAll('kinds').map((value) => String(value))
		const signedAtRaw = user.role === 'DESIGNER' ? null : orNull(String(formData.get('signedAt') ?? ''))
		const signedAt = signedAtRaw ? parseDate(signedAtRaw) : confirmPr1Signed ? new Date() : null
		const workingDaysRaw = String(formData.get('workingDays') ?? '').trim()
		const workingDays = workingDaysRaw ? Number.parseInt(workingDaysRaw, 10) : null
		if (confirmPr1Signed && workingDaysRaw && (!Number.isInteger(workingDays) || workingDays! < 1 || workingDays! > 730)) {
			return errorResponse(wantsJson, 'Укажите срок от 1 до 730 рабочих дней', uploadUrl(request, contractId, 'Укажите срок от 1 до 730 рабочих дней', executiveId, agreementIdRaw, invoiceIdRaw))
		}
		const stateRaw = String(formData.get('state') ?? 'AUTO')
		const isAutoState = !['SOURCE', 'SIGNED', 'ARCHIVE'].includes(stateRaw)
		const isConfidential = user.role !== 'DESIGNER' && formData.get('isConfidential') === 'on'
		const executiveDoc = executiveId ? await prisma.executiveDoc.findFirst({ where: { id: executiveId, contractId, deletedAt: null }, select: { id: true } }) : null
		const executiveDocId = executiveDoc?.id ?? null
		// Задача C2: скан к доп. соглашению/счёту — та же логика, что у
		// executiveDocId выше: id проверяется против ЭТОГО договора, а не
		// берётся из формы как есть.
		const agreement = agreementIdRaw ? await prisma.agreement.findFirst({ where: { id: agreementIdRaw, contractId, deletedAt: null }, select: { id: true } }) : null
		const agreementId = agreement?.id ?? null
		const invoice = invoiceIdRaw ? await prisma.invoice.findFirst({ where: { id: invoiceIdRaw, contractId, deletedAt: null }, select: { id: true } }) : null
		const invoiceId = invoice?.id ?? null

		let uploadedCount = 0
		let skippedCount = 0
		let failedCount = 0
		// Задача A3: то же самое, что уже шло в журнал импорта построчно,
		// теперь собирается и для ответа клиенту — вместо одной склеенной строки
		// на всю пачку каждый файл в FileDropField получает свой точный статус.
		const perFile: Array<{ fileName: string; status: 'SUCCESS' | 'IGNORED' | 'FAILED'; message: string; documentId?: string }> = []
		// Раньше kind/state были одним значением на всю пачку — теперь workflow-синк
		// (ниже) должен смотреть на них по факту загруженных файлов: если среди
		// смешанной автоопределённой пачки оказался договор — берём его состояние;
		// SIGNED важнее SOURCE, если договорных файлов оказалось несколько.
		let contractUploadState: DocumentState | null = null
		for (const [index, upload] of uploads.entries()) {
			let savedPath: string | null = null
			try {
				if (upload.size > MAX_UPLOAD_BYTES) throw new Error(`Файл больше допустимых ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`)
				assertSafeDocumentUpload(upload.name)
				// Приоритет (высокий → низкий): DESIGNER и подтверждение ПР1 — это не
				// догадки, а обязывающий выбор пользователя/роли, побеждают всегда.
				// Явный выбор из селекта на всю пачку (не AUTO) — вторым приоритетом.
				// Дальше — вид, который прислал клиент для конкретно этого файла
				// (kinds[i], задача B2: уже посчитан классификатором в браузере, тут
				// только проверяется валидность enum). Если и его нет (форма без JS) —
				// сервер сам классифицирует по имени (задача B1).
				const sentKind = kindsRaw[index]
				const validSentKind: DocumentKind | null = sentKind && (DOCUMENT_KIND_ORDER as readonly string[]).includes(sentKind) ? sentKind as DocumentKind : null
				const kind: DocumentKind = user.role === 'DESIGNER'
					? (selectedKind === 'PROJECT_DWG' ? 'PROJECT_DWG' : 'PROJECT_PDF')
					: confirmPr1Signed
					? 'APPENDIX'
					: !isAutoKind
					? selectedKind
					: validSentKind ?? classifyDocumentPath(upload.name)
				const state: DocumentState = user.role === 'DESIGNER'
					? 'SOURCE'
					: confirmPr1Signed || signedAt
					? 'SIGNED'
					: isAutoState
					? documentStateForPath(upload.name)
					: (stateRaw as DocumentState)
				const buffer = Buffer.from(await upload.arrayBuffer())
				const digest = sha256Buffer(buffer)
				if (await prisma.document.findFirst({ where: { contractId, sha256: digest }, select: { id: true } })) {
					skippedCount += 1
					const message = 'Точная копия уже есть в системе.'
					perFile.push({ fileName: upload.name, status: 'IGNORED', message })
					await writeImportEvent({ fileName: upload.name, event: 'MANUAL_IMPORTED', outcome: 'IGNORED', contractId, actorId: user.id, message })
					continue
				}
				const saved = await saveContractFile({ contractId, fileName: upload.name, buffer })
				savedPath = saved.storagePath
				const document = await createVersionedDocument({ contractId, kind, state, fileName: upload.name, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256, signedAt, isConfidential, executiveDocId, agreementId, invoiceId, projectSectionId: projectSection?.id ?? null, uploadedById: user.id })
				await writeAudit({ userId: user.id, action: 'UPLOAD', entityType: 'Document', entityId: document.id })
				if (kind === 'CONTRACT') contractUploadState = contractUploadState === 'SIGNED' ? contractUploadState : state
				const message = `Загружен как ${kind}.`
				await writeImportEvent({ fileName: upload.name, event: 'MANUAL_IMPORTED', outcome: 'SUCCESS', contractId, actorId: user.id, message })
				perFile.push({ fileName: upload.name, status: 'SUCCESS', message, documentId: document.id })
				uploadedCount += 1
			} catch (error) {
				failedCount += 1
				// Исходник нельзя удалять автоматически: даже если запись в БД не
				// создалась, файл остаётся на сервере для ручной проверки и повторного
				// импорта. Путь сохраняется в журнале импорта вместе с причиной ошибки.
				if (savedPath) logger.warn('contract_document.unlinked_upload', { requestId, route: '/api/contracts/[id]/documents', method: 'POST', userId: user.id, entityType: 'Contract', entityId: contractId })
				const message = error instanceof Error ? error.message : 'Непредвиденная ошибка обработки файла.'
				await writeImportEvent({ fileName: upload.name, event: 'MANUAL_IMPORTED', outcome: 'FAILED', contractId, actorId: user.id, message })
				perFile.push({ fileName: upload.name, status: 'FAILED', message })
			}
		}

		const workflow = confirmPr1Signed ? await confirmSignedPr1Workflow({ contractId, actorId: user.id, signedAt: signedAt ?? new Date(), workingDays }) : null
		const automaticStage = !workflow && contractUploadState ? (await trySyncWorkflowAfterDocumentUpload({ contractId, actorId: user.id, kind: 'CONTRACT', state: contractUploadState })).result : null
		if (projectSection && uploadedCount > 0) await prisma.projectSection.update({ where: { id: projectSection.id }, data: { queueStatus: 'IN_PROGRESS', dateFrom: new Date() } })
		const destination = new URL(projectSection ? `/projects?section=${projectSection.code}` : executiveDocId ? `/executive/${contractId}` : agreementId || invoiceId ? `/contracts/${contractId}#agreements` : `/contracts/${contractId}`, publicOrigin(request))
		const workflowText = workflow ? ` ПР1 подтверждён: площадка ${workflow.siteCreated ? 'создана' : 'уже существовала'}, разделов добавлено: ${workflow.sectionsCreated}, задач создано: ${workflow.tasksCreated}${workflow.responsibleName ? `, ответственный: ${workflow.responsibleName}` : ''}.` : automaticStage?.changed ? ' Этап договора обновлён автоматически.' : ''
		// "Загружено файлов: 0" на своём читается как сбой, даже когда дубликат
		// корректно не создался повторно — назвать причину явно, без домыслов.
		const summaryText = uploadedCount === 0 && skippedCount > 0 && failedCount === 0
			? `Файл${skippedCount > 1 ? 'ы' : ''} уже есть в системе — точная копия, повторно не загружен${skippedCount > 1 ? 'ы' : ''}.`
			: `Загружено файлов: ${uploadedCount}${skippedCount ? `. Пропущено копий: ${skippedCount}` : ''}${failedCount ? `. Ошибок: ${failedCount}; причины есть в журнале импорта` : ''}.`
		destination.searchParams.set('success', `${summaryText}${workflowText}`)

		if (wantsJson) {
			// redirectUrl — тот же адрес, куда ушла бы обычная форма (карточка
			// договора / очередь проекта / снова эта форма с ?error=). FileDropField
			// сам решения не принимает — экран сам решит, переходить ли по нему.
			return NextResponse.json({
				uploaded: uploadedCount,
				skipped: skippedCount,
				failed: failedCount,
				perFile,
				workflow: workflow
					? { pr1Confirmed: true, siteCreated: workflow.siteCreated, sectionsCreated: workflow.sectionsCreated, tasksCreated: workflow.tasksCreated, responsibleName: workflow.responsibleName }
					: automaticStage?.changed ? { stageChanged: true } : null,
				redirectUrl: destination.toString(),
			})
		}
		return NextResponse.redirect(destination, 303)
	} catch (error) {
		logger.error('contract_document.upload_failed', { requestId, route: '/api/contracts/[id]/documents', method: 'POST', userId: user.id, entityType: 'Contract', entityId: contractId, error })
		return errorResponse(wantsJson, 'Не удалось загрузить файлы. Повторите попытку.', uploadUrl(request, contractId, 'Не удалось загрузить файлы. Повторите попытку.', executiveId, agreementIdRaw, invoiceIdRaw), 500)
	}
}

// Найденный попутно баг: access:'write' на внешнем шлюзе требует canWrite()
// (ADMIN/MANAGER) ДО того, как выполнится хоть одна строка post() — а внутри
// него уже была своя, более тонкая проверка по ролям (DESIGNER — свой раздел
// проекта, BUILDER — видимый ему договор, теперь ACCOUNTING — свой счёт).
// Оба непривилегированных сценария были мертвы: любой DESIGNER/BUILDER
// получал 403 "Insufficient permissions" на внешнем шлюзе, так и не дойдя до
// кода, который их обрабатывает. access:'authenticated' здесь не ослабляет
// защиту — post() сам решает, кому можно, ровно как и был задуман.
export const POST = withApiAuth(post, { access: 'authenticated', csrf: true })
