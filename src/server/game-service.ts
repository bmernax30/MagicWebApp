import 'server-only';
import { temporaryCommander,commanderPresentation } from './temporary-commanders';
import { EMOTE_COOLDOWN_MS, EMOTE_DURATION_MS, EMOTES } from '../lib/emotes';
import { isLegacyPlaceholder } from '../lib/legacy-commander-names';
import { completeCommanderMetadata } from '../lib/commander-defaults';
import { randomInt, randomUUID } from 'node:crypto';
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
        const season=orm.select().from(tables.seasons).all().find(s=>s.endDate===null);
        if(!season||!sqlite.prepare("SELECT 1 FROM settings WHERE key='seasons_initialized'").get())throw new GameError('Season data is not initialized. Run migrations and import.',503);
        const commanders=sqlite.prepare(`SELECT d.*,COALESCE(SUM(a.won),0) AS wins,COUNT(a.game) AS plays
            FROM commander_decks d LEFT JOIN game_appearances a ON a.deck_id=d.id AND a.season_id=? GROUP BY d.id ORDER BY d.name`).all(season.id) as {id:string;name:string;legacy_metadata:string;wins:number;plays:number}[];
        const profileRows=orm.select().from(tables.profiles).orderBy(asc(tables.profiles.name)).all();
        const seasonResults=orm.select().from(tables.seasons).all().filter(s=>s.endDate!==null).sort((a,b)=>b.id-a.id).map(s=>({...s,
            players:sqlite.prepare('SELECT name,wins,plays FROM season_player_results WHERE season_id=? ORDER BY wins DESC,plays ASC,name').all(s.id),
            commanders:sqlite.prepare('SELECT commander_id AS commanderId,name,wins,plays FROM season_commander_results WHERE season_id=? ORDER BY wins DESC,plays ASC,name').all(s.id),
        })) as Catalog['seasonResults'];
        return {
            season,seasonResults,
            settings:JSON.parse(defaults.value) as Settings,
            profiles:profileRows.map(p=>{
                // Retain previous choices, showing only this season's counts.
                const history=sqlite.prepare(`SELECT d.id AS deckId,d.name,
                    SUM(CASE WHEN a.season_id=? THEN 1 ELSE 0 END) AS plays,
                    SUM(CASE WHEN a.season_id=? THEN a.won ELSE 0 END) AS wins,MAX(a.finished_at) AS lastPlayed
                    FROM game_appearances a JOIN commander_decks d ON d.id=a.deck_id WHERE a.profile=? GROUP BY d.id ORDER BY wins DESC,plays DESC,d.name`).all(season.id,season.id,p.name) as Catalog['profiles'][number]['history'];
                const totals=sqlite.prepare('SELECT COUNT(*) AS plays,COALESCE(SUM(won),0) AS wins FROM game_appearances WHERE profile=? AND season_id=?').get(p.name,season.id) as {plays:number;wins:number};
                return {...p,...totals,history};
            }),
            commanders:commanders.map(c=>({id:c.id,name:c.name,...commanderPresentation([completeCommanderMetadata(JSON.parse(c.legacy_metadata)).primary_name,...(completeCommanderMetadata(JSON.parse(c.legacy_metadata)).second_commander.enabled?[completeCommanderMetadata(JSON.parse(c.legacy_metadata)).second_commander.name]:[])],temporaryCommander(c.id)),wins:c.wins,plays:c.plays} as Commander)),
            planes: orm.select().from(tables.planes).orderBy(asc(tables.planes.name)).all(),
        };
    }
    function selectedDeck(value:string, required:boolean) {
        if(!value&&!required)return null;
        const row=sqlite.prepare('SELECT id,name FROM commander_decks WHERE id=? OR name=? OR id=(SELECT deck_id FROM commander_aliases WHERE name=?)').get(value,value,value) as {id:string;name:string}|undefined;
        if(!row)throw new GameError('Choose a commander setup from Scryfall or your recorded history.');
        return row;
    }
    function get(code: string): Game {
        if (!/^[A-Z2-9]{6}$/.test(code))
            throw new GameError('Game not found.', 404);
        const row = orm.select().from(tables.games).where(eq(tables.games.code, code)).get();
        if (!row)
            throw new GameError('Game not found. Check the six-character code.', 404);
        const game = { ...JSON.parse(row.state), revision: row.revision } as Game;
        // Older saved games already had their players assigned at creation.
        game.players = game.players.map(p => {
            const deck=sqlite.prepare('SELECT id,name FROM commander_decks WHERE id=? UNION ALL SELECT d.id,d.name FROM commander_aliases a JOIN commander_decks d ON d.id=a.deck_id WHERE a.name=? LIMIT 1').get(p.deckId??'',p.deckId??p.commander) as {id:string;name:string}|undefined;
            return {...p,commander:isLegacyPlaceholder(p.commander)?'':deck?.name??p.commander,joined:p.joined??true,seatVersion:p.seatVersion??0,deckId:deck?.id??null};
        });
        game.previousGameCode ??= null;
        game.nextGameCode ??= null;
        game.endedAt ??= null;
        game.emotes ??= [];
        return game;
    }
    function randomPlane(current?: string) {
        const list = orm.select({ name: tables.planes.name }).from(tables.planes).all();
        if (!list.length)
            throw new GameError('No planes have been imported.');
        const choices = list.filter(p => p.name !== current);
        return (choices.length ? choices : list)[randomInt(choices.length || list.length)].name;
    }
    function insertSession(settings: Settings, previous?: Game): Game {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code: string;
        do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
        while (orm.select().from(tables.games).where(eq(tables.games.code, code)).get());
        const seats = previous?.players ?? Array.from({ length: settings.number_of_players }, (_, i) => ({ number: i + 1, joined: false, seatVersion: 0, name: `Seat ${i + 1}`, commander: '', deckId: null, hidden: false }));
        const game: Game = {
            code, revision: 0, round: 1, status: 'active', emotes: [], settings: structuredClone(settings),
            previousGameCode: previous?.code ?? null, nextGameCode: null, endedAt: null,
            players: seats.map(p => ({ ...p, life: settings.starting_life_total, poison: 0, damage: seats.map(() => 0) })),
            winner: null, planeHistory: settings.planechase_enabled ? [randomPlane()] : [],
            planeIndex: settings.planechase_enabled ? 0 : -1, createdAt: new Date().toISOString(),
        };
        orm.insert(tables.games).values({ code, state: JSON.stringify(game), revision: 0, createdAt: game.createdAt }).run();
        if (previous) {
            const event: StoredGameEvent = { type: 'session-start', round: 1, at: game.createdAt, message: `New session started with players from ${previous.code}.` };
            orm.insert(tables.actions).values({ game: code, id: randomUUID(), payload: JSON.stringify({ type: 'session-start', round: 1 }), event: JSON.stringify(event), revision: 0 }).run();
        }
        return game;
    }
    function create(input: unknown): Game {
        const data = createGameSchema.parse(input);
        return sqlite.transaction(() => { catalog(); return insertSession(data.settings); }).immediate();
    }
    type ActionRow = { id: string; revision: number; payload: string; event: string | null; undone_by: string | null };
    const snapshot = (p: Game['players'][number]): CounterSnapshot => ({ life: p.life, poison: p.poison, damage: [...p.damage] });
    const signed = (n: number) => n >= 0 ? `+${n}` : String(n);
    function undoable(game: Game): ActionRow | undefined {
        const barrier = sqlite.prepare("SELECT MAX(revision) AS revision FROM actions WHERE game=? AND json_extract(payload,'$.type') IN ('join','kick','leave')").get(game.code) as { revision: number | null };
        return (sqlite.prepare('SELECT * FROM actions WHERE game=? AND revision > ? AND event IS NOT NULL AND undone_by IS NULL ORDER BY revision DESC').all(game.code, barrier.revision ?? -1) as ActionRow[])
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
            if (action.type === 'restart' || action.type === 'finish' || action.type === 'exit' || action.type === 'undo' || action.type === 'change-commander' || action.type === 'kick' || action.type === 'leave') {
                if (action.revision !== game.revision)
                    throw new GameError('Scores changed. Review the latest scores and try again.', 409);
            }
            if (game.status === 'exited')
                throw new GameError('This game session has ended. Create a new game to play again.', 409);
            if (game.status === 'finished')
                throw new GameError('This game has finished.', 409);
            if ('player' in action) {
                const seat = game.players[action.player - 1];
                if (seat && (action.seatVersion ?? 0) !== (seat.seatVersion ?? 0))
                    throw new GameError('This seat changed occupants. Reopen player controls.', 409);
            }
            if (action.type === 'counter' && action.counter === 'commander' && action.source) {
                const source = game.players[action.source - 1];
                if (source && (action.sourceVersion ?? 0) !== (source.seatVersion ?? 0))
                    throw new GameError('The source seat changed occupants. Review commander damage.', 409);
            }
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
                const deck=selectedDeck(action.commander,game.settings.game_type==='Commander');
                p.name = action.name;
                p.commander = deck?.name ?? '';
                p.deckId = deck?.id ?? null;
                p.hidden = deck ? action.hidden ?? false : false;
                p.joined = true;
                game.winner = winnerOf(game.players);
                event.message = `Player ${p.number} joined as ${p.name}.`;
            }
            else if (action.type === 'kick' || action.type === 'leave') {
                const p = game.players[action.player - 1];
                if (!p?.joined) throw new GameError('This seat is already open.', 409);
                event.message = `${p.name} (player ${p.number}) ${action.type === 'kick' ? 'was kicked from' : 'left'} the game. Seat ${p.number} is open.`;
                Object.assign(p, { joined: false, seatVersion: (p.seatVersion ?? 0) + 1,
                    name: `Seat ${p.number}`, commander: '', deckId: null, hidden: false,
                    life: game.settings.starting_life_total, poison: 0, damage: game.players.map(() => 0) });
                for (const other of game.players) other.damage[p.number - 1] = 0;
                game.emotes = game.emotes.filter(e => e.sender !== p.number && e.target !== p.number);
                game.winner = winnerOf(game.players);
            }
            else if (action.type === 'emote') {
                const sender = game.players[action.player - 1];
                const target = game.players[action.target - 1];
                if (!sender?.joined || !target?.joined) throw new GameError('Emotes require joined sender and target seats.');
                const now = Date.now();
                const latest = game.emotes.find(e => e.sender === sender.number);
                if (latest && now - latest.sentAt < EMOTE_COOLDOWN_MS)
                    throw new GameError('Wait five seconds between emotes.', 429);
                // Keep at most one record per sender: bounded storage and shared cooldown across devices.
                game.emotes = game.emotes.filter(e => e.sender !== sender.number);
                game.emotes.push({ id: action.id, sender: sender.number, senderName: sender.name,
                    target: target.number, kind: action.emote, sentAt: now, expiresAt: now + EMOTE_DURATION_MS });
                event.message = `${sender.name} (player ${sender.number}) sent ${EMOTES.find(e => e.id === action.emote)!.label} to ${target.name} (player ${target.number}).`;
            }
            else if (action.type === 'change-commander') {
                const p = game.players[action.player - 1];
                if (!p?.joined) throw new GameError('Choose a joined player before changing commanders.');
                const deck=selectedDeck(action.commander,game.settings.game_type==='Commander');
                const old = p.commander;
                p.commander = deck?.name ?? '';
                p.deckId = deck?.id ?? null;
                p.hidden = deck ? action.hidden ?? p.hidden : false;
                event.message = p.hidden ? `Player ${p.number} changed their hidden commander.` : `Player ${p.number} changed commander from ${old || 'none'} to ${p.commander || 'none'}. Scores unchanged.`;
            }
            else if (action.type === 'exit') {
                event.message = 'Game session exited without recording a win.';
                game.status = 'exited';
                game.endedAt = event.at;
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
            else if (action.type === 'visibility' || action.type === 'reveal') {
                const p = game.players[action.player - 1];
                if (!p)
                    throw new GameError('Player not in this game.');
                if (!p.joined) throw new GameError('Join this seat before changing its display.', 409);
                p.hidden = action.type === 'reveal' ? false : !p.hidden;
                event.message = `Player ${p.number} ${p.hidden ? 'hid' : 'revealed'} their commander.`;
            }
            else if (action.type === 'finish') {
                event.message = 'Game finished.';
                game.status = 'finished';
                game.endedAt = event.at;
                game.winner = winnerOf(game.players);
                if (game.winner !== null) {
                    const p = game.players[game.winner - 1];
                    sqlite.prepare('UPDATE profiles SET wins=wins+1 WHERE name=?').run(p.name);

                }
                const season=sqlite.prepare('SELECT id FROM seasons WHERE end_date IS NULL').get() as {id:number};
                for(const p of game.players.filter(p=>p.joined))sqlite.prepare('INSERT INTO game_appearances(game,round,seat,profile,deck_id,won,finished_at,source,season_id) VALUES (?,?,?,?,?,?,?,?,?)').run(game.code,game.round,p.number,p.name,p.deckId??null,game.winner===p.number?1:0,event.at,'live',season.id);
                const next = insertSession(game.settings, game);
                game.nextGameCode = next.code;
                event.message = `Game finished${game.winner ? `; player ${game.winner} won` : ' without a winner'}. Next session: ${next.code}.`;
            }
            else if (action.type === 'restart') {
                event.message = `Game restarted for round ${game.round + 1}.`;
                game.emotes = game.emotes.map(e => ({ ...e, expiresAt: 0 }));
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
            if (data.type === 'profile') orm.insert(tables.profiles).values({name:data.name,wins:0}).onConflictDoNothing().run();
            if (data.type === 'deleteProfile') {
                if(sqlite.prepare('SELECT 1 FROM game_appearances WHERE profile=? LIMIT 1').get(data.name) || orm.select().from(tables.games).all().some(row=>(JSON.parse(row.state) as Game).players.some(p=>p.name===data.name)))
                    throw new GameError('This profile is referenced by saved history and cannot be deleted.',409);
                orm.delete(tables.profiles).where(eq(tables.profiles.name,data.name)).run();
            }
            return catalog();
        }).immediate();
    }
    return { catalog, get, create, act, saveCatalog, log };
}
