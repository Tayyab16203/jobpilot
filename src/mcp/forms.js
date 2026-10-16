// src/mcp/forms.js — External application forms (Greenhouse, Lever, Ashby, Workable, generic).
// Resolves short links, hops from job-description pages to the actual form, fills every field
// with the answer engine (incl. react-select comboboxes, radio groups, consent boxes), uploads
// the CV, refuses to submit while REQUIRED fields are still unknown, and verifies a
// confirmation page. result: submitted | needs_manual | no_form | error
import { getContext } from '../agent/browser.js';
import { getProfile } from '../profile.js';
import { textAnswer, choiceAnswer, coverText } from './answers.js';
import { encounter, askLater, learn } from '../evolve.js';
import fs from 'fs';
import { cvAttachmentForJob } from '../cv.js';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const CONFIRM_RE = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(received|submitted|sent)|we.?ve received your application|successfully (applied|submitted)|your application is (complete|submitted|received)|application submitted|applied successfully|you('ve| have) applied|congrat|we will be in touch|we.?ll be in touch|check your email.*application/i;

const SCAN = () => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return (r.width > 0 || r.height > 0 || el.type === 'file' || el.type === 'radio' || el.type === 'checkbox') && s.visibility !== 'hidden'; };
  const qOf = el => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.innerText.trim()) return l.innerText; }
    if (el.type !== 'radio' && el.type !== 'checkbox') { const l = el.closest('label'); if (l?.innerText.trim()) return l.innerText; }
    const fs = el.closest('fieldset'); const lg = fs?.querySelector('legend'); if (lg?.innerText.trim()) return lg.innerText;
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(' ').map(i => document.getElementById(i)?.innerText || '').join(' '); if (t.trim()) return t; }
    let p = el.parentElement;
    for (let i = 0; i < 6 && p; i++, p = p.parentElement) { const lab = p.querySelector('label, .application-label, [class*="label"]'); if (lab && lab.innerText.trim() && !lab.contains(el)) return lab.innerText; }
    return el.placeholder || el.name || '';
  };
  const out = []; let i = 0;
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden' || el.type === 'submit' || el.disabled || !vis(el)) continue;
    if (el.closest('[aria-hidden="true"]') && el.type !== 'file') continue;
    const id = 'jf' + (i++); el.setAttribute('data-jf', id);
    const lab = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest('label');
    const q = (qOf(el) || '').replace(/\s+/g, ' ').trim();
    let val = el.tagName === 'SELECT' ? (el.selectedIndex > 0 ? el.options[el.selectedIndex].text : '') : el.value;
    if (el.getAttribute('role') === 'combobox' && !val) {
      const c = el.closest('[class*="select__control"]') || el.closest('[class*="select-shell"]') || el.parentElement?.parentElement?.parentElement;
      const t = c ? c.innerText.replace(/^(select\.*|start typing.*)$/im, '').trim() : '';
      if (t && !/^select/i.test(t)) val = t;
    }
    out.push({ id, tag: el.tagName, type: el.type, name: el.name, role: el.getAttribute('role') || '', q: q.slice(0, 300), optLabel: (lab?.innerText || el.value || '').trim().slice(0, 120),
      val, checked: !!el.checked,
      opts: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()) : undefined,
      required: el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\*\s*\n|required/i.test(q) });
  }
  return out;
};

// Job-board description pages (not real forms). Their apply link redirects to the true ATS.
const BOARD_HOST = /(^|\.)(remoteok\.com|remotive\.com|jobicy\.com|himalayas\.app|weworkremotely\.com|wellfound\.com|arbeitnow\.com|aihackerjobs\.com|lnkd\.in|paperpk\.com|rozee\.pk|mustakbil\.com)$/i;
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };

