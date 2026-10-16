import { loadEnvConfig } from '@next/env';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { databasePath } from '../src/db/client';
loadEnvConfig(process.cwd());
const filename = databasePath();
fs.mkdirSync(path.dirname(filename), { recursive: true });
const db = new Database(filename);
try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS magic_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
    for (const name of fs.readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) {
        const sql = fs.readFileSync(path.join('drizzle', name), 'utf8');
        const hash = createHash('sha256').update(sql).digest('hex');
        db.transaction(() => {
            const applied = db.prepare('SELECT hash FROM magic_migrations WHERE name = ?').get(name) as {
                hash: string;
            } | undefined;
            if (applied && applied.hash !== hash)
                throw new Error(`Applied migration changed: ${name}`);
            if (!applied) {
                db.exec(sql);
                db.prepare('INSERT INTO magic_migrations VALUES (?, ?)').run(name, hash);
            }
        }).immediate();
    }
    console.log('MagicWebApp migrations applied.');
}
finally {
    db.close();
}
