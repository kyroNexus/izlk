import { Card, CardHeader, EmptyState, FileIcon } from '@/components/ui'
import { formatDate } from '@/lib/format'
import type { Role, SectionCode } from '@prisma/client'
import { PROJECT_SECTION_LABEL, type ContractWithRelations } from './shared'
import InlineDocumentUpload from './InlineDocumentUpload'
import RenameFileButton from '@/components/RenameFileButton'

type ProjectDocument = ContractWithRelations['projectSections'][number]['documents'][number]

function FileGroup({
	title,
	documents,
	kind,
	contractId,
	projectSectionId,
	canManage,
}: {
	title: string
	documents: ProjectDocument[]
	kind: 'PROJECT_DWG' | 'PROJECT_PDF'
	contractId: string
	projectSectionId: string
	canManage: boolean
}) {
	return <details open={documents.length <= 3} className="group overflow-hidden rounded-tight border border-line-soft bg-surface/60">
		<summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs font-bold text-muted hover:bg-raised"><span className="text-faint transition-transform group-open:rotate-90">›</span><span className="min-w-0 flex-1">{title}</span><span className="rounded-full bg-raised px-2 py-0.5 text-2xs">{documents.length}</span></summary>
		<div className="space-y-2 border-t border-line-soft p-2">
			{documents.length === 0 && <div className="px-1 py-2 text-xs text-faint">Пока не загружены</div>}
			{documents.map((document) => <div key={document.id} className="flex items-start gap-1 rounded-tight border border-line-soft bg-surface p-2">
				<a href={`/api/documents/${document.id}`} title={document.fileName} className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-brand-ink hover:underline"><FileIcon fileName={document.fileName} /><span className="min-w-0 break-all">{document.fileName}</span></a>
				{canManage && <RenameFileButton type="document" id={document.id} fileName={document.fileName} />}
			</div>)}
			{canManage && <InlineDocumentUpload contractId={contractId} extraFields={{ projectSectionId, kind }} />}
		</div>
	</details>
}

export default function TabProject({
	contractId,
	projectSections,
	missingProjectSections,
	canEdit,
	userId,
	userRole,
	addProjectSection,
}: {
	contractId: string
	projectSections: ContractWithRelations['projectSections']
	missingProjectSections: SectionCode[]
	canEdit: boolean
	userId: string
	userRole: Role
	addProjectSection: (formData: FormData) => Promise<void>
}) {
	return (
		<Card id="project" hidden role="tabpanel" aria-labelledby="tab-project">
			<CardHeader title="Проект" extra={projectSections.length || undefined} />
			{projectSections.length === 0 && missingProjectSections.length === 0 ? (
				<EmptyState text="Разделы проекта не заведены" />
			) : (
				<div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
					{projectSections.map((section) => {
						const sourceDocs = section.documents.filter((document) => document.kind === 'PROJECT_DWG')
						const finalDocs = section.documents.filter((document) => document.kind === 'PROJECT_PDF')
						const canManage = canEdit || userRole === 'BUILDER' || (userRole === 'DESIGNER' && section.responsibleId === userId)
						return <div key={section.id} className="rounded-control border border-line bg-raised/40 p-3.5">
							<div className="inline-flex items-center rounded-tight bg-brand-soft px-2 py-1 text-xs font-bold text-brand-ink">{PROJECT_SECTION_LABEL[section.code] ?? section.code}</div>
							<div className="mt-[10px] truncate text-base font-medium">{section.responsible?.name ?? 'Ответственный не назначен'}</div>
							<div className="tnum mt-[4px] text-xs text-faint">{section.dateFrom ? formatDate(section.dateFrom) : '—'}{' – '}{section.dateTo ? formatDate(section.dateTo) : '—'}</div>
							<div className="mt-3 space-y-2">
								<FileGroup title="Исходники (DWG)" documents={sourceDocs} kind="PROJECT_DWG" contractId={contractId} projectSectionId={section.id} canManage={canManage} />
								<FileGroup title="Итоговые файлы (PDF)" documents={finalDocs} kind="PROJECT_PDF" contractId={contractId} projectSectionId={section.id} canManage={canManage} />
							</div>
						</div>
					})}
					{canEdit && missingProjectSections.map((code) => (
						<form key={code} action={addProjectSection} className="flex flex-col items-center justify-center gap-2 rounded-control border border-dashed border-line p-3.5 text-center">
							<input type="hidden" name="code" value={code} />
							<span className="text-xs text-muted">Раздел {PROJECT_SECTION_LABEL[code] ?? code} ещё не заведён</span>
							<button className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand-ink hover:bg-brand-soft">+ Добавить раздел {PROJECT_SECTION_LABEL[code] ?? code}</button>
						</form>
					))}
				</div>
			)}
		</Card>
	)
}
