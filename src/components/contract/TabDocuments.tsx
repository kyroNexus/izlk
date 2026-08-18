import Link from 'next/link'
import { Card, CardHeader, EmptyState, FileIcon } from '@/components/ui'
import { DOCUMENT_KIND_LABELS, formatBytes, formatDate, plural } from '@/lib/format'
import type { DocumentState } from '@prisma/client'
import type { ContractWithRelations } from './shared'
import DocumentsDropzone from './DocumentsDropzone'

type DocumentRow = ContractWithRelations['documents'][number]
type DocumentSection = {
	key: DocumentState
	label: string
	hint: string
	documents: DocumentRow[]
	byKind: Map<DocumentRow['kind'], DocumentRow[]>
	kinds: DocumentRow['kind'][]
}

export default function TabDocuments({
	contract,
	canEdit,
	isAdminUser,
	documentsForRegistry,
	selectedFolder,
	folders,
	folderFor,
	sourceDataChecklist,
	latestPr1,
	documentSections,
	stateLabel,
	changeDocumentState,
	deleteDocument,
}: {
	contract: ContractWithRelations
	canEdit: boolean
	isAdminUser: boolean
	documentsForRegistry: DocumentRow[]
	selectedFolder: string | null
	folders: { key: string; label: string }[]
	folderFor: (document: DocumentRow) => string
	sourceDataChecklist: { label: string; hint: string; document: DocumentRow | undefined }[]
	latestPr1: DocumentRow | undefined
	documentSections: DocumentSection[]
	stateLabel: Record<DocumentState, string>
	changeDocumentState: (formData: FormData) => Promise<void>
	deleteDocument: (formData: FormData) => Promise<void>
}) {
	return (
		<Card id="documents" hidden role="tabpanel" aria-labelledby="tab-documents">
			<CardHeader
				title="Документы"
				extra={plural(documentsForRegistry.length, 'файл', 'файла', 'файлов')}
			/>
			<div className="flex gap-1 overflow-x-auto border-b border-line-soft px-3 py-2.5">
				<Link href={`/contracts/${contract.id}#documents`} className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold ${!selectedFolder ? 'bg-brand text-white' : 'bg-raised text-muted hover:text-ink'}`}>Все · {documentsForRegistry.length}</Link>
				{folders.map((folder) => { const count = documentsForRegistry.filter((document) => folderFor(document) === folder.key).length; return <Link key={folder.key} href={`/contracts/${contract.id}?folder=${folder.key}#documents`} className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold ${selectedFolder === folder.key ? 'bg-brand text-white' : 'bg-raised text-muted hover:text-ink'}`}>{folder.label} · {count}</Link> })}
			</div>
			{canEdit && <div className="mx-[11px] mt-[11px]"><DocumentsDropzone contractId={contract.id} /></div>}
			{(!selectedFolder || selectedFolder === 'source-data') && <div className="mx-[11px] mt-[11px] rounded-control border border-brand/15 bg-brand/5 p-3">
				<div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="text-sm font-bold">Исходные данные от заказчика</div><div className="mt-1 text-xs text-muted">ИГИ, ГПЗУ, топосъёмка и сведения о стеснённых условиях хранятся отдельно от смет и проектов.</div></div>{canEdit && <Link href={`/contracts/${contract.id}/upload?kind=SOURCE_DATA`} className="rounded-tight border border-brand/25 bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand-ink hover:bg-brand-soft">+ Добавить</Link>}</div>
				<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{sourceDataChecklist.map((item) => <div key={item.label} className={`rounded-tight border px-2.5 py-2 ${item.document ? 'border-ok/25 bg-ok/5' : 'border-line-soft bg-surface/60'}`}><div className="flex items-center gap-1.5 text-xs font-bold"><span className={item.document ? 'text-ok' : 'text-faint'}>{item.document ? '●' : '○'}</span>{item.label}</div><div className="mt-1 truncate text-2xs text-faint">{item.document ? item.document.fileName : item.hint}</div></div>)}</div>
			</div>}
			<div className={`mx-[11px] mt-[11px] flex flex-wrap items-center gap-2.5 rounded-control border px-3 py-2.5 ${latestPr1 ? contract.pr1ConfirmedAt ? 'border-ok/25 bg-ok-bg' : 'border-warn/25 bg-warn-bg' : 'border-line-soft bg-raised/50'}`}>
				<div className="grid h-8 w-8 place-items-center rounded-tight bg-surface text-2xs font-bold text-brand-ink">ПР1</div>
				<div className="min-w-0 flex-1"><div className="text-sm font-bold">Подписанное приложение №1</div>{latestPr1 ? <Link href={`/documents/${latestPr1.id}`} className="mt-[2px] block truncate text-xs font-semibold text-brand-ink hover:underline">{latestPr1.fileName}</Link> : <div className="mt-[2px] text-xs text-muted">Файл ещё не загружен</div>}</div>
				{latestPr1 ? <a href="#workflow" className={`rounded-tight px-2.5 py-1.5 text-xs font-semibold ${contract.pr1ConfirmedAt ? 'bg-ok/10 text-ok' : 'bg-warn/15 text-warn'}`}>{contract.pr1ConfirmedAt ? 'Подтверждено' : 'Подтвердить'}</a> : canEdit && <Link href={`/contracts/${contract.id}/upload?pr1=1`} className="rounded-tight border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold">Загрузить ПР1</Link>}
			</div>
			{documentsForRegistry.length === 0 ? (
				<EmptyState text="Файлов пока нет" />
			) : (
				<div className="space-y-[9px] p-2.5">
					{documentSections.map((section) => <details key={section.key} open={section.key === 'SOURCE' && section.documents.length <= 6} className="overflow-hidden rounded-control border border-line-soft">
						<summary className="group/state flex cursor-pointer list-none items-center gap-3 bg-raised/60 px-3 py-2.5 transition hover:bg-brand/5"><span className="text-faint transition-transform group-open/state:rotate-90"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">{section.label}</span><span className="block text-2xs text-faint">{section.hint}</span></span><span className="hidden text-2xs font-medium text-faint sm:inline">{section.documents.length > 12 ? 'Открыть список' : ''}</span><span className="rounded-full bg-surface px-2 py-1 text-2xs font-bold text-muted">{section.documents.length}</span></summary>
						<div className="px-2 pb-2">{canEdit && <div className="flex justify-end px-2 pt-2"><Link href={`/contracts/${contract.id}/upload?state=${section.key}`} className="rounded-tight border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-brand-ink hover:bg-brand-soft">+ Загрузить в эту папку</Link></div>}{section.kinds.length === 0 && <div className="px-2 py-4 text-center text-xs text-faint">В этом разделе файлов пока нет</div>}{section.kinds.map((kind) => <div key={kind}>
							<div className="flex items-center gap-2 px-2 pb-1 pt-3"><span className="text-xs font-bold text-muted">{DOCUMENT_KIND_LABELS[kind]}</span><span className="text-2xs text-faint">{section.byKind.get(kind)!.length}</span></div>
							{section.byKind.get(kind)!.slice(0, 12).map((d) => (
					<div key={d.id} className="interactive-row flex items-center gap-2 rounded-control px-2 py-1">
								<Link href={`/documents/${d.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 py-1">
									<FileIcon fileName={d.fileName} />
									<div className="min-w-0">
										<div className="truncate text-base font-medium">{d.fileName}</div>
										<div className="mt-[2px] text-xs text-faint">
											{formatBytes(d.sizeBytes)}
											{` · ${stateLabel[d.state]}`}
											{d.signedAt ? ` · подписан ${formatDate(d.signedAt)}` : ''}
											{d.isConfidential ? ' · Конфиденциально' : ''}
										</div>
									</div>
								</Link>
								{canEdit && <form action={changeDocumentState}><input type="hidden" name="documentId" value={d.id} /><button className="rounded-tight border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-muted hover:border-brand/40 hover:text-brand-ink">{d.state === 'ARCHIVE' ? 'Восстановить' : 'В архив'}</button></form>}
								{isAdminUser && <form action={deleteDocument}><input type="hidden" name="documentId" value={d.id} /><button className="rounded-tight border border-danger/20 bg-danger/5 px-2 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10">Удалить</button></form>}
								</div>
							))}
							{section.byKind.get(kind)!.length > 12 && <Link href={`/documents?contractId=${contract.id}&kind=${kind}&state=${section.key}`} className="mx-2 mt-1 inline-flex rounded-tight border border-dashed border-line-soft bg-raised/40 px-2.5 py-2 text-xs font-semibold text-brand-ink hover:bg-brand-soft">Показать все {section.byKind.get(kind)!.length} файлов в реестре</Link>}
						</div>)}</div>
					</details>)}
				</div>
			)}
		</Card>
	)
}
