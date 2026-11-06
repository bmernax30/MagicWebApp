import 'server-only';
import { completeCommanderMetadata } from '../lib/commander-defaults';
import { randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { eq, asc } from 'drizzle-orm';
import type { openDatabase } from '../db/client';
import * as tables from '../db/schema';
import { actionSchema, catalogWriteSchema, createGameSchema } from '../lib/validation';
import { winnerOf, type Catalog, type Game, type Commander, type Settings, type StoredGameEvent, type GameLog, type CounterSnapshot } from '../lib/types';
type Store = ReturnType<typeof openDatabase>;
export class GameError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export function gameService({ sqlite, orm }: Store) {
    function catalog(): Catalog {
        const defaults = orm.select().from(tables.settings).where(eq(tables.settings.key, 'defaults')).get();
        if (!defaults)
            throw new GameError('Database is not initialized. Run npm run db:import.', 503);
        const links = orm.select().from(tables.profileCommanders).all();
        return {
            settings: JSON.parse(defaults.value) as Settings,
            profiles: orm.select().from(tables.profiles).orderBy(asc(tables.profiles.name)).all().map(p => ({ ...p, commanders: links.filter(l => l.profile === p.name).map(l => l.commander) })),
            commanders: orm.select().from(tables.commanders).orderBy(asc(tables.commanders.name)).all().map(c => ({ ...c, metadata: completeCommanderMetadata(JSON.parse(c.metadata)) } as Commander)),
            planes: orm.select().from(tables.planes).orderBy(asc(tables.planes.name)).all(),
        };
    }
    function get(code: string): Game {
        if (!/^[A-Z2-9]{6}$/.test(code))
            throw new GameError('Game not found.', 404);
        const row = orm.select().from(tables.games).where(eq(tables.games.code, code)).get();
        if (!row)
            throw new GameError('Game not found. Check the six-character code.', 404);
        const game = { ...JSON.parse(row.state), revision: row.revision } as Game;
        // Older saved games already had their players assigned at creation.
        game.players = game.players.map(p => ({ ...p, joined: p.joined ?? true }));
        return game;
    }
    function randomPlane(current?: string) {
        const list = orm.select({ name: tables.planes.name }).from(tables.planes).all();
        if (!list.length)
            throw new GameError('No planes have been imported.');
        const choices = list.filter(p => p.name !== current);
        return (choices.length ? choices : list)[randomInt(choices.length || list.length)].name;
    }
    function create(input: unknown): Game {
        const data = createGameSchema.parse(input);
        return sqlite.transaction(() => {
            catalog();
            const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code: string;
            do {
                code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
            } while (orm.select().from(tables.games).where(eq(tables.games.code, code)).get());
            const game: Game = {
                code, revision: 0, round: 1, status: 'active', settings: data.settings,
                players: Array.from({ length: data.settings.number_of_players }, (_, i) => ({
                    number: i + 1, joined: false, name: `Seat ${i + 1}`, commander: '',
                    life: data.settings.starting_life_total, poison: 0,
                    damage: Array.from({ length: data.settings.number_of_players }, () => 0), hidden: false,
                })),
                winner: null, planeHistory: data.settings.planechase_enabled ? [randomPlane()] : [],
                planeIndex: data.settings.planechase_enabled ? 0 : -1, createdAt: new Date().toISOString(),
            };
            orm.insert(tables.games).values({ code, state: JSON.stringify(game), revision: 0, createdAt: game.createdAt }).run();
            return game;
        }).immediate();
    }
    type ActionRow = { id: string; revision: number; payload: string; event: string | null; undone_by: string | null };
    const snapshot = (p: Game['players'][number]): CounterSnapshot => ({ life: p.life, poison: p.poison, damage: [...p.damage] });
    const signed = (n: number) => n >= 0 ? `+${n}` : String(n);
    function undoable(game: Game): ActionRow | undefined {
        return (sqlite.prepare('SELECT * FROM actions WHERE game=? AND event IS NOT NULL AND undone_by IS NULL ORDER BY revision DESC').all(game.code) as ActionRow[])
            .find(row => { const event = JSON.parse(row.event!) as StoredGameEvent; return event.type === 'counter' && event.round === game.round && event.before && event.after; });
    }
    function log(code: string, before?: number): GameLog {
        const game = get(code);
        const candidate = game.status === 'active' ? undoable(game) : undefined;
        const rows = sqlite.prepare('SELECT * FROM actions WHERE game=? AND revision < ? ORDER BY revision DESC LIMIT 51').all(code, before ?? Number.MAX_SAFE_INTEGER) as ActionRow[];
        return { revision: game.revision, undoableId: candidate?.id ?? null,
            nextCursor: rows.length > 50 ? rows[49].revision : null,
            entries: rows.slice(0, 50).map(row => {
                const input = JSON.parse(row.payload);
                const event = row.event ? JSON.parse(row.event) as StoredGameEvent : null;
                const legacy = input.type === 'counter' ? `Player ${input.player} requested ${signed(input.delta)} ${input.counter}${input.source ? ` from player ${input.source}` : ''} (earlier request; exact applied change unavailable).` : `Earlier ${input.type} action.`;
                return { id: row.id, revision: row.revision, round: event?.round ?? input.round, at: event?.at ?? null,
                    message: event?.message ?? legacy, undoneBy: row.undone_by, canUndo: row.id === candidate?.id };
            }) };
    }
    function act(code: string, input: unknown): Game {
        const action = actionSchema.parse(input);
        return sqlite.transaction(() => {
            const game = get(code);
            const previous = sqlite.prepare('SELECT payload FROM actions WHERE game=? AND id=?').get(code, action.id) as {
                payload: string;
            } | undefined;
            if (previous) {
                if (previous.payload !== JSON.stringify(action))
                    throw new GameError('Action ID already used for different input.', 409);
                return game;
            }
            if (action.round !== game.round)
                throw new GameError('This game was restarted. Refresh before making changes.', 409);
            if (action.type === 'restart' || action.type === 'finish' || action.type === 'exit' || action.type === 'undo') {
                if (action.revision !== game.revision)
                    throw new GameError('Scores changed. Review the latest scores and try again.', 409);
            }
            if (game.status === 'exited')
                throw new GameError('This game session has ended. Create a new game to play again.', 409);
            if (game.status === 'finished' && action.type !== 'restart')
                throw new GameError('This game has finished.', 409);
            let event: StoredGameEvent = { type: action.type, round: game.round, at: new Date().toISOString(), message: '' };
            if (action.type === 'undo') {
                const target = undoable(game);
                if (!target || target.id !== action.eventId) throw new GameError('Only the latest remaining score event in this round can be undone. Refresh the log.', 409);
                const prior = JSON.parse(target.event!) as StoredGameEvent;
                const p = game.players[prior.player! - 1];
                if (!p || !isDeepStrictEqual(snapshot(p), prior.after)) throw new GameError('Scores no longer match this log entry. Refresh before undoing.', 409);
                Object.assign(p, structuredClone(prior.before!));
                sqlite.prepare('UPDATE actions SET undone_by=? WHERE game=? AND id=?').run(action.id, code, target.id);
                game.winner = winnerOf(game.players);
                event.message = `Undo: ${prior.message}`;
            }
            else if (action.type === 'join') {
                const p = game.players[action.player - 1];
                if (!p) throw new GameError('Seat not in this game.');
                if (p.joined) throw new GameError('This seat has already been filled. Choose another seat or open its controls.', 409);
                const profile = orm.select().from(tables.profiles).where(eq(tables.profiles.name, action.name)).get();
                if (!profile) throw new GameError('Choose a saved player profile.');
                const linked = orm.select().from(tables.profileCommanders).all().some(link => link.profile === action.name && link.commander === action.commander);
                if ((game.settings.game_type === 'Commander' || action.commander) && !linked)
                    throw new GameError('Choose a commander from this player’s profile.');
                p.name = action.name;
                p.commander = action.commander;
                p.joined = true;
                game.winner = winnerOf(game.players);
                event.message = `Player ${p.number} joined as ${p.name}.`;
            }
            else if (action.type === 'exit') {
                event.message = 'Game session exited without recording a win.';
                game.status = 'exited';
                game.winner = null;
            }
            else if (action.type === 'counter') {
                const p = game.players[action.player - 1];
                if (!p)
                    throw new GameError('Player not in this game.');
                if (!p.joined) throw new GameError('Join this seat before changing scores.', 409);
                const before = snapshot(p);
                let applied: number;
                if (action.counter === 'commander') {
                    if (game.settings.game_type !== 'Commander')
                        throw new GameError('Commander damage is unavailable in Standard.');
                    if (!action.source || !game.players[action.source - 1]?.joined)
                        throw new GameError('Choose a joined player’s commander.');
                    const i = action.source - 1, before = p.damage[i];
                    p.damage[i] = Math.max(0, Math.min(999999, before + action.delta));
                    applied = p.damage[i] - before;
                    p.life = Math.max(0, Math.min(999999, p.life - applied));
                }
                else {
                    const previous = p[action.counter];
                    p[action.counter] = Math.max(0, Math.min(999999, previous + action.delta));
                    applied = p[action.counter] - previous;
                }
                const message = action.counter === 'commander'
                    ? `Player ${p.number} ${signed(applied)} commander damage from player ${action.source} and ${signed(p.life - before.life)} life.`
                    : `Player ${p.number} ${signed(applied)} ${action.counter === 'poison' ? 'poison' : 'life'}.`;
                event = { ...event, player: p.number, before, after: snapshot(p), message };
                game.winner = winnerOf(game.players);
            }
            else if (action.type === 'visibility') {
                const p = game.players[action.player - 1];
                if (!p)
                    throw new GameError('Player not in this game.');
                if (!p.joined) throw new GameError('Join this seat before changing its display.', 409);
                p.hidden = !p.hidden;
                event.message = `Player ${p.number} ${p.hidden ? 'hid' : 'revealed'} their commander.`;
            }
            else if (action.type === 'finish') {
                event.message = 'Game finished.';
                game.status = 'finished';
                game.winner = winnerOf(game.players);
                if (game.winner !== null) {
                    const p = game.players[game.winner - 1];
                    sqlite.prepare('UPDATE profiles SET wins=wins+1 WHERE name=?').run(p.name);
                    sqlite.prepare('UPDATE commanders SET wins=wins+1 WHERE name=?').run(p.commander);
                }
            }
            else if (action.type === 'restart') {
                event.message = `Game restarted for round ${game.round + 1}.`;
                game.round++;
                game.status = 'active';
                game.winner = null;
                for (const p of game.players) {
                    p.life = game.settings.starting_life_total;
                    p.poison = 0;
                    p.damage = game.players.map(() => 0);
                }
                game.planeHistory = game.settings.planechase_enabled ? [randomPlane()] : [];
                game.planeIndex = game.settings.planechase_enabled ? 0 : -1;
            }
            else if (action.type === 'plane') {
                if (!game.settings.planechase_enabled)
                    throw new GameError('Planechase is disabled.');
                event.message = action.direction === 'previous' ? 'Returned to the previous plane.' : 'Planeswalked to a new plane.';
                if (action.direction === 'previous')
                    game.planeIndex = Math.max(0, game.planeIndex - 1);
                else {
                    game.planeHistory = game.planeHistory.slice(0, game.planeIndex + 1);
                    game.planeHistory.push(randomPlane(game.planeHistory[game.planeIndex]));
                    game.planeIndex++;
                }
            }
            game.revision++;
            orm.update(tables.games).set({ state: JSON.stringify(game), revision: game.revision }).where(eq(tables.games.code, code)).run();
            orm.insert(tables.actions).values({ game: code, id: action.id, payload: JSON.stringify(action), event: JSON.stringify(event), revision: game.revision }).run();
            return game;
        }).immediate();
    }
    function saveCatalog(input: unknown): Catalog {
        const data = catalogWriteSchema.parse(input);
        return sqlite.transaction(() => {
            if (data.type === 'settings')
                orm.insert(tables.settings).values({ key: 'defaults', value: JSON.stringify(data.settings) }).onConflictDoUpdate({ target: tables.settings.key, set: { value: JSON.stringify(data.settings) } }).run();
            if (data.type === 'profile') {
                for (const name of data.commanders)
                    if (!orm.select().from(tables.commanders).where(eq(tables.commanders.name, name)).get())
                        throw new GameError('Unknown commander.');
                orm.insert(tables.profiles).values({ name: data.name, wins: 0 }).onConflictDoNothing().run();
                orm.delete(tables.profileCommanders).where(eq(tables.profileCommanders.profile, data.name)).run();
                for (const name of new Set(data.commanders))
                    orm.insert(tables.profileCommanders).values({ profile: data.name, commander: name }).run();
            }
            if (data.type === 'commander')
                orm.insert(tables.commanders).values({ name: data.name, wins: 0, metadata: JSON.stringify(data.metadata), rules: data.rules }).onConflictDoUpdate({ target: tables.commanders.name, set: { metadata: JSON.stringify(data.metadata), rules: data.rules } }).run();
            if (data.type === 'deleteProfile' || data.type === 'deleteCommander') {
                // Existing games retain their names and scores; prevent loss of win attribution.
                const games = orm.select().from(tables.games).all();
                if (games.some(row => (JSON.parse(row.state) as Game).players.some(p => data.type === 'deleteProfile' ? p.name === data.name : p.commander === data.name)))
                    throw new GameError('This profile is referenced by a saved game and cannot be deleted.', 409);
                if (data.type === 'deleteProfile') {
                    orm.delete(tables.profileCommanders).where(eq(tables.profileCommanders.profile, data.name)).run();
                    orm.delete(tables.profiles).where(eq(tables.profiles.name, data.name)).run();
                }
                else {
                    orm.delete(tables.profileCommanders).where(eq(tables.profileCommanders.commander, data.name)).run();
                    orm.delete(tables.commanders).where(eq(tables.commanders.name, data.name)).run();
                }
            }
            return catalog();
        }).immediate();
    }
    return { catalog, get, create, act, saveCatalog, log };
}
