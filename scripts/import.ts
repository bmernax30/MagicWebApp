import { loadEnvConfig } from '@next/env';
import path from 'node:path';
import { openDatabase } from '../src/db/client';
import { importMagic } from '../src/db/import';
loadEnvConfig(process.cwd());
const { sqlite } = openDatabase();
try {
    console.log(importMagic(sqlite, path.resolve('seed-data/res')) ? 'MagicApp profiles, settings, rules, and planes imported.' : 'Already imported; web data preserved.');
}
finally {
    sqlite.close();
}
