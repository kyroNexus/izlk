import { redirect } from 'next/navigation'
import type { DocumentKind } from '@prisma/client'
import Topbar from '@/components/Topbar'
import { prisma } from '@/lib/prisma'
import { Card, CardHeader, Chip, EmptyState, FormError, selectClass } from '@/components/ui'
import { DOCUMENT_KIND_LABELS, DOCUMENT_KIND_ORDER, formatBytes, formatDateTime, initials } from '@/lib/format'
import { isAdmin, requireUser } from '@/lib/access'
import { writeAudit, writeImportEvent } from '@/lib/audit'
import { importInboxFile, readStoredFile } from '@/lib/storage'
import { parseContractFile } from '@/lib/contract-parser'
import { runRateLimitedInboxScan } from '@/lib/inbox-scan-runner'
import { EXEC_TEMPLATES } from '@/lib/executive'
import { getInboxWatcherStatus } from '@/lib/inbox-watcher-status'
import { notify } from '@/lib/notifications'
import { removeUnusedImportedContractor, rollbackNewContractImport } from '@/lib/contract-import-cleanup'
import { grantDesignReadAccess } from '@/lib/access'
import { trySyncWorkflowAfterDocumentUpload } from '@/lib/contract-workflow'
import { createVersionedDocument } from '@/lib/document-versioning'
import { findMatchingContractor } from '@/lib/contractor-match'

export const dynamic = 'force-dynamic'

/**
 * Очередь импорта. Раньше сканер scripts/scan-inbox.ts заполнял InboxItem,
 * но в интерфейсе эти записи нигде не показывались — пункт меню вёл на 404.
 */
