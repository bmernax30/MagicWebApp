-- Preserve saved sessions and scores while initializing bounded emote state.
UPDATE games SET state=json_set(state, '$.emotes', json('[]'))
WHERE json_type(state, '$.emotes') IS NULL;
