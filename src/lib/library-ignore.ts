import type { LibraryIgnoreRuleType } from '@prisma/client'

export type LibraryIgnoreRuleInput = {
	type: LibraryIgnoreRuleType
	value: string
	enabled: boolean
}

function normalize(value: string) {
	return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase('ru-RU')
}

function matchesGlob(value: string, pattern: string) {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
	return new RegExp(`^${escaped}$`, 'iu').test(value)
}

/** Pure rule check shared by Inbox now and the archive scanner in L2. */
export function isLibraryPathIgnored(relativePath: string, isDirectory: boolean, rules: LibraryIgnoreRuleInput[]) {
	const relative = normalize(relativePath)
	const name = relative.split('/').at(-1) ?? relative
	return rules.some((rule) => {
		if (!rule.enabled) return false
		const value = normalize(rule.value)
		switch (rule.type) {
			case 'SUBTREE': return relative === value || relative.startsWith(`${value}/`)
			case 'FOLDER_EXACT': return isDirectory && relative === value
			case 'EXTENSION': return !isDirectory && name.endsWith(value.startsWith('.') ? value : `.${value}`)
			case 'NAME_PATTERN': return matchesGlob(name, rule.value)
		}
	})
}
