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
	/** Представитель по доверенности — отдельный человек, не сам заказчик.
	 *  Необязателен: у физ. лица его может не быть вовсе (подписывает сам). */
	representativeName?: string | null
	representativeSnils?: string | null
	representativePassportSeries?: string | null
	representativePassportNumber?: string | null
	representativePassportIssuedBy?: string | null
	representativePassportIssuedAt?: string | null
	representativePassportDeptCode?: string | null
	representativeProxyNumber?: string | null
	representativeProxyDate?: string | null
}

const hasAnyRepresentativeDefault = (defaults: Defaults) =>
	Boolean(defaults.representativeName || defaults.representativeSnils || defaults.representativePassportNumber || defaults.representativeProxyNumber)

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
			{/* Представитель по доверенности — не сам заказчик, отдельный человек.
			    Если распознаватель нашёл в договоре упоминание доверенности, раздел
			    открыт сразу с найденными данными — их обязательно нужно сверить
			    с документом (паспортные данные, спутанные между людьми, — это
			    испорченные юридически значимые данные, не опечатка). Если ничего
			    не найдено — раздел свёрнут, вносится только если он реально есть. */}
			<details open={hasAnyRepresentativeDefault(defaults)} className="rounded-control border border-line bg-surface/60 px-3 py-2.5">
				<summary className="cursor-pointer list-none text-xs font-semibold text-muted">Представитель по доверенности, если есть</summary>
				<div className="mt-3 flex flex-col gap-3.5">
					{hasAnyRepresentativeDefault(defaults) && <div className="rounded-tight bg-warn-bg px-2.5 py-1.5 text-xs leading-4 text-warn">Данные распознаны автоматически из текста договора — сверьте с документом перед сохранением.</div>}
					<Field label="ФИО представителя"><input name="representativeName" defaultValue={defaults.representativeName ?? ''} className={inputClass} /></Field>
					<div className="grid grid-cols-2 gap-3.5">
						<Field label="Номер доверенности"><input name="representativeProxyNumber" defaultValue={defaults.representativeProxyNumber ?? ''} className={inputClass} /></Field>
						<Field label="Дата доверенности"><input name="representativeProxyDate" type="date" defaultValue={defaults.representativeProxyDate ?? ''} className={inputClass} /></Field>
					</div>
					<Field label="СНИЛС представителя"><input name="representativeSnils" defaultValue={defaults.representativeSnils ?? ''} className={inputClass} placeholder="000-000-000 00" /></Field>
					<div className="grid grid-cols-2 gap-3.5">
						<Field label="Серия паспорта"><input name="representativePassportSeries" defaultValue={defaults.representativePassportSeries ?? ''} className={inputClass} placeholder="00 00" /></Field>
						<Field label="Номер паспорта"><input name="representativePassportNumber" defaultValue={defaults.representativePassportNumber ?? ''} className={inputClass} placeholder="000000" /></Field>
					</div>
					<Field label="Кем выдан"><input name="representativePassportIssuedBy" defaultValue={defaults.representativePassportIssuedBy ?? ''} className={inputClass} /></Field>
					<div className="grid grid-cols-2 gap-3.5">
						<Field label="Дата выдачи"><input name="representativePassportIssuedAt" type="date" defaultValue={defaults.representativePassportIssuedAt ?? ''} className={inputClass} /></Field>
						<Field label="Код подразделения"><input name="representativePassportDeptCode" defaultValue={defaults.representativePassportDeptCode ?? ''} className={inputClass} placeholder="000-000" /></Field>
					</div>
				</div>
			</details>
		</div>}
	</>
}
