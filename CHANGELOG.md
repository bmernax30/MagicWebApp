# Changelog

## 0.2.0 — 2026-11-06

- Reconcile updated seed settings with live data using backups, three-way metadata merging, and incremental win counts.
- Report missing commander artwork and normalize incomplete commander metadata.
- Preview pending life, poison, and commander-damage adjustments with Apply and Cancel controls.
- Support commander damage from a player's own commander.
- Add paginated game history and transactional undo of counter changes in the current round.
- Default the app and HTTP proof to port 6001.
- Add reviewed Avahi/Caddy configuration for `mernamagicapp.local`.
- Add `magicapp start`, `restart`, `stop`, `status`, and `logs`, backed by a user systemd service.
- Display the package version in the lobby and game screens.

## 0.1.0

- Initial shared web game table, profile and commander catalog, SQLite persistence, phone controllers, Planechase, seat selection, scoreboards, win totals, and commander information.
