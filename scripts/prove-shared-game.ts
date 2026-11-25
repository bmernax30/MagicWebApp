import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Catalog, Game, GameLog } from '../src/lib/types';
const base = process.env.MAGIC_TEST_URL ?? 'http://127.0.0.1:6001';
async function request<T>(url: string, body?: unknown): Promise<T> {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json', Origin: new URL(base).origin } : undefined, body: body ? JSON.stringify(body) : undefined });
    const value = await r.json();
    assert.ok(r.ok, JSON.stringify(value));
    const serverTime = Number(r.headers.get('X-Server-Time'));
    assert.ok(Number.isFinite(serverTime) && serverTime > 0, 'Responses must supply the server clock for emote timers.');
    return value as T;
}
async function main() {
    const catalog = await request<Catalog>('/api/catalog');
    let game = await request<Game>('/api/games', { settings: { ...catalog.settings, number_of_players: 2, starting_life_total: 40, planechase_enabled: false } });
    const url = `/api/games/${game.code}`;
    assert.ok(catalog.profiles.length >= 2, 'The proof needs two saved player profiles.');
    for (let i = 0; i < 2; i++) {
        const profile = catalog.profiles[i];
        game = await request<Game>(url, { id: randomUUID(), type: 'join', round: 1, revision: game.revision,
            player: i + 1, name: profile.name, commander: profile.commanders[0] ?? '' });
    }
    const initialRevision = game.revision;
    const actions = Array.from({ length: 20 }, (_, i) => ({ id: randomUUID(), type: 'counter', round: 1, revision: 0, player: i % 2 + 1, counter: 'life', delta: -1 }));
    await Promise.all(actions.map(a => request<Game>(url, a)));
    const [a, b] = await Promise.all([request<Game>(url), request<Game>(url)]);
    assert.deepEqual(a, b);
    assert.equal(a.players[0].life, 30);
    assert.equal(a.players[1].life, 30);
    assert.equal(a.revision, initialRevision + 20);
    const reconnected = await request<Game>(url.toLowerCase());
    assert.deepEqual(reconnected, a, 'A new phone must resume the exact saved setup and scores.');
    assert.deepEqual(reconnected.players.map(p => [p.name, p.commander]), game.players.map(p => [p.name, p.commander]));
    await request(url, actions[0]);
    assert.equal((await request<Game>(url)).revision, initialRevision + 20);
    const selfDamage = await request<Game>(url, { id: randomUUID(), type: 'counter', round: a.round, revision: a.revision, player: 1, counter: 'commander', source: 1, delta: 5 });
    assert.equal(selfDamage.players[0].life, 25);
    assert.equal(selfDamage.players[0].damage[0], 5);
    const log = await request<GameLog>(`${url}/log`);
    assert.equal(log.entries[0].message, 'Player 1 +5 commander damage from player 1 and -5 life.');
    const undone = await request<Game>(url, { id: randomUUID(), type: 'undo', round: selfDamage.round, revision: selfDamage.revision, eventId: log.entries[0].id });
    assert.equal(undone.players[0].life, 30);
    assert.equal(undone.players[0].damage[0], 0);
    const profile = catalog.profiles.find(p => p.name === undone.players[0].name)!;
    const replacement = profile.commanders.find(name => name !== undone.players[0].commander);
    assert.ok(replacement, 'The proof needs an alternate commander on the first profile.');
    const switched = await request<Game>(url, { id: randomUUID(), type: 'change-commander', round: undone.round, revision: undone.revision, player: 1, commander: replacement });
    assert.equal(switched.players[0].life, 30);
    assert.equal(switched.players[0].commander, replacement);
    const emote = { id: randomUUID(), type: 'emote', round: switched.round, revision: switched.revision, player: 1, target: 2, emote: 'salt' };
    const emoted = await request<Game>(url, emote);
    assert.deepEqual(emoted.players, switched.players);
    assert.deepEqual((await request<Game>(url)).emotes, emoted.emotes);
    assert.equal((await request<Game>(url, emote)).revision, emoted.revision);
    const limited = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin }, body: JSON.stringify({ ...emote, id: randomUUID(), emote: 'nice' }) });
    assert.equal(limited.status, 429);
    const finish = { id: randomUUID(), type: 'finish', round: emoted.round, revision: emoted.revision };
    const finished = await request<Game>(url, finish);
    assert.equal(finished.status, 'finished');
    assert.equal(finished.winner, null); // The proof does not award real profile wins.
    assert.ok(finished.nextGameCode);
    assert.equal((await request<Game>(url, finish)).nextGameCode, finished.nextGameCode);
    const [clientA, clientB] = await Promise.all([request<Game>(url), request<Game>(url)]);
    assert.equal(clientA.nextGameCode, clientB.nextGameCode);
    const nextUrl = `/api/games/${finished.nextGameCode}`;
    const next = await request<Game>(nextUrl);
    assert.deepEqual(next.players.map(p => [p.number, p.name, p.commander]), switched.players.map(p => [p.number, p.name, p.commander]));
    assert.ok(next.players.every(p => p.life === 40 && p.poison === 0 && p.damage.every(d => d === 0)));
    const left = await request<Game>(nextUrl, { id: randomUUID(), type: 'leave', player: 1, seatVersion: next.players[0].seatVersion ?? 0, round: next.round, revision: next.revision });
    assert.equal((await request<Game>(nextUrl)).players[0].joined, false);
    assert.equal(left.players[1].life, 40);
    const rejoined = await request<Game>(nextUrl, { id: randomUUID(), type: 'join', player: 1, seatVersion: left.players[0].seatVersion, name: next.players[0].name, commander: next.players[0].commander, round: left.round, revision: left.revision });
    const stale = await fetch(base + nextUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin }, body: JSON.stringify({ id: randomUUID(), type: 'counter', player: 1, counter: 'life', delta: -1, round: rejoined.round, revision: rejoined.revision, seatVersion: 0 }) });
    assert.equal(stale.status, 409);
    const kicked = await request<Game>(nextUrl, { id: randomUUID(), type: 'kick', player: 1, seatVersion: rejoined.players[0].seatVersion, round: rejoined.round, revision: rejoined.revision });
    assert.equal((await request<Game>(nextUrl)).players[0].joined, false);
    const exited = await request<Game>(nextUrl, { id: randomUUID(), type: 'exit', round: kicked.round, revision: kicked.revision });
    assert.equal(exited.status, 'exited');
    assert.equal((await request<Game>(nextUrl)).status, 'exited');
    console.log(`PASS: ${game.code}: seat reconnection, concurrent scoring, self damage, undo, commander switching, shared emotes and cooldown, exactly one successor ${next.code}, carried-over seats, leave/rejoin/kick, stale-seat protection, and shared exit. No profile wins awarded.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
