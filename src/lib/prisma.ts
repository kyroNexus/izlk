import { PrismaClient } from '@prisma/client';

// Singleton, чтобы Next.js в dev-режиме (hot reload) не создавал
// новое подключение к БД на каждое изменение файла.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
