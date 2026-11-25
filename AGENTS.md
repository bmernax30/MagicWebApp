# MagicWebApp implementation guidance

- When the original checkouts are available, source behavior is in `../MagicApp/main.py` and the reference stack is in `../mulverna-budget-app`. This repository must remain independently runnable.
- Preserve user changes and the two source projects. Work in this directory.
- Keep Next.js App Router, React, TypeScript, Tailwind, Drizzle, Zod, SQLite, and the Webpack scripts unless the user authorizes a stack change.
- Before framework changes, read relevant installed `node_modules/next/dist/docs/` guides if present; otherwise use official documentation.
- UI and HTTP writes must use the shared validated game service. Keep database modules server-only.
- Maintain atomic deltas, unique action IDs, current-round validation, and revision checks on destructive actions. Never accept full client score snapshots.
- Add a SQL migration for schema changes; never edit applied migrations. The initial migrations use a custom hash journal, not Drizzle Kit metadata.
- Keep databases, sidecars, local environment settings, backups and node_modules out of Git. Tests must use temporary databases.
- Default to loopback. LAN commands are an explicit trusted-playgroup option requested for this app; public hosting requires a reviewed access model.
- Run lint, tests, production build, and the shared HTTP proof when dependencies are available. Report blocked checks honestly.
- Do not commit or publish without user authorization.

## GitHub issue workflow

- Read the requested `MAGIC-###` issue and its comments; clarify missing requirements when needed.
- Work on `development/MAGIC-###` based on the latest appropriate main branch.
- Implement, validate, and launch an isolated preview for user testing. Wait for user confirmation before committing or pushing.
- After confirmation, increment the patch (last) version number once per completed issue. When the patch would reach 10, increment the minor (middle) number and reset patch to 0: `1.0.8 -> 1.0.9 -> 1.1.0`. Keep the major number unchanged unless requested.
- Keep `package.json`, the root package entries in `package-lock.json`, and the README's current version aligned. The UI reads the package version automatically.
- Commit and push the approved issue to its development branch. The user reviews and merges; do not merge it yourself.

## Commander history invariants

- Player profiles have no commander assignments. Store setup names/Oracle IDs and statistics locally, but never persist Scryfall card responses (text, artwork URLs, faces or other details). Fetch details on demand with bounded temporary memory caches; do not recreate `profile_commanders` or a manual commander editor.
- Count one appearance per joined seat only at Finish, for its final setup. Pair order does not split identity; pair wins do not increment individual-card totals. Hidden setups count normally.
- Keep appearance rows, player win credit, Finish/log updates and successor creation in the same immediate transaction; Exit/Restart/reconnection must not add statistics.
- Preserve legacy data in frozen Season 0 results. Current statistics must use only Finish appearances assigned to the active season, without inferred floors. Exact-name alias merges must keep old IDs usable and all counts intact. Only apply explicitly approved spelling corrections; retain unresolved metadata as fallback.
- Migration 0006 invokes the one-time history bootstrap inside its SQL migration transaction. Never rerun bootstrap over already reconciled data or run old builds against the new schema. Preview/test only on isolated database copies; rollback requires both the old database and old build.

- Commander artwork comes only from Scryfall. Do not recommit retired local commander images; ignored runtime copies may remain solely for old builds until deployment. Keep plane and emote assets.

## Season invariants

- Migration 0008 invokes `initializeSeasons` inside its transaction; fresh imports invoke it after legacy history bootstrap. Archive totals once before resetting counters, and never rerun the reset over an initialized season.
- Keep raw games/actions and historical appearances. Record the current season ID at Finish in the same transaction as win credit, log and successor creation.
- Frozen season results must not change during play, seed synchronization, or commander alias merges. Seed counters must never restore pre-season wins into active statistics.
- Previous commander choices remain selectable across seasons, but their displayed counts are current-season counts. Limit commander leaderboards to 10; award ties use wins then fewer commander plays, with any remaining ties shared.
