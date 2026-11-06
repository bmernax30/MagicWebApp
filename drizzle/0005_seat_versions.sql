-- Add occupant generations without replacing identities or counters.
UPDATE games SET state=json_set(state, '$.players', json((
    SELECT json_group_array(json_set(value, '$.seatVersion', COALESCE(json_extract(value, '$.seatVersion'), 0)))
    FROM json_each(games.state, '$.players')
))) WHERE EXISTS (
    SELECT 1 FROM json_each(games.state, '$.players') WHERE json_type(value, '$.seatVersion') IS NULL
);
