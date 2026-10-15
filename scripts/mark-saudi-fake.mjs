// scripts/mark-saudi-fake.mjs — mark the user-flagged fake "Saudi HR" batch as FAKE.
// Sets each lead's status to 'fake' + records every address in the fake_emails registry so no
// brain (now or future) contacts them again. The durable list lives in
// src/fake-emails.txt (contributed back); this handles the per-user DB side.
import { initDB, save, rows, setStatus, markFakeEmail } from '../src/tracker.js';

await initDB();
const leads = rows(`SELECT url, email FROM jobs WHERE source='manual_saudi_batch' AND email IS NOT NULL AND email!=''`);
let marked = 0;
for (const j of leads) {
  markFakeEmail(j.email, 'user-reported fake decoy list (Saudi HR dump)', 'manual_saudi_batch');
  try { setStatus(j.url, 'fake', 'marked fake: user-reported decoy list — do not contact'); } catch {}
  marked++;
}
save();
console.log(JSON.stringify({ leadsMarked: marked, fakeRegistrySize: rows('SELECT COUNT(*) n FROM fake_emails')[0]?.n || 0 }, null, 2));
process.exit(0);
