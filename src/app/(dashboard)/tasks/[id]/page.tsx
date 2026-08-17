import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { TaskPriority, TaskStatus } from '@prisma/client'
import Topbar from '@/components/Topbar'
import {
  Card,
  CardHeader,
  Chip,
  Field,
  FormError,
  inputClass,
  selectClass,
  textareaClass,
} from '@/components/ui'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import { formatDateTime, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { notify } from '@/lib/notifications'

const taskStatuses: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']
const taskPriorities: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { error?: string }
}) {
  const user = await requireUser()
  const visibility =
    user.role === 'ADMIN'
      ? {}
      : user.role === 'MANAGER'
        ? {
            OR: [
              { assigneeId: user.id },
              { creatorId: user.id },
              { contract: { managerId: user.id } },
            ],
          }
        : { assigneeId: user.id }

  const task = await prisma.task.findFirst({
    where: { id: params.id, deletedAt: null, ...visibility },
    include: {
      contract: {
        select: {
          id: true,
          number: true,
          contractor: { select: { name: true } },
        },
      },
      assignee: { select: { id: true, name: true } },
      creator: { select: { name: true } },
      comments: {
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!task) redirect('/tasks')

  const [users, contracts] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.contract.findMany({
      where: {
        deletedAt: null,
        ...contractScope(user),
      },
      select: { id: true, number: true },
      orderBy: { date: 'desc' },
      take: 300,
    }),
  ])

  const canEdit = Boolean(
    canWrite(user) &&
      (user.role === 'ADMIN' ||
        task.creatorId === user.id ||
        task.assigneeId === user.id ||
        task.contract),
  )
  const canDelete = user.role === 'ADMIN' || task.creatorId === user.id

  async function updateTask(formData: FormData) {
    'use server'
    const acting = await requireUser()
    if (!canWrite(acting)) redirect('/tasks')

    const current = await prisma.task.findFirst({
      where: {
        id: params.id,
        deletedAt: null,
        ...(acting.role === 'ADMIN'
          ? {}
          : {
              OR: [
                { assigneeId: acting.id },
                { creatorId: acting.id },
                { contract: { managerId: acting.id } },
              ],
            }),
      },
      select: { id: true, assigneeId: true, title: true },
    })
    if (!current) redirect('/tasks')

    const title = String(formData.get('title') ?? '').trim()
    const assigneeId = String(formData.get('assigneeId') ?? '')
    const status = String(formData.get('status') ?? '') as TaskStatus
    const priority = String(formData.get('priority') ?? '') as TaskPriority
    const contractId = String(formData.get('contractId') ?? '')

    const allowedAssignee = await prisma.user.findFirst({
      where: { id: assigneeId, deletedAt: null, isActive: true },
      select: { id: true },
    })
    const allowedContract = contractId
      ? await prisma.contract.findFirst({
          where: {
            id: contractId,
            deletedAt: null,
            ...(acting.role === 'MANAGER' ? { managerId: acting.id } : {}),
          },
          select: { id: true },
        })
      : null

    if (
      !title ||
      !allowedAssignee ||
      (contractId && !allowedContract) ||
      !taskStatuses.includes(status) ||
      !taskPriorities.includes(priority)
    ) {
      redirect(`/tasks/${params.id}?error=${encodeURIComponent('Проверьте обязательные поля')}`)
    }

    const dueDate = String(formData.get('dueDate') ?? '')
    await prisma.task.update({
      where: { id: current.id },
      data: {
        title,
        description: String(formData.get('description') ?? '').trim() || null,
        category: String(formData.get('category') ?? '').trim() || null,
        contractId: allowedContract?.id ?? null,
        assigneeId: allowedAssignee.id,
        status,
        priority,
        dueDate: dueDate ? new Date(`${dueDate}T12:00:00.000Z`) : null,
        completedAt: status === 'DONE' ? new Date() : null,
      },
    })
    await writeAudit({
      userId: acting.id,
      action: 'UPDATE',
      entityType: 'Task',
      entityId: current.id,
    })
    if (allowedAssignee.id !== current.assigneeId) {
      await notify({ userId: allowedAssignee.id, type: 'ASSIGNMENT', title: 'Вы назначены исполнителем задачи', message: title, href: `/tasks/${current.id}`, dedupeKey: `task-assignment:${current.id}:${allowedAssignee.id}` })
    }
    redirect(`/tasks/${current.id}`)
  }

  async function addComment(formData: FormData) {
    'use server'
    const acting = await requireUser()
    const text = String(formData.get('text') ?? '').trim()
    const visible = await prisma.task.findFirst({
      where: {
        id: params.id,
        deletedAt: null,
        ...(acting.role === 'ADMIN'
          ? {}
          : acting.role === 'MANAGER'
            ? {
                OR: [
                  { assigneeId: acting.id },
                  { creatorId: acting.id },
                  { contract: { managerId: acting.id } },
                ],
              }
            : { assigneeId: acting.id }),
      },
      select: { id: true, assigneeId: true, creatorId: true, title: true },
    })
    if (visible && text) {
      const comment = await prisma.taskComment.create({
        data: { taskId: visible.id, authorId: acting.id, text },
        select: { id: true },
      })
      await writeAudit({
        userId: acting.id,
        action: 'CREATE',
        entityType: 'TaskComment',
        entityId: comment.id,
      })
      if (visible.assigneeId !== acting.id) await notify({ userId: visible.assigneeId, type: 'INFO', title: 'Новый комментарий к задаче', message: visible.title, href: `/tasks/${visible.id}`, dedupeKey: `task-comment:${comment.id}:assignee` })
      if (visible.creatorId !== acting.id && visible.creatorId !== visible.assigneeId) await notify({ userId: visible.creatorId, type: 'INFO', title: 'Новый комментарий к задаче', message: visible.title, href: `/tasks/${visible.id}`, dedupeKey: `task-comment:${comment.id}:creator` })
    }
    redirect(`/tasks/${params.id}`)
  }

  async function deleteTask() {
    'use server'
    const acting = await requireUser()
    if (!canWrite(acting)) redirect('/tasks')
    const current = await prisma.task.findFirst({
      where: {
        id: params.id,
        deletedAt: null,
        ...(acting.role === 'ADMIN' ? {} : { creatorId: acting.id }),
      },
      select: { id: true },
    })
    if (current) {
      await prisma.task.update({
        where: { id: current.id },
        data: { deletedAt: new Date() },
      })
      await writeAudit({
        userId: acting.id,
        action: 'DELETE',
        entityType: 'Task',
        entityId: current.id,
      })
    }
    redirect('/tasks')
  }

  const statusMeta =
    task.status === 'DONE'
      ? { tone: 'ok' as const, label: 'Готово' }
      : task.status === 'IN_PROGRESS'
        ? { tone: 'brand' as const, label: 'В работе' }
        : task.status === 'CANCELLED'
          ? { tone: 'danger' as const, label: 'Отменено' }
          : { tone: 'off' as const, label: 'Не начато' }
  const name = user.name ?? user.email ?? ''

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Главная', href: '/' },
          { label: 'Задачи', href: '/tasks' },
          { label: task.title },
        ]}
        userName={name.split(' ')[0]}
        initials={initials(name)}
      />
      <div className="workspace-content">
        <div className="mb-[16px] flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-2xl font-bold">{task.title}</h1>
              <Chip tone={statusMeta.tone}>{statusMeta.label}</Chip>
            </div>
            <div className="mt-[5px] text-sm text-muted">
              Создал: {task.creator.name} · {formatDateTime(task.createdAt)}
            </div>
          </div>
          <Link
            href="/tasks"
            className="ml-auto flex-none rounded-tight border border-line px-3 py-2 text-sm font-semibold transition hover:bg-raised"
          >
            ← К задачам
          </Link>
        </div>

        <FormError message={searchParams.error} />

        <div className="side-panel-grid mt-[14px] grid grid-cols-[minmax(0,1fr)_360px] gap-3.5">
          <Card className="side-panel-grid-primary p-5">
            <form action={updateTask} className="flex flex-col gap-3.5">
              <Field label="Название" required>
                <input name="title" defaultValue={task.title} disabled={!canEdit} className={inputClass} />
              </Field>
              <Field label="Описание">
                <textarea
                  name="description"
                  defaultValue={task.description ?? ''}
                  disabled={!canEdit}
                  className={textareaClass}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Договор">
                  <select
                    name="contractId"
                    defaultValue={task.contractId ?? ''}
                    disabled={!canEdit}
                    className={selectClass}
                  >
                    <option value="">Без договора</option>
                    {contracts.map((item) => (
                      <option key={item.id} value={item.id}>
                        № {item.number}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Исполнитель">
                  <select
                    name="assigneeId"
                    defaultValue={task.assigneeId}
                    disabled={!canEdit}
                    className={selectClass}
                  >
                    {users.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Срок">
                  <input
                    type="date"
                    name="dueDate"
                    defaultValue={task.dueDate?.toISOString().slice(0, 10) ?? ''}
                    disabled={!canEdit}
                    className={inputClass}
                  />
                </Field>
                <Field label="Раздел">
                  <input
                    name="category"
                    defaultValue={task.category ?? ''}
                    disabled={!canEdit}
                    className={inputClass}
                  />
                </Field>
                <Field label="Приоритет">
                  <select
                    name="priority"
                    defaultValue={task.priority}
                    disabled={!canEdit}
                    className={selectClass}
                  >
                    <option value="LOW">Низкий</option>
                    <option value="MEDIUM">Средний</option>
                    <option value="HIGH">Высокий</option>
                    <option value="CRITICAL">Критичный</option>
                  </select>
                </Field>
                <Field label="Статус">
                  <select
                    name="status"
                    defaultValue={task.status}
                    disabled={!canEdit}
                    className={selectClass}
                  >
                    <option value="TODO">Не начато</option>
                    <option value="IN_PROGRESS">В работе</option>
                    <option value="DONE">Готово</option>
                    <option value="CANCELLED">Отменено</option>
                  </select>
                </Field>
              </div>
              {canEdit && (
                <button className="brand-gradient h-control self-start rounded-tight px-4 text-sm font-semibold text-white">
                  Сохранить изменения
                </button>
              )}
            </form>

            {canDelete && (
              <form action={deleteTask} className="mt-[10px] border-t border-line pt-2.5">
                <button className="h-control rounded-tight border border-danger-bd px-3.5 text-sm font-semibold text-danger">
                  Удалить задачу
                </button>
              </form>
            )}
          </Card>

          <Card>
            <CardHeader title="Комментарии" extra={task.comments.length} />
            <div className="max-h-[430px] overflow-auto">
              {task.comments.length === 0 ? (
                <div className="p-[22px] text-center text-sm text-faint">
                  Комментариев пока нет
                </div>
              ) : (
                task.comments.map((comment) => (
                  <div key={comment.id} className="border-b border-line-soft px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-xs">{comment.author.name}</b>
                      <span className="text-2xs text-faint">
                        {formatDateTime(comment.createdAt)}
                      </span>
                    </div>
                    <div className="mt-[5px] whitespace-pre-wrap text-sm leading-5">
                      {comment.text}
                    </div>
                  </div>
                ))
              )}
            </div>
            <form action={addComment} className="border-t border-line p-3">
              <textarea
                name="text"
                required
                placeholder="Написать комментарий…"
                className={`${textareaClass} min-h-[72px]`}
              />
              <button className="brand-gradient mt-[7px] h-[34px] w-full rounded-tight text-xs font-semibold text-white">
                Добавить комментарий
              </button>
            </form>
            {task.contract && (
              <div className="border-t border-line p-3">
                <Link
                  href={`/contracts/${task.contract.id}`}
                  className="block rounded-tight bg-brand-soft px-2.5 py-2 text-center text-xs font-semibold text-brand-ink"
                >
                  К договору №{task.contract.number}
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