export default async function InboxPage({ searchParams }: { searchParams: { error?: string } }) {
	const user = await requireUser()
	if (!isAdmin(user)) redirect('/')

	const [items, contracts, watcher, recent, statusGroups] = await Promise.all([
		prisma.inboxItem.findMany({
			where: { status: { in: ['PENDING', 'SUGGESTED', 'FAILED'] } },
			orderBy: { createdAt: 'desc' },
			take: 100,
			select: {
				id: true,
				fileName: true,
				sourcePath: true,
				sizeBytes: true,
				status: true,
				createdAt: true,
				parsedContractNumber: true,
				parsedCipher: true,
				suggestedKind: true,
				matchedContractId: true,
				errorMessage: true,
			},
		}),
		prisma.contract.findMany({
			where: { deletedAt: null },
			select: { id: true, number: true, cipher: true },
			orderBy: { date: 'desc' },
			take: 500,
		}),
		getInboxWatcherStatus(),
		prisma.inboxItem.findMany({ where: { status: { in: ['MATCHED', 'IGNORED'] } }, orderBy: { updatedAt: 'desc' }, take: 15 }),
		prisma.inboxItem.groupBy({ by: ['status'], _count: { _all: true } }),
	])
	const statusCount = new Map(statusGroups.map((row) => [row.status, row._count._all]))
	const contractById = new Map(contracts.map((contract) => [contract.id, contract]))
	const recentPrimary = recent.slice(0, 5)
	const recentRest = recent.slice(5)

	async function confirmImport(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!isAdmin(actingUser)) redirect('/')

		// Явный тип never нужен для корректного сужения типов после fail().
		const fail: (message: string) => never = (message) =>
			redirect(`/inbox?error=${encodeURIComponent(message)}`)

		const itemId = String(formData.get('itemId') ?? '')
		const contractId = String(formData.get('contractId') ?? '')
		const kindRaw = String(formData.get('kind') ?? 'OTHER')
		const kind = (DOCUMENT_KIND_ORDER as readonly string[]).includes(kindRaw)
			? (kindRaw as DocumentKind)
			: ('OTHER' as DocumentKind)

		if (!contractId) fail('Выберите договор для привязки файла')

		const item = await prisma.inboxItem.findUnique({
			where: { id: itemId },
			select: { id: true, fileName: true, sourcePath: true, sha256: true },
		})
		if (!item) fail('Запись очереди не найдена')

		const contract = await prisma.contract.findFirst({
			where: { id: contractId, deletedAt: null },
			select: { id: true },
		})
		if (!contract) fail('Договор не найден')

		const source = item as { id: string; fileName: string; sourcePath: string; sha256: string | null }

		// sha256 у Document уникален: без проверки повторный импорт уронил бы страницу.
		if (source.sha256) {
			const duplicate = await prisma.document.findFirst({
				where: { contractId, sha256: source.sha256 },
				select: { id: true },
			})
			if (duplicate) {
					await prisma.inboxItem.update({
						where: { id: source.id },
						data: { status: 'IGNORED', matchedContractId: contractId },
					})
					await writeImportEvent({ inboxItemId: source.id, fileName: source.fileName, event: 'MANUAL_IMPORTED', outcome: 'IGNORED', contractId, actorId: actingUser.id, message: 'Точная копия уже прикреплена к этому договору.' })
					fail('Такой файл уже есть в системе — запись помечена как обработанная')
			}
		}

			let savedPath: string | null = null
			try {
				const saved = await importInboxFile({
				contractId,
				sourcePath: source.sourcePath,
				fileName: source.fileName,
				expectedSha256: source.sha256 ?? undefined,
				})
				savedPath = saved.storagePath

				const created = await createVersionedDocument({
					contractId,
					kind,
					fileName: source.fileName,
					storagePath: saved.storagePath,
					mimeType: saved.mimeType,
					sizeBytes: BigInt(saved.sizeBytes),
					sha256: saved.sha256,
					uploadedById: actingUser.id,
				})

			await prisma.inboxItem.update({
				where: { id: source.id },
				data: { status: 'MATCHED', matchedContractId: contractId },
			})
			await writeImportEvent({ inboxItemId: source.id, fileName: source.fileName, event: 'MANUAL_IMPORTED', outcome: 'SUCCESS', contractId, actorId: actingUser.id, message: 'Пользователь вручную подтвердил привязку файла.' })

				await writeAudit({
				userId: actingUser.id,
				action: 'UPLOAD',
				entityType: 'Document',
				entityId: created.id,
				})
				await trySyncWorkflowAfterDocumentUpload({ contractId, actorId: actingUser.id, kind, state: 'SOURCE' })
			await notify({ userId: actingUser.id, type: 'READY', title: 'Документ импортирован', message: `${source.fileName} автоматически добавлен в выбранный договор`, href: `/contracts/${contractId}`, dedupeKey: `inbox:${source.id}` })
			} catch (error) {
				if (savedPath) {
					const linked = await prisma.document.count({ where: { storagePath: savedPath } }).catch(() => 1)
					if (linked === 0) console.warn(`Unlinked Inbox file preserved for recovery: ${savedPath}`)
				}
			console.error('Не удалось импортировать файл из очереди:', error)
			const message = error instanceof Error ? error.message : 'Файл недоступен на диске'
			await prisma.inboxItem.update({ where: { id: source.id }, data: { status: 'FAILED', errorMessage: message } })
			await writeImportEvent({ inboxItemId: source.id, fileName: source.fileName, event: 'MANUAL_IMPORTED', outcome: 'FAILED', contractId, actorId: actingUser.id, message })
			fail('Файл недоступен на диске — запись помечена ошибкой')
		}

		redirect('/inbox')
	}

	async function ignoreItem(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!isAdmin(actingUser)) redirect('/')

		const itemId = String(formData.get('itemId') ?? '')
		if (itemId) {
			const item = await prisma.inboxItem.update({ where: { id: itemId }, data: { status: 'IGNORED' }, select: { fileName: true } })
			await writeImportEvent({ inboxItemId: itemId, fileName: item.fileName, event: 'IGNORED', outcome: 'IGNORED', actorId: actingUser.id, message: 'Пользователь исключил файл из очереди.' })
		}
		redirect('/inbox')
	}

	/** Повтор не создаёт дублей: возвращаем только ошибочные записи в очередь,
	 * после чего сканер заново проверит файл, хэш и договор. */
	async function retryFailedItems() {
		'use server'
		const actingUser = await requireUser()
		if (!isAdmin(actingUser)) redirect('/')
		await prisma.inboxItem.updateMany({
			where: { status: 'FAILED' },
			// Сканер видит FAILED как запрос на повторную полную проверку.
			data: { errorMessage: null },
		})
		await writeImportEvent({ fileName: 'Массовый повтор обработки', event: 'RETRY', outcome: 'QUEUED', actorId: actingUser.id, message: 'Администратор запустил повторную проверку ошибочных файлов.' })
		try {
			const operation = await runRateLimitedInboxScan(`user:${actingUser.id}`)
			if (!operation.result) throw new Error('Сканирование уже запущено или временно ограничено.')
		} catch (error) {
			redirect(`/inbox?error=${encodeURIComponent(error instanceof Error ? error.message : 'Не удалось повторить обработку файлов')}`)
		}
		redirect('/inbox')
	}

	async function runScan() {
		'use server'
		const actingUser = await requireUser()
		if (!isAdmin(actingUser)) redirect('/')
		try {
			const operation = await runRateLimitedInboxScan(`user:${actingUser.id}`)
			if (!operation.result) throw new Error('Сканирование уже запущено или временно ограничено.')
		}
		catch (error) { redirect(`/inbox?error=${encodeURIComponent(error instanceof Error ? error.message : 'Не удалось проверить папку')}`) }
		redirect('/inbox')
	}

	async function createContractFromFile(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!isAdmin(actingUser)) redirect('/')
		const fail: (message: string) => never = (message) => redirect(`/inbox?error=${encodeURIComponent(message)}`)
		const itemId = String(formData.get('itemId') ?? '')
		const item = await prisma.inboxItem.findUnique({ where: { id: itemId } })
		if (!item || !['PENDING', 'SUGGESTED', 'FAILED'].includes(item.status)) fail('Файл очереди не найден')
		const source = item!
		let parsed
			try { parsed = await parseContractFile(source.fileName, await readStoredFile(source.sourcePath)) }
			catch (error) { const message = error instanceof Error ? error.message : 'Файл не удалось распознать'; await writeImportEvent({ inboxItemId: source.id, fileName: source.fileName, event: 'CONTRACT_CREATED', outcome: 'FAILED', actorId: actingUser.id, message }); fail(message) }
			if (!parsed.contractNumber || !parsed.contractDate || !parsed.amount || (!parsed.contractorName && !parsed.inn)) { const message = `Не хватает данных: ${parsed.warnings.join(', ')}`; await writeImportEvent({ inboxItemId: source.id, fileName: source.fileName, event: 'CONTRACT_CREATED', outcome: 'FAILED', actorId: actingUser.id, message }); fail(message) }
			const existing = await prisma.contract.findUnique({ where: { number: parsed.contractNumber }, select: { id: true } })
			if (existing) { const message = `Договор ${parsed.contractNumber} уже существует — выберите его и привяжите файл`; await writeImportEvent({ inboxItemId: source.id, fileName: source.fileName, event: 'CONTRACT_CREATED', outcome: 'IGNORED', contractId: existing.id, actorId: actingUser.id, message }); fail(message) }
			let createdContractorId: string | null = null
			const match = await findMatchingContractor({ name: parsed.contractorName, inn: parsed.inn, phone: parsed.phone, email: parsed.email })
			let contractor = match ? { id: match.id } : null
			if (!contractor) { contractor = await prisma.contractor.create({ data: { name: parsed.contractorName || `Контрагент ИНН ${parsed.inn}`, inn: parsed.inn || null }, select: { id: true } }); createdContractorId = contractor.id }
			const contract = await prisma.contract.create({ data: { number: parsed.contractNumber, date: new Date(`${parsed.contractDate}T12:00:00.000Z`), amount: parsed.amount, currency: parsed.currency, kind: 'SMR', status: 'ACTIVE', contractorId: contractor.id, managerId: actingUser.id, cipher: parsed.cipher || null, objectAddress: parsed.objectAddress || null }, select: { id: true } })
		try {
			const saved = await importInboxFile({ contractId: contract.id, sourcePath: source.sourcePath, fileName: source.fileName, expectedSha256: source.sha256 ?? undefined })
				const document = await createVersionedDocument({ contractId: contract.id, kind: 'CONTRACT', fileName: source.fileName, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256, uploadedById: actingUser.id })
				await prisma.executiveDoc.createMany({ data: EXEC_TEMPLATES.SMR.map((name) => ({ contractId: contract.id, name })) })
				await grantDesignReadAccess(contract.id)
				await trySyncWorkflowAfterDocumentUpload({ contractId: contract.id, actorId: actingUser.id, kind: 'CONTRACT', state: 'SOURCE' })
			await prisma.inboxItem.update({ where: { id: source.id }, data: { status: 'MATCHED', matchedContractId: contract.id, parsedContractNumber: parsed.contractNumber, parsedCipher: parsed.cipher || null } })
			await writeImportEvent({ inboxItemId: source.id, fileName: source.fileName, event: 'CONTRACT_CREATED', outcome: 'SUCCESS', contractId: contract.id, actorId: actingUser.id, message: `Создан договор № ${parsed.contractNumber} из файла очереди.` })
			await writeAudit({ userId: actingUser.id, action: 'CREATE', entityType: 'ContractImport', entityId: contract.id })
			await writeAudit({ userId: actingUser.id, action: 'UPLOAD', entityType: 'Document', entityId: document.id })
			await notify({ userId: actingUser.id, type: 'READY', title: 'Договор создан из файла', message: `№ ${parsed.contractNumber} добавлен в систему вместе с исходным документом`, href: `/contracts/${contract.id}`, dedupeKey: `contract-import:${source.id}` })
			} catch (error) {
				await rollbackNewContractImport(contract.id)
				await removeUnusedImportedContractor(createdContractorId)
				await writeImportEvent({ inboxItemId: source.id, fileName: source.fileName, event: 'CONTRACT_CREATED', outcome: 'FAILED', contractId: contract.id, actorId: actingUser.id, message: error instanceof Error ? error.message : 'Не удалось создать договор из файла очереди.' })
			fail(error instanceof Error ? error.message : 'Не удалось сохранить договор')
		}
		redirect(`/contracts/${contract.id}`)
	}

	const name = user.name ?? user.email ?? ''

	return (
		<>
			<Topbar
				crumbs={[{ label: 'Главная', href: '/' }, { label: 'Очередь импорта' }]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
				notifications={items.length}
			/>

			<div className="px-[26px] py-[22px]">
				<div className="mb-[18px] flex items-start gap-4">
					<div>
					<h1 className="text-[26px] font-bold tracking-[-0.02em]">Очередь импорта</h1>
					<div className="mt-[5px] text-[13px] text-muted">
						Файлы, найденные сканером во входящей папке. Подтвердите привязку к договору.
					</div>
					</div>
					<div className="ml-auto flex flex-wrap justify-end gap-2">
						{(statusCount.get('FAILED') ?? 0) > 0 && (
							<form action={retryFailedItems}>
								<button type="submit" className="inline-flex h-[38px] items-center rounded-[10px] border border-danger-bd bg-danger-bg px-[15px] text-[13px] font-semibold text-danger hover:brightness-95">Повторить ошибки</button>
							</form>
						)}
						<form action={runScan}>
							<button type="submit" className="brand-gradient inline-flex h-[38px] items-center rounded-[10px] px-[15px] text-[13px] font-semibold text-white">Проверить папку сейчас</button>
						</form>
					</div>
				</div>

				<div className="mb-[14px] max-w-[720px]">
					<FormError message={searchParams.error} />
				</div>
				<div className="mb-[14px] grid grid-cols-2 gap-[10px] md:grid-cols-4">
					<div className="rounded-[12px] border border-line bg-surface p-[13px]"><div className="text-[10px] uppercase tracking-wide text-faint">Ждут решения</div><div className="mt-1 text-[21px] font-bold">{(statusCount.get('PENDING') ?? 0) + (statusCount.get('SUGGESTED') ?? 0)}</div></div>
					<div className="rounded-[12px] border border-ok-bd bg-ok-bg p-[13px]"><div className="text-[10px] uppercase tracking-wide text-muted">Импортировано</div><div className="mt-1 text-[21px] font-bold text-ok">{statusCount.get('MATCHED') ?? 0}</div></div>
					<div className="rounded-[12px] border border-line bg-surface p-[13px]"><div className="text-[10px] uppercase tracking-wide text-faint">Копии / пропущено</div><div className="mt-1 text-[21px] font-bold">{statusCount.get('IGNORED') ?? 0}</div></div>
					<div className="rounded-[12px] border border-danger-bd bg-danger-bg p-[13px]"><div className="text-[10px] uppercase tracking-wide text-muted">Ошибки</div><div className="mt-1 text-[21px] font-bold text-danger">{statusCount.get('FAILED') ?? 0}</div></div>
				</div>
				<div className={`mb-[14px] flex flex-wrap items-center gap-3 rounded-[12px] border px-[14px] py-[11px] ${watcher.online ? 'border-ok-bd bg-ok-bg' : 'border-warn-bd bg-warn-bg'}`}>
					<span className={`h-2.5 w-2.5 rounded-full ${watcher.online ? 'bg-ok' : 'bg-warn'}`} />
					<div><div className="text-[12.5px] font-bold">{watcher.online ? 'Автосканер работает' : 'Автосканер не запущен'}</div><div className="mt-0.5 text-[10.5px] text-muted">{watcher.online ? `Папка проверяется автоматически каждые 5 секунд${watcher.checkedAt ? ` · последняя проверка ${formatDateTime(watcher.checkedAt)}` : ''}` : 'Запустите приложение через START-IZLK.cmd — ручная проверка при этом остаётся доступна'}</div></div>
					{watcher.online && <div className="ml-auto text-right text-[10.5px] text-muted"><div>Новых: {watcher.result?.queued ?? 0} · копий: {watcher.result?.duplicates ?? 0}</div><div className="max-w-[360px] truncate">{watcher.inboxPath}</div></div>}
				</div>

				<Card>
					<CardHeader
						title="Ожидают обработки"
						extra={<span className="text-[12px] text-muted">{items.length}</span>}
					/>
					{items.length === 0 ? (
						<EmptyState text="Очередь пуста — новых файлов нет" />
					) : (
						<div className="flex flex-col">
							{items.map((item) => (
								<div key={item.id} className="border-b border-line-soft px-[18px] py-[14px] last:border-b-0">
									<div className="mb-[8px] flex flex-wrap items-center gap-[9px]">
										<span className="text-[13.5px] font-medium text-ink">{item.fileName}</span>
										<Chip tone={item.status === 'FAILED' ? 'danger' : item.status === 'SUGGESTED' ? 'brand' : 'off'}>
											{item.status === 'FAILED'
												? 'Ошибка'
												: item.status === 'SUGGESTED'
													? 'Есть гипотеза'
													: 'Новый'}
										</Chip>
										<span className="tnum text-[12px] text-faint">{formatBytes(item.sizeBytes)}</span>
										<span className="text-[12px] text-faint">{formatDateTime(item.createdAt)}</span>
									</div>

									<div className="mb-[10px] text-[12px] text-faint">
										{item.parsedContractNumber ? `Распознан договор: ${item.parsedContractNumber}` : 'Номер договора не распознан'}
										{item.parsedCipher ? ` · шифр ${item.parsedCipher}` : ''}
									</div>
									{item.errorMessage && (
										<div className="mb-[10px] rounded-[8px] border border-danger-bd bg-danger-bg px-3 py-2 text-[12px] text-danger">
											<b>Что произошло:</b> {item.errorMessage}
										</div>
									)}

									<div className="flex flex-wrap items-end gap-[10px]">
										{item.suggestedKind === 'CONTRACT' && (
											<form action={createContractFromFile}>
												<input type="hidden" name="itemId" value={item.id} />
												<button type="submit" className="brand-gradient inline-flex h-[38px] items-center justify-center rounded-[10px] px-[16px] text-[13px] font-semibold text-white">Создать договор из файла</button>
											</form>
										)}
										<form action={confirmImport} className="flex flex-wrap items-end gap-[10px]">
											<input type="hidden" name="itemId" value={item.id} />
											<div>
												<label className="mb-[5px] block text-[11.5px] text-faint">Договор</label>
												<select
													name="contractId"
													defaultValue={item.matchedContractId ?? ''}
													className={`${selectClass} w-[280px]`}
												>
													<option value="">— выберите договор —</option>
													{contracts.map((c) => (
														<option key={c.id} value={c.id}>
															№ {c.number}
															{c.cipher ? ` · ${c.cipher}` : ''}
														</option>
													))}
												</select>
											</div>
											<div>
												<label className="mb-[5px] block text-[11.5px] text-faint">Тип</label>
												<select
													name="kind"
													defaultValue={item.suggestedKind ?? 'OTHER'}
													className={`${selectClass} w-[200px]`}
												>
													{DOCUMENT_KIND_ORDER.map((k) => (
														<option key={k} value={k}>
															{DOCUMENT_KIND_LABELS[k]}
														</option>
													))}
												</select>
											</div>
											<button
												type="submit"
												className="brand-gradient inline-flex h-[38px] items-center justify-center rounded-[10px] px-[16px] text-[13px] font-semibold text-white"
											>
												Привязать
											</button>
										</form>

										<form action={ignoreItem}>
											<input type="hidden" name="itemId" value={item.id} />
											<button
												type="submit"
												className="inline-flex h-[38px] items-center justify-center rounded-[10px] border border-line bg-surface px-[16px] text-[13px] font-semibold hover:bg-raised"
											>
												Игнорировать
											</button>
										</form>
									</div>
								</div>
							))}
						</div>
					)}
				</Card>
				<Card className="mt-[14px] overflow-hidden">
					<CardHeader title="Журнал последних обработок" extra={<span className="text-[11px] text-muted">последние {recent.length}</span>} />
					{recent.length === 0 ? <EmptyState text="Обработанных файлов пока нет" /> : <div>{recentPrimary.map((item) => { const linked = item.matchedContractId ? contractById.get(item.matchedContractId) : null; return <div key={item.id} className="flex flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[11px] first:border-t-0"><Chip tone={item.status === 'MATCHED' ? 'ok' : 'off'}>{item.status === 'MATCHED' ? 'Импортирован' : 'Пропущен'}</Chip><span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{item.fileName}</span>{linked ? <a href={`/contracts/${linked.id}`} className="text-[11.5px] font-semibold text-brand-ink hover:underline">Договор № {linked.number}</a> : <span className="text-[11px] text-faint">Без привязки</span>}<span className="tnum text-[10.5px] text-faint">{formatDateTime(item.updatedAt)}</span></div> })}{recentRest.length > 0 && <details className="border-t border-line-soft"><summary className="cursor-pointer px-[18px] py-[10px] text-[12px] font-semibold text-brand-ink hover:bg-raised">Показать историю: ещё {recentRest.length}</summary>{recentRest.map((item) => { const linked = item.matchedContractId ? contractById.get(item.matchedContractId) : null; return <div key={item.id} className="flex flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[11px]"><Chip tone={item.status === 'MATCHED' ? 'ok' : 'off'}>{item.status === 'MATCHED' ? 'Импортирован' : 'Пропущен'}</Chip><span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{item.fileName}</span>{linked ? <a href={`/contracts/${linked.id}`} className="text-[11.5px] font-semibold text-brand-ink hover:underline">Договор № {linked.number}</a> : <span className="text-[11px] text-faint">Без привязки</span>}<span className="tnum text-[10.5px] text-faint">{formatDateTime(item.updatedAt)}</span></div> })}</details>}</div>}
				</Card>
			</div>
		</>
	)
}
