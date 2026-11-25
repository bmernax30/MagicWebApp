-- Retain the original catalog as read-only migration evidence; remove assignments.
ALTER TABLE commanders RENAME TO legacy_commanders;
DROP TABLE profile_commanders;
CREATE TABLE commander_decks (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, cards TEXT NOT NULL DEFAULT '[]',
 legacy_metadata TEXT NOT NULL, legacy_rules TEXT NOT NULL DEFAULT '',
 baseline_wins INTEGER NOT NULL DEFAULT 0 CHECK(baseline_wins>=0),
 baseline_plays INTEGER NOT NULL DEFAULT 0 CHECK(baseline_plays>=baseline_wins)
);
CREATE TABLE commander_aliases (name TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES commander_decks(id));
CREATE TABLE game_appearances (
 game TEXT NOT NULL REFERENCES games(code), round INTEGER NOT NULL, seat INTEGER NOT NULL,
 profile TEXT NOT NULL REFERENCES profiles(name), deck_id TEXT REFERENCES commander_decks(id),
 won INTEGER NOT NULL CHECK(won IN (0,1)), finished_at TEXT, source TEXT NOT NULL,
 PRIMARY KEY(game,round,seat)
);
CREATE INDEX appearances_profile_deck ON game_appearances(profile,deck_id);
CREATE INDEX appearances_deck ON game_appearances(deck_id);
