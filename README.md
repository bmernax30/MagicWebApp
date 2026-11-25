# MagicWebApp

Current version: **1.0.4**.

A shared Magic: The Gathering game table for a Linux server and your playgroup’s phones. Create a table, share its game code, and let each player choose a seat and keep score. The main scoreboard stays synchronized across devices.

Adapted from the MagicApp Python application using the Mulverna Budget web stack: Next.js App Router, React, TypeScript, Tailwind CSS, Drizzle, Zod, and SQLite through better-sqlite3. Webpack is retained from the reference stack. This repository includes the application, migrations, initial catalog data, and artwork; the original projects are not required to install or run it.

## Install and run

Install **Node.js 22 or 24 and npm**, clone the repository, and install:

```bash
git clone https://github.com/bmernax30/MagicWebApp.git
cd MagicWebApp
npm ci
cp .env.example .env.local
npm run db:migrate
npm run db:import
npm run dev
```

Open `http://127.0.0.1:6001`. Do not overwrite an existing `.env.local`. `MAGIC_DATABASE_PATH` selects a local `.sqlite`, `.sqlite3`, or `.db` file, defaulting to `data/magic.sqlite`. CLI scripts load the same environment files as Next. A database is never created, migrated, or imported by browsing or building the application.

The native SQLite dependency may require Python 3, make, and a C++ compiler if its prebuilt binary is unavailable. No Google Fonts download is required. The npm lockfile is included; use `npm ci` for reproducible installs. Dependency versions follow the reference project.

## Start, restart, and stop

The `magicapp` command is installed on the current server. For a fresh checkout, install it as your normal user (without sudo):

```bash
bash scripts/install-magicapp.sh
export PATH="$HOME/.local/bin:$PATH"
```

From any directory:

```bash
magicapp start
magicapp restart
magicapp stop
magicapp status
magicapp logs
```

The command manages a user-level systemd service on port 6001. Start is safe to repeat. Restart and stop affect only this project; an unrelated application on that port is refused. `magicapp restart` also safely hands over an existing terminal-launched instance of this project. On this server, use that once to move the currently running app into the background service. It uses the existing production build; it does not rebuild or change database contents. `logs` follows the journal; Ctrl+C leaves the app running.

The service retries after a crash and sends output to the user journal. User lingering is enabled on this server so it keeps running after logout. On another server, the installer tries to enable lingering for your own account; if administrative authentication is needed it prints the one-time `sudo loginctl enable-linger USERNAME` command. Starting at boot is optional: `systemctl --user enable magicapp.service`. Stopping the app does not stop Caddy or the LAN hostname publisher.

The launcher lives at `~/.local/bin/magicapp`, the service at `~/.config/systemd/user/magicapp.service`, and command locks at `~/.local/state/magicapp/`. The lifecycle integration check is `bash tests/magicapp-control.sh`; it requires a working user service manager and uses a separate test project/port without linking your data directory.

## Update an existing running server

Stop the managed app before migrating or rebuilding (use Ctrl+C instead if it is still terminal-launched), then run:

```bash
magicapp stop
npm run db:migrate
npm run build
magicapp start
```

Refresh the website on every phone after restarting. Migration `0001_seat_sessions.sql` marks older, already-assigned players as joined and preserves their names, scores, and wins. New tables start with empty seats. The migration is safe to rerun through `db:migrate`.

## What is implemented