// ── Indeed: extract the real ATS link embedded in the posting, or fall back to
//    connect/email so the lead still gets actioned rather than silently dropped.
async function resolveIndeed(page) {
  // Indeed embeds the employer's apply URL in a data attribute or an <a> tag inside
  // the job posting detail. Try the most common selectors first.
  const found = await page.evaluate(() => {
    // 1. "Apply on company website" button href pointing straight off indeed.com
    const ext = document.querySelector('a[data-indeed-apply-joburl], a[href*="indeedapply"], .jobsearch-IndeedApplyButton-newDesign a');
    if (ext?.href && !ext.href.includes('indeed.com')) return { direct: ext.href };

    // 2. Metadata inside the apply widget
    const meta = document.querySelector('[data-indeed-apply-apitoken], [data-indeed-apply-joburl]');
    if (meta) {
      const u = meta.getAttribute('data-indeed-apply-joburl') || meta.getAttribute('action');
      if (u && !u.includes('indeed.com')) return { direct: u };
    }

    // 3. Any visible "Apply" link pointing off indeed.com
    for (const a of document.querySelectorAll('a[href]')) {
      const txt = (a.innerText || '').toLowerCase();
      if ((txt.includes('apply') || txt.includes('company site')) && !a.href.includes('indeed.com')) return { direct: a.href };
    }

    // 4. "Apply on company site" that points at Indeed's own redirect endpoint
    //    (/applystart?jk=…). This is NOT Indeed's in-app Easy Apply widget (which has
    //    #indeedApplyButton / [data-indeed-apply-apitoken]); it is a bounce link to the
    //    employer's real ATS that merely passes THROUGH indeed.com first. Following it in
    //    the logged-in session lands on the real Greenhouse/Lever/Ashby/Workable page.
    for (const a of document.querySelectorAll('a[href]')) {
      const txt = (a.innerText || '').toLowerCase();
      if ((txt.includes('company site') || txt.includes('company website')) && /\/applystart\b|\/rc\/clk\b/.test(a.href)) return { redirect: a.href };
    }
    return null;
  }).catch(() => null);

  if (!found) return null;
  if (found.direct) return found.direct;

  // Follow the Indeed redirect link within the authenticated session and capture where it finally
  // lands. If it leaves indeed.com, that destination is the real ATS; hand it back to applyForm().
  // If it stays on indeed.com (in-site Indeed Apply), there is no external ATS to drive — return
  // null so the caller routes to connect/email.
  if (found.redirect) {
    try {
      await page.goto(found.redirect, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await SLEEP(3500);
      const dest = page.url();
      if (dest && !/indeed\.com/.test(dest)) return dest;
    } catch { /* fall through */ }
  }
  return null;
}

// ── Glassdoor: click the "Apply on employer site" CTA and return the employer-ATS URL.
//    Glassdoor's own "Easy Apply" is Indeed SmartApply behind a reCAPTCHA — not auto-fillable
//    and NOT something we evade — so only the "Apply on employer site" path is driven here.
//    The current UI renders the CTA as <button data-test="applyButton"> (not an <a>), so match
//    the button and use a real (trusted) Playwright click; element.click() in page context does
//    not fire Glassdoor's handler. A visible "Easy Apply" label means SmartApply → bail to null
//    so the lead routes to connect/email.
async function resolveGlassdoor(page) {
  const applyBtn = page.locator('button[data-test="applyButton"], a[data-test="applyButton"]').first();
  const legacy = page.getByRole('link', { name: /apply on (company site|employer site)/i });
  const target = (await applyBtn.isVisible({ timeout: 6000 }).catch(() => false)) ? applyBtn
    : (await legacy.first().isVisible({ timeout: 2000 }).catch(() => false)) ? legacy.first()
    : null;
  if (!target) return null;

  const label = (await target.innerText().catch(() => '')).toLowerCase();
  if (/easy apply/i.test(label)) return null;   // SmartApply / reCAPTCHA — not auto-applyable

  const ctx = page.context();
  const [popup] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null),
    target.click({ timeout: 8000 }).catch(() => {}),
  ]);

  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await SLEEP(2500);
    const dest = popup.url();
    await popup.close().catch(() => {});
    if (dest && !/glassdoor\.com/.test(dest) && !/smartapply\.indeed\.com/.test(dest)) return dest;
    if (/smartapply\.indeed\.com/.test(dest)) return null;   // bounced to reCAPTCHA path
  }

  // Glassdoor navigates in the same tab sometimes.
  await SLEEP(3000);
  const current = page.url();
  if (current && !/glassdoor\.com/.test(current) && !/smartapply\.indeed\.com/.test(current)) return current;
  return null;
}

