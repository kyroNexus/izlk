import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { assertContractAccess, requireUser } from '@/lib/access'
import Topbar from '@/components/Topbar'
import { Card } from '@/components/ui'
import { initials } from '@/lib/format'
import { estimateSchema, firstIssue, orNull, parseAmount, parseDate } from '@/lib/validation'
import { MAX_UPLOAD_BYTES, saveContractFile, sha256Buffer } from '@/lib/storage'
import { parseEstimateWorkbook } from '@/lib/estimate-parser'
import { calcContractDeadline } from '@/lib/deadline'
import { writeAudit, writeImportEvent } from '@/lib/audit'
import { createVersionedDocument } from '@/lib/document-versioning'

const FIELD_CLASS =
	'h-[40px] w-full rounded-[10px] border border-line bg-surface px-[13px] text-[13.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand focus:ring-[3px] focus:ring-brand/20'

// В Next.js 14 params и searchParams — ОБЫЧНЫЕ объекты, не Promise. Не добавляйте await.
export default async function NewEstimatePage({
	params,
	searchParams,
}: {
	params: { id: string }
	searchParams: { error?: string }
}) {
	const user = await requireUser()
	const contractId = params.id

	// Раньше проверялась только роль: менеджер мог создать смету в чужом договоре.
	await assertContractAccess(contractId, user, { write: true })

	const contract = await prisma.contract.findFirst({
		where: { id: contractId, deletedAt: null },
		select: {
			id: true,
			number: true,
			agreements: {
				where: { deletedAt: null },
				orderBy: { date: 'asc' },
				select: { id: true, number: true },
			},
		},
	})

	if (!contract) redirect('/contracts')

	async function createEstimate(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		await assertContractAccess(contractId, actingUser, { write: true })
		const fail: (message: string) => never = (message) =>
			redirect(`/contracts/${contractId}/estimates/new?error=${encodeURIComponent(message)}`)

		const parsed = estimateSchema.safeParse({
			number: String(formData.get('number') ?? ''),
			date: String(formData.get('date') ?? ''),
			agreementId: String(formData.get('agreementId') ?? ''),
			amount: String(formData.get('amount') ?? ''),
		})
		if (!parsed.success) {
			redirect(
				`/contracts/${contractId}/estimates/new?error=${encodeURIComponent(firstIssue(parsed.error))}`,
			)
		}
		const data = parsed.data

		const dateValue = parseDate(data.date)
		if (!dateValue) {
			redirect(
				`/contracts/${contractId}/estimates/new?error=${encodeURIComponent('Дата указана неверно')}`,
			)
		}

		// Сумма сметы необязательная. Если указана — проверяем формат.
		let amount: string | null = null
		const rawAmount = orNull(data.amount)
		if (rawAmount) {
			amount = parseAmount(rawAmount)
			if (!amount) {
				redirect(
					`/contracts/${contractId}/estimates/new?error=${encodeURIComponent('Сумма сметы указана неверно')}`,
				)
			}
		}

		const uploadedFile = formData.get('estimateFile')
		const estimateFile = uploadedFile instanceof File && uploadedFile.size > 0 ? uploadedFile : null
		let parsedWorkingDays: number | null = null
		let estimateBuffer: Buffer | null = null
		if (estimateFile) {
			if (estimateFile.size > MAX_UPLOAD_BYTES) fail('Файл сметы больше допустимых 200 МБ')
			if (!/\.(xlsx|xls|csv)$/i.test(estimateFile.name)) fail('Для автоматического разбора загрузите смету в Excel: XLSX, XLS или CSV')
			estimateBuffer = Buffer.from(await estimateFile.arrayBuffer())
			const parsedFile = parseEstimateWorkbook(estimateBuffer)
			parsedWorkingDays = parsedFile.workingDays
			if (!amount && parsedFile.amount != null) amount = parsedFile.amount.toFixed(2)
		}

		// Выбранное ДС могло принадлежать другому договору — проверяем связь.
		const agreementId = orNull(data.agreementId)
		if (agreementId) {
			const agreement = await prisma.agreement.findFirst({
				where: { id: agreementId, contractId, deletedAt: null },
				select: { id: true },
			})
			if (!agreement) {
				redirect(
					`/contracts/${contractId}/estimates/new?error=${encodeURIComponent('Выбранное ДС не относится к этому договору')}`,
				)
			}
		}

		const estimate = await prisma.estimate.create({
			data: {
				contractId,
				agreementId,
				number: data.number,
				date: dateValue,
				amount,
			},
			select: { id: true },
		})

		if (estimateFile && estimateBuffer) {
			let savedPath: string | null = null
			try {
				const digest = sha256Buffer(estimateBuffer)
				const duplicate = await prisma.document.findFirst({ where: { contractId, sha256: digest }, select: { id: true } })
				if (!duplicate) {
					const saved = await saveContractFile({ contractId, fileName: estimateFile.name, buffer: estimateBuffer })
					savedPath = saved.storagePath
					const estimateDocument = await createVersionedDocument({
							contractId,
							estimateId: estimate.id,
							kind: 'ESTIMATE',
							fileName: estimateFile.name,
							storagePath: saved.storagePath,
							mimeType: saved.mimeType,
							sizeBytes: BigInt(saved.sizeBytes),
							sha256: saved.sha256,
							uploadedById: actingUser.id,
					})
					await writeAudit({ userId: actingUser.id, action: 'UPLOAD', entityType: 'Document', entityId: estimateDocument.id })
					await writeImportEvent({ fileName: estimateFile.name, event: 'MANUAL_IMPORTED', outcome: 'SUCCESS', contractId, actorId: actingUser.id, message: `Смета ${data.number} загружена и привязана к договору.` })
				} else {
					await writeImportEvent({ fileName: estimateFile.name, event: 'MANUAL_IMPORTED', outcome: 'IGNORED', contractId, actorId: actingUser.id, message: 'Точная копия уже есть в этом договоре; файл повторно не сохранён.' })
				}
			} catch (error) {
				if (savedPath) {
					const linked = await prisma.document.count({ where: { storagePath: savedPath } }).catch(() => 1)
					if (linked === 0) console.warn(`Unlinked estimate upload preserved for recovery: ${savedPath}`)
				}
				await prisma.estimate.delete({ where: { id: estimate.id } }).catch((cleanupError) => console.error('Could not roll back an incomplete estimate:', cleanupError))
				console.error('Estimate attachment failed:', error)
				await writeImportEvent({ fileName: estimateFile.name, event: 'MANUAL_IMPORTED', outcome: 'FAILED', contractId, actorId: actingUser.id, message: error instanceof Error ? error.message : 'Не удалось сохранить Excel-смету.' })
				fail('Не удалось прикрепить Excel к смете. Смета не создана — повторите загрузку.')
			}
		}

		if (parsedWorkingDays != null) {
			const timing = await prisma.contract.findFirst({ where: { id: contractId }, select: { pr1SignedAt: true } })
			await prisma.contract.update({
				where: { id: contractId },
				data: {
					workingDays: parsedWorkingDays,
					deadline: calcContractDeadline(timing?.pr1SignedAt, parsedWorkingDays),
				},
			})
		}

		const summary = estimateFile
			? parsedWorkingDays != null
				? `Смета создана. Срок из файла: ${parsedWorkingDays} раб. дн.`
				: 'Смета создана. Срок в файле не найден — его можно указать при подтверждении ПР1.'
			: 'Смета создана'
		redirect(`/contracts/${contractId}?success=${encodeURIComponent(summary)}`)
	}

	const name = user.name ?? user.email ?? ''

	return (
		<>
			<Topbar
				crumbs={[
					{ label: 'Главная', href: '/' },
					{ label: 'Договоры', href: '/contracts' },
					{ label: `№ ${contract.number}`, href: `/contracts/${contract.id}` },
					{ label: 'Новая смета' },
				]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="workspace-content px-[26px] py-[22px]">
				<div className="mb-[20px]">
					<h1 className="text-[26px] font-bold tracking-[-0.02em]">{'Новая смета'}</h1>
					<div className="mt-[4px] text-[13px] text-faint">{`К договору № ${contract.number}`}</div>
				</div>

				{searchParams.error && (
					<div className="mb-[16px] max-w-[560px] rounded-[10px] border border-danger-bd bg-danger-bg px-[15px] py-[11px] text-[13px] text-danger">
						{searchParams.error}
					</div>
				)}

				<Card className="max-w-[560px] p-[22px]">
					<form action={createEstimate} encType="multipart/form-data" className="flex flex-col gap-[16px]">
						<div className="grid grid-cols-2 gap-[14px]">
							<div>
								<label className="mb-[6px] block text-[12.5px] font-medium text-muted">{'Номер *'}</label>
								<input name="number" required className={FIELD_CLASS} placeholder="Смета №1" />
							</div>
							<div>
								<label className="mb-[6px] block text-[12.5px] font-medium text-muted">{'Дата *'}</label>
								<input type="date" name="date" required className={FIELD_CLASS} />
							</div>
						</div>

						<div>
							<label className="mb-[6px] block text-[12.5px] font-medium text-muted">
								{'Доп. соглашение'}
							</label>
							<select name="agreementId" defaultValue="" className={FIELD_CLASS}>
								<option value="">{'Напрямую к договору'}</option>
								{contract.agreements.map((a) => (
									<option key={a.id} value={a.id}>
										{a.number}
									</option>
								))}
							</select>
						</div>

						<div>
							<label className="mb-[6px] block text-[12.5px] font-medium text-muted">{'Сумма сметы'}</label>
							<input name="amount" inputMode="decimal" className={FIELD_CLASS} placeholder="Необязательно" />
						</div>

						<div>
							<label className="mb-[6px] block text-[12.5px] font-medium text-muted">Excel-файл сметы</label>
							<input type="file" name="estimateFile" accept=".xlsx,.xls,.csv" className="block w-full rounded-[10px] border border-line bg-surface px-[13px] py-[9px] text-[12.5px] file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-[12px]" />
							<p className="mt-[6px] text-[11.5px] leading-5 text-faint">Прикрепим смету к договору и автоматически найдём итоговую сумму и срок в рабочих днях. Введённая вручную сумма имеет приоритет.</p>
						</div>

						<div className="mt-[6px] flex gap-[10px]">
							<button
								type="submit"
								className="brand-gradient inline-flex h-[40px] items-center justify-center rounded-[10px] px-[18px] text-[13.5px] font-semibold text-white"
							>
								{'Создать смету'}
							</button>
							<Link
								href={`/contracts/${contract.id}`}
								className="inline-flex h-[40px] items-center justify-center rounded-[10px] border border-line bg-surface px-[18px] text-[13.5px] font-semibold hover:bg-raised"
							>
								{'Вернуться к договору'}
							</Link>
						</div>
					</form>
				</Card>
			</div>
		</>
	)
}
