import 'server-only';
import type Database from 'better-sqlite3';
import { completeCommanderMetadata } from '../lib/commander-defaults';
import { commanderDeckId } from '../lib/commander-decks';
import { canonicalLegacyName,isLegacyPlaceholder,legacyPlaceholders } from '../lib/legacy-commander-names';
import type { Game, Player, CommanderMetadata } from '../lib/types';

type Legacy = { name: string; wins: number; metadata: string; rules: string };
export function legacyDisplayMetadata(input:Partial<CommanderMetadata>) {
    const meta=completeCommanderMetadata(input);
    meta.primary_name=canonicalLegacyName(meta.primary_name);
    meta.second_commander.name=canonicalLegacyName(meta.second_commander.name);
    meta.image_path='';meta.second_commander.image_path='';
    return meta;
}
export function importLegacyCommander(db: Database.Database, row: Legacy) {
    const meta = completeCommanderMetadata(JSON.parse(row.metadata));
    if(isLegacyPlaceholder(row.name)||isLegacyPlaceholder(meta.primary_name)){if(row.wins>0)throw new Error('Placeholder commander has wins; resolve its identity before migration.');return null;}
    meta.image_path='';meta.second_commander.image_path='';
    meta.primary_name=canonicalLegacyName(meta.primary_name||row.name);
    meta.second_commander.name=canonicalLegacyName(meta.second_commander.name);
    const names = [meta.primary_name || row.name, ...(meta.second_commander.enabled && meta.second_commander.name ? [meta.second_commander.name] : [])];
    const id = commanderDeckId(names);
    db.prepare(`INSERT INTO commander_decks(id,name,legacy_metadata,legacy_rules,baseline_wins,baseline_plays) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET baseline_wins=baseline_wins+excluded.baseline_wins,baseline_plays=baseline_plays+excluded.baseline_plays`).run(id,names.join(' + '),JSON.stringify(meta),row.rules,row.wins,row.wins);
    db.prepare('INSERT OR IGNORE INTO commander_aliases VALUES (?,?)').run(row.name,id);
    return id;
}
export function migrateCommanderHistory(db: Database.Database) {
    if (db.prepare("SELECT 1 FROM settings WHERE key='commander_history_v1'").get()) return;
    const legacy = db.prepare('SELECT * FROM legacy_commanders ORDER BY name').all() as Legacy[];
    if (!legacy.length && !(db.prepare('SELECT 1 FROM games LIMIT 1').get())) return; // fresh import will populate it
    const find = (name: string) => {
        if (!name || isLegacyPlaceholder(name)) return null;
        const alias = db.prepare('SELECT deck_id FROM commander_aliases WHERE name=?').get(name) as {deck_id:string}|undefined;
        return alias?.deck_id ?? importLegacyCommander(db,{name,wins:0,metadata:JSON.stringify(completeCommanderMetadata({primary_name:name})),rules:''});
    };
    for (const row of legacy) importLegacyCommander(db,row);
    const allGames = (db.prepare('SELECT code,state FROM games').all() as {code:string;state:string}[]).map(r=>JSON.parse(r.state) as Game);
    let incomplete = 0;
    for (const g of allGames) {
        const actions = (db.prepare('SELECT id,payload,event FROM actions WHERE game=? ORDER BY revision').all(g.code) as {id:string;payload:string;event:string|null}[])
            .map(r=>({id:r.id,a:JSON.parse(r.payload),e:r.event?JSON.parse(r.event):null}));
        const prior = allGames.find(p=>p.code===g.previousGameCode);
        const mutable = new Set(actions.filter(r=>['join','leave','kick'].includes(r.a.type)).map(r=>r.a.player));
        const changed = new Set(actions.filter(r=>r.a.type==='change-commander').map(r=>r.a.player));
        let seats = g.players.map(p=>({ ...p, joined: prior ? prior.players[p.number-1]?.joined ?? false : !mutable.has(p.number) && (p.joined ?? true),
            name: prior?.players[p.number-1]?.name ?? (!mutable.has(p.number)?p.name:''),
            commander: prior?.players[p.number-1]?.commander ?? (!mutable.has(p.number)&&!changed.has(p.number)?p.commander:''),
            life:g.settings.starting_life_total,poison:0,damage:g.players.map(()=>0) }));
        const record = (round:number, players:Player[], winner:number|null, at:string|null) => {
            for (const p of players.filter(p=>p.joined)) {
                if (!p.name || !db.prepare('SELECT 1 FROM profiles WHERE name=?').get(p.name)) { incomplete++; continue; }
                if (g.settings.game_type==='Commander'&&(!p.commander||isLegacyPlaceholder(p.commander))) incomplete++;
                db.prepare('INSERT OR IGNORE INTO game_appearances(game,round,seat,profile,deck_id,won,finished_at,source) VALUES (?,?,?,?,?,?,?,?)').run(g.code,round,p.number,p.name,find(p.commander),winner===p.number?1:0,at,'historical');
            }
        };
        let hadFinal = false;
        for (const {a,e} of actions) {
            const p = seats[a.player-1];
            if (a.type==='join' && p) Object.assign(p,{joined:true,name:a.name,commander:a.commander,life:g.settings.starting_life_total,poison:0,damage:seats.map(()=>0)});
            if (a.type==='change-commander' && p) p.commander=a.commander;
            if ((a.type==='leave'||a.type==='kick')&&p) { p.joined=false; for(const s of seats)s.damage[p.number-1]=0; }
            if (a.type==='counter'&&p) {
                if(e?.after) Object.assign(p,e.after);
                else if(a.counter==='commander'&&a.source) { const before=p.damage[a.source-1];p.damage[a.source-1]=Math.max(0,Math.min(999999,before+a.delta));p.life=Math.max(0,Math.min(999999,p.life-(p.damage[a.source-1]-before))); }
                else if(a.counter==='life'||a.counter==='poison')p[a.counter as 'life'|'poison']=Math.max(0,Math.min(999999,p[a.counter as 'life'|'poison']+a.delta));
            }
            if(a.type==='undo') { const target=actions.find(r=>r.id===a.eventId);if(target?.e?.before&&target.e.player)Object.assign(seats[target.e.player-1],target.e.before); }
            if(a.type==='restart')seats=seats.map(p=>({...p,life:g.settings.starting_life_total,poison:0,damage:seats.map(()=>0)}));
            if(a.type==='finish') {
                if(g.status==='finished'&&a.round===g.round) {record(g.round,g.players.map(p=>({...p,joined:p.joined??true})),g.winner,g.endedAt??e?.at??null);hadFinal=true;}
                else {
                    const match=e?.message?.match(/; player (\d+) won/);
                    const alive=seats.filter(p=>p.joined&&p.life>0&&p.poison<10&&!p.damage.some(d=>d>=21));
                    const winner=match?Number(match[1]):seats.filter(p=>p.joined).length>=2&&alive.length===1?alive[0].number:null;
                    record(a.round??1,seats,winner,e?.at??null);
                }
            }
        }
        if(g.status==='finished'&&!hadFinal)record(g.round,g.players.map(p=>({...p,joined:p.joined??true})),g.winner,g.endedAt??null);
    }
    // Existing counters already include historical wins: subtract attributed wins from
    // the legacy floor rather than adding the same wins a second time.
    db.exec(`UPDATE commander_decks SET baseline_wins=MAX(0,baseline_wins-COALESCE((SELECT SUM(won) FROM game_appearances WHERE deck_id=commander_decks.id),0));
        UPDATE commander_decks SET baseline_plays=baseline_wins;`);
    const report={legacyCommanders:legacy.length,recoveredAppearances:(db.prepare('SELECT COUNT(*) AS n FROM game_appearances').get() as {n:number}).n,incompleteAttribution:incomplete};
    db.prepare('INSERT INTO settings VALUES (?,?)').run('commander_history_v1',JSON.stringify(report));
}
export function legacyMetadata(names: string[]): CommanderMetadata {
    return completeCommanderMetadata({primary_name:names[0]??'',second_commander:{enabled:names.length>1,name:names[1]??''} as CommanderMetadata['second_commander']});
}

