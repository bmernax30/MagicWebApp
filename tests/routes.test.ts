import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { database } from '../src/db/client';
import { importMagic } from '../src/db/import';
import { GET as readCatalog, POST as updateCatalog } from '../src/app/api/catalog/route';
import { POST as createGame } from '../src/app/api/games/route';
import { GET as readGame, POST as changeGame } from '../src/app/api/games/[code]/route';
import type { Game } from '../src/lib/types';

// Exercise real route handlers and web Request/Response contracts without opening
// a listener. Live transport/browser behavior is checked separately by test:shared.
describe('HTTP route contracts with independent clients', () => {
    let directory: string;
    let previousPath: string | undefined;
    const origin = 'http://127.0.0.1:3000';
    const context = (code: string) => ({ params: Promise.resolve({ code }) });
    const request = (code: string, body: unknown) => new Request(`${origin}/api/games/${code}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
    });
    const counter = (player = 1) => ({ id: randomUUID(), type: 'counter', round: 1, revision: 0, player, counter: 'life', delta: -1 });

    before(() => {
        directory = mkdtempSync(path.join(tmpdir(), 'magic-routes-'));
        previousPath = process.env.MAGIC_DATABASE_PATH;
        process.env.MAGIC_DATABASE_PATH = path.join(directory, 'routes.sqlite');
        const db = new Database(process.env.MAGIC_DATABASE_PATH);
        try {
            db.pragma('foreign_keys = ON');
            db.exec(readFileSync('drizzle/0000_magic.sql', 'utf8'));
            importMagic(db, path.resolve('seed-data/res'));
        } finally { db.close(); }
    });
    after(() => {
        database().sqlite.close();
        if (previousPath === undefined) delete process.env.MAGIC_DATABASE_PATH;
        else process.env.MAGIC_DATABASE_PATH = previousPath;
        rmSync(directory, { recursive: true, force: true });
    });
    async function create(): Promise<Game> {
        const response = await createGame(request('', {
            settings: { number_of_players: 2, starting_life_total: 40, game_type: 'Commander', planechase_enabled: false },
        }));
        assert.equal(response.status, 200);
        let game = await response.json() as Game;
        const catalog = await (await readCatalog()).json();
        for (let i = 0; i < 2; i++) {
            const profile = catalog.profiles[i];
            const joined = await changeGame(request(game.code, { id: randomUUID(), type: 'join', round: 1, revision: game.revision,
                player: i + 1, name: profile.name, commander: profile.commanders[0] }), context(game.code));
            assert.equal(joined.status, 200);
            game = await joined.json();
        }
        return game;
    }
    async function read(code: string): Promise<Game> {
        const response = await readGame(new Request(`${origin}/api/games/${code}`), context(code));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        return response.json();
    }
    test('20 concurrent requests preserve both clients’ deltas and duplicate IDs apply once', async () => {
        const catalog = await readCatalog();
        assert.equal(catalog.status, 200);
        const game = await create();
        const actions = Array.from({ length: 20 }, (_, i) => counter(i % 2 + 1));
        const responses = await Promise.all(actions.map(action => changeGame(request(game.code, action), context(game.code))));
        for (const response of responses) assert.equal(response.status, 200);
        const [clientA, clientB] = await Promise.all([read(game.code), read(game.code)]);
        assert.deepEqual(clientA, clientB);
        assert.equal(clientA.revision, game.revision + 20);
        assert.deepEqual(clientA.players.map(p => p.life), [30, 30]);
        assert.equal((await changeGame(request(game.code, actions[0]), context(game.code))).status, 200);
        assert.equal((await read(game.code)).revision, game.revision + 20);
    });
    test('cross-origin, non-JSON, malformed JSON and invalid payloads are rejected without writes', async () => {
        const game = await create();
        const url = `${origin}/api/games/${game.code}`;
        const invalid = [
            { status: 403, headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify(counter()) },
            { status: 415, headers: { 'Content-Type': 'text/plain', Origin: origin }, body: JSON.stringify(counter()) },
            { status: 400, headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{bad' },
            { status: 400, headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ ...counter(), delta: 999 }) },
        ];
        for (const input of invalid) {
            const response = await changeGame(new Request(url, { method: 'POST', headers: input.headers, body: input.body }), context(game.code));
            assert.equal(response.status, input.status);
            assert.equal(typeof (await response.json()).error, 'string');
        }
        assert.equal((await read(game.code)).revision, game.revision);
    });
    test('LAN and localhost browser origins use Host rather than Next’s bind address', async () => {
        const setup = {
            settings: { number_of_players: 2, starting_life_total: 40, game_type: 'Commander', planechase_enabled: false },
        };
        for (const browserOrigin of ['http://192.168.1.50:3000', 'http://localhost:3000', 'http://[::1]:3000', 'http://magic-table.local']) {
            const headers = {
                'Content-Type': 'application/json', Origin: browserOrigin,
                Host: new URL(browserOrigin).host,
            };
            const response = await createGame(new Request('http://0.0.0.0:3000/api/games', {
                method: 'POST', headers, body: JSON.stringify(setup),
            }));
            assert.equal(response.status, 200, browserOrigin);
            const game = await response.json() as Game;
            const catalog = await (await readCatalog()).json();
            const profile = catalog.profiles[0];
            const joined = await changeGame(new Request(`http://0.0.0.0:3000/api/games/${game.code}`, {
                method: 'POST', headers, body: JSON.stringify({ id: randomUUID(), type: 'join', round: 1, revision: 0,
                    player: 1, name: profile.name, commander: profile.commanders[0] }),
            }), context(game.code));
            assert.equal(joined.status, 200);
            const changed = await changeGame(new Request(`http://0.0.0.0:3000/api/games/${game.code}`, {
                method: 'POST', headers, body: JSON.stringify(counter()),
            }), context(game.code));
            assert.equal(changed.status, 200);
            assert.equal((await changed.json()).players[0].life, 39);
            const saved = await updateCatalog(new Request('http://0.0.0.0:3000/api/catalog', {
                method: 'POST', headers, body: JSON.stringify({ type: 'settings', settings: setup.settings }),
            }));
            assert.equal(saved.status, 200);
        }
    });
    test('mismatched origins, ports, schemes and forged forwarded hosts stay blocked on LAN', async () => {
        const game = await create();
        for (const suppliedOrigin of ['https://other.example', 'http://192.168.1.50:3001', 'https://192.168.1.50:3000', 'http://0.0.0.0:3000', 'null', 'invalid', '']) {
            const response = await changeGame(new Request(`http://0.0.0.0:3000/api/games/${game.code}`, {
                method: 'POST', headers: {
                    'Content-Type': 'application/json', Host: '192.168.1.50:3000',
                    Origin: suppliedOrigin, 'X-Forwarded-Host': suppliedOrigin.replace(/^https?:\/\//, ''),
                }, body: JSON.stringify(counter()),
            }), context(game.code));
            assert.equal(response.status, 403, suppliedOrigin);
        }
        assert.equal((await read(game.code)).revision, game.revision);
    });
    test('restart returns conflicts for stale scores and delayed prior-round requests', async () => {
        const game = await create();
        const change = await changeGame(request(game.code, counter()), context(game.code));
        assert.equal(change.status, 200);
        const staleRestart = { id: randomUUID(), type: 'restart', round: 1, revision: game.revision };
        assert.equal((await changeGame(request(game.code, staleRestart), context(game.code))).status, 409);
        const restart = await changeGame(request(game.code, { ...staleRestart, id: randomUUID(), revision: game.revision + 1 }), context(game.code));
        assert.equal(restart.status, 200);
        assert.equal((await restart.json()).round, 2);
        assert.equal((await changeGame(request(game.code, counter()), context(game.code))).status, 409);
        assert.deepEqual((await read(game.code)).players.map(p => p.life), [40, 40]);
    });
    test('simultaneous clients joining one open seat get one success and one conflict', async () => {
        const response = await createGame(request('', { settings: { number_of_players: 2, starting_life_total: 40, game_type: 'Commander', planechase_enabled: false } }));
        const game = await response.json() as Game;
        assert.ok(game.players.every(p => !p.joined));
        const catalog = await (await readCatalog()).json();
        const attempts = catalog.profiles.slice(0, 2).map((p: { name: string; commanders: string[] }) => ({ id: randomUUID(), type: 'join', round: 1, revision: 0, player: 1, name: p.name, commander: p.commanders[0] }));
        const responses = await Promise.all(attempts.map((action: unknown) => changeGame(request(game.code, action), context(game.code))));
        assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
        const winner = responses.findIndex(r => r.status === 200);
        const updated = await read(game.code);
        assert.equal(updated.players[0].name, attempts[winner].name);
        assert.equal(updated.revision, 1);
        assert.equal(updated.winner, null);
    });
    test('exit is shared across reads and blocks both scores and new joins', async () => {
        const game = await create();
        const before = await (await readCatalog()).json();
        const response = await changeGame(request(game.code, { id: randomUUID(), type: 'exit', round: 1, revision: game.revision }), context(game.code));
        assert.equal(response.status, 200);
        const [a, b] = await Promise.all([read(game.code), read(game.code)]);
        assert.deepEqual(a, b);
        assert.equal(a.status, 'exited');
        assert.equal((await changeGame(request(game.code, counter()), context(game.code))).status, 409);
        assert.equal((await changeGame(request(game.code, { id: randomUUID(), type: 'join', round: 1, revision: a.revision, player: 1, name: game.players[0].name, commander: game.players[0].commander }), context(game.code))).status, 409);
        assert.deepEqual(await (await readCatalog()).json(), before);
    });
    test('unknown game codes return a useful 404 response', async () => {
        const response = await readGame(new Request(`${origin}/api/games/ABC234`), context('ABC234'));
        assert.equal(response.status, 404);
        assert.match((await response.json()).error, /Game not found/);
    });
});
