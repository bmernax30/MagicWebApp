import type { ServerClock } from '@/lib/emotes';

export async function api<T>(url: string, data?: unknown, signal?: AbortSignal, onClock?: (clock: ServerClock) => void): Promise<T> {
    const response = await fetch(url, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? undefined : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store', signal });
    const time = response.headers.get('X-Server-Time');
    const serverTime = time === null ? NaN : Number(time);
    if (Number.isFinite(serverTime) && serverTime > 0) onClock?.({ serverTime, receivedAt: performance.now() });
    const value = await response.json();
    if (!response.ok)
        throw new Error(value.error ?? 'Request failed.');
    return value as T;
}
export function actionId() {
    // randomUUID is unavailable on plain-HTTP phone LAN origins; getRandomValues is supported.
    if (typeof crypto.randomUUID === 'function')
        return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, n => n.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
