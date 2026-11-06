ALTER TABLE actions ADD COLUMN event TEXT;
ALTER TABLE actions ADD COLUMN undone_by TEXT;
CREATE INDEX actions_game_revision ON actions(game, revision);
