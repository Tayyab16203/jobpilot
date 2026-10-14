// scripts/send-saudi-batch.mjs — one-off: send an application email to a hand-provided list of
// Saudi company HR/careers addresses, through the user's logged-in Gmail (CV auto-attached), using
// the SAME proven path the mailer uses (sendViaGmail + the role-aware template). Dedup-guarded:
// skips any address already emailed. Paced politely between sends. Pass --dry to preview only.
import fs from 'fs';
import path from 'path';
import { getProfile } from '../src/profile.js';
import { initDB, save, alreadyEmailed, logEmail, upsertJobs, setStatus } from '../src/tracker.js';
import { sendViaGmail } from '../src/mcp/gmail.js';
import { subject as mkSubject, body as mkBody } from '../src/scraper/email_content.js';
import { cvAttachmentForJob } from '../src/cv.js';
import { launchChrome } from '../src/mcp/chrome.js';
import http from 'http';

const DRY = process.argv.includes('--dry');
const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[saudi-batch]', ...a);

// Wait until the debug Chrome on :9222 answers; relaunch once if it's down. Fixes the recurring
// cdp_unavailable churn (issue #397) that was skipping addresses mid-batch.
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

// The provided list (deduped, lowercased for the address; original kept for sending).
const RAW = [
  'CV@Arabianfal.com','Cv@aldawaa.com.sa','Hr.qrm@hotmail.com','Rec@alojaimi.com',
  'Recruitment@rawabiholding.com','Job.s6@hotmail.com','Careers@dnata.com','Hr@alesayi_motors.com',
  'Hr@alarayan.com','Recruiting.ksa@mcmermott.com','Recruitment@aytb.com','Wadaef@gtecorp.com',
  'Careers@nesr.com','Recruit@farm.com.sa','Info@alhumamlaw.com','Hr1@gulfteksaudi.com',
  'Catcosa@catcosa.com','Cv@tafear.com','Recruitment@sraco.com.sa','Info@atco.com.sa',
  'HRdepartmental@sa.yokogawa.com','Recruitment@shadeco.com','Klc.hr@alkafaa.com','Kbr-amcdehr@kbr.com',
  'Recruitment@batook.com','Career@shawarmer.com','Hrsupport@archirodon.net','Jobs@binajinah.com',
  'Marketing.np@nesma.com','Wadaef2019@abdulla-fouad.com','Careers@innosoft.sa','M@startime.com.sa',
  'job@musk.sa.com','Shababwatansa@gmail.com','j@sabksa.com','al.alshaikh@bonyan.sa',
  'ymohammed@innovest.com.sa','s.alwadi@nhc.sa','i.atassi@artar.com.sa','oalkhunaizi@darwaemaar.com',
  'jobs@almasah.net','recruitment.amjad@gmail.com','jobrydlaw@gmail.com','Job@almoosahospital.com.sa',
  'recruitment@almoosahospital.com.sa','jobs@sghgroup.net','career.dmm@sghgroup.net',
  'talent.acquisition@drsulaimanalhabib.com','Careers@jhah.com','hrd@alahsahospital.com.sa',
  'career@almanahospital.com.sa','info@familycare.com.sa','info@ramclinics.com','HR.DSFHR@fakeeh.care',
  'career@mouwasat.com','careers@dallah-hospital.com','hr.phc@drsulaimanalhabib.com',
  'careers@almurjanhospital.com','hiringnow.ksa@gmail.com',
];

// Dedup the list itself (case-insensitive), preserving first-seen original casing.
const seen = new Set();
const LIST = [];
for (const e of RAW) { const k = e.trim().toLowerCase(); if (!seen.has(k)) { seen.add(k); LIST.push(e.trim()); } }

// Derive a readable company name from the email domain (e.g. aldawaa.com.sa -> Aldawaa).
function companyFromEmail(email) {
  const dom = (email.split('@')[1] || '').toLowerCase()
    .replace(/\.(com|net|org|sa|care)(\.(sa))?$/g, '').replace(/\.(com|co)$/g, '');
  const core = dom.split('.').filter(Boolean).pop() || dom;
  return core.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function main() {
  await initDB();
  const p = getProfile();
  const role = p.headline || p.currentTitle || 'Senior Software Engineer';
  log(`sending ${LIST.length} unique addresses as "${role}", CV: ${p.cvPath}${DRY ? ' (DRY)' : ''}`);

  let sent = 0, skipped = 0, failed = 0;
  for (const email of LIST) {
    if (alreadyEmailed(email)) { skipped++; log(`skip (already emailed): ${email}`); continue; }
    const company = companyFromEmail(email);
    const url = `mailto:${email}`;
    const job = { role, company, email, url, description: '', posterName: '' };
    const subj = mkSubject(job, p);
    const body = mkBody(job, p);

    if (DRY) { log(`DRY → ${email}  [${company}]  subj="${subj.slice(0, 60)}"`); continue; }

    // Record the lead first so dedup/history is accurate even if the process is interrupted.
    try { upsertJobs([{ ...job, channel: 'email', status: 'new', source: 'manual_saudi_batch', relevance: 0.8 }]); } catch {}

    // Send with bounded retries: a transient cdp_unavailable (Chrome dropped) triggers an
    // ensureChromeReady() + retry on the SAME address, instead of skipping it (issue #397).
    let r = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await ensureChromeReady();
      try { r = await sendViaGmail({ to: email, subject: subj, body, attachmentPath: cvAttachmentForJob(job, p) }); }
      catch (e) { r = { ok: false, detail: (e.message || '').slice(0, 120) }; }
      if (r && r.transient) {
        log(`transient (${r.detail}) attempt ${attempt}/4 — waiting for Chrome, will retry: ${email}`);
        await SLEEP(5000 + attempt * 3000);
        continue;
      }
      break;   // got a real outcome (ok or genuine fail)
    }

    if (r && r.transient) { log(`✗ gave up after retries (Chrome unstable / Gmail login?): ${email}`); failed++; save(); continue; }
    if (r && r.ok) {
      sent++;
      try { logEmail(email, company, role, subj, 'sent', url); setStatus(url, 'emailed', `sent: ${subj}`); } catch {}
      log(`✉ SENT ${email}  [${company}]  (${sent} sent)`);
    } else {
      failed++;
      try { setStatus(url, 'failed', (r && r.detail) || 'send failed'); } catch {}
      log(`✗ FAIL ${email}  — ${(r && r.detail) || 'unknown'}`);
    }
    save();
    // Polite jittered pace (4–9s) — same spirit as the mailer's emailPaceRange.
    await SLEEP(4000 + Math.round(Math.random() * 5000));
  }
  save();
  log(`DONE — sent ${sent}, skipped ${skipped} (already emailed), failed ${failed}, of ${LIST.length} unique.`);
  process.exit(0);
}
main();
