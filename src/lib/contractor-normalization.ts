export function normalizePhone(value?: string | null) {
	const digits = (value ?? '').replace(/\D/g, '')
	if (!digits) return ''
	return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits
}

export function normalizeCompanyName(value?: string | null) {
	return (value ?? '')
		.toLocaleLowerCase('ru-RU')
		.replace(/[«»"'`]/g, '')
		// JavaScript's \b only recognises Latin letters, so Russian legal forms
		// must be handled explicitly before punctuation is normalized.
		.replace(/^\s*(?:ооо|ао|пао|зао|ип)\s+/iu, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
}