// ── WeWorkRemotely: the "Apply for this job" button links directly to the employer's URL.
async function resolveWeWorkRemotely(page) {
  // WWR posts an <a class="button"> with href pointing to the real application URL.
  const atsUrl = await page.evaluate(() => {
    // Primary: the green "Apply for this job" button on the detail page
    for (const a of document.querySelectorAll('a.button, a.wwr-button, section.apply a, .listing-header-container a')) {
      const txt = (a.innerText || '').toLowerCase();
      if ((txt.includes('apply') || txt.includes('job')) && a.href && !a.href.includes('weworkremotely.com')) return a.href;
    }
    // Fallback: any off-domain link in the job body
    for (const a of document.querySelectorAll('.listing-container a[href], .job-listing a[href]')) {
      if (a.href && !a.href.includes('weworkremotely.com') && /apply|careers|job/i.test(a.href + a.innerText)) return a.href;
    }
    return null;
  }).catch(() => null);

  return atsUrl || null;
}

async function toForm(page) {
  const u = page.url();
  if (/jobs\.lever\.co\/[^/]+\/[0-9a-f-]{36}$/.test(u)) { await page.goto(u + '/apply', { waitUntil: 'domcontentloaded' }); return; }
  if (/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}\/?$/.test(u)) { await page.goto(u.replace(/\/$/, '') + '/application', { waitUntil: 'domcontentloaded' }); return; }

  // lnkd.in shortlinks — follow the redirect to the real URL before processing as a form.
  if (/lnkd\.in\//.test(u)) {
    await SLEEP(3000); // let the initial redirect land
    // Wait up to 8 seconds total for the URL to navigate away from lnkd.in.
    await page.waitForURL(url => !url.includes('lnkd.in'), { timeout: 8000 }).catch(() => {});
    const landed = page.url();

    // LinkedIn safety interstitial: "This link will take you to a page that's not on LinkedIn"
    // The page shows an artdeco-button <a> with the real external URL. Click it to proceed.
    if (/linkedin\.com/.test(landed)) {
      const externalHref = await page.evaluate(() => {
        // artdeco-button <a> on the interstitial page that carries the real destination
        for (const a of document.querySelectorAll('a[href], a.artdeco-button')) {
          if (a.href && !a.href.includes('linkedin.com') && a.href.startsWith('http')) return a.href;
        }
        return null;
      }).catch(() => null);
      if (externalHref) {
        await page.goto(externalHref, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await SLEEP(2000);
        return;
      }
      // Fallback: click the visible off-domain link on the interstitial
      const interstitialLink = page.locator('a[href]:not([href*="linkedin.com"])').first();
      if (await interstitialLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        const [popup] = await Promise.all([
          page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null),
          interstitialLink.click().catch(() => {}),
        ]);
        if (popup) {
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          const dest = popup.url();
          await popup.close().catch(() => {});
          if (dest && !dest.includes('linkedin.com')) {
            await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          }
        } else {
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        }
        await SLEEP(2000);
        return;
      }
    }

    if (/lnkd\.in\//.test(landed)) {
      // Still on lnkd.in — try grabbing the canonical href from the page redirect element.
      const href = await page.evaluate(() => {
        const a = document.querySelector('a[href], meta[http-equiv="refresh"]');
        if (a?.tagName === 'A') return a.href;
        if (a?.tagName === 'META') { const m = a.content.match(/url=([^\s;]+)/i); return m ? m[1] : null; }
        // Look for any anchor that doesn't point back to lnkd.in.
        for (const el of document.querySelectorAll('a[href]')) {
          if (!el.href.includes('lnkd.in') && el.href.startsWith('http')) return el.href;
        }
        return null;
      }).catch(() => null);
      if (href && !href.includes('lnkd.in')) {
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      } else {
        // Last resort: click any visible <a> link that isn't a lnkd.in URL.
        const offDomain = page.locator('a[href]:not([href*="lnkd.in"])').first();
        if (await offDomain.isVisible().catch(() => false)) {
          await offDomain.click().catch(() => {});
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        }
      }
    }
    await SLEEP(2000);
  }

  const startHost = hostOf(page.url());
  const onBoard = BOARD_HOST.test(startHost);
  // On a real ATS page that already shows a form, stop.
  if (!onBoard) {
    const fileInputs = await page.locator('input[type="file"]').count();
    const textInputs = await page.locator('input[type="text"]:visible, input[type="email"]:visible').count();
    if (fileInputs || textInputs >= 2) return;
  }

  // Himalayas.app — find the "Apply now" external link pointing to real ATS.
  if (/himalayas\.app/.test(startHost)) {
    // First, try clicking an "Apply now" / "Apply" button — it may trigger a modal or navigate.
    const applyBtn = page.locator('a[href*="apply"], button').filter({ hasText: /apply( now)?/i }).first();
    if (await applyBtn.isVisible().catch(() => false)) {
      const [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null),
        applyBtn.click().catch(() => {}),
      ]);
      if (popup) {
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        const popupUrl = popup.url();
        await popup.close().catch(() => {});
        if (popupUrl && !popupUrl.includes('himalayas.app')) {
          await page.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await SLEEP(2500);
          return;
        }
      }
      await SLEEP(2000);
      // If the click navigated away from himalayas, we're done.
      if (!page.url().includes('himalayas.app')) { await SLEEP(1000); return; }
    }
    // Now scan for ATS links (post-click modal content may have added new links).
    const atsUrl = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a[href]')) {
        if (/(greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|bamboohr|jobvite|teamtailor|rippling|personio|apply)/i.test(a.href)
          && !a.href.includes('himalayas.app')) return a.href;
      }
      // fallback: any off-domain link in an apply/cta button
      for (const a of document.querySelectorAll('a[href]')) {
        const txt = (a.innerText || '').toLowerCase();
        if ((txt.includes('apply') || txt.includes('apply now')) && !a.href.includes('himalayas.app')) return a.href;
      }
      return null;
    }).catch(() => null);
    if (atsUrl) { await page.goto(atsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); await SLEEP(2500); return; }
  }

  // Jobicy.com — detect off-site apply pattern early.
  // Jobicy is a job board that links out to the employer's ATS via an auth-gated "Apply Now"
  // button (jv-open-apply-auth). The page itself never contains a fillable application form.
  // Strategy:
  //   1. Check if there's a real embedded form (rare, template-version 1 layouts).
  //   2. Otherwise look for any direct off-domain apply link in the jv-application-body or
  //      in the page <head>/<meta> canonical; if found, navigate there directly.
  //   3. If the auth gate is present (jv-open-apply-auth / jobs-offsite-apply-confirmation-banner),
  //      return null so applyForm will report needs_manual — off-site auth flow, route via email/connect.
  if (/jobicy\.com/.test(startHost)) {
    const resolved = await page.evaluate(() => {
      // 1. Real embedded form on the page?
      const form = document.querySelector('#job-application form:not(.jobicy_unified_form):not(.jh-search), .application-form form');
      if (form && form.querySelectorAll('input[type="text"], input[type="email"], textarea').length > 1) return { type: 'form' };
      // 2. Direct external ATS link anywhere in the apply section
      for (const a of document.querySelectorAll('.jv-application-body a[href], .jv-apply-section a[href], .candidates_can_apply a[href]')) {
        if (a.href && !a.href.includes('jobicy.com') && /^https?:\/\//.test(a.href)) return { type: 'ats', url: a.href };
      }
      // 3. Any off-domain apply link on the page
      for (const a of document.querySelectorAll('a[href]')) {
        if (/apply/i.test(a.innerText + a.getAttribute('aria-label') || '') && a.href && !a.href.includes('jobicy.com') && /^https?:\/\//.test(a.href)) return { type: 'ats', url: a.href };
      }
      // 4. Auth-gated off-site apply (most common case) → signal needs_manual
      if (document.querySelector('#jv-open-apply-auth, .jv-apply-primary, .jobs-offsite-apply-confirmation-banner')) return { type: 'offsite' };
      return null;
    }).catch(() => null);

    if (resolved?.type === 'ats') {
      await page.goto(resolved.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await SLEEP(2000);
      return; // continue to form-fill on the real ATS page
    }
    if (resolved?.type === 'form') {
      // scroll to #job-application if present on same page
      await page.evaluate(() => document.querySelector('#job-application')?.scrollIntoView()).catch(() => {});
      await SLEEP(1000);
      return;
    }
    // offsite or unresolved — signal via returning without navigating; applyForm will detect no form
    return;
  }

  // Collect candidate apply links; on job boards follow them to the external ATS.
  const links = await page.locator('a:visible').evaluateAll(as => as
    .filter(a => /apply/i.test((a.innerText || '') + (a.getAttribute('aria-label') || '')))
    .map(a => a.href).filter(Boolean));
  const ctx = page.context();
  // Prefer links that already point off the board to a known ATS.
  const FORM_HOST = /greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|breezy|recruitee|bamboohr|jobvite|teamtailor|rippling|personio|forms\.gle|google\.com\/forms|typeform|tally\.so/i;
  const direct = links.find(l => FORM_HOST.test(l));
  if (direct) { await page.goto(direct, { waitUntil: 'domcontentloaded' }).catch(() => {}); await SLEEP(2500); return followRedirect(page, startHost); }

  const btn = page.getByRole('link', { name: /apply (now|for this job|to this)|^apply$|i.?m interested/i }).or(page.getByRole('button', { name: /apply (now|for this job)|^apply$/i })).first();
  if (await btn.isVisible().catch(() => false)) {
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null), btn.click().catch(() => {})]);
    if (popup) { await popup.waitForLoadState('domcontentloaded').catch(() => {}); const url = popup.url(); await popup.close().catch(() => {}); await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {}); }
    await SLEEP(3000);
    return followRedirect(page, startHost);
  }
}