- Create a Commander or Standard table with 2–6 empty seats, 1–999 starting life, optional Planechase, and saved default settings. Profile and commander selection happens when joining, not when creating the table.
- A unique six-character code identifies each saved game. Join by code, or use `/game/CODE?view=select`; choose an open seat, a saved player profile, and a Scryfall commander setup or one from that player’s recorded history. Commander games require a commander; Standard permits none. Seat assignment is atomic: the first join succeeds and another simultaneous join receives a conflict. Filled seats offer **Take over seat**: confirm the existing setup to reopen controls without resetting or reassigning anything.
- Main and compact scoreboards show each joined player’s total profile wins and the selected commander setup’s wins and plays. Totals refresh when a game is finished or restarted, including changes made from another device.
- Shared scoreboard, compact scoreboard, and `/game/CODE?view=1` through `?view=6` individual phone controllers. All views use the same saved state; each phone chooses its own display mode.
- Click/tap controls for life, poison, and commander damage, including damage from your own commander. Taps accumulate a separate signed pending change; Apply commits the batch as one event, and Cancel discards the draft. The displayed total changes only after Apply. Game hotkeys are removed. Names and profile content can still be entered in normal web forms.
- Life and counters stop at zero. Commander damage also changes life; correcting damage restores the corresponding life. 21 commander damage from one player (including your own commander), 10 poison, or zero life eliminates a player. Exactly one surviving joined player is the winner once at least two players have joined. Empty seats do not count as opponents. Scores remain editable until Finish.
- Finish permanently records one appearance for each joined seat’s final commander setup and awards a sole survivor’s player/setup win once. Hidden setups count normally. Two players using the same setup add two plays. It atomically creates a new session with a fresh code, the same profiles, seat numbers, commanders and settings, and reset life/poison/damage/Planechase. Every connected view follows to that session while keeping its player number or display mode. Finishing without a sole survivor records no win but still creates the next session. Repeated or competing finish requests cannot create additional sessions or wins. Old session scores and logs stay locked.
- Exit game disconnects all normal views and sends every browser/phone to the main screen with a session-ended notice. It records no wins and does not create a successor session. Closed codes cannot accept joins or score changes. A browser that was offline follows the transition when it reconnects.
- Players can expand Change commander on their phone and choose Scryfall cards or a previously used setup, with an optional partner/background and hide checkbox. The selection is validated and logged; life, poison, recorded damage, and seat identity are preserved; visibility follows the selection’s hide checkbox. Apply or cancel any pending score change first. The selected commander at Finish receives commander win credit. Restart resets the current active round without awarding a win or creating a new session.
- Phone controls list every other joined player’s commander. Tap the commander name to expand artwork, rules, power/toughness, colors, mana costs, and partner information inline while keeping your own seat and controls. Hidden commanders remain hidden. The scoreboard uses the same details view.
- A Game log screen shows the latest event first, timestamps, and earlier events. A new session links to the previous saved session in read-only archive mode (`?view=log&archive=1`); its final scores and logs can be inspected without reconnecting as an active player. Undo walks backward through applied counter changes in the current round and restores both life and commander damage atomically. Undo requires the reviewed revision, so concurrent changes cause a refresh conflict rather than overwriting newer state. Finished/exited games and previous rounds are locked. Pre-migration requests remain readable but cannot be undone because they have no before/after snapshots.
- Reveal commander button, Scryfall-backed rules/stats/artwork, player/setup leaderboards, player profile management and commander history. Commander assignments and the manual commander-profile editor are retired.
- Shared random Planechase plane and previous-plane history, preserving the original “new random branch after going back” behavior. Consecutive planes do not repeat. Card effects are descriptive and are applied manually, as in MagicApp.

## Use real phones

The app defaults to port **6001** for development and production. The shared HTTP proof requires an explicitly selected isolated server. Port 6000 is avoided because it is on the [browser restricted-port list](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/port_util.cc) as an X11 service port. The normal `dev` and `start` commands bind to loopback. To intentionally allow devices on your trusted local network:

```bash
npm run dev:lan
# Or, after a successful production build:
npm run start:lan
```

Open **the server computer’s reachable LAN address** on every device, for example `http://192.168.1.50:6001`. Create the game from that address so Copy link produces a phone-accessible link. `localhost` on a phone points to the phone, not the server. Use the same Wi-Fi network and allow the app port through the host firewall. This repository does not change firewall or forwarding configuration.

Anyone who can reach this baseline server can create games and edit the shared profile library. A game code provides convenient discovery, not an account or authorization boundary. Joining fills an open seat without allowing another join to overwrite it. This is not per-device authentication: any trusted participant can reopen a filled seat’s controls. Commander hiding is a visual feature. Use on a trusted network; do not expose this baseline directly to the public internet. Run one Next.js service against one persistent SQLite volume; ephemeral/serverless storage will not preserve games.

## Friendly LAN address

The server-specific configuration for **http://mernamagicapp.local** is in [deploy/lan](deploy/lan/README.md). Install it with `sudo bash scripts/setup-lan-name.sh` from the project directory. It adds an Avahi mDNS alias and a Caddy HTTP proxy to the app on port 6001. This requires administrative authentication on the Linux server; the configuration files are prepared but not installed by the agent. See the deployment notes for network requirements, backups, and verification.

