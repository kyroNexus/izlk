import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/Topbar'
import { Card, Field, FormError, inputClass, selectClass } from '@/components/ui'
import SmartDocumentUpload from '@/components/SmartDocumentUpload'
import { DOCUMENT_KIND_LABELS, DOCUMENT_KIND_ORDER, formatBytes, initials } from '@/lib/format'
import { assertContractAccess, contractScope, requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'

// В Next.js 14 params и searchParams — ОБЫЧНЫЕ объекты, не Promise. Не добавляйте await.
export default async function UploadDocumentPage({
	params,
	searchParams,
}: {
	params: { id: string }
	searchParams: { error?: string; success?: string; executive?: string; project?: string; state?: string; kind?: string; pr1?: string }
}) {
	const user = await requireUser()
	const contractId = params.id
	const requestedState = ['SOURCE', 'SIGNED', 'ARCHIVE'].includes(searchParams.state ?? '') ? searchParams.state! : 'SOURCE'
	const requestedKind = DOCUMENT_KIND_ORDER.find((kind) => kind === searchParams.kind) ?? ''
	const pr1Mode = searchParams.pr1 === '1'
	const projectSection = searchParams.project ? await prisma.projectSection.findFirst({ where: { id: searchParams.project, contractId, deletedAt: null, ...(user.role === 'DESIGNER' ? { responsibleId: user.id } : {}) }, select: { id: true, code: true } }) : null
	const contract = user.role === 'DESIGNER'
		? projectSection && await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null }, select: { id: true, number: true, managerId: true } })
		: user.role === 'BUILDER'
		// Строитель загружает файлы площадок/исполнительной/графика проектирования
		// на любой видимый ему договор — без общего canWrite (не может редактировать сам договор).
		? await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null, ...contractScope(user) }, select: { id: true, number: true, managerId: true } })
		: await assertContractAccess(contractId, user, { write: true })
	if (!contract) redirect('/projects')

	const [recent, executiveDocs] = await Promise.all([prisma.document.findMany({
		where: { contractId, deletedAt: null, ...(projectSection ? { projectSectionId: projectSection.id } : {}) },
		select: { id: true, fileName: true, kind: true, sizeBytes: true },
		orderBy: { createdAt: 'desc' },
		take: 8,
	}), prisma.executiveDoc.findMany({ where: { contractId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } })])

	/* Legacy server action kept here was never used by the form (the API route below is
	 * the actual uploader).  Keeping it inside this page made Next serialize its closure
	 * and crash the render with "Functions cannot be passed to Client Components".
	async function uploadDocument(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		await assertContractAccess(contractId, actingUser, { write: true })

		// Явный тип never нужен для корректного сужения типов после fail().
		const requestedExecutiveId = String(formData.get('executiveDocId') ?? '')
		const fail: (message: string) => never = (message) =>
			redirect(`/contracts/${contractId}/upload?${requestedExecutiveId ? `executive=${encodeURIComponent(requestedExecutiveId)}&` : ''}error=${encodeURIComponent(message)}`)

		const uploads = formData.getAll('files').filter((file): file is File => file instanceof File && file.size > 0)
		if (uploads.length === 0) fail('Выберите хотя бы один файл для загрузки')
		if (uploads.length > 30) fail('За один раз можно загрузить не больше 30 файлов')
		const oversized = uploads.find((file) => file.size > MAX_UPLOAD_BYTES)
		if (oversized) fail(`Файл «${oversized.name}» больше допустимых ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`)

		const kindRaw = String(formData.get('kind') ?? 'OTHER')
		const kind = (DOCUMENT_KIND_ORDER as readonly string[]).includes(kindRaw)
			? (kindRaw as DocumentKind)
			: ('OTHER' as DocumentKind)

		const signedAtRaw = orNull(String(formData.get('signedAt') ?? ''))
		const signedAt = signedAtRaw ? parseDate(signedAtRaw) : null
		const isConfidential = formData.get('isConfidential') === 'on'
		const executiveDocId = requestedExecutiveId && executiveDocs.some((item) => item.id === requestedExecutiveId) ? requestedExecutiveId : null

		let uploadedCount = 0
		let skippedCount = 0
		for (const upload of uploads) {
			const buffer = Buffer.from(await upload.arrayBuffer())
			const digest = sha256Buffer(buffer)
			const existing = await prisma.document.findFirst({ where: { contractId, sha256: digest }, select: { id: true } })
			if (existing) { skippedCount += 1; continue }

			const saved = await saveContractFile({ contractId, fileName: upload.name, buffer })
			const created = await prisma.document.create({
				data: { contractId, kind, fileName: upload.name, storagePath: saved.storagePath, mimeType: upload.type || saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256, signedAt, isConfidential, executiveDocId, uploadedById: actingUser.id },
				select: { id: true },
			})
			await writeAudit({ userId: actingUser.id, action: 'UPLOAD', entityType: 'Document', entityId: created.id })
			uploadedCount += 1
		}

		const destination = executiveDocId ? `/executive/${contractId}` : `/contracts/${contractId}`
		const summary = `Загружено файлов: ${uploadedCount}${skippedCount ? `. Пропущено копий: ${skippedCount}` : ''}`
		redirect(`${destination}?success=${encodeURIComponent(summary)}`)
	} */

	const name = user.name ?? user.email ?? ''

	return (
		<>
			<Topbar
				crumbs={[
					{ label: 'Главная', href: '/' },
					{ label: 'Договоры', href: '/contracts' },
					{ label: `№ ${contract.number}`, href: `/contracts/${contractId}` },
					{ label: 'Загрузка документа' },
				]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="workspace-content px-[26px] py-[22px]">
				<div className="work-hero mb-[20px] px-5 py-4">
					<h1 className="text-[26px] font-bold tracking-[-0.02em]">{pr1Mode ? 'Подписанное Приложение №1' : 'Загрузка документа'}</h1>
					<div className="mt-[4px] text-[13px] text-faint">К договору № {contract.number}</div>
				</div>

				<div className="max-w-[640px]">
					<div className="mb-[14px]">
						<FormError message={searchParams.error} />
						{searchParams.success && <div className="rounded-[10px] border border-green-200 bg-green-50 px-[12px] py-[9px] text-[12.5px] text-green-800">{searchParams.success}</div>}
					</div>

					<Card className="border-brand/10 p-[22px] shadow-[0_14px_34px_rgba(25,22,45,.055)]">
						<SmartDocumentUpload
							contractId={contractId}
							projectSection={projectSection}
							executiveDocs={executiveDocs}
							requestedExecutive={searchParams.executive ?? ''}
							requestedState={requestedState}
							requestedKind={requestedKind}
							pr1Mode={pr1Mode}
						/>
						{false && <form action={`/api/contracts/${contractId}/documents`} method="post" encType="multipart/form-data" className="flex flex-col gap-[15px]">
							{projectSection && <input type="hidden" name="projectSectionId" value={projectSection?.id ?? ''} />}
							<div className="rounded-[12px] border border-brand/20 bg-brand/5 px-[14px] py-[12px] text-[12px] leading-5 text-muted"><b className="text-ink">Три шага:</b> выберите один или несколько файлов, укажите раздел/тип, затем нажмите «Загрузить». Все дополнительные параметры необязательны и применяются ко всей выбранной пачке.</div>
							<Field label="Файлы" required hint="До 30 файлов за раз. Настройки ниже применятся ко всей пачке.">
								<input
									type="file"
									name="files"
									required
									multiple
									className="w-full rounded-[10px] border border-line bg-surface px-[13px] py-[9px] text-[13px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-[12.5px] file:text-ink"
								/>
							</Field>

							{!projectSection && executiveDocs.length > 0 && (
								<Field label="Раздел исполнительной документации" hint="Файл появится в выбранной карточке исполняшки">
									<select name="executiveDocId" defaultValue={searchParams.executive ?? ''} className={selectClass}>
										<option value="">Не привязывать к разделу</option>
										{executiveDocs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
									</select>
								</Field>
							)}

							<div className={`grid gap-[14px] ${projectSection ? 'grid-cols-1' : 'grid-cols-3'}`}>
								<Field label="Тип документа" required>
									<select name="kind" defaultValue={projectSection ? 'PROJECT_PDF' : searchParams.executive ? 'EXECUTIVE' : 'CONTRACT'} className={selectClass}>
										{(projectSection ? (['PROJECT_PDF', 'PROJECT_DWG'] as const) : DOCUMENT_KIND_ORDER).map((k) => (
											<option key={k} value={k}>
												{DOCUMENT_KIND_LABELS[k]}
											</option>
										))}
									</select>
								</Field>
								{!projectSection && <Field label="Дата подписания" hint="По ней считается этап «ПР1 подписан»">
									<input type="date" name="signedAt" className={inputClass} />
								</Field>}
								{!projectSection && <Field label="Рабочих дней" hint="Для срока по подписанному ПР1">
									<input type="number" name="workingDays" min="1" max="730" className={inputClass} placeholder="Например, 20" />
								</Field>}
							</div>

							{!projectSection && <details className="rounded-[11px] border border-line bg-raised/40 px-[13px] py-[10px]"><summary className="cursor-pointer text-[12.5px] font-semibold text-ink">Дополнительные настройки: подпись, версия и доступ</summary><div className="mt-[13px] flex flex-col gap-[14px]"><Field label="Состояние версии" hint="Так исходники, подписанные и старые варианты не смешиваются">
								<select name="state" defaultValue={requestedState} className={selectClass}><option value="SOURCE">Актуальный исходник</option><option value="SIGNED">Подписанная версия</option><option value="ARCHIVE">Архивная версия</option></select>
							</Field>

							{!projectSection && <label className="flex items-center gap-[9px] text-[13px] text-muted">
								<input type="checkbox" name="isConfidential" className="h-[15px] w-[15px]" />
								Конфиденциально — не выдавать наблюдателям
							</label>}</div></details>}

							{!projectSection && !searchParams.executive && <label className="rounded-[11px] border border-brand/25 bg-brand/5 p-[13px]">
								<span className="flex items-start gap-[10px]"><input type="checkbox" name="confirmPr1Signed" className="mt-[2px] h-[16px] w-[16px] accent-[#7047e8]" /><span><span className="block text-[12.5px] font-bold text-ink">Подтверждаю: Приложение №1 подписано заказчиком</span><span className="mt-1 block text-[11.5px] leading-5 text-muted">Файл будет сохранён как ПР1, договор автоматически появится в «Площадках» и в очереди проектирования КМ/КЖ.</span></span></span>
							</label>}

							<div className="mt-[6px] flex gap-[10px]">
								<button
									type="submit"
									className="brand-gradient inline-flex h-[40px] items-center justify-center rounded-[10px] px-[18px] text-[13.5px] font-semibold text-white"
								>
									Загрузить
								</button>
								<Link
									href={projectSection ? `/projects?section=${projectSection?.code ?? ''}` : `/contracts/${contractId}`}
									className="inline-flex h-[40px] items-center justify-center rounded-[10px] border border-line bg-surface px-[18px] text-[13.5px] font-semibold hover:bg-raised"
								>
									Вернуться к договору
								</Link>
							</div>
						</form>}
					</Card>

					{recent.length > 0 && (
						<div className="mt-[16px] rounded-[14px] border border-line bg-surface p-[16px] shadow-[0_8px_24px_rgba(25,22,45,.04)]">
							<div className="mb-[9px] text-[11.5px] uppercase tracking-[0.06em] text-faint">
								Уже загружено
							</div>
							<div className="flex flex-col gap-[6px]">
								{recent.map((d) => (
									<div key={d.id} className="flex items-center justify-between gap-[10px] text-[12.5px]">
										<span className="min-w-0 flex-1 truncate text-ink">{d.fileName}</span>
										<span className="flex-none text-faint">{DOCUMENT_KIND_LABELS[d.kind]}</span>
										<span className="tnum flex-none text-faint">{formatBytes(d.sizeBytes)}</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</>
	)
}
