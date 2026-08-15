import Link from 'next/link'
import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, Field, FormError, inputClass, selectClass, textareaClass } from '@/components/ui'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import { initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'

export default async function NewProjectPage({ searchParams }: { searchParams: { error?: string } }) {
	const user = await requireUser()
	if (!canWrite(user)) redirect('/projects')
	const [contracts, designers] = await Promise.all([
		prisma.contract.findMany({ where: { ...contractScope(user), status: 'ACTIVE' }, select: { id: true, number: true, cipher: true, contractor: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 1000 }),
		prisma.user.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
	])
	async function createProject(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!canWrite(actingUser)) redirect('/projects')
		const contractId = String(formData.get('contractId') ?? ''), responsibleId = String(formData.get('responsibleId') ?? '')
		const code = String(formData.get('code') ?? ''), durationDays = Number.parseInt(String(formData.get('durationDays') ?? ''), 10)
		const deadlineRaw = String(formData.get('deadline') ?? ''), comment = String(formData.get('comment') ?? '').trim()
		const contract = await prisma.contract.findFirst({ where: { id: contractId, ...contractScope(actingUser) }, select: { id: true } })
		const responsible = await prisma.user.findFirst({ where: { id: responsibleId, deletedAt: null, isActive: true }, select: { id: true } })
		if (!contract || !responsible || !['KM', 'KZH', 'AR'].includes(code) || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 120) redirect(`/projects/new?error=${encodeURIComponent('Проверьте договор, направление, исполнителя и длительность')}`)
		const sectionCode = code as 'KM' | 'KZH' | 'AR'
		const last = await prisma.projectSection.aggregate({ where: { code: sectionCode, responsibleId }, _max: { queuePosition: true } })
		await prisma.projectSection.create({ data: { contractId, responsibleId, code: sectionCode, durationDays, deadline: deadlineRaw ? new Date(deadlineRaw) : null, queuePosition: (last._max.queuePosition ?? 0) + 10, comment: comment || null } })
		redirect(`/projects?section=${code}`)
	}
	const name = user.name ?? user.email ?? ''
	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Проекты', href: '/projects' }, { label: 'Добавить в очередь' }]} userName={name.split(' ')[0]} initials={initials(name)} /><div className="workspace-content px-[26px] py-[22px]"><h1 className="text-[26px] font-bold">Добавить проект в очередь</h1><p className="mb-[16px] mt-[5px] text-[13px] text-muted">Договор появится в очереди выбранного конструктора.</p><div className="max-w-[720px]"><FormError message={searchParams.error} /><Card className="mt-[14px] p-[22px]"><form action={createProject} className="flex flex-col gap-[15px]"><Field label="Договор" required><select name="contractId" required defaultValue="" className={selectClass}><option value="" disabled>Выберите договор</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>№ {contract.number} · {contract.contractor.name}{contract.cipher ? ` · ${contract.cipher}` : ''}</option>)}</select></Field><div className="grid grid-cols-1 gap-[14px] md:grid-cols-2"><Field label="Направление" required><select name="code" defaultValue="KM" className={selectClass}><option value="KM">КМ</option><option value="KZH">КЖ</option><option value="AR">АР</option></select></Field><Field label="Конструктор" required><select name="responsibleId" required defaultValue="" className={selectClass}><option value="" disabled>Выберите исполнителя</option>{designers.map((designer) => <option key={designer.id} value={designer.id}>{designer.name}</option>)}</select></Field><Field label="Дней проектирования" required><input type="number" name="durationDays" min="1" max="120" defaultValue="5" className={inputClass} /></Field><Field label="Дедлайн"><input type="date" name="deadline" className={inputClass} /></Field></div><Field label="Комментарий"><textarea name="comment" className={textareaClass} placeholder="Особенности проекта, ограничения, договорённости" /></Field><div className="flex gap-[10px]"><button className="brand-gradient inline-flex h-[40px] items-center rounded-[10px] px-[18px] text-[13.5px] font-semibold text-white">Добавить в очередь</button><Link href="/projects" className="inline-flex h-[40px] items-center rounded-[10px] border border-line px-[18px] text-[13.5px] font-semibold">Отмена</Link></div></form></Card></div></div></>
}