## Prove shared scoring

After setup and with the server running, open three independent browsers/devices:

1. Create a game and leave the first browser on Scoreboard.
2. Join the code on two phones; choose different open seats and select each player’s saved profile and commander. Check that the scoreboard shows those selections.
3. Tap life controls on both phones. All three views should match within approximately one second. Change poison or commander damage and switch scoreboard modes; the same totals remain visible.
4. Reload a phone and restart the server. The saved game should retain its code and scores.
5. Finish the game; every device should move to the same new code, retain its seat/view, and show reset totals. Use Change commander on a phone and verify the main scoreboard updates. View the previous saved session from Game log and confirm its final scores remain unchanged.
6. In the new active session, choose Exit game and confirm. Every device should return to the main screen and show a disconnection notice. No wins are added, and the old code cannot accept joins or score changes.

There is also an automated HTTP proof that creates a separate test game, joins its seats using the first two saved profiles, sends **20 concurrent mutations**, reads the result independently twice, verifies both players have 30 life, checks duplicate-action protection, then verifies self-commander damage, undo, commander switching, idempotent Finish, automatic successor metadata and carried-over seats, and Exit. It finishes without a winner so no actual profile wins are awarded:

```bash
# Run against a separately started server with an isolated database:
MAGIC_TEST_URL=http://127.0.0.1:3023 npm run test:shared
```

This command writes test sessions and play-history rows into the selected running server. Never target production: Finish records plays even when no wins are awarded. It prints the game code and URLs for visual inspection. It sends the browser Origin header on writes, so it also checks that a real browser-facing address can create and update a game. It is an HTTP integration check; the physical-phone check remains a separate step.

## Merge later seed changes

`db:import` still initializes an empty database only. To reconcile later edits to `seed-data/res/settings.json` with an existing web database:

```bash
npm run db:sync
```

Every sync first makes an online SQLite backup under `data/backups/`. It compares the new seed with a persisted prior seed. It adds legacy catalog records and players, ignores retired assignment lists, and preserves web-only Scryfall setups, history and saved games. Metadata changes apply when the live field still matches the old seed; conflicting live edits win and are reported. Seed win-count differences are added to the live count, preserving wins earned through the web app. The baseline advances in the same transaction, so repeating a sync does not add the wins twice. Deleted source entities remain in the database for game history. It does not import plane/rules-file changes; this command reconciles settings.json.

On an older database without a baseline, explicitly supply the previously imported seed using `npm run db:sync -- --baseline previous-settings.json`. Never use the edited new seed as that initial baseline. New imports automatically store their baseline. The November seed reconciliation has already been applied to the working database: 20 commander profiles and 24 associations added, one source-removed association removed, seven metadata records updated, no live conflicts, and all 11 saved games preserved unchanged. The user’s seed file was not rewritten.

The [old artwork inventory](reports/missing-commander-images.md) is retired. Local commander artwork is removed from version control. Legacy image-path strings remain only in archived source evidence and are never used by the new UI. Card details are fetched on demand and are never saved to SQLite.

## Data and architecture

The initial `seed-data/res` snapshot preserves the Python settings, 8 player profiles, original commander records/associations as migration evidence, win totals, commander rules, second-card metadata and 111 planes. Commander artwork now comes exclusively from Scryfall; plane and emote assets remain bundled. Missing commander metadata referenced by a player gets an empty profile, matching MagicApp’s backfill behavior. `db:import` is transactional, runs only on an empty database, and becomes a no-op after success. It never resets web changes or writes to MagicApp. To import a later source snapshot, design an explicit reconciliation migration rather than rerunning over live data.

Persistence tables: `settings`, `profiles`, `commander_decks`, `commander_aliases`, `game_appearances`, `planes`, `games`, `actions`, plus the read-only `legacy_commanders` archive. Migration `0006_commander_history.sql` removes `profile_commanders`, renames the original commander table for provenance, and runs the history bootstrap in the same transaction before the migration journal advances. The original Python metadata remains in the legacy archive; active setups keep only identity fields in the compatibility JSON columns; game state preserves players, life, poison, the directed commander-damage matrix, winner, round, and plane history as JSON. Commander assignments no longer exist. Player wins and unattributed legacy floors remain SQL integers; commander and per-player/setup totals combine those floors with immutable appearance rows. Game rows have a monotonically increasing revision, and action IDs are unique within each game. Migration `0002_game_log.sql` adds action event snapshots and undo markers. Migration `0003_session_links.sql` adds nullable session-link and ending-time fields to existing JSON game states without changing their participants, scores, revisions, or wins. Linked sessions are separate rows in `games`; finishing, win credit, successor creation and both session log records commit together. New events store exact before/after counters, actual applied deltas after clamping, timestamps, and human-readable messages. Undo keeps the original entry and writes a compensating event in the same transaction as restoring the scores.

