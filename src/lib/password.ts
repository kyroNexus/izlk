import bcrypt from 'bcryptjs'

/**
 * Хеширование паролей.
 * В БД хранится только bcrypt-хеш (User.passwordHash).
 * Открытый пароль не сохраняется ни в базе, ни в логах.
 */

const ROUNDS = 12

/** Создаёт bcrypt-хеш пароля. */
export async function hashPassword(plain: string): Promise<string> {
	return bcrypt.hash(plain, ROUNDS)
}

/** Сравнивает введённый пароль с хешем из БД. */
export async function verifyPassword(
	plain: string,
	hash: string | null | undefined,
): Promise<boolean> {
	if (!hash) return false
	try {
		return await bcrypt.compare(plain, hash)
	} catch {
		return false
	}
}

/** Проверяет, что в поле действительно лежит bcrypt-хеш, а не открытый пароль. */
export function isHashed(value: string | null | undefined): boolean {
	return !!value && /^\$2[aby]\$\d{2}\$/.test(value)
}

/** Минимальные требования к паролю. Возвращает текст ошибки или null. */
export function validatePasswordStrength(plain: string): string | null {
	if (plain.length < 8) {
		return '\u041f\u0430\u0440\u043e\u043b\u044c \u0434\u043e\u043b\u0436\u0435\u043d \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u043d\u0435 \u043c\u0435\u043d\u0435\u0435 8 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432'
	}
	if (!/[a-zA-Z]/.test(plain)) {
		return '\u041f\u0430\u0440\u043e\u043b\u044c \u0434\u043e\u043b\u0436\u0435\u043d \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u0431\u0443\u043a\u0432\u044b'
	}
	if (!/\d/.test(plain)) {
		return '\u041f\u0430\u0440\u043e\u043b\u044c \u0434\u043e\u043b\u0436\u0435\u043d \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u0446\u0438\u0444\u0440\u044b'
	}
	return null
}
