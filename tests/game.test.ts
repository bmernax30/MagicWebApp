import { applyTestSchema } from './schema-fixture';
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
import { completeCommanderMetadata } from '../src/lib/commander-defaults';
import { isAlive } from '../src/lib/types';
import type { GameAction } from '../src/lib/validation';
function fixture() {
    const directory = mkdtempSync(path.join(tmpdir(), 'magic-test-')), filename = path.join(directory, 'test.sqlite');
    const init = new Database(filename);
    applyTestSchema(init);
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
            player: i + 1, name: profiles[i].name, commander: s.catalog().commanders[i].id });
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
            assert.deepEqual(p.history, []);
            assert.ok(!Object.hasOwn(p,'commanders'));
        }
        for (const [name, value] of Object.entries(source.commander_profiles)) {
            const { total_wins, ...metadata } = value as Record<string, unknown>;
            const archived=f.store.sqlite.prepare('SELECT wins,metadata FROM legacy_commanders WHERE name=?').get(name) as {wins:number;metadata:string};
            assert.equal(archived.wins,total_wins);
            assert.deepEqual(JSON.parse(archived.metadata),completeCommanderMetadata(metadata));
            const alias=f.store.sqlite.prepare('SELECT deck_id FROM commander_aliases WHERE name=?').get(name) as {deck_id:string}|undefined;
            if(alias)assert.ok(c.commanders.some(c=>c.id===alias.deck_id));
        }
        assert.ok(f.store.sqlite.prepare("SELECT 1 FROM legacy_commanders WHERE rules<>''").get());
        assert.ok(c.commanders.every(c=>c.rules===''&&c.cards.length===0));
        assert.ok(c.commanders.every(c=>c.cards.length>0||(!c.metadata.image_path&&!c.metadata.second_commander.image_path)));
        assert.ok(!c.commanders.some(c=>['Ben New Commander','New Commander','Strobel new commander.'].includes(c.name)));
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
        state = f.service.act(g.code, { ...counter(), counter: 'commander', source: 1, delta: 5 });
        assert.equal(state.players[0].damage[0], 5);
        assert.equal(state.players[0].life, 15);
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
        assert.ok(state.nextGameCode);
        const next = f.service.get(state.nextGameCode!);
        assert.equal(next.previousGameCode, g.code);
        assert.throws(() => f.service.act(g.code, { id: randomUUID(), type: 'restart', round: 1, revision: state.revision }), /finished/);
        state = f.service.act(next.code, { id: randomUUID(), type: 'restart', round: 1, revision: next.revision });
        assert.equal(state.round, 2);
        assert.equal(state.players[0].poison, 0);
        assert.equal(state.winner, null);
        assert.throws(() => f.service.act(next.code, counter()), /restarted/);
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
        assert.throws(() => f.service.act(a.code, { ...counter(), delta: 1000000 }));
        assert.throws(() => f.service.create({ settings, players: [] }));
        assert.throws(() => f.service.get('BAD'));
        assert.equal(f.service.get(a.code).revision, a.revision + 1);
    }
    finally {
        f.close();
    }
});
test('player saves preserve wins and reject old assignment and commander-edit APIs', () => {
    const f=fixture();try{
        const p=f.service.catalog().profiles[0];create(f.service);
        f.service.saveCatalog({type:'profile',name:p.name});
        assert.equal(f.service.catalog().profiles[0].wins,p.wins);
        assert.throws(()=>f.service.saveCatalog({type:'profile',name:p.name,commanders:[]}));
        assert.throws(()=>f.service.saveCatalog({type:'commander',name:'Old manual editor'}));
        assert.throws(()=>f.service.saveCatalog({type:'deleteProfile',name:p.name}),/saved history/);
    }finally{f.close();}
});

