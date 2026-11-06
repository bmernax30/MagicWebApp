"""Dependency-free checks for the checked-in SQL and copied MagicApp assets.
These do not replace the TypeScript service or HTTP tests.
"""
import json
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class SQLiteSmoke(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for migration in sorted((ROOT / 'drizzle').glob('*.sql')):
            self.db.executescript(migration.read_text())

    def tearDown(self):
        self.db.close()

    def test_schema_and_constraints(self):
        names = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertEqual(names, {'settings', 'profiles', 'commanders', 'profile_commanders', 'planes', 'games', 'actions'})
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO profiles VALUES (?, ?)', ('Invalid', -1))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO profile_commanders VALUES (?, ?)', ('Missing', 'Missing'))

    def test_idempotency_key_is_unique_per_game(self):
        for code in ['ABC234', 'DEF567']:
            self.db.execute('INSERT INTO games VALUES (?, ?, ?, ?)', (code, '{}', 0, 'now'))
            self.db.execute('INSERT INTO actions(game,id,payload,revision) VALUES (?, ?, ?, ?)', (code, 'action-1', '{}', 1))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO actions(game,id,payload,revision) VALUES (?, ?, ?, ?)', ('ABC234', 'action-1', '{}', 2))
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_import_sources_and_every_image_are_available(self):
        saved = json.loads((ROOT / 'seed-data/res/settings.json').read_text())
        planes = json.loads((ROOT / 'seed-data/res/planes/planes.json').read_text())
        self.assertEqual(len(saved['player_profiles']), 8)
        self.assertGreaterEqual(len(saved['commander_profiles']), 72)
        self.assertEqual(len(planes), 111)
        for profile in saved['commander_profiles'].values():
            for card in [profile, profile.get('second_commander', {})]:
                if card.get('image_path'):
                    self.assertIsInstance(card['image_path'], str)  # Missing/new art is reported by db:sync.
        for plane in planes:
            self.assertTrue((ROOT / 'public' / plane['image_path']).is_file(), plane['image_path'])
        self.assertTrue((ROOT / 'seed-data/res/commanders/commander_text/commander_text.txt').is_file())

if __name__ == '__main__':
    unittest.main()
