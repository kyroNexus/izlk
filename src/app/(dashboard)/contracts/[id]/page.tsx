import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { canSeeAmounts as canSeeAmountsFor, canWrite, contractScope, isAdmin, requireUser } from '@/lib/access'
import Topbar from '@/components/Topbar'
import ContractSectionNav from '@/components/ContractSectionNav'
import ContractHierarchy, { type ContractHierarchyNode } from '@/components/ContractHierarchy'
import ChatPanel from '@/components/ChatPanel'
import CopyValue, { CopyContractorDetails } from '@/components/CopyValue'
import { Card, CardHeader, Chip, EmptyState, ExecStatusChip, FileIcon, ProgressBar, StatusChip } from '@/components/ui'
import {
	DOCUMENT_KIND_LABELS,
	DOCUMENT_KIND_ORDER,
	formatBytes,
	formatDate,
	formatDateTime,
	formatMoney,
	initials,
	plural,
} from '@/lib/format'
import type { ContractWorkflowStage, DocumentKind, DocumentState, SiteStatus } from '@prisma/client'
import { writeAudit } from '@/lib/audit'
import { confirmSignedPr1Workflow, getNextWorkflowStages, revokePr1Confirmation, transitionContractStage, WORKFLOW_STAGE_LABEL } from '@/lib/contract-workflow'
import { getDeadlineInfo } from '@/lib/deadline'


const PROJECT_SECTION_LABEL: Record<string, string> = {
	KM: '\u041a\u041c',
	AR: '\u0410\u0420',
	KZH: '\u041a\u0416',
	OTHER: '\u041f\u0440\u043e\u0447\u0435\u0435',
}

const SITE_STATUS: Record<SiteStatus, { label: string; tone: 'ok' | 'warn' | 'off' | 'danger' }> = {
	READY: { label: '\u0413\u043e\u0442\u043e\u0432\u0430', tone: 'ok' },
	PREPARING: { label: '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430', tone: 'off' },
	ISSUE: { label: '\u041f\u0440\u043e\u0431\u043b\u0435\u043c\u0430', tone: 'warn' },
	BLOCKED: { label: '\u0417\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d\u0430', tone: 'danger' },
}

/** Номер ДС часто уже содержит «ДС» или «№» — без этого выходило «ДС №ДС №1». */
function agreementTitle(rawNumber: string): string {
	const raw = rawNumber.trim()
	if (/^ДС/i.test(raw)) return raw
	return raw.startsWith('№') ? `ДС ${raw}` : `ДС №${raw}`
}

function estimateTitle(rawNumber: string): string {
	const raw = rawNumber.trim()
	if (/^Смета/i.test(raw)) return raw
	return raw.startsWith('№') ? `Смета ${raw}` : `Смета №${raw}`
}

const EVENT_DOT: Record<string, string> = {
	SUCCESS: 'bg-ok',
	WARNING: 'bg-warn',
	INFO: 'bg-brand',
}

const DOCUMENT_STATES: { key: DocumentState; label: string; hint: string }[] = [
	{ key: 'SOURCE', label: 'Актуальные исходники', hint: 'Рабочие договоры, сметы и приложения' },
	{ key: 'SIGNED', label: 'Подписанные заказчиком', hint: 'Юридически значимые версии' },
	{ key: 'ARCHIVE', label: 'Архив версий', hint: 'Старые варианты — можно восстановить в любой момент' },
]

