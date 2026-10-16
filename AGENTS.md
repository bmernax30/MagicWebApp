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
