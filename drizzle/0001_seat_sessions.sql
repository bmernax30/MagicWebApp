-- Existing games have already assigned players. Preserve those seats as joined.
-- New games create explicit unjoined seats through the shared game service.
UPDATE games
SET state = json_set(state, '$.players', json((
    SELECT json_group_array(json_set(value, '$.joined', json('true')))
    FROM json_each(games.state, '$.players')
)))
WHERE EXISTS (
    SELECT 1 FROM json_each(games.state, '$.players')
    WHERE json_type(value, '$.joined') IS NULL
);
