import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db/client';
import { importMagic } from '../src/db/import';
import { gameService } from '../src/server/game-service';
import { isAlive } from '../src/lib/types';
import type { GameAction } from '../src/lib/validation';
function fixture() {
    const directory = mkdtempSync(path.join(tmpdir(), 'magic-test-')), filename = path.join(directory, 'test.sqlite');
    const init = new Database(filename);
    init.exec(readFileSync('drizzle/0000_magic.sql', 'utf8'));
    init.close();
    const store = openDatabase(filename);
    importMagic(store.sqlite, path.resolve('seed-data/res'));
    const service = gameService(store);
    return { store, service, filename, close() { store.sqlite.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const settings = { number_of_players: 2, starting_life_total: 40, game_type: 'Commander' as const, planechase_enabled: false };
function create(s: ReturnType<typeof gameService>) {
    let game = s.create({ settings });
    const profiles = s.catalog().profiles.slice(0, 2);
    for (let i = 0; i < profiles.length; i++) {
        game = s.act(game.code, { id: randomUUID(), type: 'join', round: game.round, revision: game.revision,
            player: i + 1, name: profiles[i].name, commander: profiles[i].commanders[0] });
    }
    return game;
}
function counter(round = 1): GameAction { return { type: 'counter', id: randomUUID(), round, revision: 0, player: 1, counter: 'life', delta: -1 }; }
test('legacy import preserves every profile, partner metadata, rules, wins and planes; repeat import is inert', () => {
    const f = fixture();
    try {
        const c = f.service.catalog(), source = JSON.parse(readFileSync('seed-data/res/settings.json', 'utf8'));
        assert.equal(c.profiles.length, Object.keys(source.player_profiles).length);
        assert.equal(c.planes.length, 111);
        for (const p of c.profiles) {
            assert.equal(p.wins, source.player_profile_wins[p.name] ?? 0);
            assert.deepEqual(new Set(p.commanders), new Set(source.player_profiles[p.name]));
        }
        for (const [name, value] of Object.entries(source.commander_profiles)) {
            const { total_wins, ...metadata } = value as Record<string, unknown>;
            const c1 = c.commanders.find(c => c.name === name)!;
            assert.equal(c1.wins, total_wins);
            assert.deepEqual(c1.metadata, metadata);
        }
        assert.ok(c.commanders.some(c => c.rules.length > 0));
        assert.equal(importMagic(f.store.sqlite, path.resolve('seed-data/res')), false);
    }
    finally {
        f.close();
    }
});
test('independent database clients apply deltas without lost updates, and scores persist after reopening', () => {
    const f = fixture();
    const other = openDatabase(f.filename);
    try {
        const g = create(f.service), s2 = gameService(other);
        for (let i = 0; i < 20; i++) {
            f.service.act(g.code, counter());
            s2.act(g.code, counter());
        }
        assert.equal(s2.get(g.code).players[0].life, 0);
        assert.equal(s2.get(g.code).revision, g.revision + 40);
        const third = openDatabase(f.filename);
        try {
            assert.equal(gameService(third).get(g.code).players[0].life, 0);
        }
        finally {
            third.sqlite.close();
        }
    }
    finally {
        other.sqlite.close();
        f.close();
    }
});
test('duplicate actions are idempotent; reused ID with altered input is rejected', () => {
    const f = fixture();
    try {
        const g = create(f.service), a = counter();
        f.service.act(g.code, a);
        f.service.act(g.code, a);
        assert.equal(f.service.get(g.code).players[0].life, 39);
        assert.throws(() => f.service.act(g.code, { ...a, delta: 1 }), /Action ID/);
    }
    finally {
        f.close();
    }
});
test('commander damage changes life atomically, clamps at zero, and eliminates at 21', () => {
    const f = fixture();
    try {
        const g = create(f.service);
        let state = g;
        for (let i = 0; i < 21; i++)
            state = f.service.act(g.code, { ...counter(), counter: 'commander', source: 2 });
        // Use positive damage, rather than negative correction, for lethal damage.
        assert.equal(state.players[0].life, 40);
        assert.equal(state.players[0].damage[1], 0);
        for (let i = 0; i < 21; i++)
            state = f.service.act(g.code, { ...counter(), counter: 'commander', source: 2, delta: 1 });
        assert.equal(state.players[0].life, 19);
        assert.equal(state.players[0].damage[1], 21);
        assert.equal(isAlive(state.players[0]), false);
        assert.equal(state.winner, 2);
        state = f.service.act(g.code, { ...counter(), counter: 'commander', source: 2 });
        assert.equal(state.players[0].life, 20);
        assert.equal(state.winner, null);
        assert.throws(() => f.service.act(g.code, { ...counter(), counter: 'commander', source: 1 }), /opposing/);
    }
    finally {
        f.close();
    }
});
test('poison elimination, finish-once win tracking, lock, restart, and delayed old-round actions', () => {
    const f = fixture();
    try {
        const g = create(f.service), p = g.players[1], before = f.service.catalog();
        let state = g;
        for (let i = 0; i < 10; i++)
            state = f.service.act(g.code, { ...counter(), counter: 'poison', delta: 1 });
        assert.equal(state.winner, 2);
        assert.equal(state.players[0].life, 40);
        const finish = { id: randomUUID(), type: 'finish', round: 1, revision: state.revision };
        state = f.service.act(g.code, finish);
        f.service.act(g.code, finish);
        const after = f.service.catalog();
        assert.equal(after.profiles.find(v => v.name === p.name)!.wins, before.profiles.find(v => v.name === p.name)!.wins + 1);
        assert.equal(after.commanders.find(v => v.name === p.commander)!.wins, before.commanders.find(v => v.name === p.commander)!.wins + 1);
        assert.throws(() => f.service.act(g.code, counter()), /finished/);
        state = f.service.act(g.code, { id: randomUUID(), type: 'restart', round: 1, revision: state.revision });
        assert.equal(state.round, 2);
        assert.equal(state.players[0].poison, 0);
        assert.equal(state.winner, null);
        assert.throws(() => f.service.act(g.code, counter()), /restarted/);
    }
    finally {
        f.close();
    }
});
test('stale destructive actions conflict; rejected operations leave state and action log unchanged', () => {
    const f = fixture();
    try {
        const g = create(f.service);
        f.service.act(g.code, counter());
        assert.throws(() => f.service.act(g.code, { id: randomUUID(), round: 1, revision: 0, type: 'restart' }), /Scores changed/);
        assert.throws(() => f.service.act(g.code, { ...counter(), player: 6 }), /Player not/);
        assert.equal(f.service.get(g.code).revision, g.revision + 1);
        assert.equal((f.store.sqlite.prepare('SELECT count(*) n FROM actions').get() as {
            n: number;
        }).n, g.revision + 1);
    }
    finally {
        f.close();
    }
});
test('Planechase history is shared and reset with a new round', () => {
    const f = fixture();
    try {
        let g = f.service.create({ settings: { ...settings, planechase_enabled: true } });
        const first = g.planeHistory[0];
        g = f.service.act(g.code, { id: randomUUID(), round: 1, revision: 0, type: 'plane', direction: 'next' });
        assert.equal(g.planeHistory.length, 2);
        g = f.service.act(g.code, { id: randomUUID(), round: 1, revision: 0, type: 'plane', direction: 'previous' });
        assert.equal(g.planeHistory[g.planeIndex], first);
        g = f.service.act(g.code, { id: randomUUID(), round: 1, revision: g.revision, type: 'restart' });
        assert.equal(g.planeHistory.length, 1);
    }
    finally {
        f.close();
    }
});
test('games stay isolated and malformed input never changes scores', () => {
    const f = fixture();
    try {
        const a = create(f.service), b = create(f.service);
        f.service.act(a.code, counter());
        assert.equal(f.service.get(b.code).players[0].life, 40);
        assert.throws(() => f.service.act(a.code, { ...counter(), delta: 100 }));
        assert.throws(() => f.service.create({ settings, players: [] }));
        assert.throws(() => f.service.get('BAD'));
        assert.equal(f.service.get(a.code).revision, a.revision + 1);
    }
    finally {
        f.close();
    }
});
test('catalog saves preserve wins, update relationships, and reject deletion of game references', () => {
    const f = fixture();
    try {
        const before = f.service.catalog(), p = before.profiles[0];
        create(f.service);
        f.service.saveCatalog({ type: 'profile', name: p.name, commanders: [] });
        assert.equal(f.service.catalog().profiles.find(v => v.name === p.name)!.wins, p.wins);
        assert.equal(f.service.catalog().profiles.find(v => v.name === p.name)!.commanders.length, 0);
        const c = before.commanders[0];
        f.service.saveCatalog({ type: 'commander', name: c.name, metadata: c.metadata, rules: 'Updated' });
        assert.equal(f.service.catalog().commanders.find(v => v.name === c.name)!.wins, c.wins);
        assert.throws(() => f.service.saveCatalog({ type: 'deleteProfile', name: p.name }), /saved game/);
        assert.throws(() => f.service.saveCatalog({ type: 'profile', name: 'New', commanders: ['missing'] }), /Unknown/);
        assert.ok(!f.service.catalog().profiles.some(p => p.name === 'New'));
    }
    finally {
        f.close();
    }
});

test('creation makes open seats; join validates profiles and commanders and never overwrites an occupied seat', () => {
    const f = fixture(), other = openDatabase(f.filename);
    try {
        const game = f.service.create({ settings: { ...settings, number_of_players: 4 } });
        assert.equal(game.players.length, 4);
        assert.ok(game.players.every(p => !p.joined && p.commander === '' && p.name === `Seat ${p.number}`));
        assert.throws(() => f.service.act(game.code, counter()), /Join this seat/);
        const [first, second] = f.service.catalog().profiles;
        const join = { id: randomUUID(), type: 'join', round: 1, revision: 0, player: 1, name: first.name, commander: first.commanders[0] };
        assert.throws(() => f.service.act(game.code, { ...join, name: 'Unknown profile' }), /saved player/);
        assert.throws(() => f.service.act(game.code, { ...join, commander: '' }), /commander from/);
        const unrelated = f.service.catalog().commanders.find(c => !first.commanders.includes(c.name))!;
        assert.throws(() => f.service.act(game.code, { ...join, commander: unrelated.name }), /commander from/);
        const joined = f.service.act(game.code, join);
        assert.equal(joined.players[0].name, first.name);
        assert.equal(joined.players[0].joined, true);
        assert.equal(joined.winner, null);
        assert.equal(f.service.act(game.code, join).revision, 1);
        assert.throws(() => gameService(other).act(game.code, { ...join, id: randomUUID(), name: second.name, commander: second.commanders[0] }), /already been filled/);
        assert.equal(gameService(other).get(game.code).players[0].name, first.name);
        assert.throws(() => f.service.act(game.code, { ...counter(), counter: 'commander', source: 2 }), /opposing commander/);
        const updated = f.service.act(game.code, { ...join, id: randomUUID(), player: 2, name: second.name, commander: second.commanders[0] });
        assert.equal(updated.players[1].joined, true);
        assert.equal(updated.players[0].life, 40);
        const restarted = f.service.act(game.code, { id: randomUUID(), type: 'restart', round: 1, revision: updated.revision });
        assert.deepEqual(restarted.players.map(p => p.joined), [true, true, false, false]);
    } finally { other.sqlite.close(); f.close(); }
});

test('exit ends a session without wins even when a winner exists, and all later mutations are refused', () => {
    const f = fixture();
    try {
        const game = create(f.service), before = f.service.catalog();
        const staleExit = { id: randomUUID(), type: 'exit', round: 1, revision: game.revision };
        let state = game;
        for (let i = 0; i < 10; i++) state = f.service.act(game.code, { ...counter(), counter: 'poison', delta: 1 });
        assert.equal(state.winner, 2);
        assert.throws(() => f.service.act(game.code, staleExit), /Scores changed/);
        const exit = { ...staleExit, id: randomUUID(), revision: state.revision };
        state = f.service.act(game.code, exit);
        assert.equal(state.status, 'exited');
        assert.equal(state.winner, null);
        assert.equal(state.players[0].poison, 10);
        assert.equal(f.service.act(game.code, exit).revision, state.revision);
        assert.deepEqual(f.service.catalog(), before);
        for (const type of ['finish', 'restart', 'exit']) {
            assert.throws(() => f.service.act(game.code, { id: randomUUID(), type, round: 1, revision: state.revision }), /session has ended/);
        }
        assert.throws(() => f.service.act(game.code, counter()), /session has ended/);
        assert.throws(() => f.service.act(game.code, { id: randomUUID(), type: 'join', round: 1, revision: state.revision, player: 1, name: game.players[0].name, commander: game.players[0].commander }), /session has ended/);
    } finally { f.close(); }
});

test('seat migration preserves legacy games and leaves new empty seats untouched', () => {
    const f = fixture();
    try {
        const legacy = create(f.service), open = f.service.create({ settings });
        const oldState = JSON.parse(JSON.stringify(legacy));
        for (const p of oldState.players) delete p.joined;
        f.store.sqlite.prepare('UPDATE games SET state=? WHERE code=?').run(JSON.stringify(oldState), legacy.code);
        assert.ok(f.service.get(legacy.code).players.every(p => p.joined));
        const sql = readFileSync('drizzle/0001_seat_sessions.sql', 'utf8');
        f.store.sqlite.exec(sql);
        const stored = JSON.parse((f.store.sqlite.prepare('SELECT state FROM games WHERE code=?').get(legacy.code) as { state: string }).state);
        assert.deepEqual(stored, legacy);
        assert.deepEqual(f.service.get(open.code), open);
        f.store.sqlite.exec(sql);
        assert.deepEqual(f.service.get(legacy.code), legacy);
    } finally { f.close(); }
});
