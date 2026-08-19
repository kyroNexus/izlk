export function additionalCustomerIds(values: FormDataEntryValue[], primaryId: string): string[] {
	return [...new Set(values.map(String).filter((id) => id && id !== primaryId))]
}
