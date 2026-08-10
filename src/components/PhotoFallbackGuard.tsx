'use client'

import { useEffect } from 'react'

/** Keeps a bad legacy photo from turning into a wall of broken filename text. */
export default function PhotoFallbackGuard() {
	useEffect(() => {
		const showFallback = (event: Event) => {
			const image = event.target
			if (!(image instanceof HTMLImageElement) || !image.src.includes('/api/site-photos/')) return
			const link = image.closest('a')
			if (!link || link.querySelector('[data-photo-fallback]')) return
			image.classList.add('photo-load-failed')
			image.alt = ''
			const fallback = document.createElement('span')
			fallback.dataset.photoFallback = 'true'
			fallback.className = 'site-photo-fallback'
			fallback.textContent = 'Фото временно недоступно · открыть оригинал'
			link.appendChild(fallback)
		}
		document.addEventListener('error', showFallback, true)
		return () => document.removeEventListener('error', showFallback, true)
	}, [])
	return null
}
