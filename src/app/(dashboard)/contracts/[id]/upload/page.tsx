import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/Topbar'
import { Card, FormError } from '@/components/ui'
import SmartDocumentUpload from '@/components/SmartDocumentUpload'
import { DOCUMENT_KIND_LABELS, DOCUMENT_KIND_ORDER, formatBytes, initials } from '@/lib/format'
import { assertContractAccess, contractScope, requireUser } from '@/lib/access'
import { agreementTitle } from '@/components/contract/shared'

export const dynamic = 'force-dynamic'

// В Next.js 14 params и searchParams — ОБЫЧНЫЕ объекты, не Promise. Не добавляйте await.
export default async function UploadDocumentPage({
	params,
	searchParams,
}: {
	params: { id: string }
	searchParams: { error?: string; success?: string; executive?: string; project?: string; state?: string; kind?: string; pr1?: string; agreement?: string; invoice?: string }
}) {
	const user = await requireUser()
	const contractId = params.id
	// Пустая строка — SmartDocumentUpload сам подставит AUTO (задача B1):
	// без явной ссылки вида ?state=SIGNED версия документа определяется
	// по имени файла, а не жёстко фиксируется на "исходник".
	const requestedState = ['SOURCE', 'SIGNED', 'ARCHIVE'].includes(searchParams.state ?? '') ? searchParams.state! : ''
	const requestedKind = DOCUMENT_KIND_ORDER.find((kind) => kind === searchParams.kind) ?? ''
	const pr1Mode = searchParams.pr1 === '1'
	const projectSection = searchParams.project ? await prisma.projectSection.findFirst({ where: { id: searchParams.project, contractId, deletedAt: null, ...(user.role === 'DESIGNER' ? { responsibleId: user.id } : {}) }, select: { id: true, code: true } }) : null
	// Задача C2: скан к конкретному доп. соглашению/счёту — та же проверка "id
	// принадлежит этому договору", что уже есть для projectSection выше.
	const agreement = searchParams.agreement ? await prisma.agreement.findFirst({ where: { id: searchParams.agreement, contractId, deletedAt: null }, select: { id: true, number: true } }) : null
	const invoice = searchParams.invoice ? await prisma.invoice.findFirst({ where: { id: searchParams.invoice, contractId, deletedAt: null }, select: { id: true, number: true } }) : null
	const contract = user.role === 'DESIGNER'
		? projectSection && await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null }, select: { id: true, number: true, managerId: true } })
		: user.role === 'BUILDER'
		// Строитель загружает файлы площадок/исполнительной/графика проектирования
		// на любой видимый ему договор — без общего canWrite (не может редактировать сам договор).
		? await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null, ...contractScope(user) }, select: { id: true, number: true, managerId: true } })
		: user.role === 'ACCOUNTING'
		// У бухгалтерии нет общего canWrite — только узкий доступ к странице
		// прикрепления скана к счёту, который она явно открыла по ссылке.
		? invoice && await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null }, select: { id: true, number: true, managerId: true } })
		: await assertContractAccess(contractId, user, { write: true })
	if (!contract) redirect('/projects')

	const [recent, executiveDocs] = await Promise.all([prisma.document.findMany({
		where: { contractId, deletedAt: null, ...(projectSection ? { projectSectionId: projectSection.id } : {}) },
		select: { id: true, fileName: true, kind: true, sizeBytes: true },
		orderBy: { createdAt: 'desc' },
		take: 8,
	}), prisma.executiveDoc.findMany({ where: { contractId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } })])

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

			<div className="workspace-content">
				<div className="work-hero mb-[20px] px-5 py-4">
					<h1 className="text-2xl font-bold tracking-[-0.02em]">{pr1Mode ? 'Подписанное Приложение №1' : agreement ? `Скан к ${agreementTitle(agreement.number)}` : invoice ? `Скан к счёту №${invoice.number}` : 'Загрузка документа'}</h1>
					<div className="mt-[4px] text-base text-faint">К договору № {contract.number}</div>
				</div>

				<div className="max-w-[640px]">
					<div className="mb-[14px]">
						<FormError message={searchParams.error} />
						{searchParams.success && <div className="rounded-control border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.success}</div>}
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
							agreement={agreement}
							invoice={invoice}
						/>
					</Card>

					{recent.length > 0 && (
						<div className="mt-[16px] rounded-[14px] border border-line bg-surface p-4 shadow-[0_8px_24px_rgba(25,22,45,.04)]">
							<div className="mb-[9px] text-xs uppercase tracking-[0.06em] text-faint">
								Уже загружено
							</div>
							<div className="flex flex-col gap-1.5">
								{recent.map((d) => (
									<div key={d.id} className="flex items-center justify-between gap-2.5 text-sm">
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
