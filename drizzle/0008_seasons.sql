CREATE TABLE seasons (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
 start_date TEXT, end_date TEXT
);
INSERT INTO seasons VALUES (0,'Season 0',NULL,'2026-11-25'),(1,'Season 1','2026-11-25',NULL);
CREATE UNIQUE INDEX one_current_season ON seasons((1)) WHERE end_date IS NULL;
CREATE TABLE season_player_results (
 season_id INTEGER NOT NULL REFERENCES seasons(id), name TEXT NOT NULL,
 wins INTEGER NOT NULL CHECK(wins>=0), plays INTEGER NOT NULL CHECK(plays>=wins),
 PRIMARY KEY(season_id,name)
);
CREATE TABLE season_commander_results (
 season_id INTEGER NOT NULL REFERENCES seasons(id), commander_id TEXT NOT NULL, name TEXT NOT NULL,
 wins INTEGER NOT NULL CHECK(wins>=0), plays INTEGER NOT NULL CHECK(plays>=wins),
 PRIMARY KEY(season_id,commander_id)
);
-- Rebuild rather than ALTER ADD REFERENCES with a non-NULL default: SQLite
-- rejects that alteration when upgrading a populated appearance ledger.
CREATE TABLE game_appearances_seasoned (
 game TEXT NOT NULL REFERENCES games(code), round INTEGER NOT NULL, seat INTEGER NOT NULL,
 profile TEXT NOT NULL REFERENCES profiles(name), deck_id TEXT REFERENCES commander_decks(id),
 won INTEGER NOT NULL CHECK(won IN (0,1)), finished_at TEXT, source TEXT NOT NULL,
 season_id INTEGER NOT NULL DEFAULT 0 REFERENCES seasons(id),
 PRIMARY KEY(game,round,seat)
);
INSERT INTO game_appearances_seasoned(game,round,seat,profile,deck_id,won,finished_at,source,season_id)
 SELECT game,round,seat,profile,deck_id,won,finished_at,source,0 FROM game_appearances;
DROP TABLE game_appearances;
ALTER TABLE game_appearances_seasoned RENAME TO game_appearances;
CREATE INDEX appearances_profile_deck ON game_appearances(profile,deck_id);
CREATE INDEX appearances_deck ON game_appearances(deck_id);
CREATE INDEX appearances_season_profile ON game_appearances(season_id,profile,deck_id);
CREATE INDEX appearances_season_deck ON game_appearances(season_id,deck_id);
