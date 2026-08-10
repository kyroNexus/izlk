import type { NotificationType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

type NotifyInput = {
  userId?: string | null
  type?: NotificationType
  title: string
  message?: string | null
  href?: string | null
  dedupeKey?: string | null
}

export async function notify(input: NotifyInput) {
  if (!input.userId) return null
  try {
    return await prisma.notification.upsert({
    where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey ?? `${Date.now()}-${Math.random()}` } },
    // Важный момент: предупреждение «скоро срок» должно превращаться в
    // «просрочено», а не оставаться старым текстом в колокольчике.
    update: { type: input.type ?? 'INFO', title: input.title, message: input.message ?? null, href: input.href ?? null },
    create: {
      userId: input.userId,
      type: input.type ?? 'INFO',
      title: input.title,
      message: input.message ?? null,
      href: input.href ?? null,
      dedupeKey: input.dedupeKey ?? null,
    },
    })
  } catch (error) {
    // Notifications are secondary to the business operation that triggered them.
	logger.error('notification.write_failed', { userId: input.userId, error })
    return null
  }
}

async function batchNotify(items: NotifyInput[]) {
  const valid = items.filter((item) => item.userId)
  if (valid.length === 0) return { processed: 0, created: 0 }
  const existing = await prisma.notification.findMany({
    where: { OR: valid.filter((item) => item.dedupeKey).map((item) => ({ userId: item.userId!, dedupeKey: item.dedupeKey! })) },
    select: { userId: true, dedupeKey: true },
  })
  const existingKeys = new Set(existing.map((item) => `${item.userId}:${item.dedupeKey}`))
  await prisma.$transaction(
    valid.map((input) =>
      prisma.notification.upsert({
        where: { userId_dedupeKey: { userId: input.userId!, dedupeKey: input.dedupeKey ?? `${Date.now()}-${Math.random()}` } },
        update: { type: input.type ?? 'INFO', title: input.title, message: input.message ?? null, href: input.href ?? null },
        create: {
          userId: input.userId!,
          type: input.type ?? 'INFO',
          title: input.title,
          message: input.message ?? null,
          href: input.href ?? null,
          dedupeKey: input.dedupeKey ?? null,
        },
      }),
    ),
	).catch((error) => {
		logger.error('notification.batch_write_failed', { error })
		throw error
	})
	return {
		processed: valid.length,
		created: valid.filter((item) => !item.dedupeKey || !existingKeys.has(`${item.userId}:${item.dedupeKey}`)).length,
	}
}

export async function syncDeadlineNotifications(userId: string) {
  const now = new Date()
  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + 5)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user) return { processed: 0, created: 0 }

  const [sections, tasks, contracts, invoices] = await Promise.all([
    prisma.projectSection.findMany({
      where: { responsibleId: userId, deletedAt: null, queueStatus: { not: 'DONE' }, deadline: { lte: horizon } },
      select: { id: true, code: true, deadline: true, contract: { select: { id: true, number: true } } },
      orderBy: { deadline: 'asc' },
      take: 30,
    }),
    prisma.task.findMany({
      where: { assigneeId: userId, deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] }, dueDate: { lte: horizon } },
      select: { id: true, title: true, dueDate: true, contract: { select: { id: true, number: true } } },
      orderBy: { dueDate: 'asc' },
      take: 30,
    }),
    (user.role === 'ADMIN' || user.role === 'MANAGER')
      ? prisma.contract.findMany({
          where: { deletedAt: null, status: 'ACTIVE', workflowStage: { not: 'CLOSED' }, deadline: { lte: horizon }, ...(user.role === 'MANAGER' ? { managerId: userId } : {}) },
          select: { id: true, number: true, deadline: true },
          orderBy: { deadline: 'asc' },
          take: 30,
        })
      : Promise.resolve([]),
    (user.role === 'ADMIN' || user.role === 'MANAGER')
      ? prisma.invoice.findMany({
          where: { deletedAt: null, status: { notIn: ['PAID', 'CANCELLED'] }, dueDate: { lte: horizon }, contract: { deletedAt: null, ...(user.role === 'MANAGER' ? { managerId: userId } : {}) } },
          select: { id: true, number: true, dueDate: true, contract: { select: { id: true, number: true, contractor: { select: { name: true } } } } },
          orderBy: { dueDate: 'asc' },
          take: 30,
        })
      : Promise.resolve([]),
  ])

  const pending: NotifyInput[] = []

  for (const section of sections) {
    const codeLabel = section.code === 'KZH' ? 'КЖ' : section.code
    const overdue = Boolean(section.deadline && section.deadline < now)
    pending.push({
      userId,
      type: overdue ? 'WARNING' : 'DEADLINE',
      title: overdue ? `Просрочен раздел ${codeLabel}` : `Срок раздела ${codeLabel} приближается`,
      message: `Договор № ${section.contract.number} · ${overdue ? 'срок был' : 'завершить до'} ${section.deadline?.toLocaleDateString('ru-RU')}`,
      href: `/projects?section=${section.code}`,
      dedupeKey: `deadline:${section.id}:${section.deadline?.toISOString().slice(0, 10)}`,
    })
  }

  for (const task of tasks) {
    const overdue = Boolean(task.dueDate && task.dueDate < now)
    pending.push({
      userId,
      type: overdue ? 'WARNING' : 'DEADLINE',
      title: overdue ? `Просрочена задача: ${task.title}` : `Срок задачи приближается: ${task.title}`,
      message: `${task.contract ? `Договор № ${task.contract.number} · ` : ''}${overdue ? 'срок был' : 'выполнить до'} ${task.dueDate?.toLocaleDateString('ru-RU')}`,
      href: `/tasks/${task.id}`,
      dedupeKey: `task-deadline:${task.id}:${task.dueDate?.toISOString().slice(0, 10)}`,
    })
  }

  for (const contract of contracts) {
    const overdue = Boolean(contract.deadline && contract.deadline < now)
    pending.push({
      userId,
      type: overdue ? 'WARNING' : 'DEADLINE',
      title: overdue ? `Просрочен общий срок договора` : `Срок договора приближается`,
      message: `Договор № ${contract.number} · ${overdue ? 'срок был' : 'завершить до'} ${contract.deadline?.toLocaleDateString('ru-RU')}`,
      href: `/contracts/${contract.id}`,
      dedupeKey: `contract-deadline:${contract.id}:${contract.deadline?.toISOString().slice(0, 10)}`,
    })
  }

  for (const invoice of invoices) {
    const overdue = Boolean(invoice.dueDate && invoice.dueDate < now)
    pending.push({
      userId,
      type: overdue ? 'WARNING' : 'DEADLINE',
      title: overdue ? `Просрочен счёт ${invoice.number}` : `Скоро оплата счёта ${invoice.number}`,
      message: `Договор № ${invoice.contract.number} · ${invoice.contract.contractor.name} · ${overdue ? 'срок был' : 'оплатить до'} ${invoice.dueDate?.toLocaleDateString('ru-RU')}`,
      href: `/contracts/${invoice.contract.id}`,
      dedupeKey: `invoice-deadline:${invoice.id}:${invoice.dueDate?.toISOString().slice(0, 10)}`,
    })
  }

  const result = await batchNotify(pending)
  // `Notification` intentionally has no delivery state: dedupe makes a repeat
  // safe and updates a warning when a deadline becomes overdue.
  return result
}

export async function syncAllDeadlineNotifications() {
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  let processed = 0
  let created = 0
  for (const user of users) {
    const result = await syncDeadlineNotifications(user.id)
    processed += result.processed
    created += result.created
  }
  return { processed, created }
}
