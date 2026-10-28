import assert from 'node:assert/strict';
import { judgeLogin, LOGIN_SITES } from '../src/login-ask.js';

assert.deepEqual(judgeLogin('x', 'fail', 'fail'), { ask: true, keep: true });
assert.deepEqual(judgeLogin('instagram', 'fail', ''), { ask: false, keep: true });
assert.deepEqual(judgeLogin('linkedin', 'ok', 'fail'), { ask: false, keep: false });
assert.deepEqual(judgeLogin('gmail', 'fail', 'fail'), { ask: true, keep: true });
assert.equal(judgeLogin('indeed', 'fail', '').ask, false);
assert.equal(LOGIN_SITES.glassdoor[2], 'normal');
console.log('ok', Object.keys(LOGIN_SITES).length);
