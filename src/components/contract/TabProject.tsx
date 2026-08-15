import Link from 'next/link'
import { Card, CardHeader, EmptyState } from '@/components/ui'
import { formatDate } from '@/lib/format'
import type { SectionCode } from '@prisma/client'
import { PROJECT_SECTION_LABEL, type ContractWithRelations } from './shared'

export default function TabProject({
	contractId,
	projectSections,
	missingProjectSections,
	canEdit,
	addProjectSection,
}: {
	contractId: string
	projectSections: ContractWithRelations['projectSections']
	missingProjectSections: SectionCode[]
	canEdit: boolean
	addProjectSection: (formData: FormData) => Promise<void>
}) {
	return (
		<Card id="project" hidden role="tabpanel" aria-labelledby="tab-project">
			<CardHeader title="Проект" extra={projectSections.length || undefined} />
			{projectSections.length === 0 && missingProjectSections.length === 0 ? (
				<EmptyState text="Разделы проекта не заведены" />
			) : (
				<div className="grid grid-cols-1 gap-[12px] p-[18px] sm:grid-cols-2 xl:grid-cols-3">
					{projectSections.map((s) => { const sourceDocs = s.documents.filter((document) => document.kind === 'PROJECT_DWG'); const finalDocs = s.documents.filter((document) => document.kind === 'PROJECT_PDF'); return (
						<div key={s.id} className="rounded-[12px] border border-line bg-raised/40 p-[14px]">
							<div className="inline-flex items-center rounded-[7px] bg-brand-soft px-[9px] py-[3px] text-[11.5px] font-bold text-brand-ink">
								{PROJECT_SECTION_LABEL[s.code] ?? s.code}
							</div>
							<div className="mt-[10px] truncate text-[13px] font-medium">
								{s.responsible?.name ?? 'Ответственный не назначен'}
							</div>
							<div className="tnum mt-[4px] text-[11.5px] text-faint">
								{s.dateFrom ? formatDate(s.dateFrom) : '—'}
								{' – '}
								{s.dateTo ? formatDate(s.dateTo) : '—'}
							</div>
							<div className="mt-3">
								<div className="micro-label">Исходники (DWG)</div>
								<div className="mt-1 flex flex-wrap gap-1.5">
									{sourceDocs.map((document) => <a key={document.id} href={`/api/documents/${document.id}`} className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-bold text-brand-ink transition hover:border-brand/40 hover:bg-brand-soft">↓ DWG</a>)}
									{sourceDocs.length === 0 && <span className="text-[10px] text-faint">Пока не загружены</span>}
									{canEdit && <Link href={`/contracts/${contractId}/upload?project=${s.id}`} className="rounded-lg border border-dashed border-line px-2 py-1 text-[10px] font-semibold text-muted hover:border-brand/40 hover:text-brand-ink">+ Добавить</Link>}
								</div>
							</div>
							<div className="mt-3">
								<div className="micro-label">Итоговый файл (PDF)</div>
								<div className="mt-1 flex flex-wrap gap-1.5">
									{finalDocs.map((document) => <a key={document.id} href={`/api/documents/${document.id}`} className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-bold text-brand-ink transition hover:border-brand/40 hover:bg-brand-soft">↓ PDF</a>)}
									{finalDocs.length === 0 && <span className="text-[10px] text-warn">Ещё не загружен</span>}
								</div>
							</div>
						</div>
					)})}
					{canEdit && missingProjectSections.map((code) => (
						<form key={code} action={addProjectSection} className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line p-[14px] text-center">
							<input type="hidden" name="code" value={code} />
							<span className="text-[11.5px] text-muted">Раздел {PROJECT_SECTION_LABEL[code] ?? code} ещё не заведён</span>
							<button className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-brand-ink hover:bg-brand-soft">+ Добавить раздел {PROJECT_SECTION_LABEL[code] ?? code}</button>
						</form>
					))}
				</div>
			)}
		</Card>
	)
}
