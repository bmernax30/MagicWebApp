import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { importMagic } from '../src/db/import';
import { readSeed, syncSeed, missingCommanderImages } from '../src/db/seed-sync';
function fixture() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys=ON');
    db.exec(fs.readFileSync('drizzle/0000_magic.sql', 'utf8'));
    importMagic(db, path.resolve('seed-data/res'));
    return db;
}
test('seed reconciliation preserves web additions, live metadata, wins and games and is idempotent', () => {
    const db = fixture();
    try {
        const baseline = readSeed('seed-data/res/settings.json'), next = structuredClone(baseline);
        const player = Object.keys(baseline.player_profiles)[0], commander = Object.keys(baseline.commander_profiles)[0];
        const oldWins = Number(baseline.commander_profiles[commander].total_wins);
        next.player_profile_wins[player] = (baseline.player_profile_wins[player] ?? 0) + 3;
        next.commander_profiles[commander].total_wins = oldWins + 2;
        next.commander_profiles[commander].attack_power = 77;
        next.commander_profiles[commander].defense_power = 55;
        const live = JSON.parse((db.prepare('SELECT metadata FROM commanders WHERE name=?').get(commander) as { metadata: string }).metadata);
        live.defense_power = 99;
        db.prepare('UPDATE commanders SET metadata=?, wins=wins+4 WHERE name=?').run(JSON.stringify(live), commander);
        db.prepare('UPDATE profiles SET wins=wins+5 WHERE name=?').run(player);
        db.prepare('INSERT INTO profiles VALUES (?,?)').run('Web only player', 8);
        db.prepare('INSERT INTO commanders VALUES (?,?,?,?)').run('Web only commander', 7, JSON.stringify(live), 'Keep these rules');
        db.prepare('INSERT INTO profile_commanders VALUES (?,?)').run(player, 'Web only commander');
        db.prepare('INSERT INTO games VALUES (?,?,?,?)').run('ABC234', '{"unchanged":true}', 25, 'before');
        next.commander_profiles['New seed commander'] = { ...baseline.commander_profiles[commander], total_wins: 0 };
        next.player_profiles[player].push('New seed commander');
        const removed = next.player_profiles[player].shift()!;
        const report = syncSeed(db, next);
        assert.ok(report.conflicts.includes(`${commander}.defense_power`));
        const actual = db.prepare('SELECT * FROM commanders WHERE name=?').get(commander) as { metadata: string; wins: number };
        assert.equal(actual.wins, oldWins + 6);
        assert.equal(JSON.parse(actual.metadata).attack_power, 77);
        assert.equal(JSON.parse(actual.metadata).defense_power, 99);
        assert.equal((db.prepare('SELECT wins FROM profiles WHERE name=?').get(player) as { wins: number }).wins, (baseline.player_profile_wins[player] ?? 0) + 8);
        assert.ok(db.prepare('SELECT 1 FROM profile_commanders WHERE profile=? AND commander=?').get(player, 'Web only commander'));
        assert.ok(db.prepare('SELECT 1 FROM profile_commanders WHERE profile=? AND commander=?').get(player, 'New seed commander'));
        assert.ok(!db.prepare('SELECT 1 FROM profile_commanders WHERE profile=? AND commander=?').get(player, removed));
        assert.equal((db.prepare('SELECT state FROM games').get() as { state: string }).state, '{"unchanged":true}');
        const repeat = syncSeed(db, next);
        assert.equal(repeat.winDelta, 0);
        assert.equal(repeat.metadataUpdates, 0);
        assert.equal((db.prepare('SELECT wins FROM commanders WHERE name=?').get(commander) as { wins: number }).wins, oldWins + 6);
    } finally { db.close(); }
});
test('first sync requires a baseline and failures roll back all changes', () => {
    const db = fixture();
    try {
        db.prepare("DELETE FROM settings WHERE key='seed_sync_baseline'").run();
        const next = readSeed('seed-data/res/settings.json');
        assert.throws(() => syncSeed(db, next), /requires the previously imported seed/);
        assert.equal(syncSeed(db, next, next).winDelta, 0);
    } finally { db.close(); }
});
test('image report distinguishes unassigned, missing files and partner artwork', () => {
    const db = fixture(), dir = fs.mkdtempSync(path.join(tmpdir(), 'magic-images-'));
    try {
        const name = Object.keys(readSeed('seed-data/res/settings.json').commander_profiles)[0];
        const meta = JSON.parse((db.prepare('SELECT metadata FROM commanders WHERE name=?').get(name) as { metadata: string }).metadata);
        meta.image_path = '';
        meta.second_commander = { ...meta.second_commander, enabled: true, name: 'Partner', image_path: 'res/commanders/missing.png' };
        db.prepare('UPDATE commanders SET metadata=? WHERE name=?').run(JSON.stringify(meta), name);
        const missing = missingCommanderImages(db, dir);
        assert.ok(missing.some(c => c.name === name && c.reason === 'No image assigned'));
        assert.ok(missing.some(c => c.name.includes('(partner: Partner)') && c.reason === 'Assigned file is missing'));
    } finally { db.close(); fs.rmSync(dir, { recursive: true }); }
});

test('a failed win adjustment rolls back metadata, links, and the sync baseline', () => {
    const db = fixture();
    try {
        const baseline = readSeed('seed-data/res/settings.json'), next = structuredClone(baseline);
        const name = Object.keys(baseline.commander_profiles)[0];
        next.commander_profiles[name].attack_power = 88;
        const player = Object.keys(baseline.player_profile_wins).find(p => baseline.player_profile_wins[p] > 0)!;
        next.player_profile_wins[player] = 0;
        db.prepare('UPDATE profiles SET wins=0 WHERE name=?').run(player);
        const before = db.prepare('SELECT metadata FROM commanders WHERE name=?').get(name);
        assert.throws(() => syncSeed(db, next), /Unsafe win adjustment/);
        assert.deepEqual(db.prepare('SELECT metadata FROM commanders WHERE name=?').get(name), before);
        assert.deepEqual(JSON.parse((db.prepare("SELECT value FROM settings WHERE key='seed_sync_baseline'").get() as { value: string }).value), baseline);
    } finally { db.close(); }
});
