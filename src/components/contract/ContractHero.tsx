import Link from 'next/link'
import ContractHierarchy, { type ContractHierarchyNode } from '@/components/ContractHierarchy'
import CopyValue from '@/components/CopyValue'
import { Chip, StatusChip } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { WORKFLOW_STAGE_LABEL } from '@/lib/contract-workflow'
import ContractStageStepper from './ContractStageStepper'
import type { ContractWithRelations } from './shared'

export default function ContractHero({
	contract,
	canEdit,
	isAdminUser,
	workflowTone,
	hierarchyNodes,
	deleteContract,
}: {
	contract: ContractWithRelations
	canEdit: boolean
	isAdminUser: boolean
	workflowTone: 'ok' | 'warn' | 'off' | 'brand'
	hierarchyNodes: ContractHierarchyNode[]
	deleteContract: () => Promise<void>
}) {
	return (
		<div className="work-hero mb-[20px] flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2.5">
					<h1 className="text-2xl font-bold tracking-[-0.02em]">{contract.number}</h1>
					<CopyValue value={contract.number} label="Скопировать номер договора" />
					<StatusChip status={contract.status} />
					<Chip tone={workflowTone}>{WORKFLOW_STAGE_LABEL[contract.workflowStage]}</Chip>
				</div>
				<div className="mt-[5px] text-base text-muted">
					{contract.cipher ?? 'Шифр не указан'}
					{' · от '}
					{formatDate(contract.date)}
					{contract.manager?.name ? ` · Менеджер: ${contract.manager.name}` : ''}
				</div>
				<ContractStageStepper stage={contract.workflowStage} />
			</div>

			{canEdit && (
				<div className="flex flex-wrap gap-2 sm:ml-auto sm:justify-end">
					<ContractHierarchy nodes={hierarchyNodes} />
					<a href={`/api/contracts/${contract.id}/download`} className="inline-flex h-control items-center rounded-control border border-line bg-surface px-4 text-base font-semibold hover:bg-raised">Скачать всё</a>
					<Link
						href={`/contracts/${contract.id}/edit`}
						className="inline-flex h-control items-center gap-1.5 rounded-control border border-line bg-surface px-4 text-base font-semibold hover:bg-raised"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
							<path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
						</svg>
						Редактировать
					</Link>
					<Link
						href={`/contracts/${contract.id}/upload`}
						className="brand-gradient inline-flex h-control items-center gap-1.5 rounded-control px-4 text-base font-semibold text-white"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
							<path d="M12 4v11m0 0 4-4m-4 4-4-4M4 19h16" />
						</svg>
						Загрузить документ
					</Link>
					{isAdminUser && <form action={deleteContract}><button className="inline-flex h-control items-center rounded-control border border-danger/25 bg-danger/10 px-3 text-sm font-semibold text-danger hover:bg-danger/15">В корзину</button></form>}
				</div>
			)}
		</div>
	)
}
