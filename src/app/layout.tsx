import type { Metadata } from 'next'
import { themeInitScript } from '@/components/ThemeToggle'
import PhotoFallbackGuard from '@/components/PhotoFallbackGuard'
import './globals.css'

export const metadata: Metadata = {
	title: 'IZLK RUS \u2014 \u0441\u0438\u0441\u0442\u0435\u043c\u0430 \u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u043e\u0432',
	description: '\u0415\u0434\u0438\u043d\u0430\u044f \u0441\u0438\u0441\u0442\u0435\u043c\u0430 \u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u043e\u0432 \u0438 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u043e\u0432',
	icons: { icon: '/logo/mark.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="ru" suppressHydrationWarning>
			<head>
				{/* Ставит класс .dark до отрисовки, чтобы не было белой вспышки */}
				<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
			</head>
			<body className="bg-canvas text-ink antialiased"><PhotoFallbackGuard />{children}</body>
		</html>
	)
}
