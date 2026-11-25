import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardSearch, normalizeCard } from '../src/server/scryfall';
import { GameError } from '../src/server/game-service';
const sample = { name: 'Sol Ring', cmc: 1, mana_cost: '{1}', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.',
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/card.jpg' }, scryfall_uri: 'https://scryfall.com/card/test', set_name: 'Commander', rarity: 'uncommon', legalities: { commander: 'legal' } };

test('Scryfall client validates inputs, encodes card names, sends required headers and coalesces cached queries', async () => {
    const calls: { url: URL; options?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (url, options) => {
        calls.push({ url: new URL(String(url)), options });
        return Response.json(String(url).includes('autocomplete') ? { data: ['Sol Ring'] } : sample);
    };
    const client = createCardSearch(fetcher);
    await assert.rejects(client.lookup({ q: 's' }));
    await assert.rejects(client.lookup({ q: 'sol', extra: 'no' }));
    assert.equal(calls.length, 0);
    const result = await Promise.all([client.lookup({ q: 'Sol R' }), client.lookup({ q: 'Sol R' })]);
    assert.deepEqual(result, [{ suggestions: ['Sol Ring'] }, { suggestions: ['Sol Ring'] }]);
    assert.equal(calls.length, 1);
    await client.lookup({ q: 'Sol R' }); assert.equal(calls.length, 1);
    assert.equal(calls[0].url.searchParams.get('q'), 'Sol R');
    const headers = new Headers(calls[0].options?.headers);
    assert.match(headers.get('User-Agent')!, /MagicWebApp/); assert.equal(headers.get('Accept'), 'application/json');
    const detail = await client.lookup({ name: 'Fire // Ice & Friends' });
    assert.ok('card' in detail); assert.equal(detail.card.faces[0].manaCost, '{1}');
    assert.equal(calls[1].url.searchParams.get('exact'), 'Fire // Ice & Friends');
    assert.equal(calls[1].url.searchParams.size, 1);
});

test('double-faced and shared-image cards preserve all faces, stats and full images; untrusted URLs are dropped', () => {
    const transform = normalizeCard({ ...sample, name: 'Front // Back', image_uris: undefined, card_faces: [
        { name: 'Front', mana_cost: '{2}{U}', image_uris: sample.image_uris, power: '2', toughness: '3' },
        { name: 'Back', oracle_text: 'Back rules.', image_uris: { normal: 'https://cards.scryfall.io/normal/back/card.jpg' }, loyalty: '4', defense: '5' },
    ] });
    assert.equal(transform.faces.length, 2); assert.equal(transform.faces[1].text, 'Back rules.');
    assert.equal(transform.faces[1].loyalty, '4'); assert.equal(transform.faces[1].defense, '5');
    const split = normalizeCard({ ...sample, card_faces: [{ name: 'Left' }, { name: 'Right' }] });
    assert.equal(split.faces[0].image, sample.image_uris.normal); assert.equal(split.faces[1].image, '');
    const unsafe = normalizeCard({ ...sample, scryfall_uri: 'javascript:alert(1)', image_uris: { normal: 'https://example.com/image.jpg' } });
    assert.equal(unsafe.url, ''); assert.equal(unsafe.faces[0].image, '');
});

test('Scryfall errors are useful, failed requests do not poison the queue, and rate limits trigger shared backoff', async () => {
    let count = 0;
    const client = createCardSearch(async () => {
        count++;
        if (count === 1) throw new Error('offline');
        if (count === 2) return Response.json({}, { status: 404 });
        if (count === 3) return Response.json({ unexpected: true });
        return Response.json({}, { status: 429 });
    });
    await assert.rejects(client.lookup({ q: 'one' }), /internet connection/);
    await assert.rejects(client.lookup({ q: 'two' }), /Card not found/);
    await assert.rejects(client.lookup({ q: 'three' }), /unexpected card data/);
    await assert.rejects(client.lookup({ q: 'four' }), e => e instanceof GameError && e.status === 429);
    await assert.rejects(client.lookup({ q: 'five' }), /busy/);
    assert.equal(count, 4);
});

test('named lookups respect the documented 500ms rate limit across concurrent clients', async () => {
    const times: number[] = [];
    const client = createCardSearch(async () => { times.push(Date.now()); return Response.json(sample); });
    await Promise.all([client.lookup({ name: 'Sol Ring' }), client.lookup({ name: 'Island' }), client.lookup({ name: 'Mountain' })]);
    assert.equal(times.length, 3);
    assert.ok(times[1] - times[0] >= 490); assert.ok(times[2] - times[1] >= 490);
});
