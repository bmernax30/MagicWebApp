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

// Advance a server-time sample with elapsed browser time, never the phone's wall clock.
export type ServerClock = { serverTime: number; receivedAt: number };
export function serverNow(clock: ServerClock, monotonicNow: number): number {
    return clock.serverTime + Math.max(0, monotonicNow - clock.receivedAt);
}
export function emoteCooldownSeconds(sentAt: number | undefined, now: number | null): number {
    if (sentAt === undefined || !Number.isFinite(sentAt)) return 0;
    if (now === null || !Number.isFinite(now)) return EMOTE_COOLDOWN_MS / 1000;
    return Math.ceil(Math.min(EMOTE_COOLDOWN_MS, Math.max(0, sentAt + EMOTE_COOLDOWN_MS - now)) / 1000);
}
