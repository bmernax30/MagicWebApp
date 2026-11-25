import fs from 'node:fs';
import type Database from 'better-sqlite3';
export function applyTestSchema(db:Database.Database) {
    for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())db.exec(fs.readFileSync(`drizzle/${name}`,'utf8'));
}
