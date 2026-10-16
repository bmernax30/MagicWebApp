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
