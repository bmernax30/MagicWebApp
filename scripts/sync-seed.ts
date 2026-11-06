import { loadEnvConfig } from '@next/env';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, databasePath } from '../src/db/client';
import { readSeed, syncSeed, missingCommanderImages } from '../src/db/seed-sync';
loadEnvConfig(process.cwd());
async function main() {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--baseline')) throw new Error('Usage: npm run db:sync -- [--baseline previous-settings.json]');
    const baseline = args[1] ? readSeed(args[1]) : undefined;
    const next = readSeed('seed-data/res/settings.json');
    const { sqlite } = openDatabase();
    try {
        const dir = path.resolve('data/backups'); fs.mkdirSync(dir, { recursive: true });
        const backup = path.join(dir, `before-seed-sync-${Date.now()}.sqlite`);
        await sqlite.backup(backup); fs.chmodSync(backup, 0o600);
        console.log('Backup:', backup);
        console.log('Database:', databasePath());
        console.log(JSON.stringify(syncSeed(sqlite, next, baseline), null, 2));
        const missing = missingCommanderImages(sqlite, path.resolve('public'));
        fs.mkdirSync('reports', { recursive: true });
        fs.writeFileSync('reports/missing-commander-images.md', '# Commanders missing usable images\n\n' + missing.map(c => `- **${c.name}** — ${c.reason}${c.image ? `: ${c.image}` : ''}`).join('\n') + '\n');
        console.log(`Missing commander images: ${missing.length}. See reports/missing-commander-images.md`);
    } finally { sqlite.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
