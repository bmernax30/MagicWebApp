import test from 'node:test';
import assert from 'node:assert/strict';
import { isAlive, winnerOf, assetUrl, type Player } from '../src/lib/types';
const player = (number: number, patch: Partial<Player> = {}): Player => ({ number, joined: true, name: `P${number}`, commander: '', life: 40, poison: 0, damage: [0, 0], hidden: false, ...patch });
test('life, poison and commander lethal thresholds match MagicApp', () => {
    assert.equal(isAlive(player(1, { life: 1, poison: 9, damage: [0, 20] })), true);
    assert.equal(isAlive(player(1, { life: 0 })), false);
    assert.equal(isAlive(player(1, { poison: 10 })), false);
    assert.equal(isAlive(player(1, { damage: [0, 21] })), false);
});
test('winner requires exactly one survivor; all eliminated is a draw', () => {
    assert.equal(winnerOf([player(1), player(2)]), null);
    assert.equal(winnerOf([player(1, { poison: 10 }), player(2)]), 2);
    assert.equal(winnerOf([player(1, { life: 0 }), player(2, { life: 0 })]), null);
});
test('only bundled relative asset paths render as images', () => {
    assert.equal(assetUrl('res/commanders/test.png'), '/res/commanders/test.png');
    assert.equal(assetUrl('https://example.com/card.png'), '');
    assert.equal(assetUrl('/etc/passwd'), '');
    assert.equal(assetUrl('res/../settings.json'), '');
});

test('open seats are not opponents and a lone joined player is not yet a winner', () => {
    assert.equal(isAlive(player(1, { joined: false })), false);
    assert.equal(winnerOf([player(1), player(2, { joined: false })]), null);
    assert.equal(winnerOf([player(1), player(2, { life: 0 }), player(3, { joined: false })]), 1);
});

test('all player views leave closed sessions and preserve their seat in a successor session', async () => {
    const { sessionDestination } = await import('../src/lib/session-navigation');
    assert.equal(sessionDestination(null, '1', false), null);
    assert.equal(sessionDestination({ status: 'active', nextGameCode: null }, '1', false), null);
    for (const view of ['scoreboard', 'compact', 'select', 'log', '1', '2', '6']) {
        assert.equal(sessionDestination({ status: 'exited', nextGameCode: null }, view, false), '/?notice=game-ended');
        assert.equal(sessionDestination({ status: 'finished', nextGameCode: 'ABC234' }, view, false), `/game/ABC234?view=${view}`);
    }
    assert.equal(sessionDestination({ status: 'finished', nextGameCode: null }, '1', false), '/?notice=game-ended');
    assert.equal(sessionDestination({ status: 'finished', nextGameCode: 'ABC234' }, 'log', true), null);
});

test('emote countdown uses server time and stays within five seconds, including clock initialization and skew', async () => {
    const { serverNow, emoteCooldownSeconds } = await import('../src/lib/emotes');
    const sentAt = 1800000000000;
    const clock = { serverTime: sentAt, receivedAt: 100 };
    assert.equal(emoteCooldownSeconds(sentAt, null), 5);
    assert.equal(emoteCooldownSeconds(sentAt, 0), 5); // formerly displayed billions of seconds
    assert.equal(emoteCooldownSeconds(sentAt, sentAt - 86400000), 5);
    assert.equal(emoteCooldownSeconds(undefined, null), 0);
    for (let elapsed = 0; elapsed <= 6000; elapsed += 250) {
        assert.equal(emoteCooldownSeconds(sentAt, serverNow(clock, 100 + elapsed)), Math.ceil(Math.max(0, 5000 - elapsed) / 1000));
    }
    assert.equal(serverNow(clock, 99), sentAt);
    assert.equal(emoteCooldownSeconds(NaN, sentAt), 0);
    assert.equal(emoteCooldownSeconds(sentAt, NaN), 5);
});
