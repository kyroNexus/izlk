declare module 'word-extractor' {
	class Document {
		getBody(): string
		getHeaders(): string
		getFootnotes(): string
		getEndnotes(): string
	}
	class WordExtractor {
		extract(source: Buffer | string): Promise<Document>
	}
	export default WordExtractor
}
