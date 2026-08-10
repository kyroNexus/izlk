/**
 * One-shot Inbox scan for an administrator or scheduled task.
 *
 * Keep this command deliberately thin: the web button, the watcher and the
 * command line must share exactly the same parser, classifier, duplicate rules
 * and import journal.
 */
import { scanInbox } from '../src/lib/inbox-scanner'
import { prisma } from '../src/lib/prisma'

async function main() {
	const result = await scanInbox()
	console.log(`Inbox scanned: found=${result.found}, queued=${result.queued}, autoImported=${result.autoImported}, duplicates=${result.duplicates}, ignored=${result.ignored}, errors=${result.errors}`)
	for (const issue of result.issues.slice(0, 20)) console.warn(`- ${issue}`)
}

main()
	.catch((error) => {
		console.error('Inbox scan failed:', error)
		process.exitCode = 1
	})
	.finally(async () => prisma.$disconnect())
