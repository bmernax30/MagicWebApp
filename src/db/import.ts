import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
// This import is a one-time copy. It never writes to MagicApp or resets web data.
export function importMagic(db: Database.Database, source: string) {
    const saved = JSON.parse(fs.readFileSync(path.join(source, 'settings.json'), 'utf8'));
    const planes = JSON.parse(fs.readFileSync(path.join(source, 'planes/planes.json'), 'utf8')) as {
        name: string;
        image_path: string;
        planes_text: string;
    }[];
    const text = fs.readFileSync(path.join(source, 'commanders/commander_text/commander_text.txt'), 'utf8');
    const rules: Record<string, string> = {};
    let current = '';
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('[') && line.endsWith(']')) {
            current = line.slice(1, -1).trim();
            rules[current] = '';
        }
        else if (current)
            rules[current] += line + '\n';
    }
    return db.transaction(() => {
        if (db.prepare("SELECT 1 FROM settings WHERE key='imported'").get())
            return false;
        if ((db.prepare('SELECT (SELECT count(*) FROM profiles)+(SELECT count(*) FROM commanders)+(SELECT count(*) FROM games)+(SELECT count(*) FROM settings)+(SELECT count(*) FROM planes) AS n').get() as {
            n: number;
        }).n)
            throw new Error('Import requires an empty database.');
        const empty = { primary_name: '', image_path: '', attack_power: 0, defense_power: 0, colors: [], color_cost: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, second_commander: { enabled: false, name: '', image_path: '', attack_power: 0, defense_power: 0, colors: [], color_cost: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } } };
        const names = new Set<string>(Object.keys(saved.commander_profiles));
        for (const list of Object.values(saved.player_profiles) as string[][])
            for (const name of list)
                names.add(name);
        for (const name of names) {
            const { total_wins = 0, ...metadata } = saved.commander_profiles[name] ?? { ...empty, primary_name: name };
            db.prepare('INSERT INTO commanders VALUES (?,?,?,?)').run(name, total_wins, JSON.stringify(metadata), (rules[name] ?? rules[metadata.primary_name] ?? '').trim());
        }
        for (const [name, list] of Object.entries(saved.player_profiles) as [
            string,
            string[]
        ][]) {
            db.prepare('INSERT INTO profiles VALUES (?,?)').run(name, saved.player_profile_wins[name] ?? 0);
            for (const commander of new Set(list))
                db.prepare('INSERT INTO profile_commanders VALUES (?,?)').run(name, commander);
        }
        for (const p of planes)
            db.prepare('INSERT INTO planes VALUES (?,?,?)').run(p.name, p.image_path, p.planes_text);
        db.prepare('INSERT INTO settings VALUES (?,?)').run('defaults', JSON.stringify(saved.settings));
        // Preserve selection metadata without coupling game state to the legacy UI.
        for (const key of ['last_profile_name', 'last_commander_profile_name'])
            if (saved[key] !== undefined)
                db.prepare('INSERT INTO settings VALUES (?,?)').run(key, JSON.stringify(saved[key]));
        db.prepare('INSERT INTO settings VALUES (?,?)').run('imported', JSON.stringify({ at: new Date().toISOString(), source: 'MagicApp' }));
        return true;
    }).immediate();
}
