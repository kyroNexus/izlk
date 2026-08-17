import Topbar from '@/components/Topbar'
import { canWrite, requireUser } from '@/lib/access'
import { initials } from '@/lib/format'
import { redirect } from 'next/navigation'
import ContractImportForm from './ContractImportForm'

export default async function ImportContractPage() {
	const user = await requireUser()
	if (!canWrite(user)) redirect('/contracts')
	const name = user.name ?? user.email ?? ''
	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Договоры', href: '/contracts' }, { label: 'Добавление договора' }]} userName={name.split(' ')[0]} initials={initials(name)} /><div className="workspace-content"><div className="mb-[20px]"><h1 className="text-2xl font-bold tracking-[-0.02em]">Добавление договора</h1><div className="mt-[5px] text-base text-muted">Выберите папку — система найдёт договор, проверит реквизиты и разложит документы.</div></div><ContractImportForm /></div></>
}
