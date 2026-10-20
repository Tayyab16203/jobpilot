// src/mcp/human-assisted-apply.js — Human-in-the-loop apply for flows gated by a CAPTCHA /
// Cloudflare / "verify you are human" challenge (Indeed SmartApply, Glassdoor Easy Apply which is
// SmartApply under the hood, and any ATS that throws an interstitial human-check).
//
// POLICY: we NEVER solve or bypass a CAPTCHA. When a VISIBLE human-check appears we stop, leave
// the tab open in the user's Chrome, and hand control to the user to click it. On a follow-up
// `resume` call we re-attach to that same tab (found by URL) and continue the application. All the
// non-human steps (resume selection, questions, review, submit) are driven automatically.
//
// Returns: { ok, result, detail, url }
//   result = 'submitted'            → application confirmed
//          | 'waiting_for_human'    → a human-check is on screen; user must click it, then call
//                                     this tool again with { resume: true } (same jobUrl)
//          | 'needs_answers'        → a question the engine can't answer (ask the user, learn, retry)
//          | 'no_apply' | 'error'   → nothing to drive / failed
import { getContext } from '../agent/browser.js';
import { getProfile } from '../profile.js';
import { textAnswer, choiceAnswer } from './answers.js';
import { encounter, askLater } from '../evolve.js';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const SMARTAPPLY_RE = /smartapply\.indeed\.com|indeedapply\/form/i;

// A VISIBLE human-check (not an invisible/enterprise reCAPTCHA badge that never challenges).
// Scans the top document AND every child frame, since the challenge iframe is usually nested.
async function visibleHumanCheck(page) {
  for (const fr of page.frames()) {
    try {
      const hit = await fr.evaluate(() => {
        const frames = [...document.querySelectorAll('iframe')];
        const challenge = frames.find(f => {
          const src = f.src || '';
          if (!/recaptcha.*bframe|hcaptcha.*challenge|turnstile|cloudflare|challenges\.cloudflare/i.test(src)) return false;
          const r = f.getBoundingClientRect();
          return r.width > 60 && r.height > 60;   // actually rendered, not the 0×0 invisible badge
        });
        if (challenge) return true;
        const txt = (document.body?.innerText || '').toLowerCase();
        return /verify you are human|confirm you are human|are you a robot|complete the (security )?check|i'm not a robot|checking your browser|just a moment/i.test(txt);
      }).catch(() => false);
      if (hit) return true;
    } catch {}
  }
  return false;
}

async function findSmartApplyTab(ctx) {
  for (const p of ctx.pages()) {
    try { if (SMARTAPPLY_RE.test(p.url())) return p; } catch {}
  }
  return null;
}

// SmartApply renders its form (resume selection, questions, review + "Submit your application")
// inside a child frame, not the top document. Find the frame that actually holds the apply
// controls so fill/advance/confirm operate where the form really lives. Falls back to the main
// frame. Returns a Playwright Frame.
async function contentFrame(page) {
  for (const fr of page.frames()) {
    try {
      if (!/indeedapply\/form|smartapply/i.test(fr.url())) continue;
      const has = await fr.evaluate(() =>
        !!document.querySelector('input,select,textarea,button') &&
        /submit your application|continue|review|resume|question/i.test(document.body?.innerText || '')
      ).catch(() => false);
      if (has) return fr;
    } catch {}
  }
  return page.mainFrame();
}

