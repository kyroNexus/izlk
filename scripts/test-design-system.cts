import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const css = read('src/app/globals.css')
const shell = read('src/components/DashboardShell.tsx')
const densityToggle = read('src/components/TableDensityToggle.tsx')
const ui = read('src/components/ui.tsx')
const contracts = read('src/app/(dashboard)/contracts/page.tsx')
const sidebar = read('src/components/Sidebar.tsx')
const departmentsPicker = read('src/app/(dashboard)/departments/page.tsx')

assert.match(css, /prefers-reduced-motion/)
assert.match(css, /table thead th \{ position: sticky/)
assert.match(css, /data-table-density='compact'/)
assert.match(shell, /izlk-table-density/)
// Плотность таблиц переехала из плавающих кнопок на DashboardShell в один
// переключатель в Настройках (TableDensityToggle) — сюда же переехала и проверка.
assert.match(densityToggle, /aria-pressed/)
assert.match(ui, /export function RichEmptyState/)
assert.match(contracts, /Нет назначенных договоров/)
assert.match(contracts, /<Icon icon=\{Folder\}/)
assert.match(contracts, /function WorkflowRail/)
assert.match(contracts, /role="list"/)
assert.match(contracts, /overflow-x-auto/)
assert.match(contracts, /min-w-0 overflow-hidden/)
assert.doesNotMatch(contracts, /min-w-\[1120px\]/)
assert.match(contracts, /SHIPPED/)
// C2: пункт сайдбара раньше вёл жёстко на /departments/production для всех ролей —
// теперь на страницу выбора, которая перечисляет все 4 отдела.
assert.match(sidebar, /href: '\/departments', label: 'Отделы и чаты'/)
for (const code of ['commercial', 'engineering', 'production', 'construction']) {
	assert.match(departmentsPicker, new RegExp(`/departments/\\$\\{department\\.key\\}`))
	assert.match(departmentsPicker, new RegExp(code))
}

// Задача: хлебные крошки на страницах, открываемых со страницы договора
// (файл, задача, площадка), должны вести обратно через сам договор, а не
// через свой глобальный список (жалоба: "перешёл из договора 731 в
// документы — сверху показывает Главная → Все документы"). Каждая из этих
// страниц уже грузит contract из связи — проверяем, что крошки её
// действительно используют, а не игнорируют.
const documentViewer = read('src/app/(dashboard)/documents/[id]/page.tsx')
assert.match(documentViewer, /label: `№ \$\{document\.contract\.number\}`, href: `\/contracts\/\$\{document\.contract\.id\}#documents`/)
const taskDetail = read('src/app/(dashboard)/tasks/[id]/page.tsx')
assert.match(taskDetail, /crumbs=\{task\.contract \? \[/)
assert.match(taskDetail, /label: `№ \$\{task\.contract\.number\}`, href: `\/contracts\/\$\{task\.contract\.id\}#tasks`/)
const siteDetail = read('src/app/(dashboard)/sites/[id]/page.tsx')
assert.match(siteDetail, /label: `№ \$\{site\.contract\.number\}`, href: `\/contracts\/\$\{site\.contract\.id\}#site`/)
// Карточка договора — самая посещаемая страница — крошки начинались сразу с
// "Договоры", без "Главная" (несогласовано со всеми остальными страницами).
const contractDetail = read('src/app/(dashboard)/contracts/[id]/page.tsx')
assert.match(contractDetail, /crumbs=\{\[\{ label: 'Главная', href: '\/' \}, \{ label: 'Договоры', href: '\/contracts' \}, \{ label: contract\.number \}\]\}/)
// "В корзину" при отказе в доступе раньше уводило на общий список договоров,
// а не обратно на карточку — тот же класс "неправильного пути", что и крошки.
assert.match(contractDetail, /async function deleteContract\(\)[\s\S]{0,120}?if \(!isAdmin\(acting\)\) redirect\(`\/contracts\/\$\{params\.id\}`\)/)

console.log('Design-system checks passed: icons, empty state, density, sticky headers, reduced motion, department picker routing, and contextual breadcrumbs.')