// В Next.js 14 params — ОБЫЧНЫЙ объект, не Promise. Не добавляйте await.
export default async function ContractPage({ params, searchParams }: { params: { id: string }; searchParams: { success?: string; folder?: string; workflowError?: string } }) {
	const user = await requireUser()
	const canSeeAmounts = canSeeAmountsFor(user)
	const canEdit = canWrite(user)

	// Видимость считается централизованно (lib/access), а не копией условий на каждой странице.
	const contract = await prisma.contract.findFirst({
		where: {
			id: params.id,
			...contractScope(user),
		},
		include: {
    contractor: true,
    manager: { select: { name: true } },
		estimates: { where: { deletedAt: null }, orderBy: { date: 'asc' } },
    agreements: { where: { deletedAt: null }, orderBy: { date: 'asc' }, include: { estimates: { where: { deletedAt: null } } } },
			invoices: { where: { deletedAt: null }, orderBy: { date: 'asc' } },
    documents: { where: { deletedAt: null }, orderBy: { signedAt: 'desc' } },
    sites: { include: { events: { orderBy: { occurredAt: 'asc' } }, works: { select: { direction: true, crewCost: true, equipmentCost: true, materialCost: true, otherCost: true } } } },
    executiveDocs: { orderBy: { name: 'asc' } },
			projectSections: { orderBy: { code: 'asc' }, include: { responsible: { select: { name: true } }, documents: { where: { deletedAt: null, kind: { in: ['PROJECT_PDF', 'PROJECT_DWG'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true, kind: true } } } },
    tasks: { where: { deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] } }, orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }], include: { assignee: { select: { name: true } } }, take: 5 },
			stageHistory: { orderBy: { createdAt: 'desc' }, include: { changedBy: { select: { name: true } } } },
},
	})

	if (!contract) redirect('/contracts')

	async function changeDocumentState(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!canWrite(acting)) redirect(`/contracts/${params.id}`)
		const documentId = String(formData.get('documentId') ?? '')
		const target = await prisma.document.findFirst({ where: { id: documentId, contractId: params.id, deletedAt: null, contract: contractScope(acting) }, select: { id: true, state: true, signedAt: true } })
		if (!target) redirect(`/contracts/${params.id}#documents`)
		const nextState: DocumentState = target.state === 'ARCHIVE' ? (target.signedAt ? 'SIGNED' : 'SOURCE') : 'ARCHIVE'
		await prisma.document.update({ where: { id: target.id }, data: { state: nextState } })
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: nextState === 'ARCHIVE' ? 'DocumentArchived' : 'DocumentRestored', entityId: target.id })
		redirect(`/contracts/${params.id}#documents`)
	}

	async function deleteDocument(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!isAdmin(acting)) redirect(`/contracts/${params.id}`)
		const documentId = String(formData.get('documentId') ?? '')
		const target = await prisma.document.findFirst({ where: { id: documentId, contractId: params.id, deletedAt: null }, select: { id: true } })
		if (target) {
			await prisma.document.update({ where: { id: target.id }, data: { deletedAt: new Date() } })
			await writeAudit({ userId: acting.id, action: 'DELETE', entityType: 'DocumentDeleted', entityId: target.id })
		}
		redirect(`/contracts/${params.id}#documents`)
	}

	async function deleteContract() {
		'use server'
		const acting = await requireUser()
		if (!isAdmin(acting)) redirect('/contracts')
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
		if (Number.isNaN(signedAt.getTime())) redirect(`/contracts/${params.id}#workflow`)
		const document = await prisma.document.findFirst({ where: { contractId: params.id, kind: 'APPENDIX', state: 'SIGNED', deletedAt: null }, select: { id: true } })
		if (!document) redirect(`/contracts/${params.id}/upload`)
		await confirmSignedPr1Workflow({ contractId: params.id, actorId: acting.id, signedAt, workingDays })
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'ContractPr1Confirmed', entityId: params.id })
		redirect(`/contracts/${params.id}#workflow`)
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
		if (!current || !getNextWorkflowStages(current.workflowStage).includes(toStage) || (toStage === 'DESIGN' && !current.pr1ConfirmedAt)) redirect(`/contracts/${params.id}#workflow`)
		// Реальный переход в цех нельзя «прокликать»: производству нужен утверждённый КМ и его итоговый PDF.
		if (toStage === 'WAITING_PRODUCTION') {
			const km = current.projectSections[0]
			if (!km || km.queueStatus !== 'DONE' || km.documents.length === 0) redirect(`/contracts/${params.id}?workflowError=km-final-file-required#workflow`)
		}
		await transitionContractStage({ contractId: params.id, toStage, actorId: acting.id, comment: String(formData.get('comment') ?? '') })
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'ContractWorkflowStage', entityId: params.id })
		redirect(`/contracts/${params.id}#workflow`)
	}

	async function revokePr1(formData: FormData) {
		'use server'
		const acting = await requireUser()
		if (!isAdmin(acting)) redirect(`/contracts/${params.id}`)
		const reason = String(formData.get('reason') ?? '').trim()
		if (!reason) redirect(`/contracts/${params.id}#workflow`)
		await revokePr1Confirmation({ contractId: params.id, actorId: acting.id, reason })
		await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'ContractPr1Revoked', entityId: params.id })
		redirect(`/contracts/${params.id}#workflow`)
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
		redirect(`/contracts/${params.id}#workflow`)
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

	const FOLDERS = [
		{ key: 'legal', label: 'Договоры' }, { key: 'estimate', label: 'Сметы' }, { key: 'source-data', label: 'Исходные данные' }, { key: 'KM', label: 'КМ' }, { key: 'KZH', label: 'КЖ' }, { key: 'AR', label: 'АР' }, { key: 'executive', label: 'Исполнительная' }, { key: 'other', label: 'Прочее' },
	]
	const folderFor = (document: typeof contract.documents[number]) => {
		if (document.projectSectionId) return contract.projectSections.find((section) => section.id === document.projectSectionId)?.code ?? 'other'
		if (document.kind === 'SOURCE_DATA') return 'source-data'
		if (document.kind === 'ESTIMATE') return 'estimate'
		if (['CONTRACT', 'AGREEMENT', 'APPENDIX', 'INVOICE', 'COMMERCIAL_PROPOSAL', 'SIGNED_SCAN'].includes(document.kind)) return 'legal'
		if (['EXECUTIVE', 'ACT', 'CERTIFICATE'].includes(document.kind)) return 'executive'
		return 'other'
	}
	const selectedFolder = FOLDERS.some((folder) => folder.key === searchParams.folder) ? searchParams.folder! : null
	const shownDocuments = selectedFolder ? contract.documents.filter((document) => folderFor(document) === selectedFolder) : contract.documents
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
		{ label: 'ИГИ', hint: 'инженерно-геологические изыскания', match: /(?:\bиги\b|инженерн(?:о|ые)[ -]?геолог)/i },
		{ label: 'ГПЗУ', hint: 'градостроительный план', match: /(?:\bгпзу\b|градостроительн)/i },
		{ label: 'Топосъёмка', hint: 'топографическая съёмка', match: /(?:топос[ъь]ем|топограф)/i },
		{ label: 'Геоподоснова', hint: 'геодезическая или топографическая основа', match: /(?:геоподоснов|геодезическ(?:ая|ий)?\s+основ)/i },
		{ label: 'Стеснённые условия', hint: 'сведения об ограничениях на площадке', match: /стеснен/i },
	].map((item) => ({ ...item, document: sourceDataDocuments.find((document) => item.match.test(document.fileName)) }))
	// Защищаем страницу от старых записей/Prisma Client, где новые связи ещё не возвращаются.
	const sites = contract.sites ?? []
	const executiveDocs = contract.executiveDocs ?? []
	const projectSections = contract.projectSections ?? []
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
				crumbs={[{ label: '\u0414\u043e\u0433\u043e\u0432\u043e\u0440\u044b', href: '/contracts' }, { label: contract.number }]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="px-[26px] py-[22px]">
				{searchParams.success && <div className="mb-[14px] rounded-[10px] border border-green-200 bg-green-50 px-[13px] py-[10px] text-[12.5px] font-medium text-green-800">{searchParams.success}</div>}
				{/* Шапка страницы */}
				<div className="work-hero mb-[20px] flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-[11px]">
							<h1 className="text-[26px] font-bold tracking-[-0.02em]">{contract.number}</h1>
							<StatusChip status={contract.status} />
							<Chip tone={workflowTone}>{WORKFLOW_STAGE_LABEL[contract.workflowStage]}</Chip>
						</div>
						<div className="mt-[5px] text-[13px] text-muted">
							{contract.cipher ?? '\u0428\u0438\u0444\u0440 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d'}
							{' \u00b7 \u043e\u0442 '}
							{formatDate(contract.date)}
							{contract.manager?.name ? ` \u00b7 \u041c\u0435\u043d\u0435\u0434\u0436\u0435\u0440: ${contract.manager.name}` : ''}
						</div>
					</div>

					{canEdit && (
						<div className="flex flex-wrap gap-[9px] sm:ml-auto sm:justify-end">
							<ContractHierarchy nodes={hierarchyNodes} />
							<a href={`/api/contracts/${contract.id}/download`} className="inline-flex h-[38px] items-center rounded-[10px] border border-line bg-surface px-[15px] text-[13.5px] font-semibold hover:bg-raised">Скачать всё</a>
							<Link
								href={`/contracts/${contract.id}/edit`}
								className="inline-flex h-[38px] items-center gap-[7px] rounded-[10px] border border-line bg-surface px-[15px] text-[13.5px] font-semibold hover:bg-raised"
							>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
									<path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
								</svg>
								{'\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c'}
							</Link>
							<Link
								href={`/contracts/${contract.id}/upload`}
								className="brand-gradient inline-flex h-[38px] items-center gap-[7px] rounded-[10px] px-[15px] text-[13.5px] font-semibold text-white"
							>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
									<path d="M12 4v11m0 0 4-4m-4 4-4-4M4 19h16" />
								</svg>
								{'\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442'}
							</Link>
							{isAdmin(user) && <form action={deleteContract}><button className="inline-flex h-[38px] items-center rounded-[10px] border border-danger/25 bg-danger/10 px-[12px] text-[12px] font-semibold text-danger hover:bg-danger/15">В корзину</button></form>}
						</div>
					)}
				</div>

				<div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_316px]">
					{/* ---------- Левая колонка ---------- */}
					<div className="flex min-w-0 flex-col gap-[18px]">
						{/* Карточка договора: контрагент слева, управленческие данные справа */}
						<Card className="overflow-hidden border-brand/10 shadow-[0_14px_34px_rgba(25,22,45,.055)]">
							<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,.94fr)_minmax(0,1.3fr)]">
								<div className="border-b border-line-soft bg-gradient-to-br from-brand-soft/55 to-surface p-[19px] lg:border-b-0 lg:border-r">
									<div className="flex items-center gap-3"><div className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-brand text-white"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V6l7-3 7 3v15M9 10h2M9 14h2M15 10h0M15 14h0" /></svg></div><div className="min-w-0"><div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-faint">Контрагент</div><Link href={`/contractors/${contract.contractor.id}?from=${contract.id}`} className="block truncate text-[16px] font-bold hover:text-brand-ink hover:underline">{contract.contractor.name}</Link></div></div>
									<div className="mt-[14px] grid grid-cols-2 gap-x-[20px] gap-y-[10px] text-[12px]"><div><div className="text-[10px] font-semibold uppercase text-faint">ИНН</div><div className="mt-1 flex items-center font-semibold">{contract.contractor.inn ?? '—'}<CopyValue value={contract.contractor.inn ?? ''} label="Скопировать ИНН" /></div></div><div><div className="text-[10px] font-semibold uppercase text-faint">Телефон</div><div className="mt-1 flex items-center font-semibold">{contract.contractor.phone ? <a href={`tel:${contract.contractor.phone.replace(/[^+\d]/g, '')}`} className="text-brand-ink hover:underline">{contract.contractor.phone}</a> : '—'}<CopyValue value={contract.contractor.phone ?? ''} label="Скопировать телефон" /></div></div><div className="col-span-2"><div className="text-[10px] font-semibold uppercase text-faint">Email</div><div className="mt-1 flex items-center font-semibold"><span className="truncate">{contract.contractor.email ? <a href={`mailto:${contract.contractor.email}`} className="text-brand-ink hover:underline">{contract.contractor.email}</a> : '—'}</span><CopyValue value={contract.contractor.email ?? ''} label="Скопировать email" /></div></div></div>
									<div className="mt-[15px] flex flex-wrap gap-2"><Link href={`/contractors/${contract.contractor.id}?from=${contract.id}`} className="inline-flex rounded-[8px] border border-brand/25 bg-surface/80 px-[10px] py-[7px] text-[11.5px] font-semibold text-brand-ink hover:bg-brand-soft">Открыть карточку контрагента →</Link><CopyContractorDetails name={contract.contractor.name} inn={contract.contractor.inn} phone={contract.contractor.phone} email={contract.contractor.email} address={contract.contractor.address} /></div>
								</div>
								<div className="p-[19px]"><div className="grid grid-cols-2 gap-x-[26px] gap-y-[12px] text-[12px]"><div><div className="text-[10px] font-semibold uppercase text-faint">Шифр договора</div><div className="mt-1 font-bold">{contract.cipher ?? '—'}</div></div><div><div className="text-[10px] font-semibold uppercase text-faint">Менеджер</div><div className="mt-1 font-semibold">{contract.manager?.name ?? 'Не назначен'}</div></div><div><div className="text-[10px] font-semibold uppercase text-faint">Подписание ПР1</div><div className="mt-1 font-semibold">{contract.pr1SignedAt ? formatDate(contract.pr1SignedAt) : 'Не подтверждено'}</div></div><div><div className="text-[10px] font-semibold uppercase text-faint">Рабочих дней</div><div className="mt-1 font-semibold">{contract.workingDays ?? '—'}</div></div><div><div className="text-[10px] font-semibold uppercase text-faint">Дедлайн договора</div><div className={`mt-1 font-semibold ${deadlineInfo.tone === 'danger' ? 'text-danger' : deadlineInfo.tone === 'warn' ? 'text-warn' : ''}`}>{contract.deadline ? formatDate(contract.deadline) : 'Не рассчитан'}</div></div><div><div className="text-[10px] font-semibold uppercase text-faint">Адрес объекта</div><div className="mt-1 truncate font-semibold">{contract.objectAddress ? <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(contract.objectAddress)}`} target="_blank" rel="noreferrer" className="text-brand-ink hover:underline">{contract.objectAddress}</a> : '—'}</div></div></div>
									{canSeeAmounts && <div className="mt-[16px] border-t border-line-soft pt-[12px]"><div className="text-[10px] font-semibold uppercase tracking-[.06em] text-faint">Стоимость договора</div><div className="mt-[4px] text-[20px] font-bold tracking-[-.02em]">{formatMoney(contract.amount, contract.currency)}</div>{hasPlanBreakdown && <div className="mt-[9px] grid grid-cols-3 gap-[6px] text-center text-[10.5px] text-muted"><div className="rounded-[8px] bg-raised p-[6px]">СМР<br/><b className="text-ink">{formatMoney(contract.smrAmount ?? 0, contract.currency)}</b></div><div className="rounded-[8px] bg-raised p-[6px]">МК<br/><b className="text-ink">{formatMoney(contract.mkAmount ?? 0, contract.currency)}</b></div><div className="rounded-[8px] bg-raised p-[6px]">Доставка<br/><b className="text-ink">{formatMoney(contract.deliveryAmount ?? 0, contract.currency)}</b></div></div>}</div>}
								</div>
							</div>
						</Card>

						<ContractSectionNav sections={[
							{ id: 'workflow', label: 'Ход договора' },
							{ id: 'agreements', label: 'Соглашения' },
							{ id: 'documents', label: 'Документы' },
							{ id: 'project', label: 'Проект' },
							...(site ? [{ id: 'site', label: 'Площадка' }] : []),
							...(needsExecutive ? [{ id: 'executive', label: 'Исполнительная' }] : []),
							{ id: 'tasks', label: 'Задачи' },
							{ id: 'history', label: 'История' },
						]} />

						{/* Дополнительные соглашения */}
						<Card id="workflow">
							<CardHeader title="Ход договора" extra={<Chip tone={contract.workflowStage === 'CLOSED' ? 'ok' : contract.workflowStage === 'DESIGN' ? 'brand' : 'off'}>{WORKFLOW_STAGE_LABEL[contract.workflowStage]}</Chip>} />
							<div className="p-[18px]">
								{!contract.pr1ConfirmedAt && (latestPr1 ? (
									<form action={confirmPr1} className="rounded-[11px] border border-brand/25 bg-brand/5 p-[12px]">
										<div className="text-[12.5px] font-bold">Подтвердить подписанное Приложение №1</div>
										<div className="mt-1 text-[11.5px] leading-5 text-muted">Система создаст нужные разделы, задачи и площадку для СМР.</div>
										<div className="mt-3 grid gap-[8px] sm:grid-cols-[1fr_140px_auto]"><input name="signedAt" type="date" defaultValue={(latestPr1.signedAt ?? new Date()).toISOString().slice(0, 10)} className="h-[35px] rounded-[8px] border border-line bg-surface px-[9px] text-[12px]" /><input name="workingDays" type="number" min="1" max="730" defaultValue={contract.workingDays ?? ''} placeholder="Рабочих дней" className="h-[35px] rounded-[8px] border border-line bg-surface px-[9px] text-[12px]" /><button className="brand-gradient rounded-[8px] px-[12px] text-[12px] font-semibold text-white">Подтвердить ПР1</button></div>
									</form>
								) : <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-[11px] border border-warn/25 bg-warn-bg p-[12px]"><div><div className="text-[12.5px] font-bold">Нужен подписанный файл ПР1</div><div className="mt-1 text-[11.5px] text-muted">Откройте отдельную зону, перетащите файл и подтвердите дату.</div></div>{canEdit && <Link href={`/contracts/${contract.id}/upload?pr1=1`} className="rounded-[8px] border border-line bg-surface px-[11px] py-[7px] text-[11.5px] font-semibold">Загрузить ПР1</Link>}</div>)}

								{isAdmin(user) && contract.pr1ConfirmedAt && <form action={revokePr1} className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t border-line-soft pt-[12px]"><span className="text-[11.5px] text-faint">Админ: отмена ошибочного ПР1</span><input name="reason" required placeholder="Причина отмены" className="h-[34px] min-w-[180px] flex-1 rounded-[8px] border border-danger/25 bg-surface px-[9px] text-[12px]" /><button className="h-[34px] rounded-[8px] border border-danger/30 bg-danger/10 px-[11px] text-[12px] font-semibold text-danger">Отменить ПР1</button></form>}
								{canEdit && nextWorkflowStages.length > 0 && <form action={moveWorkflowStage} className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t border-line-soft pt-[12px]"><span className="text-[11.5px] text-muted">Следующий шаг:</span><select name="toStage" className="h-[34px] rounded-[8px] border border-line bg-surface px-[9px] text-[12px]">{nextWorkflowStages.map((stage) => <option key={stage} value={stage}>{WORKFLOW_STAGE_LABEL[stage]}</option>)}</select><input name="comment" placeholder="Комментарий (необязательно)" className="h-[34px] min-w-[180px] flex-1 rounded-[8px] border border-line bg-surface px-[9px] text-[12px]" /><button className="h-[34px] rounded-[8px] border border-brand/30 bg-brand/10 px-[11px] text-[12px] font-semibold text-brand-ink">Перевести</button></form>}
								{workflowError && <div className="mt-[10px] flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warn/30 bg-warn-bg px-[11px] py-[9px] text-[11.5px] text-warn"><span><b>Передача в цех пока заблокирована.</b> Нужны: готовый раздел КМ и итоговый PDF.</span><Link href={`/projects?view=production`} className="font-semibold text-brand-ink hover:underline">Открыть буфер цеха →</Link></div>}

								{isAdmin(user) && <details className="group mt-[12px] overflow-hidden rounded-[11px] border border-dashed border-brand/35 bg-gradient-to-r from-brand/10 via-brand-soft/45 to-surface"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-[12px] py-[10px]"><span><b className="block text-[11.5px] text-brand-ink">Демо-панель администратора</b><span className="mt-0.5 block text-[10.5px] text-muted">Тестовые переходы без загрузки файлов</span></span><span className="grid h-7 w-7 place-items-center rounded-lg bg-surface text-brand-ink transition-transform group-open:rotate-180">⌄</span></summary><div className="grid gap-2 border-t border-brand/15 p-[10px] sm:grid-cols-2"><form action={applyDemoStep} className="rounded-[9px] border border-line bg-surface/85 p-[10px]"><input type="hidden" name="step" value="pr1" /><b className="block text-[11px]">1. Подтвердить ПР1</b><span className="mt-1 block text-[10px] leading-4 text-muted">Создаст площадку, проектные разделы и задачи.</span><button className="mt-2 rounded-lg bg-brand px-2.5 py-1.5 text-[10.5px] font-semibold text-white transition hover:brightness-110">Сделать ПР1 подписанным</button></form><form action={applyDemoStep} className="rounded-[9px] border border-line bg-surface/85 p-[10px]"><input type="hidden" name="step" value="production" /><b className="block text-[11px]">2. Завершить проектирование</b><span className="mt-1 block text-[10px] leading-4 text-muted">Переведёт договор в ожидание производства только для демонстрации.</span><button className="mt-2 rounded-lg border border-brand/30 bg-brand-soft px-2.5 py-1.5 text-[10.5px] font-semibold text-brand-ink transition hover:bg-brand hover:text-white">КМ готов → в буфер</button></form></div></details>}
								{contract.stageHistory.length > 0 && <div className="mt-[14px] border-t border-line-soft pt-[12px]"><div className="mb-[7px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">Последние изменения</div><div className="flex flex-col gap-[6px]">{contract.stageHistory.slice(0, 5).map((item) => <div key={item.id} className="flex items-start justify-between gap-3 text-[11.5px]"><div><span className="font-medium">{item.fromStage ? `${WORKFLOW_STAGE_LABEL[item.fromStage]} → ` : ''}{WORKFLOW_STAGE_LABEL[item.toStage]}</span>{item.comment ? <span className="text-muted"> · {item.comment}</span> : null}<span className="text-faint"> · {item.isAutomatic ? 'автоматически' : item.changedBy?.name ?? 'система'}</span></div><span className="flex-none text-faint">{formatDateTime(item.createdAt)}</span></div>)}</div></div>}
							</div>
						</Card>

						<Card id="agreements">
							<CardHeader
								title={'\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f'}
								extra={
									canEdit ? (
										<span className="flex items-center gap-[12px] text-[12px]">
											<Link href={`/contracts/${contract.id}/agreements/new`} className="text-brand-ink hover:underline">
												{'+ \u0414\u0421'}
											</Link>
											<Link href={`/contracts/${contract.id}/estimates/new`} className="text-brand-ink hover:underline">
												{'+ \u0421\u043c\u0435\u0442\u0430'}
											</Link>
											<span className="text-muted">{contract.agreements.length}</span>
										</span>
									) : (
										contract.agreements.length || undefined
									)
								}
							/>
							{contract.agreements.length === 0 ? (
								<EmptyState text={'\u0414\u043e\u043f. \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0439 \u043d\u0435\u0442'} />
							) : (
								<div className="px-[10px] py-[6px]">
									{contract.agreements.map((a) => {
										const est = a.estimates[0]
										return (
											<div key={a.id} className="flex items-center gap-[11px] rounded-[10px] px-[8px] py-[9px] hover:bg-raised">
												<div className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-brand-soft text-[9px] font-bold text-brand-ink">
													{'\u0414\u0421'}
												</div>
												<div className="min-w-0">
													<div className="truncate text-[13px] font-medium">
														{agreementTitle(a.number)}
													</div>
													<div className="mt-[2px] text-[11.5px] text-faint">
														{est
													? `${estimateTitle(est.number)}${canSeeAmounts && est.amount != null ? ` \u00b7 ${formatMoney(est.amount)}` : ''}`
															: '\u0411\u0435\u0437 \u0441\u043c\u0435\u0442\u044b'}
													</div>
												</div>
												<div className="tnum ml-auto text-[11.5px] text-faint">{formatDate(a.date)}</div>
											</div>
										)
									})}
								</div>
							)}
						</Card>

						{/* Документы, сгруппированные по типу */}
						<Card id="documents">
							<CardHeader
								title={'\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b'}
								extra={plural(contract.documents.length, '\u0444\u0430\u0439\u043b', '\u0444\u0430\u0439\u043b\u0430', '\u0444\u0430\u0439\u043b\u043e\u0432')}
							/>
							<div className="flex gap-1 overflow-x-auto border-b border-line-soft px-3 py-2.5">
								<Link href={`/contracts/${contract.id}#documents`} className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${!selectedFolder ? 'bg-brand text-white' : 'bg-raised text-muted hover:text-ink'}`}>Все · {contract.documents.length}</Link>
								{FOLDERS.map((folder) => { const count = contract.documents.filter((document) => folderFor(document) === folder.key).length; return <Link key={folder.key} href={`/contracts/${contract.id}?folder=${folder.key}#documents`} className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${selectedFolder === folder.key ? 'bg-brand text-white' : 'bg-raised text-muted hover:text-ink'}`}>{folder.label} · {count}</Link> })}
							</div>
							{(!selectedFolder || selectedFolder === 'source-data') && <div className="mx-[11px] mt-[11px] rounded-[11px] border border-brand/15 bg-brand/5 p-3">
								<div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="text-[12.5px] font-bold">Исходные данные от заказчика</div><div className="mt-1 text-[10.5px] text-muted">ИГИ, ГПЗУ, топосъёмка и сведения о стеснённых условиях хранятся отдельно от смет и проектов.</div></div>{canEdit && <Link href={`/contracts/${contract.id}/upload?kind=SOURCE_DATA`} className="rounded-[8px] border border-brand/25 bg-surface px-2.5 py-1.5 text-[10.5px] font-semibold text-brand-ink hover:bg-brand-soft">+ Добавить</Link>}</div>
								<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{sourceDataChecklist.map((item) => <div key={item.label} className={`rounded-[8px] border px-2.5 py-2 ${item.document ? 'border-ok/25 bg-ok/5' : 'border-line-soft bg-surface/60'}`}><div className="flex items-center gap-1.5 text-[10.5px] font-bold"><span className={item.document ? 'text-ok' : 'text-faint'}>{item.document ? '●' : '○'}</span>{item.label}</div><div className="mt-1 truncate text-[10px] text-faint">{item.document ? item.document.fileName : item.hint}</div></div>)}</div>
							</div>}
							<div className={`mx-[11px] mt-[11px] flex flex-wrap items-center gap-[10px] rounded-[11px] border px-[12px] py-[10px] ${latestPr1 ? contract.pr1ConfirmedAt ? 'border-ok/25 bg-ok-bg' : 'border-warn/25 bg-warn-bg' : 'border-line-soft bg-raised/50'}`}>
								<div className="grid h-8 w-8 place-items-center rounded-[8px] bg-surface text-[10px] font-bold text-brand-ink">{`\u041f\u04201`}</div>
								<div className="min-w-0 flex-1"><div className="text-[12px] font-bold">{`\u041f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u043d\u043e\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u21161`}</div>{latestPr1 ? <Link href={`/documents/${latestPr1.id}`} className="mt-[2px] block truncate text-[11px] font-semibold text-brand-ink hover:underline">{latestPr1.fileName}</Link> : <div className="mt-[2px] text-[11px] text-muted">{`\u0424\u0430\u0439\u043b \u0435\u0449\u0451 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d`}</div>}</div>
								{latestPr1 ? <a href="#workflow" className={`rounded-[8px] px-[10px] py-[6px] text-[11px] font-semibold ${contract.pr1ConfirmedAt ? 'bg-ok/10 text-ok' : 'bg-warn/15 text-warn'}`}>{contract.pr1ConfirmedAt ? `\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043e` : `\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c`}</a> : canEdit && <Link href={`/contracts/${contract.id}/upload?pr1=1`} className="rounded-[8px] border border-line bg-surface px-[10px] py-[6px] text-[11px] font-semibold">{`\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u041f\u04201`}</Link>}
							</div>
							{contract.documents.length === 0 ? (
								<EmptyState text={'\u0424\u0430\u0439\u043b\u043e\u0432 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442'} />
							) : (
								<div className="space-y-[9px] p-[11px]">
									{documentSections.map((section) => <details key={section.key} open={section.key === 'SOURCE' && section.documents.length <= 6} className="overflow-hidden rounded-[11px] border border-line-soft">
									<summary className="group/state flex cursor-pointer list-none items-center gap-3 bg-raised/60 px-3 py-2.5 transition hover:bg-brand/5"><span className="text-faint transition-transform group-open/state:rotate-90"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg></span><span className="min-w-0 flex-1"><span className="block text-[12.5px] font-bold">{section.label}</span><span className="block text-[10px] text-faint">{section.hint}</span></span><span className="hidden text-[10px] font-medium text-faint sm:inline">{section.documents.length > 12 ? 'Открыть список' : ''}</span><span className="rounded-full bg-surface px-2 py-1 text-[10px] font-bold text-muted">{section.documents.length}</span></summary>
										<div className="px-2 pb-2">{canEdit && <div className="flex justify-end px-2 pt-2"><Link href={`/contracts/${contract.id}/upload?state=${section.key}`} className="rounded-[7px] border border-line bg-surface px-2.5 py-1 text-[10.5px] font-semibold text-brand-ink hover:bg-brand-soft">+ Загрузить в эту папку</Link></div>}{section.kinds.length === 0 && <div className="px-2 py-4 text-center text-[11px] text-faint">В этом разделе файлов пока нет</div>}{section.kinds.map((kind) => <div key={kind}>
											<div className="flex items-center gap-2 px-2 pb-1 pt-3"><span className="text-[11px] font-bold text-muted">{DOCUMENT_KIND_LABELS[kind]}</span><span className="text-[10px] text-faint">{section.byKind.get(kind)!.length}</span></div>
											{section.byKind.get(kind)!.slice(0, 12).map((d) => (
							<div key={d.id} className="interactive-row flex items-center gap-2 rounded-[10px] px-[8px] py-[4px]">
												<Link href={`/documents/${d.id}`} className="flex min-w-0 flex-1 items-center gap-[11px] py-[5px]">
													<FileIcon fileName={d.fileName} />
													<div className="min-w-0">
														<div className="truncate text-[13px] font-medium">{d.fileName}</div>
														<div className="mt-[2px] text-[11.5px] text-faint">
															{formatBytes(d.sizeBytes)}
															{` · ${stateLabel[d.state]}`}
															{d.signedAt ? ` \u00b7 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d ${formatDate(d.signedAt)}` : ''}
															{d.isConfidential ? ' \u00b7 \u041a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u043e' : ''}
														</div>
													</div>
												</Link>
												{canEdit && <form action={changeDocumentState}><input type="hidden" name="documentId" value={d.id} /><button className="rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[10.5px] font-semibold text-muted hover:border-brand/40 hover:text-brand-ink">{d.state === 'ARCHIVE' ? 'Восстановить' : 'В архив'}</button></form>}
												{isAdmin(user) && <form action={deleteDocument}><input type="hidden" name="documentId" value={d.id} /><button className="rounded-[7px] border border-danger/20 bg-danger/5 px-2 py-1.5 text-[10.5px] font-semibold text-danger hover:bg-danger/10">Удалить</button></form>}
												</div>
											))}
											{section.byKind.get(kind)!.length > 12 && <Link href={`/documents?contractId=${contract.id}&kind=${kind}&state=${section.key}`} className="mx-2 mt-1 inline-flex rounded-[8px] border border-dashed border-line-soft bg-raised/40 px-2.5 py-2 text-[11px] font-semibold text-brand-ink hover:bg-brand-soft">Показать все {section.byKind.get(kind)!.length} файлов в реестре</Link>}
										</div>)}</div>
									</details>)}
								</div>
							)}
						</Card>

						<Card id="history" className="order-last">
							<CardHeader title="История действий" extra={`${auditLogs.length} событий`} />
							{auditLogs.length === 0 ? <EmptyState text="История начнёт заполняться после изменений и загрузок" /> : <div>{auditLogs.map((log) => {
								const objectName = documentNameById.get(log.entityId) ?? `договор № ${contract.number}`
								const actionLabel = log.entityType === 'DocumentArchived' ? 'отправил в архив' : log.entityType === 'DocumentRestored' ? 'восстановил версию' : log.action === 'UPLOAD' ? 'загрузил файл' : log.action === 'DOWNLOAD' ? 'скачал файл' : log.action === 'CREATE' ? 'создал' : log.action === 'DELETE' ? 'удалил' : 'изменил'
								return <div key={log.id} className="flex items-start gap-3 border-b border-line-soft px-4 py-3 last:border-0"><div className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-brand-soft text-brand"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/></svg></div><div className="min-w-0 flex-1"><div className="text-[12px]"><b>{log.user.name}</b> {actionLabel} <span className="font-medium">{objectName}</span></div><div className="mt-1 text-[10.5px] text-faint">{formatDateTime(log.createdAt)}</div></div></div>
							})}</div>}
						</Card>
						{/* Площадка */}
						{site && (
						<Card id="site" className="overflow-hidden">
							<details open={site.status === 'ISSUE' || site.status === 'BLOCKED'} className="group/site">
								<summary className="flex cursor-pointer list-none items-center gap-3 px-[19px] py-[14px] transition hover:bg-raised/50"><span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand-ink transition-transform group-open/site:rotate-180">⌄</span><span className="min-w-0"><span className="block text-[14px] font-bold tracking-[-.01em]">{'\u041f\u043b\u043e\u0449\u0430\u0434\u043a\u0430'}</span><span className="mt-0.5 block truncate text-[10.5px] text-faint">{site.address} · {plural(site.events.length, 'запись', 'записи', 'записей')}</span></span><span className="ml-auto"><Chip tone={SITE_STATUS[site.status].tone}>{SITE_STATUS[site.status].label}</Chip></span></summary>
								<div className="border-t border-line-soft p-[18px]">
									<div className="mb-[14px] text-[13px] text-muted">{site.address}</div>
									<div className="relative flex flex-col gap-[16px] before:absolute before:bottom-[10px] before:left-[8px] before:top-[10px] before:w-px before:bg-line">
										{site.events.map((e) => (
											<div key={e.id} className="relative pl-[28px]">
												<span
													className={`absolute left-[2px] top-[3px] h-[13px] w-[13px] rounded-full ring-4 ring-surface ${
														EVENT_DOT[e.type] ?? 'bg-brand'
													}`}
												/>
												<div className="tnum text-[11px] text-faint">{formatDateTime(e.occurredAt)}</div>
												<div className="mt-[3px] text-[12.5px] leading-[1.45]">{e.text}</div>
											</div>
										))}
										{site.events.length === 0 && (
											<div className="pl-[28px] text-[12.5px] text-faint">
												{'\u0421\u043e\u0431\u044b\u0442\u0438\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442'}
											</div>
										)}
									</div>
									<Link
										href={`/sites/${site.id}`}
										className="mt-[14px] inline-flex h-[36px] items-center justify-center rounded-[10px] border border-line bg-surface px-[15px] text-[13px] font-semibold hover:bg-raised"
									>
										{'\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435 \u043e \u043f\u043b\u043e\u0449\u0430\u0434\u043a\u0435'}
									</Link>
								</div>
							</details>
						</Card>
						)}

						{/* Проект */}
						<Card id="project">
							<CardHeader title={'\u041f\u0440\u043e\u0435\u043a\u0442'} extra={projectSections.length || undefined} />
							{projectSections.length === 0 ? (
								<EmptyState text={'\u0420\u0430\u0437\u0434\u0435\u043b\u044b \u043f\u0440\u043e\u0435\u043a\u0442\u0430 \u043d\u0435 \u0437\u0430\u0432\u0435\u0434\u0435\u043d\u044b'} />
							) : (
								<div className="grid grid-cols-1 gap-[12px] p-[18px] sm:grid-cols-2 xl:grid-cols-3">
									{projectSections.map((s) => (
										<div key={s.id} className="rounded-[12px] border border-line bg-raised/40 p-[14px]">
											<div className="inline-flex items-center rounded-[7px] bg-brand-soft px-[9px] py-[3px] text-[11.5px] font-bold text-brand-ink">
												{PROJECT_SECTION_LABEL[s.code] ?? s.code}
											</div>
											<div className="mt-[10px] truncate text-[13px] font-medium">
												{s.responsible?.name ?? '\u041e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 \u043d\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d'}
											</div>
											<div className="tnum mt-[4px] text-[11.5px] text-faint">
												{s.dateFrom ? formatDate(s.dateFrom) : '\u2014'}
												{' \u2013 '}
												{s.dateTo ? formatDate(s.dateTo) : '\u2014'}
											</div>
											<div className="mt-3 flex flex-wrap gap-1.5">{s.documents.length ? s.documents.map((document) => <a key={document.id} href={`/api/documents/${document.id}`} className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-bold text-brand-ink transition hover:border-brand/40 hover:bg-brand-soft">↓ {document.kind === 'PROJECT_PDF' ? 'PDF' : 'DWG'}</a>) : <span className="text-[10px] text-warn">Итоговые PDF/DWG ещё не загружены</span>}</div>
										</div>
									))}
								</div>
							)}
						</Card>

						<Card id="tasks">
							<CardHeader title="Задачи" extra={openTasks.length || undefined} />
							{openTasks.length === 0 ? (
								<EmptyState text="Открытых задач по договору нет" />
							) : (
								<div className="flex flex-col p-[10px]">
									{openTasks.map((task) => {
										const overdue = Boolean(task.dueDate && task.dueDate < new Date())
										return (
											<Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-[12px] rounded-[10px] px-[9px] py-[9px] hover:bg-raised">
												<div className="min-w-0 flex-1">
													<div className="truncate text-[12.5px] font-semibold">{task.title}</div>
													<div className="mt-[2px] truncate text-[11px] text-muted">{task.assignee.name}{task.category ? ` · ${task.category}` : ''}</div>
												</div>
												<span className={`text-[11.5px] ${overdue ? 'font-semibold text-danger' : 'text-muted'}`}>{formatDate(task.dueDate)}</span>
												<Chip tone={task.status === 'IN_PROGRESS' ? 'brand' : 'off'}>{task.status === 'IN_PROGRESS' ? 'В работе' : 'Не начато'}</Chip>
											</Link>
										)
									})}
									<Link href={`/tasks?contract=${contract.id}`} className="mt-[6px] rounded-[9px] border border-line px-[12px] py-[8px] text-center text-[11.5px] font-semibold hover:bg-raised">Все задачи и создание новой →</Link>
								</div>
							)}
						</Card>

						{/* Исполнительная документация */}
						<Card id="executive">
							<CardHeader title={'\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f'} extra={executiveDocs.length || undefined} />
							{executiveDocs.length === 0 ? (
								<EmptyState text={'\u0421\u043f\u0438\u0441\u043e\u043a \u043f\u0443\u0441\u0442'} />
							) : (
								<div className="flex flex-col gap-[2px] p-[10px]">
									{executiveDocs.map((ed) => (
										<div key={ed.id} className="flex items-center gap-3 rounded-[10px] px-[8px] py-[9px] hover:bg-raised">
											<span className="min-w-0 flex-1 truncate text-[13px]">{ed.name}</span>
											<ExecStatusChip status={ed.status} />
										</div>
									))}
								</div>
							)}
						</Card>
					</div>

					{/* ---------- Правая колонка ---------- */}
					<div className="flex flex-col gap-[18px] xl:sticky xl:top-[76px]">
						{canSeeAmounts && (
							<Card className="p-[18px]">
								<div className="text-[11.5px] text-muted">
									{'\u0421\u0443\u043c\u043c\u0430 \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u0430'}
								</div>
								<div className="tnum mt-[5px] text-[23px] font-bold tracking-[-0.01em]">
									{formatMoney(contract.amount, contract.currency)}
								</div>
								<div className="mt-[4px] text-[11.5px] text-faint">
									{'\u0432\u043a\u043b. '}
									{plural(
										contract.agreements.length,
										'\u0434\u043e\u043f. \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435',
										'\u0434\u043e\u043f. \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f',
										'\u0434\u043e\u043f. \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0439',
									)}
								</div>
								{(contract.smrAmount != null || contract.mkAmount != null || contract.deliveryAmount != null) && <div className="mt-[13px] grid grid-cols-3 gap-[5px] border-t border-line-soft pt-[11px] text-center text-[10.5px] text-muted"><div>СМР<br/><b className="tnum text-[11.5px] text-ink">{formatMoney(contract.smrAmount ?? 0, contract.currency)}</b></div><div>МК<br/><b className="tnum text-[11.5px] text-ink">{formatMoney(contract.mkAmount ?? 0, contract.currency)}</b></div><div>Доставка<br/><b className="tnum text-[11.5px] text-ink">{formatMoney(contract.deliveryAmount ?? 0, contract.currency)}</b></div></div>}
							</Card>
						)}

						{canSeeAmounts && (
							<Card>
								<CardHeader title="План / факт затрат" extra={siteWorks.length ? `${siteWorks.length} отч.` : 'нет отчётов'} />
								<div className="p-[18px]">
									<div className="grid grid-cols-3 gap-[7px] text-center text-[10.5px] text-muted">
										<div className="rounded-[8px] bg-raised p-[7px]">Выручка<br/><b className="tnum text-[11.5px] text-ink">{formatMoney(contract.amount, contract.currency)}</b></div>
										<div className="rounded-[8px] bg-raised p-[7px]">Факт затрат<br/><b className="tnum text-[11.5px] text-warn">{formatMoney(actualCosts, contract.currency)}</b></div>
										<div className="rounded-[8px] bg-raised p-[7px]">Маржа*<br/><b className={`tnum text-[11.5px] ${margin < 0 ? 'text-danger' : 'text-ok'}`}>{formatMoney(margin, contract.currency)}</b></div>
									</div>
									{costShare != null ? <><div className="mt-[13px] flex items-center justify-between text-[11.5px]"><span className="text-muted">Освоение бюджета</span><span className={`tnum font-semibold ${actualCosts > planBreakdown ? 'text-danger' : 'text-ink'}`}>{costShare}%</span></div><div className="mt-[6px]"><ProgressBar percent={costShare} tone={actualCosts > planBreakdown ? 'danger' : costShare >= 80 ? 'warn' : 'brand'} height={7} /></div><div className={`mt-[7px] text-[11.5px] ${budgetLeft < 0 ? 'text-danger' : 'text-muted'}`}>{budgetLeft < 0 ? `Перерасход: ${formatMoney(Math.abs(budgetLeft), contract.currency)}` : `Остаток бюджета: ${formatMoney(budgetLeft, contract.currency)}`}</div></> : <div className="mt-[12px] rounded-[8px] bg-raised px-[10px] py-[8px] text-[11.5px] text-muted">Заполните СМР, МК и доставку в редактировании договора — появится контроль бюджета.</div>}
									{siteWorks.length > 0 && <div className="mt-[10px] flex justify-between text-[11px] text-faint"><span>КЖ: {formatMoney(actualKjCosts, contract.currency)}</span><span>КМ: {formatMoney(actualKmCosts, contract.currency)}</span></div>}
									{site && <Link href={`/sites/${site.id}`} className="mt-[11px] inline-block text-[11.5px] font-semibold text-brand-ink hover:underline">Открыть отчёты площадки →</Link>}
									<div className="mt-[7px] text-[10px] text-faint">* Предварительно: выручка договора минус занесённые расходы площадки.</div>
								</div>
							</Card>
						)}

						<Card>
							<CardHeader title="Готовность договора" extra={`${completion}%`} />
							<div className="p-[18px]">
								<ProgressBar percent={completion} height={9} tone={completion === 100 ? 'ok' : completion >= 50 ? 'brand' : 'warn'} />
								<div className="mt-[14px] flex flex-col gap-[4px]">
									{progressParts.map((item) => (
										<a key={item.label} href={item.href} className="flex items-center gap-[9px] rounded-[8px] px-[7px] py-[7px] text-[12.5px] hover:bg-raised">
											<span className={`grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] font-bold ${item.ready ? 'bg-ok-bg text-ok' : 'bg-off-bg text-faint'}`}>{item.ready ? '✓' : '—'}</span>
											<span className="min-w-0 flex-1"><span className="block">{item.label}</span><span className="mt-0.5 block text-[10px] font-normal text-faint">{progressDetail(item)}</span></span>
											<span className="text-faint">›</span>
										</a>
									))}
								</div>
								<div className={`mt-[14px] rounded-[10px] border p-[11px] ${closingBlockers.length === 0 ? 'border-ok/25 bg-ok-bg' : 'border-warn/25 bg-warn-bg'}`}>
									<div className={`text-[11px] font-bold uppercase tracking-[0.08em] ${closingBlockers.length === 0 ? 'text-ok' : 'text-warn'}`}>
										{closingBlockers.length === 0 ? 'Готов к закрытию' : 'Следующие действия'}
									</div>
									{closingBlockers.length > 0 && (
										<div className="mt-[7px] flex flex-col gap-[6px]">
											{closingBlockers.map((blocker, index) => (
												<div key={blocker} className="flex gap-[7px] text-[11.5px] leading-4 text-muted">
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
								<div className="p-[10px]">
									{problemEvent && <Link href={`/sites/${site!.id}`} className="block rounded-[9px] px-[9px] py-[8px] hover:bg-raised"><div className="text-[12.5px] font-semibold text-danger">Проблема на площадке</div><div className="mt-[3px] line-clamp-2 text-[11.5px] leading-4 text-muted">{problemEvent.text}</div></Link>}
									{overdueProjects.map((project) => <Link key={project.id} href={`/projects?section=${project.code}`} className="block rounded-[9px] px-[9px] py-[8px] hover:bg-raised"><div className="text-[12.5px] font-semibold text-danger">Просрочен раздел {PROJECT_SECTION_LABEL[project.code] ?? project.code}</div><div className="mt-[3px] text-[11.5px] text-muted">Дедлайн: {formatDate(project.deadline)}</div></Link>)}
									{overdueTasks.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="block rounded-[9px] px-[9px] py-[8px] hover:bg-raised"><div className="truncate text-[12.5px] font-semibold text-danger">Просрочена задача: {task.title}</div><div className="mt-[3px] text-[11.5px] text-muted">Срок: {formatDate(task.dueDate)} · {task.assignee.name}</div></Link>)}
									{!site && <Link href={`/sites/new?contract=${contract.id}`} className="block rounded-[9px] px-[9px] py-[8px] hover:bg-raised"><div className="text-[12.5px] font-semibold text-warn">Площадка не создана</div><div className="mt-[3px] text-[11.5px] text-muted">Создать площадку из этого договора →</div></Link>}
								</div>
							</Card>
						)}

						<ChatPanel title="Чат по договору" endpoint={`/api/chats/contract/${contract.id}`} />

						<Card>
							<CardHeader title="Быстрые действия" />
							<div className="grid grid-cols-2 gap-[8px] p-[12px]">
								<Link href={`/executive/${contract.id}`} className="rounded-[9px] border border-line bg-surface px-[10px] py-[9px] text-center text-[11.5px] font-semibold hover:bg-raised">Исполнительная документация</Link>
								<Link href={site ? `/sites/${site.id}` : `/sites/new?contract=${contract.id}`} className="rounded-[9px] border border-line bg-surface px-[10px] py-[9px] text-center text-[11.5px] font-semibold hover:bg-raised">Площадка</Link>
								<Link href={`/projects?section=KM`} className="rounded-[9px] border border-line bg-surface px-[10px] py-[9px] text-center text-[11.5px] font-semibold hover:bg-raised">Очередь КМ</Link>
								<Link href={`/projects?section=KZH`} className="rounded-[9px] border border-line bg-surface px-[10px] py-[9px] text-center text-[11.5px] font-semibold hover:bg-raised">Очередь КЖ</Link>
							</div>
						</Card>

					</div>
				</div>
			</div>
		</>
	)
}