Route handlers call one validated domain service. Drizzle owns repository operations; better-sqlite3 provides immediate transactions, foreign keys, a busy timeout, and WAL. The service reads the latest state and applies deltas inside the write transaction; it never accepts a replacement scoreboard from a client. Duplicate IDs cannot apply twice. Restart/finish/exit/undo require the reviewed revision, and every action must match the current round. Score and win writes commit together. JSON route writes compare Origin with the incoming Host and request protocol, so LAN/localhost addresses work even when Next constructs an internal URL from its bind address. Arbitrary forwarded-host headers are not trusted. Clients poll at 750 ms, reject older responses, disable controls while disconnected or submitting, and never silently retry a mutation whose response was lost. After a network error, inspect the latest score before tapping again.

SQL migrations are checked in under `drizzle/`; `db:migrate` applies each in filename order and verifies hashes of applied files. This baseline uses reviewed SQL migrations, not Drizzle Kit’s generated migration journal. For schema changes, update `src/db/schema.ts` and add a new SQL migration; never edit an applied migration. `drizzle.config.ts` is supplied for future tooling adoption, but do not run a first Drizzle generation against this database without establishing its baseline snapshot. SQLite files and environment files are ignored. Stop the service before copying its database for a backup, or use SQLite’s online backup API; copying an active WAL database file alone is insufficient.

