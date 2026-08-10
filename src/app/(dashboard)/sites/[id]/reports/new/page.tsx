import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { FormError } from '@/components/ui'
import { assertContractAccess, canWrite, requireUser } from '@/lib/access'
import { initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { saveSitePhoto } from '@/lib/storage'
import { advanceAfterInstallationCompleted, advanceAfterSiteReport } from '@/lib/contract-workflow'
import ReportForm from './ReportForm'

const MAX_PHOTO_BYTES = 20 * 1024 * 1024
const ALLOWED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
const number = (value: unknown) => { const result = Number(String(value ?? '').replace(',', '.')); return Number.isFinite(result) && result >= 0 ? result : null }

type CrewInput = { name?: unknown; days?: unknown; rate?: unknown }
type CostInput = { category?: unknown; name?: unknown; payment?: unknown; quantity?: unknown; unit?: unknown; price?: unknown }

export default async function NewSiteReportPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
	const user = await requireUser()
	if (!canWrite(user)) redirect(`/sites/${params.id}`)
	const site = await prisma.site.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true, address: true, contract: { select: { id: true, number: true } } } })
	if (!site) redirect('/sites')
	await assertContractAccess(site.contract.id, user, { write: true })

	async function createReport(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		const current = await prisma.site.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true, contractId: true } })
		if (!current || !canWrite(actingUser)) redirect('/sites')
		await assertContractAccess(current.contractId, actingUser, { write: true })
		const fail = (message: string): never => redirect(`/sites/${params.id}/reports/new?error=${encodeURIComponent(message)}`)
		const direction = String(formData.get('direction') ?? ''), stage = String(formData.get('stage') ?? '').trim(), workDate = new Date(String(formData.get('workDate') ?? ''))
		if (!['KJ', 'KM'].includes(direction) || !stage || Number.isNaN(workDate.getTime())) fail('Заполните направление, дату и этап работ')
		let crewRaw: CrewInput[] = [], costsRaw: CostInput[] = []
		try { crewRaw = JSON.parse(String(formData.get('crewJson') ?? '[]')); costsRaw = JSON.parse(String(formData.get('costJson') ?? '[]')) } catch { fail('Не удалось прочитать строки отчёта') }
		const crew = crewRaw.filter((row) => String(row.name ?? '').trim()).map((row) => ({ name: String(row.name).trim(), workDays: number(row.days), rate: number(row.rate) }))
		const costs = costsRaw.filter((row) => String(row.name ?? '').trim()).map((row) => ({ category: String(row.category), name: String(row.name).trim(), paymentType: String(row.payment), quantity: number(row.quantity), unit: String(row.unit ?? '').trim() || null, unitPrice: number(row.price) }))
		if (crew.some((row) => row.workDays == null || row.rate == null) || costs.some((row) => row.quantity == null || row.unitPrice == null || !['EQUIPMENT', 'MATERIAL', 'OTHER'].includes(row.category) || !['CASH', 'CASHLESS'].includes(row.paymentType))) fail('Проверьте дни, ставки, количество и цены')
		const crewCost = crew.reduce((sum, row) => sum + (row.workDays ?? 0) * (row.rate ?? 0), 0)
		const categoryTotal = (category: string) => costs.filter((row) => row.category === category).reduce((sum, row) => sum + (row.quantity ?? 0) * (row.unitPrice ?? 0), 0)
		const photos = formData.getAll('photos').filter((item): item is File => item instanceof File && item.size > 0)
		if (photos.length > 10) fail('За один раз можно прикрепить не более 10 фотографий')
		for (const photo of photos) if (photo.size > MAX_PHOTO_BYTES || !ALLOWED_IMAGES.has(photo.type)) fail(`Файл ${photo.name}: разрешены JPG, PNG, WEBP или HEIC до 20 МБ`)
		const report = await prisma.siteWork.create({ data: {
			siteId: current.id, direction: direction as 'KJ' | 'KM', workDate, stage, crewCount: crew.length, crewCost,
			equipmentCost: categoryTotal('EQUIPMENT'), materialCost: categoryTotal('MATERIAL'), otherCost: categoryTotal('OTHER'), comment: String(formData.get('comment') ?? '').trim() || null,
			crewEntries: { create: crew.map((row) => ({ name: row.name, workDays: row.workDays as number, rate: row.rate as number })) },
			costItems: { create: costs.map((row) => ({ category: row.category as 'EQUIPMENT' | 'MATERIAL' | 'OTHER', name: row.name, paymentType: row.paymentType as 'CASH' | 'CASHLESS', quantity: row.quantity as number, unit: row.unit, unitPrice: row.unitPrice as number })) },
		}, select: { id: true } })
		for (const photo of photos) { const saved = await saveSitePhoto({ siteId: current.id, workId: report.id, fileName: photo.name, buffer: Buffer.from(await photo.arrayBuffer()) }); await prisma.sitePhoto.create({ data: { siteWorkId: report.id, fileName: saved.fileName, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256 } }) }
		await advanceAfterSiteReport({ contractId: current.contractId, actorId: actingUser.id, direction: direction as 'KJ' | 'KM' })
		if (formData.get('finishDirection') === 'on') await advanceAfterInstallationCompleted({ contractId: current.contractId, actorId: actingUser.id, direction: direction as 'KJ' | 'KM' })
		await prisma.siteEvent.create({ data: { siteId: current.id, type: 'INFO', text: `Дневной отчёт ${direction === 'KJ' ? 'КЖ' : 'КМ'}: ${stage}, бригада ${crew.length} чел., позиций затрат ${costs.length}, фото ${photos.length}` } })
		redirect(`/sites/${current.id}`)
	}

	const name = user.name ?? user.email ?? '', today = new Date().toISOString().slice(0, 10)
	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Площадки', href: '/sites' }, { label: `Договор №${site.contract.number}`, href: `/sites/${site.id}` }, { label: 'Дневной отчёт' }]} userName={name.split(' ')[0]} initials={initials(name)} /><div className="px-[26px] py-[22px]"><h1 className="text-[26px] font-bold">Новый дневной отчёт</h1><p className="mb-[16px] mt-[5px] text-[13px] text-muted">{site.address} · договор №{site.contract.number}</p><div className="max-w-[1080px]"><FormError message={searchParams.error} /><div className="mt-[14px]"><ReportForm action={createReport} siteId={site.id} today={today} /></div></div></div></>
}
