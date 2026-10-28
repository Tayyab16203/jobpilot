import assert from 'node:assert/strict';
import { STRATEGIES, applyNotes } from '../src/strategies.js';

const ids = new Set(STRATEGIES.map(s => s.id));
assert.ok(ids.has('x-link') && ids.has('ig-comments') && ids.has('ig-bio') && ids.has('ig-dm') && ids.has('li-easy'));
const platforms = new Set(STRATEGIES.map(s => s.platform));
assert.ok(platforms.has('X') && platforms.has('Instagram') && platforms.has('LinkedIn'));

const merged = applyNotes(STRATEGIES, { 'ig-comments': { verdict: 'wrong', note: 'skip comments' } });
const comments = merged.find(s => s.id === 'ig-comments');
assert.equal(comments.blocked, true);
assert.equal(comments.human.note, 'skip comments');
assert.equal(merged.find(s => s.id === 'x-link').blocked, false);
assert.equal(merged.find(s => s.id === 'x-link').human, null);
console.log('ok', STRATEGIES.length);
