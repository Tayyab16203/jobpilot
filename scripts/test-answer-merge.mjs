import { newerAnswerWins } from '../src/tracker.js';

let fail = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}: ${actual}`);
  if (!ok) fail++;
};

const pending = { qkey: 'aws years', pending: 1, answer: '', updated_at: '2026-10-14 18:56:37' };
const typed = { qkey: 'aws years', pending: 0, answer: '3', updated_at: '2026-10-14 22:10:00' };
check('newer typed answer replaces the pending row', newerAnswerWins(pending, typed), true);
check('stale pending row does not replace a saved answer', newerAnswerWins(typed, pending), false);
check('a new disk row is kept', newerAnswerWins(undefined, typed), true);
check('equal timestamp keeps a cleared answer over a blank pending one', newerAnswerWins(pending, { ...typed, updated_at: pending.updated_at }), true);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
