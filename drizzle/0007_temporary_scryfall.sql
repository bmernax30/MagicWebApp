-- Scryfall responses are transient. Preserve identities and all statistics.
UPDATE commander_decks SET cards='[]',legacy_rules='',legacy_metadata=json_object('primary_name',json_extract(legacy_metadata,'$.primary_name'),'second_commander',json_object('enabled',json_extract(legacy_metadata,'$.second_commander.enabled'),'name',json_extract(legacy_metadata,'$.second_commander.name')));