// Boards often use an interstitial /l/<id> that 302s to the ATS. If we're still on the
// board host, click the apply link once more and wait for the host to change.
async function followRedirect(page, startHost) {
  for (let i = 0; i < 2 && hostOf(page.url()) === startHost; i++) {
    const relay = await page.locator('a[href*="/l/"], a[rel~="external"], meta[http-equiv="refresh"]').first();
    const href = await page.locator('a:visible', { hasText: /apply/i }).first().getAttribute('href').catch(() => '');
    if (href && hostOf(href) !== startHost) { await page.goto(href, { waitUntil: 'domcontentloaded' }).catch(() => {}); await SLEEP(2500); }
    else break;
  }
}


async function fillAll(page, unknown, job = {}) {
  const p = getProfile();
  const cvPath = cvAttachmentForJob(job, p);
  const fields = await page.evaluate(SCAN);
  const radios = {};
  for (const f of fields) {
    const loc = page.locator(`[data-jf="${f.id}"]`);
    try {
      if (f.type === 'file') {
        const isCover = /cover/i.test(f.q + f.name);
        if (!isCover && cvPath && fs.existsSync(cvPath)) { await loc.setInputFiles(cvPath); await SLEEP(1500); }
        continue;
      }
      if (f.type === 'radio') { (radios[f.name || f.q] ||= []).push(f); continue; }
      if (f.type === 'checkbox') {
        if (!f.checked && (/agree|consent|acknowledge|privacy|terms|confirm|certify/i.test(f.q + f.optLabel) || f.required)) await loc.check({ force: true }).catch(() => {});
        continue;
      }
      if (f.tag === 'SELECT') {
        if (f.val) continue;
        const pick = choiceAnswer(f.q, f.opts.slice(1)) ; if (pick) await loc.selectOption({ label: pick }).catch(() => {}); else if (f.required) unknown.add(f.q);
        continue;
      }
      if (f.val && f.val.trim()) continue;
      if (f.role === 'combobox' || /select/i.test(f.q) && f.tag === 'INPUT' && f.type === 'text' && await loc.getAttribute('aria-autocomplete').catch(() => null)) {
        // react-select: open, read options, pick
        await loc.click().catch(() => {}); await SLEEP(600);
        const opts = await page.locator('[role="option"]').allInnerTexts().catch(() => []);
        let pick = opts.length ? choiceAnswer(f.q, opts) : textAnswer(f.q);
        if (!opts.length && pick) { await loc.fill(pick); await SLEEP(1200); }
        const key = pick ? pick.split(/[\s+(]/).filter(Boolean)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
        const opt = key ? page.locator('[role="option"]').filter({ hasText: new RegExp('^\\s*' + key, 'i') }).first() : page.locator('[role="option"]').first();
        if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => {});
        else { await loc.press('Enter').catch(() => {}); if (f.required && !pick) unknown.add(f.q); }
        await page.keyboard.press('Escape').catch(() => {});
        continue;
      }
      const numeric = f.type === 'number';
      let v = textAnswer(f.q, { numeric });
      if ((v == null || v === '') && f.tag === 'TEXTAREA') v = coverText(p);
      if (v == null || v === '') { if (f.required) unknown.add(f.q); continue; }
      await loc.fill(String(v));
      if (/location|city/i.test(f.q)) { await SLEEP(1200); const o = page.locator('[role="option"], .pac-item').first(); if (await o.isVisible().catch(() => false)) await o.click().catch(() => {}); }
    } catch {}
  }
  for (const g of Object.values(radios)) {
    if (g.some(r => r.checked)) continue;
    const pick = choiceAnswer(g[0].q, g.map(r => r.optLabel));
    const r = g.find(x => x.optLabel === pick) || g[0];
    await page.locator(`[data-jf="${r.id}"]`).check({ force: true }).catch(() => {});
  }
  return fields.length;
}

