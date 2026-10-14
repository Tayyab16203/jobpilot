// scripts/drain-email-bank.mjs — send to EVERY pending email-channel lead in the bank
// (status='new', has an address, under the attempt cap, not already emailed). Uses the resilient
// path: ensureChromeReady() before each send + retry the SAME lead on transient cdp_unavailable,
// so Chrome churn (issue #397) never silently skips a lead. Dedup-guarded; re-run safe. --dry previews.
import fs from 'fs';
import http from 'http';
import { getProfile } from '../src/profile.js';
import { initDB, save, rows, alreadyEmailed, logEmail, setStatus, bumpAttempt, getJob } from '../src/tracker.js';
import { sendViaGmail } from '../src/mcp/gmail.js';
import { subject as mkSubject, body as mkBody } from '../src/scraper/email_content.js';
import { cvAttachmentForJob } from '../src/cv.js';
import { launchChrome } from '../src/mcp/chrome.js';

const DRY = process.argv.includes('--dry');
const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[drain-bank]', ...a);

function chromeUp() {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json/version', timeout: 2500 }, r => { r.resume(); resolve(r.statusCode === 200); });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function ensureChromeReady(maxWaitMs = 60000) {
  const t0 = Date.now();
  if (await chromeUp()) return true;
  try { await launchChrome(); } catch {}
  while (Date.now() - t0 < maxWaitMs) { if (await chromeUp()) return true; await SLEEP(2000); }
  return false;
}

async function main() {
  await initDB();
  const p = getProfile();
  // Every pending email lead: has an address, status new, under attempt cap, newest first.
  const leads = rows(
    `SELECT url, role, company, email, description, source FROM jobs
     WHERE email IS NOT NULL AND email!='' AND status='new' AND COALESCE(attempts,0) < 3
     ORDER BY CASE WHEN posted_at='' OR posted_at IS NULL THEN 1 ELSE 0 END, posted_at DESC, id DESC`
  );
  log(`${leads.length} pending email leads in the bank${DRY ? ' (DRY)' : ''}. CV: ${p.cvPath}`);

  let sent = 0, skipped = 0, failed = 0;
  for (const j of leads) {
    const email = j.email;
    if (alreadyEmailed(email)) { skipped++; try { setStatus(j.url, 'emailed', 'already emailed (dedup)'); } catch {}; log(`skip (already emailed): ${email}`); continue; }
    const role = j.role || p.headline || 'Senior Software Engineer';
    const company = j.company || '';
    const job = { ...j, role, company, posterName: '' };
    const subj = mkSubject(job, p), body = mkBody(job, p);
    if (DRY) { log(`DRY → ${email}  [${company || j.source}]  "${role}"`); continue; }

    let r = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await ensureChromeReady();
      try { r = await sendViaGmail({ to: email, subject: subj, body, attachmentPath: cvAttachmentForJob(job, p) }); }
      catch (e) { r = { ok: false, detail: (e.message || '').slice(0, 120) }; }
      if (r && r.transient) { log(`transient (${r.detail}) ${attempt}/4 — ensuring Chrome, retrying: ${email}`); await SLEEP(5000 + attempt * 3000); continue; }
      break;
    }
    if (r && r.transient) { log(`✗ gave up (Chrome/Gmail): ${email}`); failed++; save(); continue; }
    bumpAttempt(j.url);
    if (r && r.ok) {
      sent++;
      try { logEmail(email, company, role, subj, 'sent', j.url); setStatus(j.url, 'emailed', `sent: ${subj}`); } catch {}
      log(`✉ SENT ${email}  [${company || j.source}]  (${sent} sent)`);
    } else {
      failed++;
      const attempts = (getJob(j.url)?.attempts) || 0;
      try { setStatus(j.url, attempts >= 3 ? 'failed' : 'new', (r && r.detail) || 'send failed'); } catch {}
      log(`✗ FAIL ${email}  — ${(r && r.detail) || 'unknown'}`);
    }
    save();
    await SLEEP(4000 + Math.round(Math.random() * 5000));
  }
  save();
  log(`DONE — sent ${sent}, skipped ${skipped} (already emailed), failed ${failed}, of ${leads.length}.`);
  process.exit(0);
}
main();