// Only call after exact Scryfall name resolution proves these are the same cards.
// Saved game JSON and action payloads stay untouched; old IDs remain valid aliases.
export function mergeResolvedCommander(db:Database.Database,oldId:string,newId:string) {
    if(oldId===newId)return;
    db.transaction(()=>{
        const source=db.prepare('SELECT baseline_wins,baseline_plays FROM commander_decks WHERE id=?').get(oldId) as {baseline_wins:number;baseline_plays:number}|undefined;
        if(!source)return;
        if(!db.prepare('SELECT 1 FROM commander_decks WHERE id=?').get(newId))throw new Error('Resolved commander is not cached.');
        db.prepare('UPDATE commander_decks SET baseline_wins=baseline_wins+?,baseline_plays=baseline_plays+? WHERE id=?').run(source.baseline_wins,source.baseline_plays,newId);
        db.prepare('UPDATE game_appearances SET deck_id=? WHERE deck_id=?').run(newId,oldId);
        db.prepare('UPDATE commander_aliases SET deck_id=? WHERE deck_id=?').run(newId,oldId);
        db.prepare('INSERT INTO commander_aliases(name,deck_id) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET deck_id=excluded.deck_id').run(oldId,newId);
        db.prepare('DELETE FROM commander_decks WHERE id=?').run(oldId);
    }).immediate();
}


export function removeLegacyPlaceholders(db:Database.Database) {
    db.transaction(()=>{for(const name of legacyPlaceholders){
        const row=db.prepare('SELECT id,baseline_wins FROM commander_decks WHERE id=? OR name=?').get(commanderDeckId([name]),name) as {id:string;baseline_wins:number}|undefined;
        if(!row)continue;
        const won=(db.prepare('SELECT COALESCE(SUM(won),0) AS n FROM game_appearances WHERE deck_id=?').get(row.id) as {n:number}).n;
        if(row.baseline_wins||won)throw new Error('Placeholder commander has wins; resolve its identity before removal.');
        db.prepare('UPDATE game_appearances SET deck_id=NULL WHERE deck_id=?').run(row.id);
        db.prepare('DELETE FROM commander_aliases WHERE deck_id=?').run(row.id);
        db.prepare('DELETE FROM commander_decks WHERE id=?').run(row.id);
    }}).immediate();
}
