declare module 'pdf-parse/lib/pdf-parse.js' {
	type PdfResult = { text: string; numpages: number; info: Record<string, unknown>; metadata: unknown }
	export default function pdfParse(data: Buffer, options?: Record<string, unknown>): Promise<PdfResult>
}
