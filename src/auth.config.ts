import type { NextAuthConfig } from 'next-auth'

/** Edge-safe authentication settings used by middleware only. */
export const authConfig = {
	trustHost: true,
	session: { strategy: 'jwt' },
	pages: { signIn: '/login' },
	providers: [],
	callbacks: {
		async jwt({ token, user }) {
			if (user) {
				token.role = (user as { role?: string }).role
				token.id = user.id
			}
			return token
		},
		async session({ session, token }) {
			if (session.user) {
				;(session.user as { role?: string; id?: string }).role = token.role as string
				;(session.user as { role?: string; id?: string }).id = token.id as string
			}
			return session
		},
	},
} satisfies NextAuthConfig
