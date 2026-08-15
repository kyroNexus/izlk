import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'ADMIN' | 'MANAGER' | 'DESIGNER' | 'BUILDER' | 'PRODUCTION' | 'ACCOUNTING' | 'VIEWER_DESIGN' | 'VIEWER';
    } & DefaultSession['user'];
  }
}
