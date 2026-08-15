'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * Тонкая обёртка над кнопкой submit — единственная задача: пока server action
 * формы выполняется, показать это (спиннер + disabled), а не оставлять кнопку
 * выглядящей так, будто клик не сработал. Разметку и классы кнопки не меняет —
 * className передаётся как есть, чтобы не расходиться с уже существующим стилем.
 * Должна рендериться внутри <form action={...}> — useFormStatus читает
 * состояние ближайшей родительской формы.
 */
export default function SubmitButton({
	children,
	pendingText,
	className = '',
	...rest
}: {
	children: ReactNode
	pendingText?: string
	className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'disabled' | 'type'>) {
	const { pending } = useFormStatus()
	return (
		<button
			type="submit"
			disabled={pending}
			className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
			{...rest}
		>
			{pending && <span aria-hidden="true" className="mr-[6px] inline-block h-[12px] w-[12px] animate-spin rounded-full border-2 border-current/30 border-t-current align-[-2px]" />}
			{pending && pendingText ? pendingText : children}
		</button>
	)
}