Framework API references: [Next.js 16 async route parameters](https://nextjs.org/docs/app/guides/upgrading/version-16), [Drizzle SQLite driver](https://orm.drizzle.team/docs/get-started/sqlite-new), and [Drizzle upserts](https://orm.drizzle.team/docs/guides/upsert).

## Verification

```bash
npm run lint
npm test
npm run build
# In a sandbox that blocks child processes:
MAGIC_RESTRICTED_BUILD=1 npm run build
MAGIC_TEST_URL=http://127.0.0.1:3023 npm run test:shared  # isolated database/server
python3 tests/sqlite_smoke.py
```

Tests use temporary databases, not the configured live database. The test runner uses in-process isolation so restricted environments execute every test without launching child processes. Coverage includes import fidelity, SQLite constraints, independent-client persistence, duplicate actions, score rules, winner recording, restart conflicts, input validation, game isolation, Planechase, and catalog writes. Route tests call the actual handlers with independent web Request/Response objects, including 20 concurrent changes, same-origin checks, input errors, and conflict responses. They do not open a socket or replace the live HTTP proof.

**Verification in the implementation environment:** Dependencies and the lockfile are installed using Node 24.19.0 and npm 11.16.0. ESLint passed with no warnings, all 66 Node tests passed, TypeScript checking passed, and the production build passed with `MAGIC_RESTRICTED_BUILD=1`. Three Python SQLite/schema/asset tests passed. Migration and initial import succeeded for the default `data/magic.sqlite` database. The concurrent route test preserved every delta, returned identical scores to independent clients, and ignored a duplicate action. The project owner has confirmed phone access on the Linux server. The live HTTP proof also passed against an isolated production server: 20 concurrent changes, identical client reads, duplicate-action protection, self-commander damage, log messages, undo, commander changes, shared emotes and server-enforced cooldowns, exactly one successor session, carried-over players, and shared exit. The temporary server used a separate database and was stopped after verification. The new session-transition and commander-switching screens still need a phone check.

`MAGIC_RESTRICTED_BUILD=1` selects Next’s TypeScript compiler API and worker threads, runs Webpack in the main process, and uses two page workers. It keeps type checking enabled. The default build configuration remains unchanged for ordinary environments that allow child processes.

## Baseline limits and next work

This baseline passes automated rules, persistence, route-contract, lint, type, and production-build checks. Phone connectivity, seat selection, game exit, and commander information have been verified by the project owner. Image uploads, per-seat/host authentication, QR codes, in-game player-profile reassignment, a full saved-game index, and public deployment are future work. Profile names are identifiers: entering a new name creates a new profile instead of renaming historical records. Deleting profiles referenced by saved games is refused to preserve win attribution; library edits are shared across all games. Damage is tracked per opponent seat as in MagicApp, including partner decks. A future rules change could track each partner independently. The original Tkinter animation/debounce delays are replaced by explicit Apply / Cancel batches. Counter values have a web safety cap of 999,999. Polling provides shared-state synchronization; sockets can replace it later if needed.

## Table emotes

Player controls include an **Emote** button under every joined player’s life total. Choose Threat, Salt, Nice, or In response to show a six-second sticker with the sender’s name on that player’s scoreboard card. The server enforces one send per seat every five seconds across devices. Emotes are reusable and do not change scores. Preview artwork at `/emotes.html`; see [emote configuration and artwork prompts](docs/emotes.md) to add more choices. Migration `0004_emotes.sql` initializes existing sessions while preserving scores.

## Leaving and removing players

Occupied scoreboard cards have a **Kick player** button; player controls have **Leave game**. Both require confirmation and open the seat without ending the session or awarding wins. Connected controls for the removed occupant return to the lobby. The remaining players retain life and poison; commander damage to/from the vacated seat is cleared, and its next occupant starts at the configured life total with no poison or damage. Removal is logged. Undo cannot cross a roster change.

Migration `0005_seat_versions.sql` backfills occupant generations without changing saved identities or counters. Seat generations reject stale score requests after reassignment, including stale commander-damage sources. Refresh all devices after deploying this update. This remains a trusted playgroup app: kicking opens a seat and does not ban a person from rejoining.

## Card lookup (MAGIC-001)

The lobby and scoreboard include **Search Magic cards**. Type at least two characters and select a suggested English card name to inspect its full image, mana cost/value, type, Oracle text, stats, face details, flavor text, set, artist, format legality and Scryfall link. Lookup is local to your browser and never changes profiles or game scores. The server needs internet access; full card images load from Scryfall’s image host. Errors leave the game controls usable.

The read-only `/api/cards?q=...` and `/api/cards?name=...` endpoints validate names and use Scryfall’s [autocomplete](https://scryfall.com/docs/api/cards/autocomplete) and [exact-name](https://scryfall.com/docs/api/cards/named) APIs. Requests include application headers, an eight-second timeout, bounded/coalesced queues and a 100-entry in-memory cache with 15-minute expiry. Outbound calls are serialized with at least 100 ms between requests and 500 ms between exact-name requests, following the current [rate limits](https://scryfall.com/docs/api/rate-limits). A 429 pauses outbound traffic for at least 30 seconds. No API key or database migration is needed. Cached results clear when the server restarts.

## Lobby navigation (MAGIC-002)

The main screen has four tabs: **Game Creation**, **Player Profile**, **Leaderboard**, and **Card Search**. MAGIC-004 retired the Commander Profile editor. Create and Join remain together under Game Creation. Player profiles show read-only commander history instead of assignments; switching sections preserves unsaved drafts and card-search results. The tab bar wraps on phones and supports Left/Right arrows, Home and End. Game scoreboard navigation is unchanged.

## Reconnecting to a seat (MAGIC-003)

On any phone, enter the existing game code under Game Creation, choose your occupied seat, then confirm **Take over seat**. The confirmation shows the current profile, commander visibility, life, poison and commander-damage totals. There are no profile or commander selectors in takeover. The same saved setup, scores, round, seat generation and log remain; reconnection sends no join/reset action and awards no wins. Existing commander-change controls remain available as a separate deliberate action after reconnection.

An open seat still uses the normal join form. If a seat is kicked, vacated or reassigned while its takeover confirmation is open, the stale confirmation cannot open the replacement occupant’s controls. A saved direct player-view URL also continues to reopen that seat. Multiple trusted devices can control the same seat; takeover does not disconnect the previous phone or introduce authentication. Review builds remain uncommitted until approved, at which point the issue version increments.

## Scoring controls (MAGIC-005)

The player controller has Life and Poison tabs. In Commander games, choose **Commander** beside a player’s **Emote** button to receive damage from that player’s commander, including your own. The view moves to the counter and names the source commander; use the existing +/- buttons and the compact **Apply / Cancel** panel. Applying commander damage still adjusts life and creates the usual undoable game-log entry. Emote cooldowns do not block commander selection. Apply or cancel a draft before selecting another counter or commander. A vacated or reassigned source seat must be selected again instead of silently changing the damage source.

The player summary and commander-info list use names without seat numbers. The controller no longer includes a hide-commander link or damage-source dropdown. **Leave game** is a full-width red button at the bottom of the player view, with the existing confirmation. Standard games show no Commander buttons. Saved commander-visibility flags remain unchanged.

## Scryfall commander setups and history (MAGIC-004)

Player profiles contain names and recorded history, not assigned/allowed commander lists. History is ranked by wins, then plays, with names breaking ties. Commander names are links that expand on-demand card information. When joining or changing commanders, select a previously completed setup or search Scryfall, select a search result, optionally add a partner/background, then press **Join seat** (or **Save commander** during play). Any card and pairing is allowed for house rules. SQLite stores only setup identity (names and Oracle IDs), aliases, and statistics. Full card data is fetched on demand for the active table or commander-info screen and retained only in bounded process/browser memory for up to 15 minutes. Restarting the server clears its cache. Images still require access to Scryfall’s image host. The same two cards in reverse order share one statistical setup; Scryfall Oracle IDs keep alternate printings/names from splitting their totals. Name-based legacy keys remain valid aliases after exact resolution. Two faces of a single card remain one selected card.

Check **Hide my commander** during selection to hide the entire setup on shared displays. Your own controls retain its name; **Reveal commander** makes it visible during play. Hidden setups count toward wins and plays even if never revealed. Hiding is a display feature in the existing trusted-group model, not per-device data secrecy.

**Counting:** each joined seat at Finish adds one player appearance for its final setup, including eliminated players. A sole survivor receives one player win and one setup win. Registration, joining, reconnection, changing commanders, Exit and Restart add no statistics. Mid-game changes do not credit earlier setups. Departed/kicked seats that are open at Finish do not add appearances. Draws count plays without wins. Finish, all appearance rows, win credit, logs and successor creation commit together. Duplicate/retried/competing Finish requests cannot add more rows.

**Legacy reconciliation:** saved final sessions and recoverable earlier Finish events are replayed into appearance rows. Confirmed historical wins are subtracted from legacy win floors before totals are calculated, preventing double counting. Unknown legacy wins remain unassigned to players/setups where attribution is unsupported, and provide a minimum played count rather than invented losses. Player totals are preserved; personal setup histories show only recovered or newly finished appearances. A ≥/“at least” indicator marks totals containing inferred legacy play floors. The original catalog remains read-only evidence in `legacy_commanders`; its assignment table is removed. Saved game JSON and revisions are not rewritten by bootstrap.

User-approved legacy spelling corrections are in `src/lib/legacy-commander-names.ts`. The three named placeholders are removed from active commander data; recorded player appearances using them remain as unknown-commander appearances, not deleted games. Exact Scryfall resolution can merge punctuation/face-name aliases without losing counts. Original Python metadata is retained only as migration evidence; unavailable Scryfall details show a retryable error while scoring and local statistics remain usable; fuzzy matching is never used to silently reassign historical statistics.

### Migrating an existing installation

Test on an online SQLite backup first. The schema change is incompatible with older builds: a rollback must restore **both** the previous database backup and application build. Stop production before changing its schema; do not run the old build against the new schema. After approval/merge and a backup of the configured database:

```bash
magicapp stop
npm run db:migrate
npm run build
magicapp start
```

`db:migrate` performs no network calls. Migration 0007 clears any previously stored Scryfall payloads without altering setup IDs, aliases, games or statistics. New empty installations use `db:migrate` and `db:import`. Never run `db:import` over existing history. Refresh all browsers after deployment.

Validation covers historical rounds, placeholder removal, approved aliases, pair identity and pair-only credit, hidden finishes/reveal, final-setup attribution, draw/Exit/Restart rules, idempotent Finish, migration preservation and transactional rollback. All review migration and HTTP checks use isolated databases; the running production schema is unchanged until deployment.

Retired commander artwork may remain as ignored local files on an upgraded host while the old production build still needs it. It is not shipped by fresh checkouts and is not used by the new commander UI. Do not delete those runtime copies until the old app is stopped and the Scryfall-backed build is deployed. Planechase and emote images are unaffected.
