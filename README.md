# MagicWebApp

Current version: **0.2.0**.

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
- A unique six-character code identifies each saved game. Join by code, or use `/game/CODE?view=select`; choose an open seat, a saved player profile, and a commander from that profile. Commander games require a commander; Standard permits none. Seat assignment is atomic: the first join succeeds and another simultaneous join receives a conflict. Filled seats reopen their existing controls.
- Main and compact scoreboards show each joined player’s total profile wins and the selected commander’s total wins. Totals refresh when a game is finished or restarted, including changes made from another device.
- Shared scoreboard, compact scoreboard, and `/game/CODE?view=1` through `?view=6` individual phone controllers. All views use the same saved state; each phone chooses its own display mode.
- Click/tap controls for life, poison, and commander damage, including damage from your own commander. Taps accumulate a separate signed pending change; Apply commits the batch as one event, and Cancel discards the draft. The displayed total changes only after Apply. Game hotkeys are removed. Names and profile content can still be entered in normal web forms.
- Life and counters stop at zero. Commander damage also changes life; correcting damage restores the corresponding life. 21 damage from one opponent, 10 poison, or zero life eliminates a player. Exactly one surviving joined player is the winner once at least two players have joined. Empty seats do not count as opponents. Scores remain editable until Finish.
- Finish records a sole survivor’s player and commander win once and locks the scores. Finishing with no sole survivor records no win. Exit game closes an active session for all devices, returns the initiating browser to the lobby, and adds no player or commander wins, even if there is a pending winner. An exited session cannot be joined, scored, finished, or restarted. Its state is retained for consistency/audit, not added to leaderboards. Restart keeps the game code and seat assignments, creates a new round, and resets all scores and plane history. Restart does not finish an unfinished round or award its pending win.
- Phone controls list every other joined player’s commander. Tap “View commander info” to expand artwork, rules, power/toughness, colors, mana costs, and partner information inline while keeping your own seat and controls. Hidden commanders remain hidden. The scoreboard uses the same details view.
- A Game log screen shows the latest event first, timestamps, and earlier events. Undo walks backward through applied counter changes in the current round and restores both life and commander damage atomically. Undo requires the reviewed revision, so concurrent changes cause a refresh conflict rather than overwriting newer state. Finished/exited games and previous rounds are locked. Pre-migration requests remain readable but cannot be undone because they have no before/after snapshots.
- Commander visibility toggle, commander rules/stats, profile/commander leaderboards, player profile management, commander/partner metadata editing, and bundled art.
- Shared random Planechase plane and previous-plane history, preserving the original “new random branch after going back” behavior. Consecutive planes do not repeat. Card effects are descriptive and are applied manually, as in MagicApp.

## Use real phones

The app defaults to port **6001** for development, production, and the shared HTTP proof. Port 6000 is avoided because it is on the [browser restricted-port list](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/port_util.cc) as an X11 service port. The normal `dev` and `start` commands bind to loopback. To intentionally allow devices on your trusted local network:

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
5. Finish the game; every device should show finished and refuse edits. Restart from the scoreboard; every device should reset with the same seat assignments. Old requests from the prior round are rejected.
6. In an active round, choose Exit game and confirm. The initiating browser returns to the lobby; other devices show Session ended. No wins are added, and the old code cannot accept joins or score changes.

There is also an automated HTTP proof that creates a separate test game, joins its seats using the first two saved profiles, sends **20 concurrent mutations**, reads the result independently twice, verifies both players have 30 life, checks duplicate-action protection, then applies self-commander damage and undoes it through the game log:

```bash
npm run test:shared
# Optional when using another port:
MAGIC_TEST_URL=http://127.0.0.1:6002 npm run test:shared
```

This command writes one game into the selected running server. It prints the game code and URLs for visual inspection. It sends the browser Origin header on writes, so it also checks that a real browser-facing address can create and update a game. It is an HTTP integration check; the physical-phone check remains a separate step.

## Merge later seed changes

`db:import` still initializes an empty database only. To reconcile later edits to `seed-data/res/settings.json` with an existing web database:

```bash
npm run db:sync
```

Every sync first makes an online SQLite backup under `data/backups/`. It compares the new seed with a persisted prior seed. It adds new catalog records, applies source association additions/removals, and preserves web-only profiles, commanders, links, rules, and saved games. Metadata changes apply when the live field still matches the old seed; conflicting live edits win and are reported. Seed win-count differences are added to the live count, preserving wins earned through the web app. The baseline advances in the same transaction, so repeating a sync does not add the wins twice. Deleted source entities remain in the database for game history. It does not import plane/rules-file changes; this command reconciles settings.json.

