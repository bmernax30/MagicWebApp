import 'server-only';
import { randomInt } from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import type { openDatabase } from '../db/client';
import * as tables from '../db/schema';
import { actionSchema, catalogWriteSchema, createGameSchema } from '../lib/validation';
import { winnerOf, type Catalog, type Game, type Commander, type Settings } from '../lib/types';
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
            commanders: orm.select().from(tables.commanders).orderBy(asc(tables.commanders.name)).all().map(c => ({ ...c, metadata: JSON.parse(c.metadata) } as Commander)),
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
            if (action.type === 'restart' || action.type === 'finish' || action.type === 'exit') {
                if (action.revision !== game.revision)
                    throw new GameError('Scores changed. Review the latest scores and try again.', 409);
            }
            if (game.status === 'exited')
                throw new GameError('This game session has ended. Create a new game to play again.', 409);
            if (game.status === 'finished' && action.type !== 'restart')
                throw new GameError('This game has finished.', 409);
            if (action.type === 'join') {
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
            }
            else if (action.type === 'exit') {
                game.status = 'exited';
                game.winner = null;
            }
            else if (action.type === 'counter') {
                const p = game.players[action.player - 1];
                if (!p)
                    throw new GameError('Player not in this game.');
                if (!p.joined) throw new GameError('Join this seat before changing scores.', 409);
                if (action.counter === 'commander') {
                    if (game.settings.game_type !== 'Commander')
                        throw new GameError('Commander damage is unavailable in Standard.');
                    if (!action.source || action.source === action.player || !game.players[action.source - 1]?.joined)
                        throw new GameError('Choose an opposing commander.');
                    const i = action.source - 1, before = p.damage[i];
                    p.damage[i] = Math.max(0, Math.min(999999, before + action.delta));
                    p.life = Math.max(0, Math.min(999999, p.life - (p.damage[i] - before)));
                }
                else
                    p[action.counter] = Math.max(0, Math.min(999999, p[action.counter] + action.delta));
                game.winner = winnerOf(game.players);
            }
            else if (action.type === 'visibility') {
                const p = game.players[action.player - 1];
                if (!p)
                    throw new GameError('Player not in this game.');
                if (!p.joined) throw new GameError('Join this seat before changing its display.', 409);
                p.hidden = !p.hidden;
            }
            else if (action.type === 'finish') {
                game.status = 'finished';
                game.winner = winnerOf(game.players);
                if (game.winner !== null) {
                    const p = game.players[game.winner - 1];
                    sqlite.prepare('UPDATE profiles SET wins=wins+1 WHERE name=?').run(p.name);
                    sqlite.prepare('UPDATE commanders SET wins=wins+1 WHERE name=?').run(p.commander);
                }
            }
            else if (action.type === 'restart') {
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
            orm.insert(tables.actions).values({ game: code, id: action.id, payload: JSON.stringify(action), revision: game.revision }).run();
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
    return { catalog, get, create, act, saveCatalog };
}
