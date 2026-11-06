-- Add session-chain metadata without changing participants, scores or win totals.
UPDATE games SET state=json_set(state, '$.previousGameCode', json('null'))
WHERE json_type(state, '$.previousGameCode') IS NULL;
UPDATE games SET state=json_set(state, '$.nextGameCode', json('null'))
WHERE json_type(state, '$.nextGameCode') IS NULL;
UPDATE games SET state=json_set(state, '$.endedAt', json('null'))
WHERE json_type(state, '$.endedAt') IS NULL;