// Fill the fields on the current SmartApply step from profile + answer engine. Never touches the
// g-recaptcha-response field. Operates on a Frame (the SmartApply content frame). Returns the
// list of required questions it could NOT answer.
async function fillStep(frame) {
  const p = getProfile();
  const scan = await frame.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input,select,textarea')) {
      if (el.type === 'hidden' || el.name === 'g-recaptcha-response') continue;
      const label = (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || '').trim();
      out.push({ tag: el.tagName, type: el.type || '', name: el.name || el.id || '', label, required: el.required, value: el.value || '', checked: el.checked });
    }
    return out;
  }).catch(() => []);

  const unanswered = [];
  for (const f of scan) {
    const q = f.label || f.name;
    if (!q) continue;
    try {
      if (f.tag === 'SELECT') {
        if (f.value) continue;
        const a = choiceAnswer(q, []);
        if (a) await frame.selectOption(`[name="${f.name}"]`, { label: String(a) }).catch(() => {});
        else if (f.required) { unanswered.push(q); askLater(q); }
      } else if (f.type === 'radio' || f.type === 'checkbox') {
        // Radio/checkbox groups: let the engine pick an option label, click the matching control.
        const a = choiceAnswer(q, []);
        if (a) {
          const opt = frame.getByLabel(new RegExp(String(a).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first();
          await opt.check({ timeout: 2000 }).catch(() => {});
        }
      } else {
        if (f.value) continue;
        const numeric = f.type === 'number' || /salary|years|experience|notice|how many|number/i.test(q);
        const a = textAnswer(q, { numeric });
        if (a != null && a !== '') {
          const loc = frame.locator(f.name ? `[name="${f.name}"]` : `textbox`).first();
          await loc.fill(String(a), { timeout: 2500 }).catch(() => {});
        } else if (f.required) { unanswered.push(q); askLater(q); }
      }
    } catch {}
  }
  return unanswered;
}

async function clickAdvance(page) {
  // Click Continue / Review / Submit — the SmartApply primary action. The 2026 "beta" SmartApply
  // splits the review step across frames: the Edit/contact controls live in an about:srcdoc child
  // frame while the "Submit your application" button is in the MAIN document — so scan EVERY frame
  // (not just the content frame) and click the first primary button found.
  for (const frame of page.frames()) {
    const label = await frame.evaluate(() => {
      const norm = b => ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.value || '')).trim();
      // offsetParent is null for a position:fixed/sticky submit bar even when it is on-screen, so
      // gate visibility on client rects instead — the review "Submit your application" is sticky.
      const shown = el => el.getClientRects().length > 0 || el.offsetParent !== null;
      // Tick any un-checked NON-recaptcha consent checkbox that gates submit (e.g. the cross-border
      // data-transfer acknowledgement on international postings). Never touch g-recaptcha-response.
      for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
        if (cb.name === 'g-recaptcha-response' || /recaptcha|captcha/i.test(cb.name || '')) continue;
        if (!cb.checked && shown(cb)) { try { cb.click(); } catch {} }
      }
      const btns = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
        .filter(b => !b.disabled && shown(b) && !/hcaptcha|g-recaptcha/i.test(b.className || ''));
      const primary = btns.find(b => /submit your application|submit application|^submit$/i.test(norm(b)))
        || btns.find(b => /continue|review your application|^review$|^next$/i.test(norm(b)));
      if (primary) { const l = norm(primary); primary.click(); return l; }
      return null;
    }).catch(() => null);
    if (label) return label;
  }
  return null;
}

