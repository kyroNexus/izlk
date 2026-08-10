export default function DashboardLoading() {
	return (
		<div className="min-h-screen px-4 py-5 sm:px-7 sm:py-6" aria-label="Загрузка раздела" role="status">
			<div className="ui-skeleton h-7 w-48 rounded-lg" />
			<div className="mt-3 ui-skeleton h-4 w-72 max-w-full rounded" />
			<div className="mt-7 grid gap-4 xl:grid-cols-3">
				{[0, 1, 2].map((item) => <div key={item} className="rounded-[18px] border border-line bg-surface p-5"><div className="ui-skeleton h-4 w-28 rounded" /><div className="mt-4 ui-skeleton h-24 rounded-[12px]" /></div>)}
			</div>
			<span className="sr-only">Загрузка данных</span>
		</div>
	)
}
