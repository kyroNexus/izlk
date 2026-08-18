export function renamedFileName(currentName: string, requestedBase: string) {
	const base = requestedBase.trim()
	if (!base || base.length > 160 || /[\\/\u0000-\u001f]/.test(base) || base === '.' || base === '..') return null
	const dot = currentName.lastIndexOf('.')
	const extension = dot > 0 ? currentName.slice(dot) : ''
	return `${base}${extension}`
}
