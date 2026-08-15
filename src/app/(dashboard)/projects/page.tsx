import Link from 'next/link'
import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, CardHeader, Chip, EmptyState, StatTile } from '@/components/ui'
import { addWorkingDays, workingDaysBetween } from '@/lib/deadline'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import { formatDate, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { notify } from '@/lib/notifications'
import { advanceAfterProjectSectionsReady } from '@/lib/contract-workflow'

export const dynamic = 'force-dynamic'

const STATUS = {
	QUEUED: 'В очереди',
	IN_PROGRESS: 'В работе',
	PAUSED: 'На паузе',
	DONE: 'Готов',
} as const

type PageParams = { section?: string; view?: string; q?: string }

type DesignProject = {
	id: string
	responsibleId: string | null
	durationDays: number
	deadline: Date | null
	queueStatus: 'QUEUED' | 'IN_PROGRESS' | 'PAUSED' | 'DONE'
	comment: string | null
	documents: Array<{ id: string }>
	contract: { id: string; number: string; cipher: string | null; contractor: { name: string } }
}

export default async function ProjectsPage({ searchParams }: { searchParams: PageParams }) {
	if (searchParams.view === 'production') redirect('/production-schedule')
	const user = await requireUser()
	const section = searchParams.section === 'KZH' || searchParams.section === 'AR' ? searchParams.section : 'KM'
	const query = searchParams.q?.trim().slice(0, 80) ?? ''

	const [projects, designers, productionContracts, projectOverview] = await Promise.all([
		prisma.projectSection.findMany({
			where: {
				deletedAt: null,
				code: section,
				...(query ? { OR: [
					{ contract: { number: { contains: query, mode: 'insensitive' } } },
					{ contract: { cipher: { contains: query, mode: 'insensitive' } } },
					{ contract: { contractor: { name: { contains: query, mode: 'insensitive' } } } },
				] } : {}),
				...(user.role === 'DESIGNER' ? { responsibleId: user.id } : { contract: contractScope(user) }),
			},
			include: {
				contract: { select: { id: true, number: true, cipher: true, contractor: { select: { name: true } } } },
				responsible: { select: { id: true, name: true } },
				documents: { where: { deletedAt: null, kind: 'PROJECT_PDF' }, select: { id: true }, take: 1 },
			},
			orderBy: [{ responsible: { name: 'asc' } }, { queuePosition: 'asc' }, { createdAt: 'asc' }],
			take: 500,
		}),
		prisma.user.findMany({
			where: { deletedAt: null, isActive: true, OR: [{ role: 'DESIGNER' }, { responsibleFor: { some: { deletedAt: null } } }] },
			select: { id: true, name: true },
			orderBy: { name: 'asc' },
		}),
		prisma.contract.findMany({
			where: { ...contractScope(user), workflowStage: { in: ['WAITING_PRODUCTION', 'PRODUCTION'] } },
			select: {
				id: true,
				number: true,
				cipher: true,
				workflowStage: true,
				deadline: true,
				objectAddress: true,
				contractor: { select: { name: true } },
				projectSections: {
					where: { deletedAt: null, code: 'KM' },
					select: {
						id: true,
						queueStatus: true,
						responsible: { select: { name: true } },
						documents: { where: { deletedAt: null, kind: { in: ['PROJECT_PDF', 'PROJECT_DWG'] } }, select: { id: true, fileName: true, kind: true } },
					},
				},
			},
			orderBy: [{ workflowStage: 'asc' }, { deadline: 'asc' }, { date: 'asc' }],
			take: 500,
		}),
		prisma.projectSection.findMany({
			where: {
				deletedAt: null,
				...(user.role === 'DESIGNER' ? { responsibleId: user.id } : { contract: contractScope(user) }),
			},
			select: { code: true, queueStatus: true, documents: { where: { deletedAt: null, kind: 'PROJECT_PDF' }, select: { id: true }, take: 1 } },
			take: 1500,
		}),
	])

	async function updateProject(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		const id = String(formData.get('id') ?? '')
		const op = String(formData.get('op') ?? 'save')
		const current = await prisma.projectSection.findFirst({
			where: {
				id,
				deletedAt: null,
				...(actingUser.role === 'DESIGNER' ? { responsibleId: actingUser.id } : { contract: contractScope(actingUser) }),
			},
			select: { id: true, code: true, responsibleId: true, queuePosition: true, contract: { select: { id: true, number: true, managerId: true } } },
		})
		if (!current) redirect('/projects')

		if (actingUser.role === 'DESIGNER') {
			const status = String(formData.get('status') ?? '')
			if (!['IN_PROGRESS', 'PAUSED', 'DONE'].includes(status)) redirect(`/projects?section=${current.code}`)
			if (status === 'DONE') {
				const finalPdf = await prisma.document.findFirst({ where: { projectSectionId: id, kind: 'PROJECT_PDF', deletedAt: null }, select: { id: true } })
				if (!finalPdf) redirect(`/contracts/${current.contract.id}/upload?project=${id}`)
			}
			await prisma.projectSection.update({
				where: { id },
				data: {
					queueStatus: status as keyof typeof STATUS,
					comment: String(formData.get('comment') ?? '').trim() || null,
					...(status === 'IN_PROGRESS' ? { dateFrom: new Date(), dateTo: null } : {}),
					...(status === 'DONE' ? { dateTo: new Date() } : {}),
				},
			})
			if (status === 'DONE') {
				await advanceAfterProjectSectionsReady(current.contract.id, actingUser.id)
				await notify({
					userId: current.contract.managerId,
					type: 'READY',
					title: `Раздел ${current.code} готов`,
					message: `Проектировщик завершил раздел по договору № ${current.contract.number}`,
					href: `/contracts/${current.contract.id}`,
					dedupeKey: `ready:${current.id}`,
				})
			}
			redirect(`/projects?section=${current.code}`)
		}

		if (!canWrite(actingUser) && actingUser.role !== 'BUILDER') redirect('/projects')
		if (op === 'up' || op === 'down') {
			const neighbor = await prisma.projectSection.findFirst({
				where: {
					deletedAt: null,
					code: current.code,
					responsibleId: current.responsibleId,
					...(op === 'up' ? { queuePosition: { lt: current.queuePosition } } : { queuePosition: { gt: current.queuePosition } }),
				},
				orderBy: { queuePosition: op === 'up' ? 'desc' : 'asc' },
				select: { id: true, queuePosition: true },
			})
			if (neighbor) await prisma.$transaction([
				prisma.projectSection.update({ where: { id: current.id }, data: { queuePosition: neighbor.queuePosition } }),
				prisma.projectSection.update({ where: { id: neighbor.id }, data: { queuePosition: current.queuePosition } }),
			])
			redirect(`/projects?section=${current.code}`)
		}

		const responsibleId = String(formData.get('responsibleId') ?? '')
		const durationDays = Number.parseInt(String(formData.get('durationDays') ?? ''), 10)
		const deadlineRaw = String(formData.get('deadline') ?? '')
		const status = String(formData.get('status') ?? '')
		const responsible = await prisma.user.findFirst({
			where: { id: responsibleId, deletedAt: null, isActive: true, OR: [{ role: 'DESIGNER' }, { responsibleFor: { some: { deletedAt: null } } }] },
			select: { id: true },
		})
		if (!responsible || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 120 || !Object.keys(STATUS).includes(status)) redirect(`/projects?section=${current.code}`)

		let queuePosition = current.queuePosition
		if (responsibleId !== current.responsibleId) {
			const last = await prisma.projectSection.aggregate({ where: { code: current.code, responsibleId }, _max: { queuePosition: true } })
			queuePosition = (last._max.queuePosition ?? 0) + 10
		}
		await prisma.projectSection.update({
			where: { id },
			data: {
				responsibleId,
				durationDays,
				deadline: deadlineRaw ? new Date(deadlineRaw) : null,
				queueStatus: status as keyof typeof STATUS,
				queuePosition,
				comment: String(formData.get('comment') ?? '').trim() || null,
			},
		})
		if (responsibleId !== current.responsibleId) await notify({
			userId: responsibleId,
			type: 'ASSIGNMENT',
			title: `Назначен раздел ${current.code}`,
			message: `Договор № ${current.contract.number} добавлен в вашу очередь`,
			href: `/projects?section=${current.code}`,
			dedupeKey: `assignment:${current.id}:${responsibleId}`,
		})
		redirect(`/projects?section=${current.code}`)
	}

	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const byDesigner = new Map<string, typeof projects>()
	for (const project of projects) {
		const key = project.responsible?.name ?? 'Не назначен'
		byDesigner.set(key, [...(byDesigner.get(key) ?? []), project])
	}
	let late = 0
	let atRisk = 0
	let done = 0
	const forecasts = new Map<string, { start: Date; finish: Date; gap: number | null }>()
	for (const queue of byDesigner.values()) {
		let freeAt = new Date(today)
		for (const project of queue) {
			const isDone = project.queueStatus === 'DONE' || project.documents.length > 0
			if (isDone) {
				done += 1
				const finish = project.dateTo ?? today
				forecasts.set(project.id, { start: project.dateFrom ?? finish, finish, gap: project.deadline ? workingDaysBetween(finish, project.deadline) : null })
				continue
			}
			const start = project.queueStatus === 'IN_PROGRESS' && project.dateFrom ? project.dateFrom : freeAt
			const finish = addWorkingDays(start, project.durationDays)
			const gap = project.deadline ? workingDaysBetween(finish, project.deadline) : null
			if (gap != null && gap < 0) late += 1
			else if (gap != null && gap <= 5) atRisk += 1
			forecasts.set(project.id, { start, finish, gap })
			freeAt = addWorkingDays(finish, 1)
		}
	}

	const name = user.name ?? user.email ?? ''
	const kmIsReadyForProduction = (item: typeof productionContracts[number]) => {
		const km = item.projectSections[0]
		return Boolean(km && km.queueStatus === 'DONE' && km.documents.some((document) => document.kind === 'PROJECT_PDF'))
	}
	const blockedBeforeProduction = productionContracts.filter((item) => item.workflowStage === 'WAITING_PRODUCTION' && !kmIsReadyForProduction(item))
	const productionBuffer = productionContracts.filter((item) => item.workflowStage === 'PRODUCTION' || kmIsReadyForProduction(item))
	const waitingProduction = productionBuffer.filter((item) => item.workflowStage === 'WAITING_PRODUCTION')
	const inProduction = productionBuffer.filter((item) => item.workflowStage === 'PRODUCTION')
	const graphSummary = (['KM', 'KZH', 'AR'] as const).map((code) => {
		const items = projectOverview.filter((item) => item.code === code)
		const ready = items.filter((item) => item.queueStatus === 'DONE' || item.documents.length > 0).length
		const paused = items.filter((item) => item.queueStatus === 'PAUSED').length
		return { code, total: items.length, ready, paused, working: Math.max(0, items.length - ready - paused) }
	})

	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Проекты' }]} userName={name.split(' ')[0]} initials={initials(name)} notifications={late} />
		<div className="workspace-content px-[26px] py-[22px]">
			<div className="work-hero mb-[16px] flex flex-wrap items-end justify-between gap-[12px] px-5 py-4">
				<div>
					<h1 className="text-[26px] font-bold">Очередь проектирования</h1>
					<p className="mt-[5px] text-[13px] text-muted">Прогноз по рабочим дням, исполнителям и дедлайнам</p>
				</div>
				{canWrite(user) && <Link href="/projects/new" className="brand-gradient inline-flex h-[40px] items-center rounded-[10px] px-[17px] text-[13.5px] font-semibold text-white">+ Добавить проект</Link>}
			</div>
			<ProjectFlowOverview sections={graphSummary} readyForProduction={waitingProduction.length} blocked={blockedBeforeProduction.length} inProduction={inProduction.length} />

			<DesignQueue
				section={section}
				projects={projects}
				designers={designers}
				byDesigner={byDesigner}
				forecasts={forecasts}
				done={done}
				atRisk={atRisk}
				late={late}
				query={query}
				userRole={user.role}
				canWrite={canWrite(user) || user.role === 'BUILDER'}
				action={updateProject}
			/>
		</div>
	</>
}

function ProjectFlowOverview({ sections, readyForProduction, blocked, inProduction }: {
	sections: Array<{ code: 'KM' | 'KZH' | 'AR'; total: number; ready: number; paused: number; working: number }>
	readyForProduction: number
	blocked: number
	inProduction: number
}) {
	return <Card className="project-flow-overview mb-[14px] overflow-hidden border-brand/15 bg-gradient-to-br from-brand-soft/55 via-surface to-surface shadow-[0_14px_34px_rgba(25,22,45,.055)]">
		<div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-[16px] py-[13px]">
			<div><h2 className="text-[14px] font-bold">Карта потока работ</h2><p className="mt-0.5 text-[12px] text-muted">Нажмите на раздел — откроется его живая очередь</p></div>
			<Link href="/production-schedule" className="rounded-full border border-brand/25 bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-brand-ink transition hover:-translate-y-px hover:border-brand/45">График производства →</Link>
		</div>
		<div className="grid gap-3 p-[14px] lg:grid-cols-[minmax(0,1fr)_minmax(250px,.8fr)]">
			<div className="grid gap-2 sm:grid-cols-3">{sections.map((item) => {
				const label = item.code === 'KM' ? 'КМ' : item.code === 'KZH' ? 'КЖ' : 'АР'
				const completed = item.total ? Math.round((item.ready / item.total) * 100) : 0
				return <Link key={item.code} href={`/projects?section=${item.code}`} className="project-flow-lane group rounded-[12px] border border-line bg-surface/90 p-3 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-md">
					<div className="flex items-center justify-between gap-2"><b className="text-[13px]">{label}</b><span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-ink">{completed}%</span></div>
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${completed}%` }} /></div>
					<div className="mt-2 grid grid-cols-3 gap-1 text-[10.5px]"><span className="text-brand">● {item.working} раб.</span><span className="text-warn">● {item.paused} пауза</span><span className="text-ok">● {item.ready} готово</span></div>
				</Link>
			})}</div>
			<div className="project-production-bridge rounded-[12px] border border-line bg-surface/90 p-3"><div className="flex items-center justify-between"><b className="text-[13px]">КМ → цех</b><span className="text-[11px] text-muted">передача</span></div><div className="mt-2 grid grid-cols-3 gap-2 text-center"><Link href="/production-schedule" className="rounded-[9px] bg-ok-bg px-2 py-2 transition hover:-translate-y-px"><b className="block text-[18px] text-ok">{readyForProduction}</b><span className="text-[10px] text-muted">готово</span></Link><Link href="/production-schedule" className="rounded-[9px] bg-warn-bg px-2 py-2 transition hover:-translate-y-px"><b className="block text-[18px] text-warn">{blocked}</b><span className="text-[10px] text-muted">нужен PDF</span></Link><Link href="/production-schedule" className="rounded-[9px] bg-brand-soft px-2 py-2 transition hover:-translate-y-px"><b className="block text-[18px] text-brand">{inProduction}</b><span className="text-[10px] text-muted">в цехе</span></Link></div></div>
		</div>
	</Card>
}

function DesignQueue({ section, projects, designers, byDesigner, forecasts, done, atRisk, late, query, userRole, canWrite: editable, action }: {
	section: 'KM' | 'KZH' | 'AR'
	projects: DesignProject[]
	designers: Array<{ id: string; name: string }>
	byDesigner: Map<string, DesignProject[]>
	forecasts: Map<string, { start: Date; finish: Date; gap: number | null }>
	done: number
	atRisk: number
	late: number
	query: string
	userRole: string
	canWrite: boolean
	action: (formData: FormData) => void | Promise<void>
}) {
	return <>
		<div className="mb-[14px] flex flex-wrap gap-[7px]">
			{(['KM', 'KZH', 'AR'] as const).map((item) => <Link key={item} href={`/projects?section=${item}`} className={`rounded-full px-[16px] py-[8px] text-[13px] font-semibold transition ${section === item ? 'brand-gradient text-white shadow-sm' : 'border border-line bg-surface hover:bg-raised'}`}>{item === 'KZH' ? 'КЖ' : item} проекты</Link>)}
		</div>
		<form className="work-toolbar mb-[14px] flex flex-wrap items-center gap-2 p-2" method="get">
			<input type="hidden" name="section" value={section} />
			<label className="min-w-[220px] flex-1"><span className="sr-only">Найти договор в очереди</span><input name="q" defaultValue={query} placeholder="Найти договор, шифр или контрагента" className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-[12.5px] outline-none transition focus:border-brand/55" /></label>
			<button className="h-10 rounded-[10px] bg-brand px-4 text-[12px] font-semibold text-white transition hover:bg-brand-deep">Найти</button>
			{query && <Link href={`/projects?section=${section}`} className="inline-flex h-10 items-center rounded-[10px] px-3 text-[12px] font-semibold text-muted transition hover:bg-raised hover:text-ink">Сбросить</Link>}
		</form>
		<div className="mb-[14px] grid grid-cols-2 gap-[10px] lg:grid-cols-4">
			<StatTile label="В очереди" value={projects.length - done} tone="brand" />
			<StatTile label="Готово" value={done} tone="ok" />
			<StatTile label="Риск ≤ 5 дней" value={atRisk} tone="warn" />
			<StatTile label="Прогноз просрочки" value={late} tone={late ? 'danger' : 'ok'} />
		</div>
		{projects.length === 0 ? <Card><EmptyState text={`Очередь ${section === 'KZH' ? 'КЖ' : section} пока пуста`} /></Card> : <div className="grid items-start gap-[14px] xl:grid-cols-[minmax(0,1fr)_330px] xl:gap-[18px]"><div className="grid gap-[14px]">{[...byDesigner.entries()].map(([designer, queue]) => <Card key={designer} className="project-queue-card overflow-hidden"><CardHeader title={designer} extra={`${queue.length} проектов`} /><div className="flex flex-col">{queue.map((project, index) => {
			const forecast = forecasts.get(project.id)!
			const finished = project.queueStatus === 'DONE' || project.documents.length > 0
			const tone = finished ? 'ok' : forecast.gap != null && forecast.gap < 0 ? 'danger' : forecast.gap != null && forecast.gap <= 5 ? 'warn' : 'off'
			return <form action={action} key={project.id} className="border-b border-line-soft transition-colors last:border-b-0 hover:bg-raised/60">
				<input type="hidden" name="id" value={project.id} />
				<details open={index === 0} className="group project-queue-item">
					<summary className="flex cursor-pointer list-none items-center justify-between gap-[10px] p-[15px] marker:content-none"><div className="min-w-0"><span className="font-bold text-brand-ink">№ {project.contract.number}</span><div className="mt-[2px] truncate text-[11.5px] text-muted">{project.contract.contractor.name}{project.contract.cipher ? ` · ${project.contract.cipher}` : ''}</div></div><div className="flex flex-none items-center gap-2"><Chip tone={tone}>{finished ? 'Готов' : forecast.gap == null ? 'Без дедлайна' : forecast.gap < 0 ? `Просрочка ${Math.abs(forecast.gap)} дн.` : `Запас ${forecast.gap} дн.`}</Chip><span className="grid h-7 w-7 place-items-center rounded-lg border border-line text-brand transition duration-200 group-open:rotate-180 group-hover:border-brand/35 group-hover:bg-brand-soft">⌄</span></div></summary>
					<div className="border-t border-line-soft px-[15px] pb-[15px]"><div className="mt-[10px] flex items-center justify-between gap-3"><Link href={`/contracts/${project.contract.id}`} className="text-[11.5px] font-semibold text-brand-ink hover:underline">Открыть договор →</Link><span className="text-[11px] text-faint">{section === 'KZH' ? 'КЖ' : section} · позиция {index + 1}</span></div><div className="mt-[10px] grid grid-cols-3 gap-[6px] rounded-[9px] bg-raised p-[8px] text-[11px]"><div><span className="text-faint">Начало</span><br/><b>{formatDate(forecast.start)}</b></div><div><span className="text-faint">Готово</span><br/><b>{formatDate(forecast.finish)}</b></div><div><span className="text-faint">Дедлайн</span><br/><b>{formatDate(project.deadline)}</b></div></div>
					{editable && <div className="mt-[10px] grid grid-cols-2 gap-[7px] md:grid-cols-4"><select name="responsibleId" defaultValue={project.responsibleId ?? ''} className="h-[34px] rounded-[8px] border border-line bg-surface px-[8px] text-[11.5px]">{designers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input name="durationDays" type="number" min="1" max="120" defaultValue={project.durationDays} className="h-[34px] rounded-[8px] border border-line bg-surface px-[8px] text-[11.5px]" title="Рабочих дней" /><input name="deadline" type="date" defaultValue={project.deadline?.toISOString().slice(0, 10) ?? ''} className="h-[34px] rounded-[8px] border border-line bg-surface px-[8px] text-[11.5px]" /><select name="status" defaultValue={project.queueStatus} className="h-[34px] rounded-[8px] border border-line bg-surface px-[8px] text-[11.5px]">{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input name="comment" defaultValue={project.comment ?? ''} placeholder="Комментарий" className="col-span-2 h-[34px] rounded-[8px] border border-line bg-surface px-[8px] text-[11.5px] md:col-span-3" /><button name="op" value="save" className="h-[34px] rounded-[8px] bg-brand px-[10px] text-[11.5px] font-semibold text-white">Сохранить</button><div className="col-span-2 flex gap-[6px] md:col-span-4"><button name="op" value="up" disabled={index === 0} className="rounded-[7px] border border-line px-[9px] py-[5px] text-[11px] disabled:opacity-30">↑ Выше</button><button name="op" value="down" disabled={index === queue.length - 1} className="rounded-[7px] border border-line px-[9px] py-[5px] text-[11px] disabled:opacity-30">↓ Ниже</button></div></div>}
					{userRole === 'DESIGNER' && <div className="mt-[10px] grid gap-[7px]"><Link href={`/contracts/${project.contract.id}/upload?project=${project.id}`} className="w-fit rounded-[8px] border border-brand/30 bg-brand/10 px-[10px] py-[7px] text-[11.5px] font-semibold text-brand-ink">Загрузить DWG/PDF</Link><div className="grid grid-cols-[150px_1fr_auto] gap-[7px]"><select name="status" defaultValue={project.queueStatus === 'QUEUED' ? 'IN_PROGRESS' : project.queueStatus} className="h-[34px] rounded-[8px] border border-line bg-surface px-[8px] text-[11.5px]"><option value="IN_PROGRESS">В работе</option><option value="PAUSED">Пауза</option><option value="DONE">Готово</option></select><input name="comment" defaultValue={project.comment ?? ''} placeholder="Комментарий" className="h-[34px] rounded-[8px] border border-line bg-surface px-[8px] text-[11.5px]" /><button className="h-[34px] rounded-[8px] bg-brand px-[10px] text-[11.5px] font-semibold text-white">Сохранить</button></div></div>}</div>
				</details>
			</form>
		})}</div></Card>)}</div><ProjectQueueSummary section={section} projects={projects} forecasts={forecasts} done={done} atRisk={atRisk} late={late} /></div>}
	</>
}

function ProjectQueueSummary({ section, projects, forecasts, done, atRisk, late }: {
	section: 'KM' | 'KZH' | 'AR'
	projects: DesignProject[]
	forecasts: Map<string, { start: Date; finish: Date; gap: number | null }>
	done: number
	atRisk: number
	late: number
}) {
	const active = projects.filter((project) => project.queueStatus !== 'DONE' && project.documents.length === 0)
	const next = active.slice().sort((left, right) => (forecasts.get(left.id)?.finish.getTime() ?? 0) - (forecasts.get(right.id)?.finish.getTime() ?? 0))[0]
	const nextForecast = next ? forecasts.get(next.id) : null
	return <aside className="space-y-[14px] xl:sticky xl:top-[84px]">
		<Card className="overflow-hidden"><CardHeader title={`Сводка ${section === 'KZH' ? 'КЖ' : section}`} extra={`${projects.length} в очереди`} /><div className="grid grid-cols-2 gap-px bg-line-soft"><div className="bg-surface p-4"><span className="text-[11px] text-faint">Активно</span><b className="mt-1 block text-[24px] text-brand">{active.length}</b></div><div className="bg-surface p-4"><span className="text-[11px] text-faint">Готово</span><b className="mt-1 block text-[24px] text-ok">{done}</b></div><div className="bg-surface p-4"><span className="text-[11px] text-faint">Нужен шаг</span><b className="mt-1 block text-[24px] text-warn">{atRisk + late}</b></div><div className="bg-surface p-4"><span className="text-[11px] text-faint">Всего задач</span><b className="mt-1 block text-[24px] text-ink">{projects.length}</b></div></div></Card>
		<Card className="border-brand/20 bg-gradient-to-br from-brand-soft/60 via-surface to-surface p-4"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-brand">Следующая позиция</span>{next && nextForecast ? <><Link href={`/contracts/${next.contract.id}`} className="mt-2 block text-[16px] font-bold text-brand-ink hover:underline">№ {next.contract.number}</Link><p className="mt-1 text-[12px] text-muted">{next.contract.contractor.name}</p><div className="mt-3 rounded-[10px] border border-line bg-surface/85 p-3 text-[12px]"><span className="text-faint">Прогноз готовности</span><b className="mt-1 block">{formatDate(nextForecast.finish)}</b><span className={`mt-1 block ${nextForecast.gap != null && nextForecast.gap < 0 ? 'text-danger' : 'text-muted'}`}>{nextForecast.gap == null ? 'Дедлайн не указан' : nextForecast.gap < 0 ? `Просрочка ${Math.abs(nextForecast.gap)} дн.` : `Запас ${nextForecast.gap} дн.`}</span></div></> : <p className="mt-2 text-[12px] text-muted">Все позиции очереди завершены. Можно перейти к следующему разделу.</p>}</Card>
		<Card className="p-4"><h3 className="text-[13px] font-bold">Как работать с очередью</h3><ol className="mt-3 space-y-2 text-[12px] text-muted"><li><b className="mr-2 text-brand">1.</b>Откройте только нужный договор.</li><li><b className="mr-2 text-brand">2.</b>Назначьте срок и ответственного.</li><li><b className="mr-2 text-brand">3.</b>После PDF переведите раздел в «Готово».</li></ol></Card>
	</aside>
}
