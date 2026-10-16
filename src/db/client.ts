import 'server-only';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema';
export function databasePath() {
    const value = process.env.MAGIC_DATABASE_PATH ?? 'data/magic.sqlite';
    if (!value.trim() || value === ':memory:' || value.startsWith('file:') || !/\.(sqlite3?|db)$/.test(value))
        throw new Error('MAGIC_DATABASE_PATH must be a local SQLite file.');
    return path.resolve(value);
}
export function openDatabase(filename = databasePath()) {
    if (!fs.existsSync(filename))
        throw new Error('Database missing. Run npm run db:migrate and npm run db:import.');
    const sqlite = new Database(filename, { fileMustExist: true });
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('journal_mode = WAL');
    return { sqlite, orm: drizzle(sqlite, { schema }) };
}
let cached: ReturnType<typeof openDatabase> | undefined;
export function database() { return cached ??= openDatabase(); }
