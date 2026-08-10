import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { clearFailedLogins, loginAllowed, recordFailedLogin } from '@/lib/login-rate-limit';
import { authConfig } from '@/auth.config';

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
    trustHost: true, // обязательно для само-хостинга (не Vercel) — локально и на VPS
  providers: [
    Credentials({
      credentials: {
        login: {},
        password: {},
      },
      async authorize(credentials) {
        const login = credentials?.login as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!login || !password) return null;

        if (!loginAllowed(login)) return null;

        const user = await prisma.user.findUnique({ where: { login: login.trim().toLowerCase() } });
        if (!user || !user.isActive || user.deletedAt) {
          recordFailedLogin(login);
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          recordFailedLogin(login);
          return null;
        }
        clearFailedLogins(login);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    // Роль пишем в JWT при логине, чтобы не дёргать БД на каждый запрос
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.id = user.id;
      }
      return token;
    },
    // Роль передаём в session, чтобы читать её в компонентах и middleware
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string; id?: string }).role = token.role as string;
        (session.user as { role?: string; id?: string }).id = token.id as string;
      }
      return session;
    },
  },
	// Login is part of the operational audit: it makes account switches and
	// unusual access visible to the administrator without affecting sign-in.
	events: {
		async signIn({ user }) {
			if (!user.id) return
			await prisma.auditLog.create({ data: { userId: user.id, action: 'LOGIN', entityType: 'Session', entityId: user.id } }).catch(() => undefined)
		},
	},
});