test('creation makes open seats; join validates profiles and commanders and never overwrites an occupied seat', () => {
    const f = fixture(), other = openDatabase(f.filename);
    try {
        const game = f.service.create({ settings: { ...settings, number_of_players: 4 } });
        assert.equal(game.players.length, 4);
        assert.ok(game.players.every(p => !p.joined && p.commander === '' && p.name === `Seat ${p.number}`));
        assert.throws(() => f.service.act(game.code, counter()), /Join this seat/);
        const [first, second] = f.service.catalog().profiles;
        const join = { id: randomUUID(), type: 'join', round: 1, revision: 0, player: 1, name: first.name, commander: f.service.catalog().commanders[0].id };
        assert.throws(() => f.service.act(game.code, { ...join, name: 'Unknown profile' }), /saved player/);
        assert.throws(() => f.service.act(game.code, { ...join, commander: '' }), /Choose a commander setup/);
        assert.throws(() => f.service.act(game.code, { ...join, commander: 'missing' }), /Choose a commander setup/);
        const joined = f.service.act(game.code, join);
        assert.equal(joined.players[0].name, first.name);
        assert.equal(joined.players[0].joined, true);
        assert.equal(joined.winner, null);
        assert.equal(f.service.act(game.code, join).revision, 1);
        assert.throws(() => gameService(other).act(game.code, { ...join, id: randomUUID(), name: second.name, commander: f.service.catalog().commanders[1].id }), /already been filled/);
        assert.equal(gameService(other).get(game.code).players[0].name, first.name);
        assert.throws(() => f.service.act(game.code, { ...counter(), counter: 'commander', source: 2 }), /joined player/);
        const updated = f.service.act(game.code, { ...join, id: randomUUID(), player: 2, name: second.name, commander: f.service.catalog().commanders[1].id });
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

test('batched deltas create one exact log entry; self commander damage and undo restore both counters', () => {
    const f = fixture();
    try {
        const g = create(f.service);
        const action = { ...counter(), delta: -10 };
        let state = f.service.act(g.code, action);
        let log = f.service.log(g.code);
        assert.equal(log.entries[0].message, 'Player 1 -10 life.');
        assert.equal(log.entries[0].canUndo, true);
        assert.equal(state.players[0].life, 30);
        f.service.act(g.code, action);
        assert.equal(f.service.log(g.code).entries.length, log.entries.length);
        state = f.service.act(g.code, { ...counter(), counter: 'commander', source: 1, delta: 5 });
        log = f.service.log(g.code);
        assert.equal(log.entries[0].message, 'Player 1 +5 commander damage from player 1 and -5 life.');
        assert.equal(state.players[0].damage[0], 5);
        assert.equal(state.players[0].life, 25);
        const undo = { id: randomUUID(), type: 'undo', round: state.round, revision: state.revision, eventId: log.entries[0].id };
        state = f.service.act(g.code, undo);
        assert.equal(state.players[0].damage[0], 0);
        assert.equal(state.players[0].life, 30);
        assert.equal(f.service.act(g.code, undo).revision, state.revision);
        log = f.service.log(g.code);
        assert.ok(log.entries[1].undoneBy);
        const next = log.entries.find(e => e.canUndo)!;
        state = f.service.act(g.code, { ...undo, id: randomUUID(), revision: state.revision, eventId: next.id });
        assert.equal(state.players[0].life, 40);
        assert.equal(f.service.log(g.code).undoableId, null);
    } finally { f.close(); }
});

test('undo uses reviewed revision and strict reverse score order, restores clamped values, and cannot cross rounds', () => {
    const f = fixture();
    try {
        const g = create(f.service);
        let state = f.service.act(g.code, { ...counter(), delta: -100 });
        const first = f.service.log(g.code).entries[0];
        assert.equal(first.message, 'Player 1 -40 life.');
        assert.equal(state.winner, 2);
        state = f.service.act(g.code, { ...counter(), player: 2, counter: 'poison', delta: 5 });
        assert.throws(() => f.service.act(g.code, { id: randomUUID(), type: 'undo', round: 1, revision: state.revision, eventId: first.id }), /latest remaining/);
        const last = f.service.log(g.code).entries[0];
        assert.throws(() => f.service.act(g.code, { id: randomUUID(), type: 'undo', round: 1, revision: state.revision - 1, eventId: last.id }), /Scores changed/);
        state = f.service.act(g.code, { id: randomUUID(), type: 'undo', round: 1, revision: state.revision, eventId: last.id });
        assert.equal(state.players[1].poison, 0);
        state = f.service.act(g.code, { id: randomUUID(), type: 'undo', round: 1, revision: state.revision, eventId: first.id });
        assert.equal(state.players[0].life, 40);
        assert.equal(state.winner, null);
        state = f.service.act(g.code, { ...counter(), delta: -3 });
        const priorRound = f.service.log(g.code).entries[0];
        state = f.service.act(g.code, { id: randomUUID(), type: 'restart', round: 1, revision: state.revision });
        assert.throws(() => f.service.act(g.code, { id: randomUUID(), type: 'undo', round: 2, revision: state.revision, eventId: priorRound.id }), /latest remaining/);
    } finally { f.close(); }
});

test('logs paginate without losing events and finished games cannot undo awarded wins', () => {
    const f = fixture();
    try {
        const g = create(f.service);
        let state = g;
        for (let i = 0; i < 55; i++) state = f.service.act(g.code, { ...counter(), counter: 'poison', delta: 1 });
        const first = f.service.log(g.code);
        assert.equal(first.entries.length, 50);
        const older = f.service.log(g.code, first.nextCursor!);
        assert.equal(older.entries.length, 7); // two seat joins + 55 score events
        assert.equal(new Set([...first.entries, ...older.entries].map(e => e.id)).size, 57);
        const eventId = first.entries[0].id;
        state = f.service.act(g.code, { id: randomUUID(), type: 'finish', round: 1, revision: state.revision });
        assert.equal(f.service.log(g.code).undoableId, null);
        assert.throws(() => f.service.act(g.code, { id: randomUUID(), type: 'undo', round: 1, revision: state.revision, eventId }), /finished/);
    } finally { f.close(); }
});

test('undo and its audit entry roll back together if persistence fails', () => {
    const f = fixture();
    try {
        const game = create(f.service), state = f.service.act(game.code, { ...counter(), delta: -10 });
        const entry = f.service.log(game.code).entries[0];
        f.store.sqlite.exec("CREATE TRIGGER reject_undo BEFORE INSERT ON actions WHEN json_extract(NEW.payload,'$.type')='undo' BEGIN SELECT RAISE(ABORT,'test write failure'); END");
        assert.throws(() => f.service.act(game.code, { id: randomUUID(), type: 'undo', round: 1, revision: state.revision, eventId: entry.id }), /test write failure/);
        assert.deepEqual(f.service.get(game.code), state);
        assert.equal(f.service.log(game.code).entries[0].undoneBy, null);
        assert.equal(f.service.log(game.code).entries[0].canUndo, true);
    } finally { f.close(); }
});

test('earlier requests remain readable but cannot be undone without a before snapshot', () => {
    const f = fixture();
    try {
        const game = create(f.service);
        game.players[0].life = 30;
        game.revision++;
        const id = randomUUID();
        f.store.sqlite.prepare('UPDATE games SET state=?,revision=? WHERE code=?').run(JSON.stringify(game), game.revision, game.code);
        f.store.sqlite.prepare('INSERT INTO actions(game,id,payload,revision) VALUES (?,?,?,?)').run(game.code, id, JSON.stringify({ ...counter(), id, delta: -10 }), game.revision);
        assert.equal(f.service.log(game.code).undoableId, null);
        assert.match(f.service.log(game.code).entries[0].message, /earlier request/);
        let state = f.service.act(game.code, { ...counter(), delta: -5 });
        const latest = f.service.log(game.code).entries[0];
        state = f.service.act(game.code, { id: randomUUID(), type: 'undo', round: 1, revision: state.revision, eventId: latest.id });
        assert.equal(state.players[0].life, 30);
        assert.equal(f.service.log(game.code).undoableId, null);
    } finally { f.close(); }
});

test('finish archives the scores and atomically creates exactly one linked session with the same people', () => {
    const f = fixture(), other = openDatabase(f.filename);
    try {
        let game = f.service.create({ settings: { ...settings, number_of_players: 4, planechase_enabled: true } });
        const profiles = f.service.catalog().profiles.slice(0, 2);
        for (let i = 0; i < 2; i++) game = f.service.act(game.code, { id: randomUUID(), type: 'join', round: 1, revision: game.revision, player: i + 1, name: profiles[i].name, commander: f.service.catalog().commanders[i].id });
        game = f.service.act(game.code, { ...counter(), counter: 'poison', delta: 10 });
        const beforeWins = f.service.catalog();
        const finish = { id: randomUUID(), type: 'finish', round: 1, revision: game.revision };
        const finished = f.service.act(game.code, finish);
        assert.equal(finished.status, 'finished');
        assert.equal(finished.winner, 2);
        assert.ok(finished.endedAt);
        assert.deepEqual(finished.players, game.players);
        assert.ok(finished.nextGameCode && finished.nextGameCode !== game.code);
        const next = gameService(other).get(finished.nextGameCode!);
        assert.equal(next.status, 'active');
        assert.equal(next.previousGameCode, game.code);
        assert.equal(next.nextGameCode, null);
        assert.equal(next.winner, null);
        assert.equal(next.round, 1);
        assert.deepEqual(next.settings, game.settings);
        assert.deepEqual(next.players.map(p => [p.number, p.name, p.commander, p.joined]), game.players.map(p => [p.number, p.name, p.commander, p.joined]));
        assert.ok(next.players.every(p => p.life === 40 && p.poison === 0 && p.damage.every(d => d === 0)));
        assert.equal(next.planeHistory.length, 1);
        assert.equal(f.service.log(next.code).entries[0].message, `New session started with players from ${game.code}.`);
        assert.deepEqual(f.service.act(game.code, finish), finished);
        assert.throws(() => gameService(other).act(game.code, { ...finish, id: randomUUID() }), /Scores changed/);
        assert.equal((f.store.sqlite.prepare('SELECT count(*) n FROM games').get() as { n: number }).n, 2);
        const afterWins = f.service.catalog();
        const winner = game.players[1];
        assert.equal(afterWins.profiles.find(p => p.name === winner.name)!.wins, beforeWins.profiles.find(p => p.name === winner.name)!.wins + 1);
        assert.equal(afterWins.commanders.find(p => p.name === winner.commander)!.wins, beforeWins.commanders.find(p => p.name === winner.commander)!.wins + 1);
        assert.equal(f.service.get(game.code).players[0].poison, 10);
    } finally { other.sqlite.close(); f.close(); }
});

test('a successor creation failure rolls back finish, its win, and its log entry together', () => {
    const f = fixture();
    try {
        const initial = create(f.service), game = f.service.act(initial.code, { ...counter(), delta: -40 });
        const catalog = f.service.catalog(), log = f.service.log(game.code);
        f.store.sqlite.exec("CREATE TRIGGER reject_next BEFORE INSERT ON games WHEN json_extract(NEW.state,'$.previousGameCode') IS NOT NULL BEGIN SELECT RAISE(ABORT,'next-session test failure'); END");
        assert.throws(() => f.service.act(game.code, { id: randomUUID(), type: 'finish', round: 1, revision: game.revision }), /next-session test failure/);
        assert.deepEqual(f.service.get(game.code), game);
        assert.deepEqual(f.service.catalog(), catalog);
        assert.deepEqual(f.service.log(game.code), log);
        assert.equal((f.store.sqlite.prepare('SELECT count(*) n FROM games').get() as { n: number }).n, 1);
    } finally { f.close(); }
});

test('finishing without a winner still records a session and carries players forward without awarding wins', () => {
    const f = fixture();
    try {
        const game = create(f.service), before = f.service.catalog();
        const finished = f.service.act(game.code, { id: randomUUID(), type: 'finish', round: 1, revision: game.revision });
        assert.equal(finished.winner, null);
        assert.ok(finished.nextGameCode);
        const after=f.service.catalog();
        assert.deepEqual(after.profiles.map(p=>p.wins),before.profiles.map(p=>p.wins));
        assert.deepEqual(after.commanders.map(c=>c.wins),before.commanders.map(c=>c.wins));
        for(const p of game.players)assert.equal(after.profiles.find(v=>v.name===p.name)!.history[0].plays,1);
        assert.equal(f.service.get(finished.nextGameCode!).players.filter(p => p.joined).length, 2);
        assert.throws(() => f.service.act(game.code, { id: randomUUID(), type: 'exit', round: 1, revision: finished.revision }), /finished/);
    } finally { f.close(); }
});

test('changing commanders is validated and logged without resetting any scores; the new commander earns the win', () => {
    const f = fixture();
    try {
        let game = create(f.service);
        game = f.service.act(game.code, { ...counter(), counter: 'commander', source: 1, delta: 5 });
        game = f.service.act(game.code, { ...counter(), counter: 'poison', delta: 2 });
        const replacement = f.service.catalog().commanders.find(c=>c.id!==game.players[0].deckId)!.name;
        const oldCommander = game.players[0].commander;
        const before = f.service.catalog();
        const change = { id: randomUUID(), type: 'change-commander', round: 1, revision: game.revision, player: 1, commander: replacement };
        assert.throws(() => f.service.act(game.code, { ...change, commander: 'unknown' }), /Choose a commander setup/);
        assert.throws(() => f.service.act(game.code, { ...change, commander: '' }), /Choose a commander setup/);
        assert.throws(() => f.service.act(game.code, { ...change, player: 6 }), /joined player/);
        const changed = f.service.act(game.code, change);
        assert.equal(changed.players[0].commander, replacement);
        assert.deepEqual({ ...changed.players[0], commander: oldCommander, deckId:game.players[0].deckId }, game.players[0]);
        assert.deepEqual(changed.players[1], game.players[1]);
        assert.match(f.service.log(game.code).entries[0].message, /changed commander/);
        assert.deepEqual(f.service.act(game.code, change), changed);
        assert.throws(() => f.service.act(game.code, { ...change, id: randomUUID() }), /Scores changed/);
        game = f.service.act(game.code, { ...counter(), player: 2, delta: -40 });
        game = f.service.act(game.code, { id: randomUUID(), type: 'finish', round: 1, revision: game.revision });
        const after = f.service.catalog();
        assert.equal(after.commanders.find(c => c.name === replacement)!.wins, before.commanders.find(c => c.name === replacement)!.wins + 1);
        assert.equal(after.commanders.find(c => c.name === oldCommander)!.wins, before.commanders.find(c => c.name === oldCommander)!.wins);
        assert.throws(() => f.service.act(game.code, { ...change, id: randomUUID(), revision: game.revision }), /finished/);
    } finally { f.close(); }
});

test('session link migration preserves old scores and existing non-null session chains', () => {
    const f = fixture();
    try {
        const legacy = create(f.service);
        const raw = JSON.parse(JSON.stringify(legacy));
        delete raw.nextGameCode; delete raw.previousGameCode; delete raw.endedAt;
        f.store.sqlite.prepare('UPDATE games SET state=? WHERE code=?').run(JSON.stringify(raw), legacy.code);
        const started = create(f.service);
        const finished = f.service.act(started.code, { id: randomUUID(), type: 'finish', round: 1, revision: started.revision });
        const next = f.service.get(finished.nextGameCode!);
        const migration = readFileSync('drizzle/0003_session_links.sql', 'utf8');
        f.store.sqlite.exec(migration);
        assert.deepEqual(f.service.get(legacy.code), legacy);
        assert.deepEqual(f.service.get(started.code), finished);
        assert.deepEqual(f.service.get(next.code), next);
        f.store.sqlite.exec(migration);
        assert.deepEqual(f.service.get(started.code), finished);
    } finally { f.close(); }
});

test('emotes synchronize sender/target, preserve scores, deduplicate, and enforce a shared five-second cooldown', t => {
    const f = fixture(), other = openDatabase(f.filename);
    let now = 1800000000000;
    t.mock.method(Date, 'now', () => now);
    try {
        const g = create(f.service), second = gameService(other);
        const input = { id: randomUUID(), type: 'emote', round: g.round, revision: g.revision, player: 1, target: 2, emote: 'threat' };
        const sent = f.service.act(g.code, input);
        assert.deepEqual(sent.players, g.players);
        assert.deepEqual(second.get(g.code).emotes, sent.emotes);
        assert.equal(sent.emotes[0].senderName, g.players[0].name);
        assert.equal(sent.emotes[0].target, 2);
        assert.equal(sent.emotes[0].expiresAt, now + 6000);
        assert.equal(second.act(g.code, input).revision, sent.revision);
        assert.throws(() => second.act(g.code, { ...input, id: randomUUID(), target: 1, emote: 'salt' }), /five seconds/);
        now += 4999;
        assert.throws(() => second.act(g.code, { ...input, id: randomUUID() }), /five seconds/);
        // Another sender has an independent cooldown; self-targeting is supported.
        const both = second.act(g.code, { ...input, id: randomUUID(), player: 2, target: 2, emote: 'nice' });
        assert.equal(both.emotes.length, 2);
        now++;
        const again = f.service.act(g.code, { ...input, id: randomUUID(), emote: 'in-response' });
        assert.equal(again.emotes.length, 2);
        assert.equal(again.emotes.find(e => e.sender === 1)!.kind, 'in-response');
        assert.equal(f.service.log(g.code).undoableId, null);
        const restarted = f.service.act(g.code, { id: randomUUID(), type: 'restart', round: again.round, revision: again.revision });
        assert.ok(restarted.emotes.every(e => e.expiresAt === 0));
        assert.throws(() => second.act(g.code, { ...input, id: randomUUID(), round: restarted.round }), /five seconds/);
    } finally { other.sqlite.close(); f.close(); }
});

test('emotes reject unknown choices, missing seats, unjoined players and ended games', () => {
    const f = fixture();
    try {
        let g = f.service.create({ settings });
        const input = { id: randomUUID(), type: 'emote', round: 1, revision: 0, player: 1, target: 2, emote: 'salt' };
        assert.throws(() => f.service.act(g.code, input), /joined/);
        g = create(f.service);
        assert.throws(() => f.service.act(g.code, { ...input, emote: 'unknown' }));
        assert.throws(() => f.service.act(g.code, { ...input, target: 3 }), /joined/);
        const finished = f.service.act(g.code, { id: randomUUID(), type: 'finish', round: 1, revision: g.revision });
        assert.throws(() => f.service.act(g.code, input), /finished/);
        assert.deepEqual(f.service.get(finished.nextGameCode!).emotes, []);
    } finally { f.close(); }
});

test('emote migration backfills legacy games without changing scores or existing emotes', () => {
    const f = fixture();
    try {
        const g = create(f.service);
        f.store.sqlite.prepare("UPDATE games SET state=json_remove(state,'$.emotes') WHERE code=?").run(g.code);
        assert.deepEqual(f.service.get(g.code).emotes, []);
        f.store.sqlite.exec(readFileSync('drizzle/0004_emotes.sql', 'utf8'));
        const sent = f.service.act(g.code, { id: randomUUID(), type: 'emote', round: 1, revision: g.revision, player: 1, target: 2, emote: 'salt' });
        f.store.sqlite.exec(readFileSync('drizzle/0004_emotes.sql', 'utf8'));
        assert.deepEqual(f.service.get(g.code), sent);
        assert.deepEqual(sent.players, g.players);
    } finally { f.close(); }
});

test('kick and leave open fresh seats, preserve opponents, log removal, and block stale occupants and undo', () => {
    for (const type of ['kick', 'leave'] as const) {
        const f = fixture();
        try {
            let g = create(f.service);
            g = f.service.act(g.code, { ...counter(), counter: 'commander', player: 2, source: 1, delta: 5 });
            const oldEvent = f.service.log(g.code).entries[0].id;
            const oldSeat = g.players[0], otherLife = g.players[1].life;
            const wins = f.service.catalog().profiles.map(p => p.wins);
            const action = { id: randomUUID(), type, round: g.round, revision: g.revision, player: 1, seatVersion: 0 };
            assert.throws(() => f.service.act(g.code, { ...action, revision: 0 }), /Scores changed/);
            const removed = f.service.act(g.code, action);
            assert.equal(removed.status, 'active');
            assert.equal(removed.players[0].joined, false);
            assert.equal(removed.players[0].seatVersion, 1);
            assert.equal(removed.players[0].name, 'Seat 1');
            assert.equal(removed.players[0].commander, '');
            assert.equal(removed.players[0].life, 40);
            assert.equal(removed.players[1].life, otherLife);
            assert.equal(removed.players[1].damage[0], 0);
            assert.deepEqual(f.service.catalog().profiles.map(p => p.wins), wins);
            assert.equal(f.service.act(g.code, action).revision, removed.revision);
            assert.match(f.service.log(g.code).entries[0].message, /Seat 1 is open/);
            assert.equal(f.service.log(g.code).undoableId, null);
            assert.throws(() => f.service.act(g.code, { id: randomUUID(), type: 'undo', eventId: oldEvent, round: g.round, revision: removed.revision }), /latest remaining/);
            const join = { id: randomUUID(), type: 'join', round: g.round, revision: removed.revision, player: 1, name: oldSeat.name, commander: oldSeat.commander };
            assert.throws(() => f.service.act(g.code, join), /changed occupants/);
            const rejoined = f.service.act(g.code, { ...join, seatVersion: 1 });
            assert.ok(rejoined.players[0].joined);
            assert.throws(() => f.service.act(g.code, counter()), /changed occupants/);
            assert.throws(() => f.service.act(g.code, { ...counter(), player: 2, counter: 'commander', source: 1 }), /source seat changed/);
            const changed = f.service.act(g.code, { ...counter(), seatVersion: 1 });
            assert.equal(changed.players[0].life, 39);
            const damaged = f.service.act(g.code, { ...counter(), player: 2, counter: 'commander', source: 1, sourceVersion: 1 });
            assert.equal(damaged.players[1].damage[0], 0); // negative damage clamps at zero
        } finally { f.close(); }
    }
});

test('seat-version migration preserves identities and totals, and removal rejects empty or finished seats', () => {
    const f = fixture();
    try {
        const empty = f.service.create({ settings });
        assert.throws(() => f.service.act(empty.code, { id: randomUUID(), type: 'kick', player: 1, round: 1, revision: 0 }), /already open/);
        const g = create(f.service);
        f.store.sqlite.prepare("UPDATE games SET state=json_remove(state,'$.players[0].seatVersion','$.players[1].seatVersion') WHERE code=?").run(g.code);
        const before = f.service.get(g.code);
        f.store.sqlite.exec(readFileSync('drizzle/0005_seat_versions.sql', 'utf8'));
        assert.deepEqual(f.service.get(g.code), before);
        f.store.sqlite.exec(readFileSync('drizzle/0005_seat_versions.sql', 'utf8'));
        assert.deepEqual(f.service.get(g.code), before);
        const finished = f.service.act(g.code, { id: randomUUID(), type: 'finish', round: 1, revision: g.revision });
        assert.throws(() => f.service.act(g.code, { id: randomUUID(), type: 'leave', player: 1, round: 1, revision: finished.revision }), /finished/);
    } finally { f.close(); }
});

test('all six seats have independent cooldowns that release at exactly five seconds', t => {
    const f = fixture();
    let now = 1800000000000;
    t.mock.method(Date, 'now', () => now);
    try {
        let g = f.service.create({ settings: { ...settings, number_of_players: 6 } });
        const profile = f.service.catalog().profiles[0];
        for (let player = 1; player <= 6; player++) g = f.service.act(g.code, { id: randomUUID(), type: 'join', round: 1, revision: g.revision, player, name: profile.name, commander: f.service.catalog().commanders[0].id });
        const send = (player: number) => f.service.act(g.code, { id: randomUUID(), type: 'emote', player, target: 1, emote: 'nice', round: 1, revision: 0 });
        for (let player = 1; player <= 6; player++) send(player);
        now += 4999;
        for (let player = 1; player <= 6; player++) assert.throws(() => send(player), /five seconds/);
        now++;
        for (let player = 1; player <= 6; player++) send(player);
    } finally { f.close(); }
});
