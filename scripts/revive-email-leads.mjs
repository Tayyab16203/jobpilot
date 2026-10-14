// scripts/revive-email-leads.mjs — one-off: re-evaluate email leads that were SKIPPED under
// older, over-aggressive role guards. Any that now pass the current CV role-alignment guard are
// reset to status 'new' + attempts 0 so the mailer re-queues and emails them. Pass --dry to preview.
import { getProfile } from '../src/profile.js';
import { assessJob } from '../src/cv.js';
import { initDB, rows, setFields, save } from '../src/tracker.js';

const DRY = process.argv.includes('--dry');
await initDB();
const p = getProfile();
const skipped = rows(
  "select url, role, company, email, description, location, notes from jobs " +
  "where channel='email' and status='skipped' and email is not null and email!=''"
);
let revived = 0, stillSkip = 0;
const passSample = [], skipSample = [];
for (const j of skipped) {
  const a = assessJob({ role: j.role, company: j.company, description: j.description, location: j.location }, p);
  if (a.roleAligned) {
    revived++;
    if (passSample.length < 10) passSample.push(j.role);
    if (!DRY) setFields(j.url, { status: 'new', attempts: 0, notes: 'revived: now passes CV role guard' });
  } else {
    stillSkip++;
    if (skipSample.length < 12) skipSample.push(j.role);
  }
}
if (!DRY) save();
console.log(JSON.stringify({ totalSkippedEmailLeads: skipped.length, revived, stillCorrectlySkipped: stillSkip, dry: DRY }, null, 2));
console.log('--- revived sample:', JSON.stringify(passSample));
console.log('--- still-skipped sample:', JSON.stringify(skipSample));
process.exit(0);
