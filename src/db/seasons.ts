import 'server-only';
import type Database from 'better-sqlite3';

// Invoked within the migration/import transaction. Old totals are frozen once;
// only Finish appearances in the current season contribute to new statistics.
export function initializeSeasons(db:Database.Database) {
    if(db.prepare("SELECT 1 FROM settings WHERE key='seasons_initialized'").get())return;
    if(!db.prepare('SELECT 1 FROM profiles LIMIT 1').get())return; // empty installation: defer until import
    db.prepare(`INSERT INTO season_player_results(season_id,name,wins,plays)
        SELECT 0,p.name,p.wins,MAX(0,p.wins-COALESCE(SUM(a.won),0))+COUNT(a.game)
        FROM profiles p LEFT JOIN game_appearances a ON a.profile=p.name GROUP BY p.name`).run();
    db.prepare(`INSERT INTO season_commander_results(season_id,commander_id,name,wins,plays)
        SELECT 0,d.id,d.name,d.baseline_wins+COALESCE(SUM(a.won),0),d.baseline_plays+COUNT(a.game)
        FROM commander_decks d LEFT JOIN game_appearances a ON a.deck_id=d.id GROUP BY d.id`).run();
    db.prepare('UPDATE profiles SET wins=0').run();
    db.prepare('UPDATE commander_decks SET baseline_wins=0,baseline_plays=0').run();
    db.prepare("INSERT INTO settings(key,value) VALUES ('seasons_initialized','true')").run();
}
