import 'server-only';
import { z } from 'zod';
import type { CardDetails } from '../lib/card-search';
import { GameError } from './game-service';
import { APP_VERSION } from '../lib/version';
const text = z.string().default('');
const face = z.object({ name: z.string(), mana_cost: text, type_line: text, oracle_text: text,
    power: text, toughness: text, loyalty: text, defense: text, flavor_text: text, artist: text,
    image_uris: z.object({ normal: z.string() }).optional() });
const card = face.extend({ scryfall_uri: z.string(), cmc: z.number(), set_name: text,
    collector_number: text, rarity: text, released_at: text,
    legalities: z.record(z.string(), z.string()).default({}), card_faces: z.array(face).optional() });
export const cardQuery = z.union([
    z.strictObject({ q: z.string().trim().min(2).max(120) }),
    z.strictObject({ name: z.string().trim().min(1).max(200) }),
]);
function safeUrl(value: string, host: string) {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
}
export function normalizeCard(input: unknown): CardDetails {
    const c = card.parse(input);
    // Split/adventure cards have one shared image; transform cards have face images.
    const faces = c.card_faces?.length ? c.card_faces : [c];
    return { name: c.name, url: safeUrl(c.scryfall_uri, 'scryfall.com'), manaValue: c.cmc,
        set: c.set_name, number: c.collector_number, rarity: c.rarity, released: c.released_at,
        legalities: c.legalities, faces: faces.map((f, i) => ({ name: f.name,
            image: safeUrl(f.image_uris?.normal ?? (i === 0 ? c.image_uris?.normal ?? '' : ''), 'cards.scryfall.io'),
            manaCost: f.mana_cost, type: f.type_line, text: f.oracle_text, power: f.power,
            toughness: f.toughness, loyalty: f.loyalty, defense: f.defense, flavor: f.flavor_text, artist: f.artist || c.artist })) };
}
export function createCardSearch(fetcher: typeof fetch = fetch) {
    const cache = new Map<string, { until: number; value: unknown }>();
    const pending = new Map<string, Promise<unknown>>();
    let queue = Promise.resolve(), lastRequest = 0, lastNamedRequest = 0;
    let backoffUntil = 0;
    async function lookup(input: unknown): Promise<{ suggestions: string[] } | { card: CardDetails }> {
        const query = cardQuery.parse(input);
        const key = JSON.stringify(query);
        const cached = cache.get(key);
        if (cached && cached.until > Date.now()) return cached.value as Awaited<ReturnType<typeof lookup>>;
        if (pending.has(key)) return pending.get(key)! as Promise<Awaited<ReturnType<typeof lookup>>>;
        if (pending.size >= 25 || Date.now() < backoffUntil) throw new GameError('Card search is busy. Please try again shortly.', 429);
        const work = queue.then(async () => {
            if (Date.now() < backoffUntil) throw new GameError('Card search is busy. Please try again shortly.', 429);
            const wait = Math.max(0, 100 - (Date.now() - lastRequest), 'name' in query ? 500 - (Date.now() - lastNamedRequest) : 0);
            if (wait) await new Promise(resolve => setTimeout(resolve, wait));
            const url = new URL('q' in query ? 'https://api.scryfall.com/cards/autocomplete' : 'https://api.scryfall.com/cards/named');
            url.searchParams.set('q' in query ? 'q' : 'exact', 'q' in query ? query.q : query.name);
            lastRequest = Date.now();
            if ('name' in query) lastNamedRequest = lastRequest;
            let response: Response;
            try { response = await fetcher(url, { headers: { 'User-Agent': `MagicWebApp/${APP_VERSION} (github.com/bmernax30/MagicWebApp)`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'error' }); }
            catch { throw new GameError('Unable to reach Scryfall. Check the server internet connection and try again.', 502); }
            if (response.status === 429) {
                const retry = Number(response.headers.get('Retry-After'));
                backoffUntil = Date.now() + Math.min(300000, Math.max(30000, (Number.isFinite(retry) ? retry : 10) * 1000));
                throw new GameError('Scryfall is busy. Please try again shortly.', 429);
            }
            if (response.status === 404) throw new GameError('Card not found. Try another name.', 404);
            if (!response.ok) throw new GameError('Scryfall is unavailable. Please try again shortly.', 502);
            let value: unknown;
            try {
                const json: unknown = await response.json();
                value = 'q' in query ? { suggestions: z.object({ data: z.array(z.string().max(200)) }).parse(json).data.slice(0, 20) } : { card: normalizeCard(json) };
            } catch { throw new GameError('Scryfall returned unexpected card data. Please try again.', 502); }
            if (cache.size >= 100) cache.delete(cache.keys().next().value!);
            cache.set(key, { until: Date.now() + 86400000, value });
            return value;
        });
        queue = work.then(() => undefined, () => undefined);
        pending.set(key, work);
        try { return await work as Awaited<ReturnType<typeof lookup>>; }
        finally { pending.delete(key); }
    }
    return { lookup };
}
export const scryfall = createCardSearch();
