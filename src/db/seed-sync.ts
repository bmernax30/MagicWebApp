import 'server-only';
import { isLegacyPlaceholder } from '../lib/legacy-commander-names';
import { importLegacyCommander,legacyDisplayMetadata } from './commander-history';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { completeCommanderMetadata } from '../lib/commander-defaults';
import type { CommanderMetadata } from '../lib/types';
import { isDeepStrictEqual } from 'node:util';

type Seed = {
    settings: Record<string, unknown>;
    player_profiles: Record<string, string[]>;
    player_profile_wins: Record<string, number>;
    commander_profiles: Record<string, Record<string, unknown>>;
};
const mana = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
function commanders(seed: Seed) {
    const result = structuredClone(seed.commander_profiles);
    for (const names of Object.values(seed.player_profiles)) for (const name of names) {
        result[name] ??= { primary_name: name, image_path: '', attack_power: 0, defense_power: 0, colors: [], color_cost: mana,
            second_commander: { enabled: false, name: '', image_path: '', attack_power: 0, defense_power: 0, colors: [], color_cost: mana }, total_wins: 0 };
    }
    for (const [name, value] of Object.entries(result)) {
        const { total_wins = 0, ...metadata } = value;
        result[name] = { ...completeCommanderMetadata(metadata as Partial<CommanderMetadata>), total_wins };
    }
    return result;
}
export function readSeed(filename: string): Seed {
    const seed = JSON.parse(fs.readFileSync(filename, 'utf8')) as Seed;
    if (!seed.settings || !seed.player_profiles || !seed.commander_profiles || !seed.player_profile_wins) throw new Error('Invalid settings seed.');
    for (const wins of [...Object.values(seed.player_profile_wins), ...Object.values(seed.commander_profiles).map(c => c.total_wins ?? 0)]) {
        if (!Number.isSafeInteger(wins) || Number(wins) < 0) throw new Error('Seed wins must be nonnegative integers.');
    }
    for (const list of Object.values(seed.player_profiles)) if (!Array.isArray(list) || list.some(n => typeof n !== 'string' || !n.trim())) throw new Error('Invalid profile commander list.');
    return seed;
}
export function syncSeed(db: Database.Database, next: Seed, initialBaseline?: Seed) {
    return db.transaction(() => {
        const saved = db.prepare("SELECT value FROM settings WHERE key='seed_sync_baseline'").get() as { value: string } | undefined;
        const baseline = saved ? JSON.parse(saved.value) as Seed : initialBaseline;
        if (!baseline) throw new Error('First sync requires the previously imported seed as --baseline. No data changed.');
        const report = { addedProfiles: [] as string[], addedCommanders: [] as string[], addedLinks: 0, removedLinks: 0, metadataUpdates: 0, winDelta: 0, conflicts: [] as string[] };
        function merge(current: unknown, old: unknown, incoming: unknown, label: string): unknown {
            if (isDeepStrictEqual(incoming, old)) return current;
            if (isDeepStrictEqual(current, old) || current === undefined) return incoming;
            if (current && incoming && old && typeof current === 'object' && typeof incoming === 'object' && typeof old === 'object' && !Array.isArray(current) && !Array.isArray(incoming)) {
                const result = { ...current } as Record<string, unknown>;
                for (const [key, value] of Object.entries(incoming)) result[key] = merge(result[key], (old as Record<string, unknown>)[key], value, `${label}.${key}`);
                return result;
            }
            if (!isDeepStrictEqual(current, incoming)) report.conflicts.push(label);
            return current;
        }
        const oldCommanders = commanders(baseline), newCommanders = commanders(next);
        for (const [name, value] of Object.entries(newCommanders)) {
            if(isLegacyPlaceholder(name)||isLegacyPlaceholder(String(value.primary_name??'')))continue;
            const { total_wins = 0, ...metadata } = value;
            const { total_wins: oldWins = 0, ...oldMetadata } = oldCommanders[name] ?? {};
            const row = db.prepare('SELECT metadata,wins FROM legacy_commanders WHERE name=?').get(name) as { metadata: string; wins: number } | undefined;
            if (!row) {
                db.prepare('INSERT INTO legacy_commanders(name,wins,metadata,rules) VALUES (?,?,?,?)').run(name, total_wins, JSON.stringify(metadata), '');
                importLegacyCommander(db,{name,wins:Number(total_wins),metadata:JSON.stringify(metadata),rules:''});
                report.addedCommanders.push(name);
            } else {
                const merged = merge(JSON.parse(row.metadata), oldMetadata, metadata, name);
                const delta = Number(total_wins) - Number(oldWins);
                const wins = row.wins + delta;
                if (!Number.isSafeInteger(wins) || wins < 0) throw new Error(`Unsafe win adjustment for ${name}; no data changed.`);
                if (!isDeepStrictEqual(merged, JSON.parse(row.metadata))) report.metadataUpdates++;
                db.prepare('UPDATE legacy_commanders SET metadata=?, wins=? WHERE name=?').run(JSON.stringify(merged), wins, name);
                const alias=db.prepare('SELECT deck_id FROM commander_aliases WHERE name=?').get(name) as {deck_id:string};
                const deck=db.prepare('SELECT baseline_wins,cards FROM commander_decks WHERE id=?').get(alias.deck_id) as {baseline_wins:number;cards:string};
                if(deck.baseline_wins+delta<0)throw new Error(`Unsafe win adjustment for ${name}; recorded history cannot be erased.`);
                db.prepare('UPDATE commander_decks SET baseline_wins=baseline_wins+?,baseline_plays=baseline_plays+? WHERE id=?').run(delta,delta,alias.deck_id);
                if(JSON.parse(deck.cards).length===0)db.prepare('UPDATE commander_decks SET legacy_metadata=? WHERE id=?').run(JSON.stringify(legacyDisplayMetadata(merged as Partial<CommanderMetadata>)),alias.deck_id);
                report.winDelta += delta;
            }
        }
        for (const [name, list] of Object.entries(next.player_profiles)) {
            const row = db.prepare('SELECT wins FROM profiles WHERE name=?').get(name) as { wins: number } | undefined;
            const wins = next.player_profile_wins[name] ?? 0, oldWins = baseline.player_profile_wins[name] ?? 0;
            if (!row) { db.prepare('INSERT INTO profiles VALUES (?,?)').run(name, wins); report.addedProfiles.push(name); }
            else {
                const updated = row.wins + wins - oldWins;
                if (!Number.isSafeInteger(updated) || updated < Number((db.prepare('SELECT COALESCE(SUM(won),0) AS n FROM game_appearances WHERE profile=?').get(name) as {n:number}).n)) throw new Error(`Unsafe win adjustment for ${name}; no data changed.`);
                db.prepare('UPDATE profiles SET wins=? WHERE name=?').run(updated, name);
                report.winDelta += wins - oldWins;
            }
            // Legacy assignment lists are no longer permissions or history.
            void list;
        }
        const defaults = db.prepare("SELECT value FROM settings WHERE key='defaults'").get() as { value: string };
        db.prepare("UPDATE settings SET value=? WHERE key='defaults'").run(JSON.stringify(merge(JSON.parse(defaults.value), baseline.settings, next.settings, 'settings')));
        // No profile/commander deletion, rules overwrite, or game mutation is performed.
        db.prepare("INSERT INTO settings(key,value) VALUES ('seed_sync_baseline',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
        return report;
    }).immediate();
}
