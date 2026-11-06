// Add future choices here; validation and both displays share this catalog.
export const EMOTES = [
    { id: 'threat', label: 'Threat', image: '/res/emotes/threat.png' },
    { id: 'salt', label: 'Salt', image: '/res/emotes/salt.png' },
    { id: 'nice', label: 'Nice', image: '/res/emotes/nice.png' },
    { id: 'in-response', label: 'In response', image: '/res/emotes/in-response.png' },
] as const;
export type EmoteKind = typeof EMOTES[number]['id'];
export const EMOTE_COOLDOWN_MS = 5000;
export const EMOTE_DURATION_MS = 6000;
export type GameEmote = { id: string; sender: number; senderName: string; target: number; kind: EmoteKind; sentAt: number; expiresAt: number };
