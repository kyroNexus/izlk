import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import DashboardShell from '@/components/DashboardShell'
import { initials, ROLE_LABELS } from '@/lib/format'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const session = await auth()
	if (!session?.user) redirect('/login')

	const name = session.user.name ?? session.user.email ?? '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c'
	const role = (session.user as { role?: string }).role ?? 'MANAGER'

	return (
		<DashboardShell userId={String(session.user.id ?? '')} userName={name} role={role} roleLabel={ROLE_LABELS[role] ?? role} initials={initials(name)}>{children}</DashboardShell>
	)
}
