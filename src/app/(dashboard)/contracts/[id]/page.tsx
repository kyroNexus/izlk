import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { canManageInvoices, canSeeAmounts as canSeeAmountsFor, canWrite, contractScope, isAdmin, requireUser } from '@/lib/access'
import Topbar from '@/components/Topbar'
import ContractSectionNav from '@/components/ContractSectionNav'
import type { ContractHierarchyNode } from '@/components/ContractHierarchy'
import ChatPanel from '@/components/ChatPanel'
import CopyValue, { CopyContractorDetails } from '@/components/CopyValue'
import { Card, CardHeader, EmptyState, ProgressBar } from '@/components/ui'
import {
	DOCUMENT_KIND_LABELS,
	DOCUMENT_KIND_ORDER,
	formatDate,
	formatMoney,
	initials,
	plural,
} from '@/lib/format'
import type { ContractWorkflowStage, DocumentKind, DocumentState, SectionCode } from '@prisma/client'
import { writeAudit } from '@/lib/audit'
import { addMissingProjectSection, confirmSignedPr1Workflow, getNextWorkflowStages, revokePr1Confirmation, sectionsForKind, transitionContractStage, WORKFLOW_STAGE_LABEL, WORKFLOW_STAGE_ORDER } from '@/lib/contract-workflow'
import { getDeadlineInfo } from '@/lib/deadline'
import { logger } from '@/lib/logger'
import { agreementTitle, CONTRACT_INCLUDE, estimateTitle, PROJECT_SECTION_LABEL, SITE_STATUS } from '@/components/contract/shared'
import ContractHero from '@/components/contract/ContractHero'
import TabWorkflow from '@/components/contract/TabWorkflow'
import TabAgreements from '@/components/contract/TabAgreements'
import TabDocuments from '@/components/contract/TabDocuments'
import TabHistory from '@/components/contract/TabHistory'
import TabSite from '@/components/contract/TabSite'
import TabProject from '@/components/contract/TabProject'
import TabTasks from '@/components/contract/TabTasks'
import TabExecutive from '@/components/contract/TabExecutive'
import { hasToken } from '@/lib/document-classifier'

// Страница набита мутирующими server actions (удаление/архив документа,
// перевод этапа, комментарии и т.д.), каждый редиректит сам на себя —
// без force-dynamic Next.js может отдать закэшированный RSC-payload этого
// же адреса, и правка в базе происходит, а на экране как будто ничего не
// изменилось. Тот же приём уже стоит на upload/inbox/edit и других
// страницах с похожими action — тут его просто не хватало.
export const dynamic = 'force-dynamic'

// Порядок разделов — по приоритету из рабочих заметок: подписанные заказчиком
// версии юридически значимее черновиков, поэтому идут первыми.
const DOCUMENT_STATES: { key: DocumentState; label: string; hint: string }[] = [
	{ key: 'SIGNED', label: 'Подписанные заказчиком', hint: 'Юридически значимые версии' },
	{ key: 'SOURCE', label: 'Актуальные исходники', hint: 'Рабочие договоры, сметы и приложения' },
	{ key: 'ARCHIVE', label: 'Архив версий', hint: 'Старые варианты — можно восстановить в любой момент' },
]