export async function applyForm({ url, timeoutMs = 120000, submit = true, job = {} }) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const unknown = new Set();
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await SLEEP(3500);
    await toForm(page);
    await SLEEP(1500);
    const finalUrl = page.url();

    // ── Indeed: try to extract the real ATS link before bailing out.
    if (/indeed\.com/.test(finalUrl)) {
      const atsLink = await resolveIndeed(page);
      if (atsLink) {
        await page.goto(atsLink, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await SLEEP(2500);
        // fall through and let the rest of applyForm handle the real ATS page
      } else {
        await encounter('form', 'indeed.com — no external ATS link found; routing to connect/email', { url: finalUrl, page });
        return { ok: false, result: 'needs_manual', detail: 'indeed.com — route via connect or email', finalUrl };
      }
    }

    // ── Glassdoor: click through to the employer's ATS.
    if (/glassdoor\.com/.test(page.url())) {
      const atsLink = await resolveGlassdoor(page);
      if (atsLink) {
        await page.goto(atsLink, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await SLEEP(2500);
      } else {
        await encounter('form', 'glassdoor.com — "Apply on company site" not found; routing to connect/email', { url: page.url(), page });
        return { ok: false, result: 'needs_manual', detail: 'glassdoor.com — route via connect or email', finalUrl };
      }
    }

    // ── WeWorkRemotely: resolve the employer's direct apply URL.
    if (/weworkremotely\.com/.test(page.url())) {
      const atsLink = await resolveWeWorkRemotely(page);
      if (atsLink) {
        await page.goto(atsLink, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await SLEEP(2500);
      } else {
        await encounter('form', 'weworkremotely.com — no external apply link found', { url: page.url(), page });
        return { ok: false, result: 'needs_manual', detail: 'weworkremotely.com — no external apply link', finalUrl };
      }
    }

    if (/linkedin\.com\/(login|authwall)/.test(page.url())) { await encounter('form', 'redirected to linkedin login/authwall', { url: page.url(), page }); return { ok: false, result: 'needs_manual', detail: 'redirected to ' + page.url().slice(0, 80), finalUrl }; }
    if (/workday|myworkdayjobs|icims|taleo|successfactors|oraclecloud|brassring/.test(finalUrl)) return { ok: false, result: 'needs_manual', detail: 'account-gated ATS (Workday/iCIMS/Taleo) — one-click for you', finalUrl };

    let n = await fillAll(page, unknown, job);
    if (n < 2) {
      // still on a job-board description page with no real form → hand off with the direct link
      if (BOARD_HOST.test(hostOf(finalUrl))) { await encounter('form', 'job-board page, no external ATS form found on ' + hostOf(finalUrl), { url: finalUrl, page }); return { ok: false, result: 'needs_manual', detail: 'board page — open the apply link manually', finalUrl }; }
      await encounter('form', 'no application form found on ' + hostOf(finalUrl), { url: finalUrl, page });
      return { ok: false, result: 'no_form', detail: 'no application form found', finalUrl };
    }
    await SLEEP(800);
    n = await fillAll(page, unknown, job); // second pass: conditional fields that appeared

    // recompute unknown required: only those still empty
    const still = (await page.evaluate(SCAN)).filter(f => f.required && f.type !== 'file' && f.type !== 'checkbox' && (f.type === 'radio' ? false : !String(f.val || '').trim()));
    if (process.env.DEBUG_FORMS) console.log('STILL', JSON.stringify(still, null, 1));
    const missing = still.map(f => f.q).filter(Boolean);
    if (missing.length) { missing.forEach(q => askLater(q)); return { ok: false, result: 'needs_manual', detail: 'unknown required: ' + missing.slice(0, 4).join(' | ').slice(0, 300), questions: missing, finalUrl }; }
    if (!submit) return { ok: true, result: 'dry_run_ready', detail: `filled ${n} fields`, finalUrl };

    // Prefer an explicit submit control (Workable's `[data-ui="apply-button"]`, Greenhouse/Lever
    // `button[type=submit]`) before falling back to the generic accessible-name match. The
    // submit button usually sits at the very bottom of a long form, so it can be below the fold
    // where a sticky footer/overlay intercepts a plain click — hence the scroll + forced + JS
    // click fallbacks instead of a single click() that hangs until the actionability timeout.
    // For jobicy.com, use a wider selector set with a longer timeout.
    const isJobicy = /jobicy\.com/.test(hostOf(page.url()));
    const btn = isJobicy
      ? page.locator(
          'button[type="submit"], input[type="submit"], .apply-btn, #apply-button, a.apply-button'
        ).first()
          .or(page.locator('button').filter({ hasText: /submit|apply/i }).first())
        : page.locator(
          'button[data-ui="apply-button"], [data-ui="submit"], button[type="submit"]:not([aria-disabled="true"]), input[type="submit"]'
        ).first()
          .or(page.getByRole('button', { name: /submit application|submit|send application|apply now|complete application|^apply$/i }).last())
          .or(page.locator('a[role="button"]').filter({ hasText: /submit|apply now/i }).first());
    const btnTimeout = isJobicy ? 8000 : 5000;
    // Try to find the button even if it's currently not visible (off-screen / in sticky footer).
    let btnExists = (await btn.count().catch(() => 0)) > 0;
    if (!btnExists) {
      // Last resort: any button at the bottom of the page whose text looks like submit.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await SLEEP(800);
      btnExists = (await btn.count().catch(() => 0)) > 0;
    }
    if (!btnExists || !(await btn.isVisible().catch(() => false)) && !(await btn.isEnabled().catch(() => false))) {
      await encounter('form', 'form filled but no submit button on ' + hostOf(finalUrl), { url: finalUrl, page });
      return { ok: false, result: 'needs_manual', detail: 'no submit button', finalUrl };
    }
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await SLEEP(300);
    let clicked = await btn.click({ timeout: btnTimeout }).then(() => true).catch(() => false);
    if (!clicked) clicked = await btn.click({ force: true, timeout: btnTimeout }).then(() => true).catch(() => false);
    if (!clicked) clicked = await btn.evaluate(el => { el.click(); return true; }).catch(() => false);
    if (!clicked) { await encounter('form', 'submit button not clickable on ' + hostOf(finalUrl), { url: finalUrl, page }); return { ok: false, result: 'needs_manual', detail: 'submit button not clickable', finalUrl }; }
    for (let i = 0; i < 20; i++) {
      await SLEEP(1000);
      const t = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (CONFIRM_RE.test(t) || /\/(thanks|thank-you|confirmation|success)/i.test(page.url())) return { ok: true, result: 'submitted', detail: 'confirmation page shown', finalUrl };
      // Jobicy-specific confirmation: dashboard/my-applications tab visible, URL changed to profile/dashboard,
      // or jobicy appends ?registered=<email> to the job URL after a successful application.
      if (isJobicy && (
        await page.locator('#tab-my-applications').isVisible().catch(() => false) ||
        /\/(my-applications|dashboard|profile)/i.test(page.url()) ||
        /[?&]registered=/i.test(page.url())
      )) return { ok: true, result: 'submitted', detail: 'jobicy — application registered (confirmed via URL params)', finalUrl };
      if (/captcha|verify you are human/i.test(t) && i > 4) return { ok: false, result: 'needs_manual', detail: 'captcha after submit', finalUrl };
    }
    const errs = await page.locator('[role="alert"], .error, [class*="error"]').allInnerTexts().catch(() => []);
    await encounter('form', 'submitted but no confirmation on ' + hostOf(page.url()), { url: page.url(), page });
    return { ok: false, result: 'needs_manual', detail: 'no confirmation; ' + errs.filter(Boolean).slice(0, 3).join(' | ').slice(0, 200), finalUrl };
  } catch (e) {
    await encounter('form', 'exception: ' + e.message.split('\n')[0], { url, page }).catch(() => {});
    return { ok: false, result: 'error', detail: e.message.slice(0, 200) };
  } finally { await page.close().catch(() => {}); }
}
