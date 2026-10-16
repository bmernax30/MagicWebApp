import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Catalog, Game } from '../src/lib/types';
const base = process.env.MAGIC_TEST_URL ?? 'http://127.0.0.1:3000';
async function request<T>(url: string, body?: unknown): Promise<T> {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json', Origin: new URL(base).origin } : undefined, body: body ? JSON.stringify(body) : undefined });
    const value = await r.json();
    assert.ok(r.ok, JSON.stringify(value));
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
    await request(url, actions[0]);
    assert.equal((await request<Game>(url)).revision, initialRevision + 20);
    console.log(`PASS: ${game.code}: 20 concurrent HTTP mutations, identical independent reads, duplicate-action protection. Each player has 30 life. Open ${base}/game/${game.code} and ${base}/game/${game.code}?view=1`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