On an older database without a baseline, explicitly supply the previously imported seed using `npm run db:sync -- --baseline previous-settings.json`. Never use the edited new seed as that initial baseline. New imports automatically store their baseline. The November seed reconciliation has already been applied to the working database: 20 commander profiles and 24 associations added, one source-removed association removed, seven metadata records updated, no live conflicts, and all 11 saved games preserved unchanged. The user’s seed file was not rewritten.

The current [missing-image inventory](reports/missing-commander-images.md) lists 23 commander profiles without artwork plus the paired Iron Man partner image. Re-running sync refreshes this inventory.

## Data and architecture

The initial `seed-data/res` snapshot copies the Python app’s settings, 8 player profiles, 92 commander profiles, profile associations, win totals, commander rules, second-commander data, and 111 planes. Asset files are copied into `public/res`. Missing commander metadata referenced by a player gets an empty profile, matching MagicApp’s backfill behavior. `db:import` is transactional, runs only on an empty database, and becomes a no-op after success. It never resets web changes or writes to MagicApp. To import a later source snapshot, design an explicit reconciliation migration rather than rerunning over live data.

Persistence tables: `settings`, `profiles`, `commanders`, `profile_commanders`, `planes`, `games`, `actions`. Commander metadata preserves Python’s nested mana/color/partner structure as JSON; game state preserves players, life, poison, the directed commander-damage matrix, winner, round, and plane history as JSON. Profile links and catalogs are relational. Win counts are separate SQL integers. Game rows have a monotonically increasing revision, and action IDs are unique within each game. Migration `0002_game_log.sql` adds action event snapshots and undo markers. New events store exact before/after counters, actual applied deltas after clamping, timestamps, and human-readable messages. Undo keeps the original entry and writes a compensating event in the same transaction as restoring the scores.

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
npm run test:shared  # requires a separately running server
python3 tests/sqlite_smoke.py
```

Tests use temporary databases, not the configured live database. The test runner uses in-process isolation so restricted environments execute every test without launching child processes. Coverage includes import fidelity, SQLite constraints, independent-client persistence, duplicate actions, score rules, winner recording, restart conflicts, input validation, game isolation, Planechase, and catalog writes. Route tests call the actual handlers with independent web Request/Response objects, including 20 concurrent changes, same-origin checks, input errors, and conflict responses. They do not open a socket or replace the live HTTP proof.

**Verification in the implementation environment:** Dependencies and the lockfile are installed using Node 24.19.0 and npm 11.16.0. ESLint passed with no warnings, all 34 Node tests passed, TypeScript checking passed, and the production build passed with `MAGIC_RESTRICTED_BUILD=1`. Three Python SQLite/schema/asset tests passed. Migration and initial import succeeded for the default `data/magic.sqlite` database. The concurrent route test preserved every delta, returned identical scores to independent clients, and ignored a duplicate action. The project owner has confirmed phone access on the Linux server. The live HTTP proof also passed against an isolated production server: 20 concurrent changes, identical client reads, duplicate-action protection, self-commander damage, log messages, and undo. The temporary server used a separate database and was stopped after verification. The new pending-change and log screens still need a phone check.

`MAGIC_RESTRICTED_BUILD=1` selects Next’s TypeScript compiler API and worker threads, runs Webpack in the main process, and uses two page workers. It keeps type checking enabled. The default build configuration remains unchanged for ordinary environments that allow child processes.

## Baseline limits and next work

This baseline passes automated rules, persistence, route-contract, lint, type, and production-build checks. Phone connectivity, seat selection, game exit, and commander information have been verified by the project owner. Image uploads, per-seat/host authentication, QR codes, in-game roster changes, retained game browsing, and deployment are future work. Profile names are identifiers: entering a new name creates a new profile instead of renaming historical records. Deleting profiles referenced by saved games is refused to preserve win attribution; library edits are shared across all games. Damage is tracked per opponent seat as in MagicApp, including partner decks. A future rules change could track each partner independently. The original Tkinter animation/debounce delays are replaced by explicit Apply / Cancel batches. Counter values have a web safety cap of 999,999. Polling provides shared-state synchronization; sockets can replace it later if needed.