// Confirmation can land in any frame — scan them all.
async function confirmed(page) {
  for (const fr of page.frames()) {
    try {
      const t = (await fr.evaluate(() => document.body?.innerText || '')).toLowerCase();
      if (/application submitted|your application has been submitted|successfully applied|application sent|thanks for applying|we('|’)ve received your application|has been submitted/i.test(t)) return true;
    } catch {}
  }
  return false;
}

/**
 * Drive an Indeed SmartApply (or Glassdoor Easy Apply) flow with human-assist for CAPTCHAs.
 * @param {object} a
 * @param {string} a.jobUrl   Indeed viewjob URL (or a SmartApply URL already open)
 * @param {boolean} a.resume  true → re-attach to the open SmartApply tab and continue after the
 *                            user has solved the on-screen human-check.
 */
export async function humanAssistedApply(args) {
  let pageRef = { page: null };
  const r = await _humanAssistedApply(args, pageRef);
  // Close the SmartApply tab on terminal outcomes to prevent tab leaks (72+ tabs choke Chrome).
  // Keep it open ONLY when we need the user to act and then resume on the same tab.
  if (r.result !== 'waiting_for_human' && r.result !== 'needs_answers') {
    try { await pageRef.page?.close(); } catch {}
  }
  return r;
}

async function _humanAssistedApply({ jobUrl, resume = false }, pageRef) {
  const ctx = await getContext();
  let page;

  if (resume) {
    page = await findSmartApplyTab(ctx);
    pageRef.page = page;
    if (!page) return { ok: false, result: 'error', detail: 'no open SmartApply tab to resume — start the apply again', url: jobUrl };
    await page.bringToFront().catch(() => {});
    // If the human-check is still on screen, keep waiting.
    // Confirmation first: a solved reCAPTCHA leaves its (now-inert) challenge iframe in the DOM on
    // the post-apply page, which would otherwise look like a live human-check. If the application
    // is already confirmed, we are done regardless of leftover captcha frames.
    if (await confirmed(page)) {
      return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };
    }
    if (await visibleHumanCheck(page)) {
      return { ok: false, result: 'waiting_for_human', detail: 'Human-check still on screen — please click/solve it in the Chrome window, then resume again.', url: page.url() };
    }
  } else {
    page = await ctx.newPage();
    pageRef.page = page;
    page.setDefaultTimeout(15000);
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await SLEEP(3500);
    // Click the Indeed Apply button to enter SmartApply.
    const entered = await page.evaluate(() => {
      const b = document.querySelector('#indeedApplyButton, [class*="IndeedApplyButton"] button, button[aria-label*="Apply" i]')
        || [...document.querySelectorAll('a,button')].find(x => /^apply now$|^apply$/i.test((x.innerText || '').trim()));
      if (b) { b.click(); return true; }
      return false;
    }).catch(() => false);
    if (!entered) return { ok: false, result: 'no_apply', detail: 'no Indeed Apply button on this posting', url: jobUrl };
    await SLEEP(6000);
    const sa = await findSmartApplyTab(ctx);
    if (sa) { page = sa; pageRef.page = sa; }
  }

  // Walk the multi-step form. Stop and hand off the moment a VISIBLE human-check appears.
  for (let step = 0; step < 10; step++) {
    await SLEEP(2000);

    // Confirmation BEFORE human-check: a solved captcha leaves its challenge iframe in the DOM on
    // the confirmation page, so checking the captcha first would falsely re-pause a finished apply.
    if (await confirmed(page)) {
      return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };
    }

    if (await visibleHumanCheck(page)) {
      await encounter('human_check', 'visible CAPTCHA/Cloudflare on ' + (page.url().match(/[^/]+\/\/[^/]+/) || [''])[0], { url: page.url(), page }).catch(() => {});
      return {
        ok: false,
        result: 'waiting_for_human',
        detail: '🧑 Human-check on screen (CAPTCHA/Cloudflare). Please click/solve it in the debug Chrome window, then call this tool again with resume:true to continue the application.',
        url: page.url(),
      };
    }

    const frame = await contentFrame(page);
    const unanswered = await fillStep(frame);
    if (unanswered.length) {
      return { ok: false, result: 'needs_answers', detail: 'needs your answer: ' + unanswered.slice(0, 4).join(' | ').slice(0, 300), questions: unanswered, url: page.url() };
    }

    const advanced = await clickAdvance(page);
    if (!advanced) {
      // No primary button and no confirmation — either done or stuck.
      await SLEEP(1500);
      if (await confirmed(page)) return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };
      return { ok: false, result: 'error', detail: 'could not find a Continue/Submit button to advance', url: page.url() };
    }
    // If we just clicked the final submit, a human-check often fires right here — the loop's next
    // iteration detects it and hands off.
  }

  if (await confirmed(page)) return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };
  return { ok: false, result: 'error', detail: 'flow did not reach a confirmation after 10 steps', url: page.url() };
}