// В Next.js 14 params — ОБЫЧНЫЙ объект, не Promise. Не добавляйте await.
export default async function ContractPage({ params, searchParams }: { params: { id: string }; searchParams: { success?: string; folder?: string; workflowError?: string } }) {
	const user = await requireUser()
	const canSeeAmounts = canSeeAmountsFor(user)
	const canEdit = canWrite(user)
	const isAdminUser = isAdmin(user)
	// Задача C2: узкая проверка ИМЕННО для счетов — у ACCOUNTING нет canEdit
	// (canWrite только ADMIN/MANAGER), но работа со счетами — её прямая задача.
	const canEditInvoices = canManageInvoices(user)

	// Видимость считается централизованно (lib/access), а не копией условий на каждой странице.
	const contractLoadStartedAt = Date.now()
	const contract = await prisma.contract.findFirst({
		where: {
			id: params.id,
			...contractScope(user),
		},
		// См. комментарий у аналогичного запроса в dashboard.ts — без join
		// каждая из 9 связей CONTRACT_INCLUDE даёт отдельный round-trip.
		relationLoadStrategy: 'join',
		include: CONTRACT_INCLUDE,
	})

	if (!contract) redirect('/contracts')
	// Карточка договора — самая тяжёлая по числу связанных таблиц страница после дашборда.
	// Только длительность и число строк, без содержимого документов/договоров.
	logger.info('contract.loaded', {
		durationMs: Date.now() - contractLoadStartedAt,
		entityType: 'Contract',
		entityId: contract.id,
		userId: user.id,
		count: contract.documents.length + contract.agreements.length + contract.estimates.length + contract.invoices.length + contract.sites.length + contract.executiveDocs.length + contract.projectSections.length + contract.tasks.length + contract.stageHistory.length,
	})

	async function changeDocumentState(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!canWrite(acting)) redirect(`/contracts/${params.id}`)
		const documentId = String(formData.get('documentId') ?? '')
		const target = await prisma.document.findFirst({ where: { id: documentId, contractId: params.id, deletedAt: null, contract: contractScope(acting) }, select: { id: true, state: true, signedAt: true } })
		if (!target) redirect(`/contracts/${params.id}?tab=documents#documents`)
		const nextState: DocumentState = target.state === 'ARCHIVE' ? (target.signedAt ? 'SIGNED' : 'SOURCE') : 'ARCHIVE'
		await prisma.document.update({ where: { id: target.id }, data: { state: nextState } })
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: nextState === 'ARCHIVE' ? 'DocumentArchived' : 'DocumentRestored', entityId: target.id })
		redirect(`/contracts/${params.id}?tab=documents#documents`)
	}

	async function deleteDocument(formData: FormData) {
		'use server'
		const acting = await requireUser()
		const documentId = String(formData.get('documentId') ?? '')
		// Раздел, откуда вызвали удаление (Документы/Проект/...) — чтобы после
		// удаления вернуть человека туда же, а не всегда на "Документы". Тот же
		// класс бага, что и с хлебными крошками: неправильный путь после действия.
		const returnTo = formData.get('returnTo') === 'project' ? 'project' : 'documents'
		if (!isAdmin(acting)) redirect(`/contracts/${params.id}`)
		const target = await prisma.document.findFirst({ where: { id: documentId, contractId: params.id, deletedAt: null }, select: { id: true } })
		if (target) {
			await prisma.document.update({ where: { id: target.id }, data: { deletedAt: new Date() } })
			await writeAudit({ userId: acting.id, action: 'DELETE', entityType: 'DocumentDeleted', entityId: target.id })
		}
		redirect(`/contracts/${params.id}?tab=${returnTo}#${returnTo}`)
	}

	async function deleteContract() {
		'use server'
		const acting = await requireUser()
		if (!isAdmin(acting)) redirect(`/contracts/${params.id}`)
		const target = await prisma.contract.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } })
		if (target) {
			await prisma.contract.update({ where: { id: target.id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } })
			await writeAudit({ userId: acting.id, action: 'DELETE', entityType: 'ContractDeleted', entityId: target.id })
		}
		redirect('/contracts?success=Договор перемещён в корзину')
	}

	async function confirmPr1(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!canWrite(acting)) redirect(`/contracts/${params.id}`)
		const rawDate = String(formData.get('signedAt') ?? '')
		const workingRaw = String(formData.get('workingDays') ?? '').trim()
		const workingDays = workingRaw ? Number.parseInt(workingRaw, 10) : null
		const signedAt = rawDate ? new Date(`${rawDate}T12:00:00`) : new Date()
		if (Number.isNaN(signedAt.getTime())) redirect(`/contracts/${params.id}?tab=workflow#workflow`)
		const document = await prisma.document.findFirst({ where: { contractId: params.id, kind: 'APPENDIX', state: 'SIGNED', deletedAt: null }, select: { id: true } })
		if (!document) redirect(`/contracts/${params.id}/upload`)
		await confirmSignedPr1Workflow({ contractId: params.id, actorId: acting.id, signedAt, workingDays })
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'ContractPr1Confirmed', entityId: params.id })
		redirect(`/contracts/${params.id}?tab=workflow#workflow`)
	}

	async function moveWorkflowStage(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!canWrite(acting)) redirect(`/contracts/${params.id}`)
		const toStage = String(formData.get('toStage') ?? '') as ContractWorkflowStage
		const current = await prisma.contract.findFirst({
			where: { id: params.id, ...contractScope(acting) },
			select: {
				workflowStage: true,
				pr1ConfirmedAt: true,
				projectSections: {
					where: { deletedAt: null, code: 'KM' },
					select: { queueStatus: true, documents: { where: { deletedAt: null, kind: 'PROJECT_PDF' }, select: { id: true }, take: 1 } },
				},
			},
		})
		if (!current || !getNextWorkflowStages(current.workflowStage).includes(toStage) || (toStage === 'DESIGN' && !current.pr1ConfirmedAt)) redirect(`/contracts/${params.id}?tab=workflow#workflow`)
		// Реальный переход в цех нельзя «прокликать»: производству нужен утверждённый КМ и его итоговый PDF.
		if (toStage === 'WAITING_PRODUCTION') {
			const km = current.projectSections[0]
			if (!km || km.queueStatus !== 'DONE' || km.documents.length === 0) redirect(`/contracts/${params.id}?tab=workflow&workflowError=km-final-file-required#workflow`)
		}
		await transitionContractStage({ contractId: params.id, toStage, actorId: acting.id, comment: String(formData.get('comment') ?? '') })
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'ContractWorkflowStage', entityId: params.id })
		redirect(`/contracts/${params.id}?tab=workflow#workflow`)
	}

	async function revokePr1(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!isAdmin(acting)) redirect(`/contracts/${params.id}`)
		const reason = String(formData.get('reason') ?? '').trim()
		if (!reason) redirect(`/contracts/${params.id}?tab=workflow#workflow`)
		await revokePr1Confirmation({ contractId: params.id, actorId: acting.id, reason })
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'ContractPr1Revoked', entityId: params.id })
		redirect(`/contracts/${params.id}?tab=workflow#workflow`)
	}

	async function addProjectSection(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!canWrite(acting)) redirect(`/contracts/${params.id}`)
		const code = String(formData.get('code') ?? '') as SectionCode
		const contract = await prisma.contract.findFirst({ where: { id: params.id, ...contractScope(acting) }, select: { id: true } })
		if (!contract || !(['KM', 'KZH', 'AR', 'OTHER'] as SectionCode[]).includes(code)) redirect(`/contracts/${params.id}?tab=project#project`)
		await addMissingProjectSection({ contractId: params.id, code, actorId: acting.id })
		await writeAudit({ userId: acting.id, action: 'CREATE', entityType: 'ProjectSection', entityId: params.id })
		redirect(`/contracts/${params.id}?tab=project#project`)
	}

	async function applyDemoStep(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!isAdmin(acting)) redirect(`/contracts/${params.id}`)
		const step = String(formData.get('step') ?? '')
		if (step === 'pr1') {
			await confirmSignedPr1Workflow({ contractId: params.id, actorId: acting.id, signedAt: new Date(), workingDays: 55 })
		}
		if (step === 'production') {
			const current = await prisma.contract.findUnique({ where: { id: params.id }, select: { pr1ConfirmedAt: true } })
			if (!current?.pr1ConfirmedAt) await confirmSignedPr1Workflow({ contractId: params.id, actorId: acting.id, signedAt: new Date(), workingDays: 55 })
			await prisma.projectSection.updateMany({ where: { contractId: params.id, deletedAt: null }, data: { queueStatus: 'DONE', dateTo: new Date() } })
			await transitionContractStage({ contractId: params.id, toStage: 'WAITING_PRODUCTION', actorId: acting.id, isAutomatic: true, force: true, comment: 'Демо: все проектные разделы готовы' })
		}
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'ContractDemoStep', entityId: params.id })
		redirect(`/contracts/${params.id}?tab=workflow#workflow`)
	}

	const documentIds = contract.documents.map((document) => document.id)
	const auditLogs = await prisma.auditLog.findMany({
		where: { OR: [{ entityType: 'Contract', entityId: contract.id }, ...(documentIds.length ? [{ entityId: { in: documentIds } }] : [])] },
		include: { user: { select: { name: true } } },
		orderBy: { createdAt: 'desc' },
		take: 30,
	})
	const documentNameById = new Map(contract.documents.map((document) => [document.id, document.fileName]))
	const documentNodes = (documents: typeof contract.documents) => documents.map((document) => ({
		id: `document-${document.id}`,
		label: document.fileName,
		date: formatDate(document.signedAt ?? document.createdAt),
		detail: `${DOCUMENT_KIND_LABELS[document.kind]} · ${document.state === 'SIGNED' ? 'подписан' : document.state === 'ARCHIVE' ? 'в архиве' : 'актуальная версия'}`,
	}))
	const hierarchyTasks = await prisma.task.findMany({
		where: { contractId: contract.id, deletedAt: null },
		orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
		include: { assignee: { select: { name: true } } },
	})
	const hierarchyNodes: ContractHierarchyNode[] = [
		...contract.stageHistory.map((entry) => ({ id: `stage-${entry.id}`, label: WORKFLOW_STAGE_LABEL[entry.toStage], date: formatDate(entry.createdAt), detail: `${entry.isAutomatic ? 'Автоматический переход' : entry.changedBy?.name ?? 'Переход этапа'}${entry.comment ? ` · ${entry.comment}` : ''}` })),
		...contract.agreements.map((agreement) => ({ id: `agreement-${agreement.id}`, label: agreementTitle(agreement.number), date: formatDate(agreement.date), children: [...agreement.estimates.map((estimate) => ({ id: `estimate-${estimate.id}`, label: estimateTitle(estimate.number), date: formatDate(estimate.date), detail: canSeeAmounts && estimate.amount != null ? formatMoney(estimate.amount) : undefined })), ...documentNodes(contract.documents.filter((document) => document.agreementId === agreement.id))] })),
		...contract.estimates.filter((estimate) => !estimate.agreementId && !estimate.deletedAt).map((estimate) => ({ id: `estimate-${estimate.id}`, label: estimateTitle(estimate.number), date: formatDate(estimate.date), detail: canSeeAmounts && estimate.amount != null ? formatMoney(estimate.amount) : undefined, children: documentNodes(contract.documents.filter((document) => document.estimateId === estimate.id)) })),
		...contract.invoices.map((invoice) => ({ id: `invoice-${invoice.id}`, label: `Счёт №${invoice.number}`, date: formatDate(invoice.date), detail: canSeeAmounts ? formatMoney(invoice.amount, contract.currency) : undefined, children: documentNodes(contract.documents.filter((document) => document.invoiceId === invoice.id)) })),
		...contract.projectSections.map((section) => ({ id: `project-${section.id}`, label: `Раздел ${PROJECT_SECTION_LABEL[section.code] ?? section.code}`, date: section.dateTo ? formatDate(section.dateTo) : section.deadline ? formatDate(section.deadline) : undefined, detail: `${section.responsible?.name ?? 'Ответственный не назначен'} · ${section.comment ?? 'без комментария'}`, children: documentNodes(contract.documents.filter((document) => document.projectSectionId === section.id)) })),
		...contract.executiveDocs.map((entry) => ({ id: `executive-${entry.id}`, label: entry.name, date: formatDate(entry.createdAt), detail: entry.status === 'READY' ? 'Готово' : entry.status === 'IN_PROGRESS' ? 'В работе' : 'Не готово', children: documentNodes(contract.documents.filter((document) => document.executiveDocId === entry.id)) })),
		...hierarchyTasks.map((task) => ({ id: `task-${task.id}`, label: task.title, date: task.dueDate ? formatDate(task.dueDate) : undefined, detail: `${task.assignee.name} · ${task.status === 'DONE' ? 'готово' : task.status === 'IN_PROGRESS' ? 'в работе' : 'не начато'}` })),
		...documentNodes(contract.documents.filter((document) => !document.agreementId && !document.estimateId && !document.invoiceId && !document.projectSectionId && !document.executiveDocId)),
	]

	// КМ/КЖ/АР показываются только на карточке «Проект» — здесь для них отдельных папок нет.
	const FOLDERS = [
		{ key: 'legal', label: 'Договоры' }, { key: 'estimate', label: 'Сметы' }, { key: 'source-data', label: 'Исходные данные' }, { key: 'executive', label: 'Исполнительная' }, { key: 'other', label: 'Прочее' },
	]
	const folderFor = (document: typeof contract.documents[number]) => {
		if (document.projectSectionId) return contract.projectSections.find((section) => section.id === document.projectSectionId)?.code ?? 'other'
		if (document.kind === 'SOURCE_DATA') return 'source-data'
		if (document.kind === 'ESTIMATE') return 'estimate'
		if (['CONTRACT', 'AGREEMENT', 'APPENDIX', 'INVOICE', 'COMMERCIAL_PROPOSAL', 'SIGNED_SCAN'].includes(document.kind)) return 'legal'
		if (['EXECUTIVE', 'ACT', 'CERTIFICATE'].includes(document.kind)) return 'executive'
		return 'other'
	}
	// Файлы КМ/КЖ/АР (PROJECT_PDF/PROJECT_DWG) видны только на карточке «Проект» — без дублирования в общем реестре.
	const documentsForRegistry = contract.documents.filter((document) => document.kind !== 'PROJECT_PDF' && document.kind !== 'PROJECT_DWG')
	const selectedFolder = FOLDERS.some((folder) => folder.key === searchParams.folder) ? searchParams.folder! : null
	const shownDocuments = selectedFolder ? documentsForRegistry.filter((document) => folderFor(document) === selectedFolder) : documentsForRegistry
	const documentSections = DOCUMENT_STATES.map((section) => {
		const documents = shownDocuments.filter((document) => document.state === section.key)
		const byKind = new Map<DocumentKind, typeof contract.documents>()
		for (const document of documents) {
			if (!byKind.has(document.kind)) byKind.set(document.kind, [])
			byKind.get(document.kind)!.push(document)
		}
		return { ...section, documents, byKind, kinds: DOCUMENT_KIND_ORDER.filter((kind) => byKind.has(kind)) }
	})
	const stateLabel = Object.fromEntries(DOCUMENT_STATES.map((state) => [state.key, state.label])) as Record<DocumentState, string>
	const sourceDataDocuments = contract.documents.filter((document) => document.kind === 'SOURCE_DATA')
	const sourceDataChecklist = [
		{ sub: 'IGI' as const, label: 'ИГИ', hint: 'инженерно-геологические изыскания', match: (fileName: string) => hasToken(fileName, 'иги') || /инженерн(?:о|ые)[ -]?геолог/i.test(fileName) },
		{ sub: 'GPZU' as const, label: 'ГПЗУ', hint: 'градостроительный план', match: (fileName: string) => hasToken(fileName, 'гпзу') || /градостроительн/i.test(fileName) },
		{ sub: 'TOPO' as const, label: 'Топосъёмка', hint: 'топографическая съёмка', match: (fileName: string) => /(?:топос[ъь]ем|топограф)/i.test(fileName) },
		{ sub: 'GEOBASE' as const, label: 'Геоподоснова', hint: 'геодезическая или топографическая основа', match: (fileName: string) => /(?:геоподоснов|геодезическ(?:ая|ий)?\s+основ)/i.test(fileName) },
		{ sub: 'CONSTRAINTS' as const, label: 'Стеснённые условия', hint: 'сведения об ограничениях на площадке', match: (fileName: string) => /стеснен/i.test(fileName) },
	].map((item) => ({
		...item,
		document: sourceDataDocuments.find((document) => document.sourceDataKind === item.sub)
			?? sourceDataDocuments.find((document) => !document.sourceDataKind && item.match(document.fileName)),
	}))
	// Защищаем страницу от старых записей/Prisma Client, где новые связи ещё не возвращаются.
	const sites = contract.sites ?? []
	const executiveDocs = contract.executiveDocs ?? []
	// Порядок карточек «Проект» повторяет реальный ход работ: КЖ → КМ → АР.
	const SECTION_DISPLAY_ORDER: Record<string, number> = { KZH: 0, KM: 1, AR: 2, OTHER: 3 }
	const projectSections = (contract.projectSections ?? []).slice().sort((a, b) => (SECTION_DISPLAY_ORDER[a.code] ?? 9) - (SECTION_DISPLAY_ORDER[b.code] ?? 9))
	// Раздел мог появиться в правилах позже, чем договору подтвердили ПР1 — даём добавить его вручную.
	const missingProjectSections = contract.pr1ConfirmedAt ? sectionsForKind(contract.kind).filter((code) => !projectSections.some((section) => section.code === code)) : []
	const openTasks = contract.tasks ?? []
	const site = sites[0]
	const siteWorks = sites.flatMap((item) => item.works ?? [])
	const actualCosts = siteWorks.reduce((sum, work) => sum + Number(work.crewCost) + Number(work.equipmentCost) + Number(work.materialCost) + Number(work.otherCost), 0)
	const actualKjCosts = siteWorks.filter((work) => work.direction === 'KJ').reduce((sum, work) => sum + Number(work.crewCost) + Number(work.equipmentCost) + Number(work.materialCost) + Number(work.otherCost), 0)
	const actualKmCosts = actualCosts - actualKjCosts
	const planBreakdown = Number(contract.smrAmount ?? 0) + Number(contract.mkAmount ?? 0) + Number(contract.deliveryAmount ?? 0)
	const hasPlanBreakdown = contract.smrAmount != null || contract.mkAmount != null || contract.deliveryAmount != null
	const budgetLeft = (hasPlanBreakdown ? planBreakdown : Number(contract.amount)) - actualCosts
	const margin = Number(contract.amount) - actualCosts
	const costShare = hasPlanBreakdown && planBreakdown > 0 ? Math.min(100, Math.round(actualCosts / planBreakdown * 100)) : null
	const pr1Documents = contract.documents.filter((document) => document.kind === 'APPENDIX' && document.state === 'SIGNED')
	const latestPr1 = pr1Documents[0]
	const deadlineInfo = getDeadlineInfo(contract.deadline)
	const nextWorkflowStages = getNextWorkflowStages(contract.workflowStage).filter((stage) => stage !== 'DESIGN' || Boolean(contract.pr1ConfirmedAt))
	const name = user.name ?? user.email ?? ''
	const readyProjects = projectSections.filter((item) => item.queueStatus === 'DONE' || item.dateTo).length
	const documentReady = contract.documents.length > 0
	const pr1Ready = Boolean(contract.pr1ConfirmedAt)
	const siteReady = site?.status === 'READY'
	const needsSite = contract.kind === 'SMR'
	const needsExecutive = contract.kind !== 'PROJECT'
	const executiveReady = executiveDocs.length > 0 && executiveDocs.every((item) => item.status === 'READY')
	const agreementHasFiles = contract.documents.some((document) => document.agreementId || document.invoiceId || document.kind === 'AGREEMENT' || document.kind === 'INVOICE')
	const projectHasFiles = projectSections.some((section) => section.documents.length > 0)
	const executiveHasFiles = contract.documents.some((document) => document.executiveDocId)
	const progressParts = [
		{ label: 'Договор и файлы', ready: documentReady, href: '#documents' },
		{ label: 'Подписанное ПР1', ready: pr1Ready, href: '#workflow' },
		{ label: 'Проектирование', ready: projectSections.length > 0 && readyProjects === projectSections.length, href: '#project' },
		...(needsSite ? [{ label: 'Площадка и монтаж', ready: siteReady, href: '#site' }] : []),
		...(needsExecutive ? [{ label: 'Исполнительная документация', ready: executiveReady, href: '#executive' }] : []),
	]
	const completion = Math.round(progressParts.filter((item) => item.ready).length / progressParts.length * 100)
	const progressDetail = (item: { href: string; ready: boolean }) => {
		if (item.href === '#documents') return item.ready ? `${contract.documents.length} файлов загружено` : 'Ожидается основной договор'
		if (item.href === '#workflow') return item.ready ? 'Подтверждено заказчиком' : latestPr1 ? 'Файл загружен — ждёт подтверждения' : 'Ожидается подписанный файл'
		if (item.href === '#project') return projectSections.length === 0 ? 'Разделы ещё не сформированы' : item.ready ? `Завершено ${readyProjects} из ${projectSections.length}` : `В работе ${readyProjects} из ${projectSections.length} разделов`
		if (item.href === '#site') return !site ? 'Площадка появится после ПР1' : item.ready ? 'Площадка готова' : `${SITE_STATUS[site.status].label}: требуется работа`
		return executiveDocs.length === 0 ? 'Документы ещё не добавлены' : item.ready ? 'Комплект готов' : `Готово ${executiveDocs.filter((entry) => entry.status === 'READY').length} из ${executiveDocs.length}`
	}
	const closingBlockers = [
		!documentReady ? 'Загрузить основной договор и приложения' : null,
		!pr1Ready
			? 'Подтвердить подписанный ПР1 — система запустит работы по договору'
			: projectSections.length === 0
			? 'Подтвердить подписанный ПР1 — система создаст КМ, КЖ, площадку и задачи'
			: readyProjects < projectSections.length
				? `Завершить проектирование: ${projectSections.length - readyProjects} разд.`
				: null,
		needsSite ? (!site ? 'Создать площадку' : !siteReady ? 'Завершить работы на площадке' : null) : null,
	].filter((item): item is string => Boolean(item))
	const problemEvent = site?.events.filter((event) => event.type === 'WARNING').at(-1)
	const overdueProjects = projectSections.filter((item) => item.deadline && item.deadline < new Date() && item.queueStatus !== 'DONE' && !item.dateTo)
	const overdueTasks = openTasks.filter((item) => item.dueDate && item.dueDate < new Date())
	const workflowTone: 'ok' | 'warn' | 'off' | 'brand' = contract.workflowStage === 'CLOSED' ? 'ok' : ['INSTALL_KZH', 'INSTALL_KM', 'PRODUCTION'].includes(contract.workflowStage) ? 'warn' : contract.workflowStage === 'DESIGN' ? 'brand' : 'off'
	const workflowError = searchParams.workflowError === 'km-final-file-required'

	return (
		<>
			<Topbar
				crumbs={[{ label: 'Главная', href: '/' }, { label: 'Договоры', href: '/contracts' }, { label: contract.number }]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="workspace-content">
				{searchParams.success && <div className="mb-[14px] rounded-control border border-green-200 bg-green-50 px-3 py-2.5 text-sm font-medium text-green-800">{searchParams.success}</div>}

				<ContractHero
					contract={contract}
					canEdit={canEdit}
					isAdminUser={isAdminUser}
					workflowTone={workflowTone}
					hierarchyNodes={hierarchyNodes}
					deleteContract={deleteContract}
				/>

				<div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_316px]">
					{/* ---------- Левая колонка ---------- */}
					<div className="flex min-w-0 flex-col gap-4">
						{/* Карточка договора: контрагент слева, управленческие данные справа */}
						<Card className="overflow-hidden border-brand/10 shadow-[0_14px_34px_rgba(25,22,45,.055)]">
							<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,.94fr)_minmax(0,1.3fr)]">
								<div className="border-b border-line-soft bg-gradient-to-br from-brand-soft/55 to-surface p-5 lg:border-b-0 lg:border-r">
									<div className="flex items-center gap-3"><div className="grid h-10 w-10 flex-none place-items-center rounded-control bg-brand text-white"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V6l7-3 7 3v15M9 10h2M9 14h2M15 10h0M15 14h0" /></svg></div><div className="min-w-0"><div className="text-xs font-semibold uppercase tracking-[.06em] text-faint">Контрагент</div><Link href={`/contractors/${contract.contractor.id}?from=${contract.id}`} className="block truncate text-md font-bold hover:text-brand-ink hover:underline">{contract.contractor.name}</Link></div></div>
									<div className="mt-[14px] grid grid-cols-2 gap-x-[20px] gap-y-[10px] text-sm"><div><div className="text-2xs font-semibold uppercase text-faint">ИНН</div><div className="mt-1 flex items-center font-semibold">{contract.contractor.inn ?? '—'}<CopyValue value={contract.contractor.inn ?? ''} label="Скопировать ИНН" /></div></div><div><div className="text-2xs font-semibold uppercase text-faint">Телефон</div><div className="mt-1 flex items-center font-semibold">{contract.contractor.phone ? <a href={`tel:${contract.contractor.phone.replace(/[^+\d]/g, '')}`} className="text-brand-ink hover:underline">{contract.contractor.phone}</a> : '—'}<CopyValue value={contract.contractor.phone ?? ''} label="Скопировать телефон" /></div></div><div className="col-span-2"><div className="text-2xs font-semibold uppercase text-faint">Email</div><div className="mt-1 flex items-center font-semibold"><span className="truncate">{contract.contractor.email ? <a href={`mailto:${contract.contractor.email}`} className="text-brand-ink hover:underline">{contract.contractor.email}</a> : '—'}</span><CopyValue value={contract.contractor.email ?? ''} label="Скопировать email" /></div></div></div>
									<div className="mt-[15px] flex flex-wrap gap-2"><Link href={`/contractors/${contract.contractor.id}?from=${contract.id}`} className="inline-flex rounded-tight border border-brand/25 bg-surface/80 px-2.5 py-1.5 text-xs font-semibold text-brand-ink hover:bg-brand-soft">Открыть карточку контрагента →</Link><CopyContractorDetails name={contract.contractor.name} inn={contract.contractor.inn} phone={contract.contractor.phone} email={contract.contractor.email} address={contract.contractor.address} /></div>
								</div>
								<div className="p-5"><div className="grid grid-cols-2 gap-x-[26px] gap-y-[12px] text-sm"><div><div className="text-2xs font-semibold uppercase text-faint">Шифр договора</div><div className="mt-1 flex items-center font-bold">{contract.cipher ?? '—'}<CopyValue value={contract.cipher ?? ''} label="Скопировать шифр" /></div></div><div><div className="text-2xs font-semibold uppercase text-faint">Менеджер</div><div className="mt-1 font-semibold">{contract.manager?.name ?? 'Не назначен'}</div></div><div><div className="text-2xs font-semibold uppercase text-faint">Подписание ПР1</div><div className="mt-1 font-semibold">{contract.pr1SignedAt ? formatDate(contract.pr1SignedAt) : 'Не подтверждено'}</div></div><div><div className="text-2xs font-semibold uppercase text-faint">Рабочих дней</div><div className="mt-1 font-semibold">{contract.workingDays ?? '—'}</div></div><div><div className="text-2xs font-semibold uppercase text-faint">Дедлайн договора</div><div className={`mt-1 font-semibold ${deadlineInfo.tone === 'danger' ? 'text-danger' : deadlineInfo.tone === 'warn' ? 'text-warn' : ''}`}>{contract.deadline ? formatDate(contract.deadline) : 'Не рассчитан'}</div></div><div><div className="text-2xs font-semibold uppercase text-faint">Адрес объекта</div><div className="mt-1 truncate font-semibold">{contract.objectAddress ? <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(contract.objectAddress)}`} target="_blank" rel="noreferrer" className="text-brand-ink hover:underline">{contract.objectAddress}</a> : '—'}</div></div></div>
									{canSeeAmounts && <div className="mt-[16px] border-t border-line-soft pt-3"><div className="text-2xs font-semibold uppercase tracking-[.06em] text-faint">Стоимость договора</div><div className="mt-[4px] text-xl font-bold tracking-[-.02em]">{formatMoney(contract.amount, contract.currency)}</div>{hasPlanBreakdown && <div className="mt-[9px] grid grid-cols-3 gap-1.5 text-center text-xs text-muted"><div className="rounded-tight bg-raised p-1.5">СМР<br/><b className="text-ink">{formatMoney(contract.smrAmount ?? 0, contract.currency)}</b></div><div className="rounded-tight bg-raised p-1.5">МК<br/><b className="text-ink">{formatMoney(contract.mkAmount ?? 0, contract.currency)}</b></div><div className="rounded-tight bg-raised p-1.5">Доставка<br/><b className="text-ink">{formatMoney(contract.deliveryAmount ?? 0, contract.currency)}</b></div></div>}</div>}
								</div>
							</div>
						</Card>

						<ContractSectionNav sections={[
							{ id: 'workflow', label: 'Ход договора', hasFiles: Boolean(latestPr1) },
							{ id: 'documents', label: 'Документы', hasFiles: documentsForRegistry.length > 0 },
							{ id: 'agreements', label: 'Соглашения', hasFiles: agreementHasFiles },
							{ id: 'project', label: 'Проект', hasFiles: projectHasFiles },
							...(site ? [{ id: 'site', label: 'Площадка' }] : []),
							...(needsExecutive ? [{ id: 'executive', label: 'Исполнительная', hasFiles: executiveHasFiles }] : []),
							{ id: 'tasks', label: 'Задачи' },
							{ id: 'history', label: 'История' },
						]} />

						<TabWorkflow
							contract={contract}
							canEdit={canEdit}
							isAdminUser={isAdminUser}
							latestPr1={latestPr1}
							nextWorkflowStages={nextWorkflowStages}
							workflowError={workflowError}
							confirmPr1={confirmPr1}
							revokePr1={revokePr1}
							moveWorkflowStage={moveWorkflowStage}
							applyDemoStep={applyDemoStep}
						/>

						<TabAgreements contract={contract} canEdit={canEdit} canEditInvoices={canEditInvoices} canSeeAmounts={canSeeAmounts} />

						<TabDocuments
							contract={contract}
							canEdit={canEdit}
							isAdminUser={isAdminUser}
							documentsForRegistry={documentsForRegistry}
							selectedFolder={selectedFolder}
							folders={FOLDERS}
							folderFor={folderFor}
							sourceDataChecklist={sourceDataChecklist}
							latestPr1={latestPr1}
							documentSections={documentSections}
							stateLabel={stateLabel}
							changeDocumentState={changeDocumentState}
							deleteDocument={deleteDocument}
						/>

						<TabHistory contractNumber={contract.number} auditLogs={auditLogs} documentNameById={documentNameById} />

						{site && <TabSite site={site} />}

						<TabProject
							contractId={contract.id}
							projectSections={projectSections}
							missingProjectSections={missingProjectSections}
							canEdit={canEdit}
							userId={user.id}
							userRole={user.role}
							addProjectSection={addProjectSection}
							isAdminUser={isAdminUser}
							deleteDocument={deleteDocument}
						/>

						<TabTasks contractId={contract.id} openTasks={openTasks} />

						<TabExecutive contractId={contract.id} executiveDocs={executiveDocs} documents={contract.documents} canUpload={canEdit || user.role === 'BUILDER'} />
					</div>

					{/* ---------- Правая колонка ---------- */}
					<div className="flex flex-col gap-4 xl:sticky xl:top-[76px]">
						{canSeeAmounts && (
							<Card className="p-4">
								<div className="text-xs text-muted">
									Сумма договора
								</div>
								<div className="tnum mt-[5px] text-xl font-bold tracking-[-0.01em]">
									{formatMoney(contract.amount, contract.currency)}
								</div>
								<div className="mt-[4px] text-xs text-faint">
									{'вкл. '}
									{plural(
										contract.agreements.length,
										'доп. соглашение',
										'доп. соглашения',
										'доп. соглашений',
									)}
								</div>
								{(contract.smrAmount != null || contract.mkAmount != null || contract.deliveryAmount != null) && <div className="mt-[13px] grid grid-cols-3 gap-1 border-t border-line-soft pt-2.5 text-center text-xs text-muted"><div>СМР<br/><b className="tnum text-xs text-ink">{formatMoney(contract.smrAmount ?? 0, contract.currency)}</b></div><div>МК<br/><b className="tnum text-xs text-ink">{formatMoney(contract.mkAmount ?? 0, contract.currency)}</b></div><div>Доставка<br/><b className="tnum text-xs text-ink">{formatMoney(contract.deliveryAmount ?? 0, contract.currency)}</b></div></div>}
							</Card>
						)}

						{canSeeAmounts && (
							<Card>
								<CardHeader title="План / факт затрат" extra={siteWorks.length ? `${siteWorks.length} отч.` : 'нет отчётов'} />
								<div className="p-4">
									<div className="grid grid-cols-3 gap-1.5 text-center text-xs text-muted">
										<div className="rounded-tight bg-raised p-1.5">Выручка<br/><b className="tnum text-xs text-ink">{formatMoney(contract.amount, contract.currency)}</b></div>
										<div className="rounded-tight bg-raised p-1.5">Факт затрат<br/><b className="tnum text-xs text-warn">{formatMoney(actualCosts, contract.currency)}</b></div>
										<div className="rounded-tight bg-raised p-1.5">Маржа*<br/><b className={`tnum text-xs ${margin < 0 ? 'text-danger' : 'text-ok'}`}>{formatMoney(margin, contract.currency)}</b></div>
									</div>
									{costShare != null ? <><div className="mt-[13px] flex items-center justify-between text-xs"><span className="text-muted">Освоение бюджета</span><span className={`tnum font-semibold ${actualCosts > planBreakdown ? 'text-danger' : 'text-ink'}`}>{costShare}%</span></div><div className="mt-[6px]"><ProgressBar percent={costShare} tone={actualCosts > planBreakdown ? 'danger' : costShare >= 80 ? 'warn' : 'brand'} height={7} /></div><div className={`mt-[7px] text-xs ${budgetLeft < 0 ? 'text-danger' : 'text-muted'}`}>{budgetLeft < 0 ? `Перерасход: ${formatMoney(Math.abs(budgetLeft), contract.currency)}` : `Остаток бюджета: ${formatMoney(budgetLeft, contract.currency)}`}</div></> : <div className="mt-[12px] rounded-tight bg-raised px-2.5 py-2 text-xs text-muted">Заполните СМР, МК и доставку в редактировании договора — появится контроль бюджета.</div>}
									{siteWorks.length > 0 && <div className="mt-[10px] flex justify-between text-xs text-faint"><span>КЖ: {formatMoney(actualKjCosts, contract.currency)}</span><span>КМ: {formatMoney(actualKmCosts, contract.currency)}</span></div>}
									{site && <Link href={`/sites/${site.id}`} className="mt-[11px] inline-block text-xs font-semibold text-brand-ink hover:underline">Открыть отчёты площадки →</Link>}
									<div className="mt-[7px] text-2xs text-faint">* Предварительно: выручка договора минус занесённые расходы площадки.</div>
								</div>
							</Card>
						)}

						<Card>
							<CardHeader title="Готовность договора" extra={`${completion}%`} />
							<div className="p-4">
								<ProgressBar percent={completion} height={9} tone={completion === 100 ? 'ok' : completion >= 50 ? 'brand' : 'warn'} />
								<div className="mt-[14px] flex flex-col gap-1">
									{progressParts.map((item) => (
										<a key={item.label} href={item.href} className="flex items-center gap-2 rounded-tight px-1.5 py-1.5 text-sm hover:bg-raised">
											<span className={`grid h-[18px] w-[18px] place-items-center rounded-full text-2xs font-bold ${item.ready ? 'bg-ok-bg text-ok' : 'bg-off-bg text-faint'}`}>{item.ready ? '✓' : '—'}</span>
											<span className="min-w-0 flex-1"><span className="block">{item.label}</span><span className="mt-0.5 block text-2xs font-normal text-faint">{progressDetail(item)}</span></span>
											<span className="text-faint">›</span>
										</a>
									))}
								</div>
								<div className={`mt-[14px] rounded-control border p-2.5 ${closingBlockers.length === 0 ? 'border-ok/25 bg-ok-bg' : 'border-warn/25 bg-warn-bg'}`}>
									<div className={`text-xs font-bold uppercase tracking-[0.08em] ${closingBlockers.length === 0 ? 'text-ok' : 'text-warn'}`}>
										{closingBlockers.length === 0 ? 'Готов к закрытию' : 'Следующие действия'}
									</div>
									{closingBlockers.length > 0 && (
										<div className="mt-[7px] flex flex-col gap-1.5">
											{closingBlockers.map((blocker, index) => (
												<div key={blocker} className="flex gap-1.5 text-xs leading-4 text-muted">
													<span className="font-bold text-warn">{index + 1}.</span>
													<span>{blocker}</span>
												</div>
											))}
										</div>
									)}
								</div>
							</div>
						</Card>

						{(problemEvent || overdueProjects.length > 0 || overdueTasks.length > 0 || !site) && (
							<Card>
								<CardHeader title="Требует внимания" extra={overdueProjects.length + overdueTasks.length + (problemEvent ? 1 : 0) + (!site ? 1 : 0)} />
								<div className="p-2.5">
									{problemEvent && <Link href={`/sites/${site!.id}`} className="block rounded-tight px-2 py-2 hover:bg-raised"><div className="text-sm font-semibold text-danger">Проблема на площадке</div><div className="mt-[3px] line-clamp-2 text-xs leading-4 text-muted">{problemEvent.text}</div></Link>}
									{overdueProjects.map((project) => <Link key={project.id} href={`/projects?section=${project.code}`} className="block rounded-tight px-2 py-2 hover:bg-raised"><div className="text-sm font-semibold text-danger">Просрочен раздел {PROJECT_SECTION_LABEL[project.code] ?? project.code}</div><div className="mt-[3px] text-xs text-muted">Дедлайн: {formatDate(project.deadline)}</div></Link>)}
									{overdueTasks.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="block rounded-tight px-2 py-2 hover:bg-raised"><div className="truncate text-sm font-semibold text-danger">Просрочена задача: {task.title}</div><div className="mt-[3px] text-xs text-muted">Срок: {formatDate(task.dueDate)} · {task.assignee.name}</div></Link>)}
									{!site && <Link href={`/sites/new?contract=${contract.id}`} className="block rounded-tight px-2 py-2 hover:bg-raised"><div className="text-sm font-semibold text-warn">Площадка не создана</div><div className="mt-[3px] text-xs text-muted">Создать площадку из этого договора →</div></Link>}
								</div>
							</Card>
						)}

						<ChatPanel title="Чат по договору" endpoint={`/api/chats/contract/${contract.id}`} />

						<Card>
							<CardHeader title="Быстрые действия" />
							<div className="grid grid-cols-2 gap-2 p-3">
								<Link href={`/executive/${contract.id}`} className="rounded-tight border border-line bg-surface px-2.5 py-2 text-center text-xs font-semibold hover:bg-raised">Исполнительная документация</Link>
								<Link href={site ? `/sites/${site.id}` : `/sites/new?contract=${contract.id}`} className="rounded-tight border border-line bg-surface px-2.5 py-2 text-center text-xs font-semibold hover:bg-raised">Площадка</Link>
								<Link href={`/projects?section=KM`} className="rounded-tight border border-line bg-surface px-2.5 py-2 text-center text-xs font-semibold hover:bg-raised">Очередь КМ</Link>
								<Link href={`/projects?section=KZH`} className="rounded-tight border border-line bg-surface px-2.5 py-2 text-center text-xs font-semibold hover:bg-raised">Очередь КЖ</Link>
							</div>
						</Card>

					</div>
				</div>
			</div>
		</>
	)
}
