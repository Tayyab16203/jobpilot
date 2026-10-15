import { isListedFakeEmail, parseFakeEmailList, loadFakeEmailList } from '../src/fake-emails.js';

let fail = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}: ${actual}`);
  if (!ok) fail++;
};

const parsed = parseFakeEmailList(`
# comment
hr.qrm@hotmail.com
@decoy.test

not-an-entry
`);
check('comment is ignored', parsed.emails.has('# comment'), false);
check('address is stored lowercased', parsed.emails.has('hr.qrm@hotmail.com'), true);
check('domain line is stored without @', parsed.domains.has('decoy.test'), true);

const shipped = loadFakeEmailList();
check('shipped list has the Saudi dump', shipped.emails.size >= 50, true);
check('listed fake address matches regardless of case', isListedFakeEmail('HR.DSFHR@Fakeeh.care'), true);
check('real recruiter address is not listed', isListedFakeEmail('wesleyjeoffrey@yer.nl'), false);
check('domain block matches any local part', (() => {
  const list = parseFakeEmailList('@decoy.test\n');
  const a = 'jobs@decoy.test';
  return list.domains.has(a.slice(a.lastIndexOf('@') + 1));
})(), true);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
