import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/auth.config';

const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === '/login';

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  }
});

// Защищаем всё, кроме статики, изображений и самого API авторизации
export const config = {
  // Планировщик Windows обращается к сканеру без браузерной сессии;
  // сам endpoint защищён отдельным Bearer-токеном.
  // Шлюз 1С тоже не использует браузерную сессию: он проверяет собственный
  // Bearer-токен прямо в route.ts. Остальные API по-прежнему защищены входом.
  matcher: ['/((?!api/auth|api/inbox/scan|api/integrations/1c/contracts|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
