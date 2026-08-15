import Link from 'next/link'
import Topbar from '@/components/Topbar'
import { Card } from '@/components/ui'
import { requireUser } from '@/lib/access'
import { initials } from '@/lib/format'
import type { DepartmentKey } from '@/lib/dashboard'

// Лёгкая страница-развилка: только 4 карточки без выбора «моего» отдела —
// у пользователя нет поля с привязкой к отделу, а гадать по роли ненадёжно.
// Никаких запросов к БД не делает специально, чтобы не повторять то, для чего
// A6 уже выделил отдельный loadDepartmentFlow под конкретный отдел.
const DEPARTMENTS: { key: DepartmentKey; label: string; description: string }[] = [
	{ key: 'commercial', label: 'Коммерческий', description: 'Договоры, согласование и передача в работу' },
	{ key: 'engineering', label: 'Конструкторский', description: 'Очередь и готовность разделов КМ, КЖ и АР' },
	{ key: 'production', label: 'Производственный', description: 'Передача в производство, выпуск и отгрузка' },
	{ key: 'construction', label: 'Строительный', description: 'Подготовка площадок, монтаж и фотоотчёты' },
]

export default async function DepartmentsPage() {
	const user = await requireUser()
	const name = user.name ?? user.email ?? 'Пользователь'

	return (
		<>
			<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Отделы' }]} userName={name.split(' ')[0]} initials={initials(name)} />
			<div className="workspace-content px-[26px] py-[22px]">
				<h1 className="text-[22px] font-bold tracking-[-0.02em]">Отделы и чаты</h1>
				<p className="mt-1 text-[13px] text-muted">Выберите рабочую зону — там открыт чат отдела и сводка по потоку.</p>
				<div className="mt-5 grid grid-cols-1 gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
					{DEPARTMENTS.map((department) => (
						<Link key={department.key} href={`/departments/${department.key}`} className="block">
							<Card className="h-full p-[18px] transition hover:border-brand/30 hover:bg-raised">
								<div className="text-[15px] font-bold">{department.label} отдел</div>
								<p className="mt-[6px] text-[12px] leading-5 text-muted">{department.description}</p>
								<div className="mt-[14px] text-[12px] font-semibold text-brand-ink">Открыть рабочую зону →</div>
							</Card>
						</Link>
					))}
				</div>
			</div>
		</>
	)
}
