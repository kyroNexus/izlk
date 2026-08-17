'use client'

import { useState } from 'react'
import { Field, inputClass } from '@/components/ui'

type ContractorType = 'LEGAL' | 'INDIVIDUAL'

type Defaults = {
	snils?: string | null
	passportSeries?: string | null
	passportNumber?: string | null
	passportIssuedBy?: string | null
	passportIssuedAt?: string | null
	passportDeptCode?: string | null
}

/** Тип контрагента переключает, какие реквизиты обязательны: ИНН у юр. лица
 *  или СНИЛС/паспорт у физ. лица. Показываем только то, что реально нужно заполнить. */
export default function ContractorTypeFields({ defaultType = 'LEGAL', defaults = {} }: { defaultType?: ContractorType; defaults?: Defaults }) {
	const [type, setType] = useState<ContractorType>(defaultType)
	return <>
		<Field label="Тип контрагента">
			<div className="inline-flex rounded-control border border-line bg-raised p-1" role="radiogroup" aria-label="Тип контрагента">
				{(['LEGAL', 'INDIVIDUAL'] as const).map((value) => (
					<label key={value} className={`cursor-pointer rounded-tight px-3 py-1.5 text-sm font-semibold transition ${type === value ? 'bg-brand text-white shadow-sm' : 'text-muted hover:text-ink'}`}>
						<input type="radio" name="type" value={value} checked={type === value} onChange={() => setType(value)} className="sr-only" />
						{value === 'LEGAL' ? 'Юр. лицо' : 'Физ. лицо'}
					</label>
				))}
			</div>
		</Field>
		{type === 'INDIVIDUAL' && <div className="flex flex-col gap-3.5 rounded-control border border-line bg-raised/40 p-3.5">
			<div className="text-xs text-muted">Обязательные данные для физ. лица</div>
			<Field label="СНИЛС" required><input name="snils" required defaultValue={defaults.snils ?? ''} className={inputClass} placeholder="000-000-000 00" /></Field>
			<div className="grid grid-cols-2 gap-3.5">
				<Field label="Серия паспорта" required><input name="passportSeries" required defaultValue={defaults.passportSeries ?? ''} className={inputClass} placeholder="00 00" /></Field>
				<Field label="Номер паспорта" required><input name="passportNumber" required defaultValue={defaults.passportNumber ?? ''} className={inputClass} placeholder="000000" /></Field>
			</div>
			<Field label="Кем выдан" required><input name="passportIssuedBy" required defaultValue={defaults.passportIssuedBy ?? ''} className={inputClass} /></Field>
			<div className="grid grid-cols-2 gap-3.5">
				<Field label="Дата выдачи"><input name="passportIssuedAt" type="date" defaultValue={defaults.passportIssuedAt ?? ''} className={inputClass} /></Field>
				<Field label="Код подразделения"><input name="passportDeptCode" defaultValue={defaults.passportDeptCode ?? ''} className={inputClass} placeholder="000-000" /></Field>
			</div>
		</div>}
	</>
}
