# Emotes

Players use **Emote** directly beneath a player's life total on their phone, then choose Threat, Salt, Nice, or In response. Self-targeting is allowed. The scoreboard and compact view overlay images on the target's card in arrival order, alternating left, right, left, right (additional pairs form rows) with the sending player's name and seat for six seconds. Emotes are reusable, not four consumable charges. No life, damage, poison, or wins change.

There is one server-enforced five-second cooldown per sending seat, shared across targets, emote choices, and browsers. The trusted-playgroup seat model applies; seats are not authenticated accounts. The phone shows a countdown. Normal polling carries emotes to all devices. Expired emotes do not replay after refresh. Restart hides existing artwork but retains the cooldown; a fresh game session has fresh cooldowns.

Emotes use the validated game-action service and its transaction, action ID deduplication and round validation. Each game stores at most one latest emote per sender. A human-readable log entry records each send; score undo skips these entries. Migration `0004_emotes.sql` initializes existing game JSON without replacing scores. Emote state never carries into a successor session.

## Adding a choice

1. Put a transparent PNG into `public/res/emotes/`.
2. Add its stable ID, label and image URL to `src/lib/emotes.ts` (`EMOTES`). Validation and both interfaces use that catalog automatically.
3. Update the optional artwork preview at `public/emotes.html` and run the normal tests/build.

## Artwork and prompts

The built-in image generation tool created the project assets, saved under `public/res/emotes/`. No online images were used. All four files have transparency. The generated previews were displayed in the implementation conversation; `/emotes.html` shows the installed versions together.

Shared prompt: “Use case: stylized-concept. Asset type: tabletop game emote sticker, square, transparent background. [subject] Polished playful bold cartoon illustration, thick dark outlines, high contrast, readable at 160 pixels, centered with generous transparent margins, no watermark.”

Subjects:

- Threat: “Big bold red text THREAT, dramatic black and white outline, no other objects.”
- Salt: “A small tilted salt shaker pouring a visible stream of salt. No text.”
- Nice: “A yellow smiley face wearing black sunglasses, smiling confidently, with the exact word nice below.”
- In response: “A yellow nerd smiley face wearing black glasses, holding up one index finger, with the exact words in response below.”

The initial In response output incorrectly said “Actually...”; the final built-in edit prompt was: “Edit only the text on this nerd smiley sticker. Replace 'Actually...' completely with the exact lowercase text 'in response'. Spell exactly i n [space] r e s p o n s e. No other text. Preserve the glasses, raised index finger, smiling nerd face, cartoon style and transparent background. Fit the entire text inside the canvas.”
