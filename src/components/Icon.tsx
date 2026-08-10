import type { LucideIcon } from 'lucide-react'

export default function Icon({ icon: Glyph, size = 18, ...props }: React.ComponentProps<LucideIcon> & { icon: LucideIcon }) {
	return <Glyph aria-hidden="true" size={size} strokeWidth={1.8} {...props} />
}
