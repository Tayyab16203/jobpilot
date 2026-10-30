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

/**
 * Given a radio/checkbox group and the label the answer engine picked, return the option `value`
 * that should be checked. Pure (no DOM / Playwright), so it is unit-testable. Matches the picked
 * label to an option by exact label, then case-insensitive label, then value, then substring.
 *
 * @param {{name:string, options:{value:string,label:string,checked?:boolean}[]}} group
 * @param {string} pickedLabel  the label choiceAnswer returned
 * @returns {string|null} the value to check, or null if no option matches
 */
export function chooseRadioValue(group, pickedLabel) {
  if (!group || !Array.isArray(group.options) || !group.options.length) return null;
  const want = String(pickedLabel == null ? '' : pickedLabel).trim();
  if (!want) return null;
  const lc = want.toLowerCase();
  const byExact = group.options.find(o => String(o.label || '').trim() === want);
  if (byExact) return byExact.value;
  const byCi = group.options.find(o => String(o.label || '').trim().toLowerCase() === lc);
  if (byCi) return byCi.value;
  const byVal = group.options.find(o => String(o.value || '').trim().toLowerCase() === lc);
  if (byVal) return byVal.value;
  const bySub = group.options.find(o => String(o.label || '').trim().toLowerCase().includes(lc)
    || lc.includes(String(o.label || '').trim().toLowerCase()));
  return bySub ? bySub.value : null;
}
const SMARTAPPLY_RE = /smartapply\.indeed\.com|indeedapply\/form/i;
// The SmartApply interstitial (.../beta/indeedapply/applybyapplyablejobid?...) matches
// SMARTAPPLY_RE but is NOT a form module yet — it redirects to .../beta/indeedapply/form/<module>.
// FORM_RE matches only the real module page.
const FORM_RE = /indeedapply\/form\//i;

// After the Apply click (or on resume) the SmartApply tab first lands on the interstitial, then
// redirects to a .../indeedapply/form/<module> URL. Poll the SmartApply tab's URL until it reaches
// a form module (or a terminal state the loop can handle) so we never fill/advance the interstitial
// or site-chrome. The tab object itself can change across the redirect, so re-find it each tick.
async function waitForFormModule(ctx, { timeoutMs = 15000, before = [] } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = await findSmartApplyTab(ctx, before);
  while (Date.now() < deadline) {
    const page = await findSmartApplyTab(ctx, before);
    if (page) {
      last = page;
      let url = '';
      try { url = page.url(); } catch {}
      if (FORM_RE.test(url)) return page;
      // If we've already reached a terminal state (confirmation or a visible human-check), stop
      // polling and let the step loop handle it.
      try { if (await confirmed(page)) return page; } catch {}
      try { if (await visibleHumanCheck(page)) return page; } catch {}
    }
    await SLEEP(500);
  }
  // Timed out — return the last page we saw (loop degrades gracefully: confirm/human-check/advance).
  return last;
}

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

// Prefer a SmartApply tab that did not exist before this apply started. Stale SmartApply tabs
// from earlier runs sit in the window; picking the first match drove the wrong job's form.
async function findSmartApplyTab(ctx, before = []) {
  const matches = ctx.pages().filter(p => { try { return SMARTAPPLY_RE.test(p.url()); } catch { return false; } });
  const fresh = matches.filter(p => !before.includes(p));
  return fresh[fresh.length - 1] || matches[matches.length - 1] || null;
}

// SmartApply renders its form (resume selection, questions, review + "Submit your application")
// inside a child frame, not the top document. Find the frame that actually holds the apply
// controls so fill/advance/confirm operate where the form really lives. Falls back to the main
// frame. Returns a Playwright Frame.
async function contentFrame(page) {
  // Depth of a frame in the frame tree (mainFrame = 0). Used to prefer the deepest/most-specific
  // module frame over an outer wrapper when scores tie.
  const depthOf = fr => { let d = 0, f = fr; try { while (f && f.parentFrame && f.parentFrame()) { d++; f = f.parentFrame(); } } catch {} return d; };

  const candidates = [];
  for (const fr of page.frames()) {
    let url = '';
    try { url = fr.url() || ''; } catch {}
    // Never treat a captcha iframe as the form frame.
    if (/recaptcha|hcaptcha|turnstile/i.test(url)) continue;
    // Prefer real form-module frames; fall back to other smartapply frames that are not the
    // top/site-chrome frame (the mainFrame is the Indeed site chrome on the interstitial).
    const isForm = FORM_RE.test(url);
    const isSmart = /smartapply/i.test(url) && fr !== page.mainFrame();
    if (!isForm && !isSmart) continue;

    // Score = number of real form controls + whether a primary action exists. The primary-action
    // matcher mirrors clickAdvance() (data-testid OR text on the element or a nested span), and
    // explicitly excludes any reCAPTCHA control.
    const score = await fr.evaluate(() => {
      const controls = document.querySelectorAll('input:not([type=hidden]):not([name="g-recaptcha-response"]),select,textarea').length;
      const TID = /continue-button|form-action-continue|^continue$|submit|review|next/i;
      const TXT = /submit your application|submit application|^submit$|continue|review your application|^review$|^next$/i;
      const els = [...document.querySelectorAll('button, [role="button"], [data-testid]')];
      const hasAction = els.some(el => {
        if (el.disabled) return false;
        if (el.closest('.g-recaptcha, [data-testid*="recaptcha" i], iframe[src*="recaptcha" i]')) return false;
        if (el.id === 'g-recaptcha-response') return false;
        const tid = el.getAttribute('data-testid') || '';
        if (tid && TID.test(tid)) return true;
        const own = (el.innerText || '').trim();
        if (own && TXT.test(own)) return true;
        for (const sp of el.querySelectorAll('span')) { if (TXT.test((sp.textContent || '').trim())) return true; }
        return false;
      });
      return controls + (hasAction ? 1 : 0);
    }).catch(() => 0);

    if (score > 0) candidates.push({ fr, score, isForm, depth: depthOf(fr) });
  }

  if (candidates.length) {
    candidates.sort((a, b) => {
      if (a.isForm !== b.isForm) return a.isForm ? -1 : 1;   // form-module frames first
      if (b.score !== a.score) return b.score - a.score;      // most controls/action next
      return b.depth - a.depth;                               // deepest/most-specific on ties
    });
    return candidates[0].fr;
  }
  return page.mainFrame();
}

// Fill the fields on the current SmartApply step from profile + answer engine. Never touches the
// g-recaptcha-response field. Operates on a Frame (the SmartApply content frame). Returns the
// list of required questions it could NOT answer.
async function fillStep(frame) {
  const p = getProfile();
  // Scan the step into (a) a flat list of SELECT/text fields, and (b) a map of radio/checkbox
  // groups keyed by `name`, each carrying the real option labels + the group's question text.
  const scan = await frame.evaluate(() => {
    const textOf = el => {
      // Visible label for a control: its <label>, aria-label, placeholder, or nearest wrapping
      // <label>/preceding text. Used both for option labels and for the group question.
      let t = (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || '').trim();
      if (t) return t;
      const wrap = el.closest('label');
      if (wrap) { t = (wrap.innerText || '').trim(); if (t) return t; }
      const prev = el.previousElementSibling;
      if (prev) { t = (prev.innerText || prev.textContent || '').trim(); if (t) return t; }
      return '';
    };
    // The question a group belongs to: nearest <fieldset>'s <legend>, else a preceding heading/
    // question-like element, else the first option's label.
    const groupQuestion = el => {
      const fs = el.closest('fieldset');
      if (fs) { const lg = fs.querySelector('legend'); const t = (lg?.innerText || '').trim(); if (t) return t; }
      let node = el.closest('[role="group"], div, section') || el.parentElement;
      for (let i = 0; node && i < 4; i++, node = node.parentElement) {
        const h = node.querySelector && node.querySelector('legend, h1, h2, h3, h4, label, [class*="question" i], [class*="label" i]');
        if (h) { const t = (h.innerText || h.textContent || '').trim(); if (t && t.length > 2) return t; }
      }
      return '';
    };

    const fields = [];
    const groups = {};
    // Custom dropdowns: SmartApply renders SELECT screener questions as a role=combobox div
    // (data-testid input-<name>-select-list-select-list) with role=option children — there is
    // no <select> element, so the native select path never sees them and Continue stays blocked
    // with "Choose an option to continue."
    const combos = [];
    for (const el of document.querySelectorAll('[role="combobox"]')) {
      const tid = el.getAttribute('data-testid') || '';
      const m = tid.match(/^input-(.+)-select-list-select-list$/);
      if (!m) continue;
      const cur = (el.innerText || '').trim();
      if (!/^select an option$/i.test(cur)) continue; // already answered
      const by = el.getAttribute('aria-labelledby');
      const label = (by && document.getElementById(by)?.innerText || '').replace(/\s+/g, ' ').trim();
      combos.push({ name: m[1], label });
    }
    // SmartApply renders its screener inputs with opaque names (q_<hash>) and no attached
    // <label>; the question wording lives only in window._initialData.screenerQuestions. Map
    // name → question text so the answer engine sees the real question, not the hash.
    const initial = {}, initialOptions = {}, initialReq = {};
    try {
      const qs = (window._initialData && window._initialData.screenerQuestions) || [];
      for (const q of qs) {
        if (!q || !q.name) continue;
        initial[q.name] = String(q.labelHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        initialOptions[q.name] = (q.options || []).map(o => String(o.label ?? o.value ?? '')).filter(Boolean);
        initialReq[q.name] = !!q.required;
      }
    } catch {}
    for (const el of document.querySelectorAll('input,select,textarea')) {
      if (el.type === 'hidden' || el.name === 'g-recaptcha-response') continue;
      if (el.type === 'radio' || el.type === 'checkbox') {
        const name = el.name || el.id || '';
        if (!name) continue;
        const g = groups[name] || (groups[name] = { name, type: el.type, question: '', options: [], required: false });
        g.options.push({ value: el.value || '', label: textOf(el) || el.value || '', checked: !!el.checked });
        if (el.required) g.required = true;
        if (!g.question) g.question = groupQuestion(el);
        continue;
      }
      fields.push({ tag: el.tagName, type: el.type || '', name: el.name || el.id || '', label: textOf(el), required: el.required, value: el.value || '', options: el.tagName === 'SELECT' ? [...el.options].map(o => (o.text || o.value || '').trim()).filter(Boolean) : [] });
    }
    return { fields, groups: Object.values(groups), initial, initialOptions, initialReq, combos };
  }).catch(() => ({ fields: [], groups: [], initial: {}, initialOptions: {}, initialReq: {}, combos: [] }));

  const unanswered = [];

  // ── Radio / checkbox groups: pick a real option label, select by name+value with verified
  //    click + dispatched React events, fall back to Playwright .check(), then verify .checked.
  for (const g of scan.groups || []) {
    const q = (scan.initial && scan.initial[g.name]) || g.question || g.name;
    if (!q) continue;
    if (g.options.some(o => o.checked)) continue; // already answered (e.g. harvested/prefilled)
    try {
      const picked = choiceAnswer(q, g.options.map(o => o.label));
      if (!picked) { if (g.required) { unanswered.push(q); askLater(q); } continue; }
      const value = chooseRadioValue(g, picked);

      // (a)+(b) in-frame: find input by name+value (or by matching label text), set checked and
      // dispatch click/input/change so React's controlled state updates and Continue enables.
      const okInFrame = await frame.evaluate(({ name, value, label }) => {
        const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
        let input = null;
        if (value != null) input = document.querySelector(`input[name="${esc(name)}"][value="${esc(value)}"]`);
        if (!input) {
          const inputs = [...document.querySelectorAll(`input[name="${esc(name)}"]`)];
          const want = String(label || '').trim().toLowerCase();
          input = inputs.find(el => {
            const t = (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.closest('label')?.innerText || el.value || '').trim().toLowerCase();
            return t === want || (want && t.includes(want));
          }) || null;
        }
        if (!input) return false;
        input.checked = true;
        for (const ev of ['input', 'change', 'click']) input.dispatchEvent(new Event(ev, { bubbles: true }));
        return input.checked === true;
      }, { name: g.name, value, label: picked }).catch(() => false);

      if (!okInFrame) {
        // Playwright fallback: locator by name+value, else by label.
        let checked = false;
        if (value != null) {
          try {
            const byVal = frame.locator(`input[name="${g.name}"][value="${String(value).replace(/"/g, '\\"')}"]`).first();
            if (await byVal.count().catch(() => 0)) { await byVal.check({ timeout: 2000 }); checked = true; }
          } catch {}
        }
        if (!checked) {
          try {
            const re = new RegExp(String(picked).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            await frame.getByLabel(re).first().check({ timeout: 2000 });
          } catch {}
        }
      }

      // Verify a required group ended with a checked option; otherwise park it.
      const nowChecked = await frame.evaluate(name => {
        const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
        return [...document.querySelectorAll(`input[name="${esc(name)}"]`)].some(el => el.checked);
      }, g.name).catch(() => false);
      if (!nowChecked && g.required) { unanswered.push(q); askLater(q); }
    } catch {}
  }

  // ── Custom dropdowns (role=combobox): open the list, click the matching role=option.
  for (const c of scan.combos || []) {
    const q = (scan.initial && scan.initial[c.name]) || c.label || c.name;
    const opts = (scan.initialOptions && scan.initialOptions[c.name]) || [];
    const required = !!(scan.initialReq && scan.initialReq[c.name]);
    try {
      const pick = choiceAnswer(q, opts);
      if (!pick) { if (required) { unanswered.push(q); askLater(q); } continue; }
      const trigger = `[data-testid="input-${c.name}-select-list-select-list"]`;
      await frame.click(trigger, { timeout: 3000 }).catch(() => {});
      await SLEEP(500);
      let chosen = await frame.locator(`[data-testid="input-${c.name}-select-list-${pick}"]`).first()
        .click({ timeout: 3000 }).then(() => true).catch(() => false);
      if (!chosen) {
        const re = new RegExp('^\\s*' + String(pick).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
        chosen = await frame.locator('li[role="option"],[role="option"]').filter({ hasText: re }).first()
          .click({ timeout: 3000 }).then(() => true).catch(() => false);
      }
      const ok = await frame.evaluate(({ sel, pick }) => {
        const el = document.querySelector(sel);
        const t = (el?.innerText || '').trim().toLowerCase();
        return !!t && t !== 'select an option' && t.includes(String(pick).toLowerCase());
      }, { sel: trigger, pick }).catch(() => false);
      if (!ok && required) { unanswered.push(q); askLater(q); }
    } catch {}
  }

  // ── SELECT + text/number fields.
  for (const f of scan.fields || []) {
    const q = (scan.initial && scan.initial[f.name]) || f.label || f.name;
    if (!q) continue;
    try {
      if (f.tag === 'SELECT') {
        if (f.value) continue;
        const a = choiceAnswer(q, f.options || []);
        if (a) await frame.selectOption(`[name="${f.name}"]`, { label: String(a) }).catch(() => {});
        else if (f.required) { unanswered.push(q); askLater(q); }
      } else {
        if (f.value) continue;
        const numeric = f.type === 'number' || /salary|years|experience|notice|how many|number/i.test(q);
        const a = textAnswer(q, { numeric });
        if (a != null && a !== '') {
          const loc = frame.locator(f.name ? `[name="${f.name}"]` : `textbox`).first();
          await loc.fill(String(a), { timeout: 2500 }).catch(() => {});
          // SmartApply is React-controlled: dispatch input+change so the filled value registers
          // and the Continue button enables.
          if (f.name) {
            await frame.evaluate(name => {
              const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
              const el = document.querySelector(`[name="${esc(name)}"]`);
              if (el) for (const ev of ['input', 'change']) el.dispatchEvent(new Event(ev, { bubbles: true }));
            }, f.name).catch(() => {});
          }
        } else if (f.required) { unanswered.push(q); askLater(q); }
      }
    } catch {}
  }
  return unanswered;
}

async function clickAdvance(frame) {
  // Click Continue / Review / Submit — the SmartApply primary action, inside the content frame.
  // SmartApply addresses the button by data-testid (e.g. continue-button, form-action-continue)
  // and often puts the visible label on a nested <span>, so match by testid OR own/nested-span
  // text. NEVER match or click the reCAPTCHA control.
  // The primary control briefly disables while the module commits a freshly filled answer, so
  // poll for an enabled, visible primary instead of giving up on the first look.
  for (let attempt = 0; attempt < 10; attempt++) {
    const inPage = await frame.evaluate(() => {
      const SUBMIT = /submit your application|submit application|^submit$/i;
      const CONT = /continue|review your application|^review$|^next$/i;
      const TID = /continue-button|form-action-continue|submit|review|next/i;
      const isCaptcha = el =>
        el.id === 'g-recaptcha-response' ||
        !!el.closest('.g-recaptcha, [data-testid*="recaptcha" i], iframe[src*="recaptcha" i]');
      const label = el => {
        const own = (el.innerText || '').trim();
        if (own) return own;
        for (const sp of el.querySelectorAll('span')) { const t = (sp.textContent || '').trim(); if (t) return t; }
        return (el.getAttribute('aria-label') || el.getAttribute('data-testid') || '').trim();
      };
      const textMatch = (el, re) => {
        const own = (el.innerText || '').trim();
        if (own && re.test(own)) return true;
        for (const sp of el.querySelectorAll('span')) { if (re.test((sp.textContent || '').trim())) return true; }
        return false;
      };
      // Only clickable controls (BUTTON / role=button), never the wrapper DIV/FIELDSET/LABEL that
      // SmartApply also tags with data-testid. A bare [data-testid] that is not a button is layout.
      // NB: do not filter on offsetParent — SmartApply's footer Continue is position:fixed, whose
      // offsetParent is null even though it is visible, which would wrongly exclude the real button.
      const clickable = [...document.querySelectorAll('button, [role="button"]')]
        .filter(el => !el.disabled && !isCaptcha(el))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      // SmartApply's canonical primary action — exact testids. Prefer these over the looser regex so
      // we hit the real footer button, not a duplicate/placeholder "hp-continue-button-N".
      const CANON = /^(continue-button|form-action-continue|submit-button|review-button)$/i;
      // Prefer a final submit, then the canonical testid, then continue/review/next by testid or text.
      const pick = re =>
        clickable.find(el => { const tid = el.getAttribute('data-testid') || ''; return tid && re.test(tid); }) ||
        clickable.find(el => textMatch(el, re));
      const primary =
        pick(SUBMIT) ||
        clickable.find(el => CANON.test(el.getAttribute('data-testid') || '')) ||
        clickable.find(el => { const tid = el.getAttribute('data-testid') || ''; return tid && TID.test(tid); }) ||
        pick(CONT);
      if (primary) {
        return { label: label(primary) || 'advance', tid: primary.getAttribute('data-testid') || '' };
      }
      return null;
    }).catch(() => null);

    if (inPage) {
      // A synthetic DOM .click() does not reliably run this module's React handler (the questions
      // footer stayed on the page while a real pointer click advanced). Click through Playwright,
      // which dispatches a trusted pointer sequence, and keep the DOM click as a last resort.
      if (inPage.tid) {
        try {
          const byTid = frame.locator(`[data-testid="${inPage.tid}"]`).first();
          if (await byTid.count().catch(() => 0)) {
            await byTid.click({ timeout: 4000 });
            return inPage.label;
          }
        } catch {}
      }
      try {
        const byRole = frame.getByRole('button', { name: new RegExp(`^\\s*${inPage.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') }).first();
        if (await byRole.count().catch(() => 0)) {
          await byRole.click({ timeout: 4000 });
          return inPage.label;
        }
      } catch {}
      // Last resort: in-page click on the element we identified.
      const clicked = await frame.evaluate(tid => {
        const el = tid
          ? document.querySelector(`button[data-testid="${tid}"], [role="button"][data-testid="${tid}"]`)
          : null;
        if (el) { el.click(); return true; }
        return false;
      }, inPage.tid).catch(() => false);
      if (clicked) return inPage.label;
    }

    // Classic testids (older SmartApply builds) are worth one Playwright shot even before retrying.
    for (const tid of ['form-action-continue', 'continue-button', 'submit-button']) {
      try {
        const byTid = frame.getByTestId(tid).first();
        if (await byTid.count().catch(() => 0)) { await byTid.click({ timeout: 2500 }); return tid; }
      } catch {}
    }
    await SLEEP(800);
  }
  return null;
}

// When clickAdvance() finds no ENABLED primary, check whether a DISABLED primary exists (same
// CANON/TID/text matchers, but without the `!el.disabled` filter). This distinguishes "the
// Continue button is there but disabled pending required answers" from "there is no button at
// all", so the step loop can surface a clean, specific message instead of the generic error.
async function findDisabledPrimary(frame) {
  return await frame.evaluate(() => {
    const SUBMIT = /submit your application|submit application|^submit$/i;
    const CONT = /continue|review your application|^review$|^next$/i;
    const TID = /continue-button|form-action-continue|submit|review|next/i;
    const CANON = /^(continue-button|form-action-continue|submit-button|review-button)$/i;
    const isCaptcha = el =>
      el.id === 'g-recaptcha-response' ||
      !!el.closest('.g-recaptcha, [data-testid*="recaptcha" i], iframe[src*="recaptcha" i]');
    const textMatch = (el, re) => {
      const own = (el.innerText || '').trim();
      if (own && re.test(own)) return true;
      for (const sp of el.querySelectorAll('span')) { if (re.test((sp.textContent || '').trim())) return true; }
      return false;
    };
    const buttons = [...document.querySelectorAll('button, [role="button"]')]
      .filter(el => !isCaptcha(el))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const match = el => {
      const tid = el.getAttribute('data-testid') || '';
      if (tid && (CANON.test(tid) || TID.test(tid))) return true;
      return textMatch(el, SUBMIT) || textMatch(el, CONT);
    };
    return buttons.some(el => el.disabled && match(el));
  }).catch(() => false);
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

// SmartApply shows its site chrome (and sometimes a "Preparing…" line) for several seconds
// before the current module paints its real controls. Stepping during that window finds
// nothing, clicks nothing, and the stall guard gives up on a page that was still loading.
// Wait until the frame holds real form controls or a primary action (or the page confirms).
async function waitForModulePaint(page, { timeoutMs = 25000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let reloaded = false;
  while (Date.now() < deadline) {
    const frame = await contentFrame(page);
    const state = await frame.evaluate(() => {
      if (/preparing review|preparing your application/i.test(document.body?.innerText || '')) return 'waiting';
      // reCAPTCHA injects a textarea early; it is not a form control and must not count as paint.
      const isChrome = el => el.name === 'g-recaptcha-response'
        || !!el.closest('.g-recaptcha, [data-testid*="recaptcha" i], iframe');
      const controls = [...document.querySelectorAll('input:not([type="hidden"]),select,textarea')]
        .filter(el => !isChrome(el)).length;
      // The questions module is a federated remote script; until it loads there are zero real
      // controls, only site chrome. Its inputs are the q_* screener fields.
      if (/questions-module/i.test(location.href || '')) return controls > 0 ? 'painted' : 'waiting';
      const action = [...document.querySelectorAll('button,[role="button"]')].some(el => {
        if (el.disabled) return false;
        const tid = el.getAttribute('data-testid') || '';
        const label = (el.innerText || '').trim();
        return /continue-button|form-action-continue|submit|review|next/i.test(tid)
          || /continue|submit|review|next/i.test(label);
      });
      return controls > 0 || action ? 'painted' : 'waiting';
    }).catch(() => 'waiting');
    if (state === 'painted') return frame;
    if (await confirmed(page)) return null;
    // A failed remote load leaves the questions module permanently blank; one reload re-runs the
    // loader and usually paints the inputs.
    if (!reloaded && Date.now() > deadline - timeoutMs + 12000
        && /questions-module/i.test(String((() => { try { return frame.url(); } catch { return page.url(); } })()))) {
      reloaded = true;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await SLEEP(1500);
      continue;
    }
    await SLEEP(1000);
  }
  return await contentFrame(page);
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
  const before = ctx.pages();
  let page;

  if (resume) {
    page = await findSmartApplyTab(ctx, before);
    pageRef.page = page;
    if (!page) return { ok: false, result: 'error', detail: 'no open SmartApply tab to resume — start the apply again', url: jobUrl };
    await page.bringToFront().catch(() => {});
    // A resumed tab may still be on the interstitial — give it a chance to land on the form module
    // before the confirm/human-check/advance checks below run.
    page = (await waitForFormModule(ctx)) || page;
    pageRef.page = page;
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
    const sa = await findSmartApplyTab(ctx, before);
    if (sa) { page = sa; pageRef.page = sa; }
    // Wait for the interstitial (applybyapplyablejobid) to redirect to a real form module before
    // the step loop tries to fill/advance — the fixed SLEEP above does not guarantee the redirect.
    page = (await waitForFormModule(ctx, { before })) || page;
    pageRef.page = page;
  }

  // Walk the multi-step form. Stop and hand off the moment a VISIBLE human-check appears.
  // Track the form-module URL across iterations: if repeated advance clicks never change the
  // module (and no required question is unanswered), we are clicking a dead/placeholder control
  // and must stop re-clicking the same page rather than burn all 10 steps on it.
  let prevModuleUrl = '';
  let sameModuleClicks = 0;
  for (let step = 0; step < 10; step++) {
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

    const frame = await waitForModulePaint(page);
    if (!frame) return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };

    // Which SmartApply module are we on? (path after /form/, query stripped). Used for the stall
    // guard: resume-selection-module/..., questions-module/questions/1, review-module, etc.
    let moduleUrl = '';
    try { moduleUrl = (frame.url() || page.url()).split('?')[0]; } catch { moduleUrl = page.url(); }
    if (prevModuleUrl && moduleUrl === prevModuleUrl) sameModuleClicks++; else sameModuleClicks = 0;

    // The review module renders a "Preparing review…" placeholder first; the Submit control
    // appears only once that resolves (often several seconds). Without this wait the stall
    // guard fires on a healthy review page before there is anything to click.
    if (/review-module/i.test(moduleUrl)) {
      const readyBy = Date.now() + 25000;
      while (Date.now() < readyBy) {
        const ready = await frame.evaluate(() => {
          const b = document.querySelector('[data-testid="submit-application-button"], [data-testid="submit-button"]');
          return !!(b && !b.disabled);
        }).catch(() => false);
        if (ready) break;
        if (await confirmed(page)) return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };
        await SLEEP(1000);
      }
    }

    const unanswered = await fillStep(frame);
    if (unanswered.length) {
      return { ok: false, result: 'needs_answers', detail: 'needs your answer: ' + unanswered.slice(0, 4).join(' | ').slice(0, 300), questions: unanswered, url: page.url() };
    }

    // Stall guard: if we have revisited this exact module 3 times with no progress and no
    // unanswered required question, the primary control is dead/placeholder (e.g. SmartApply's
    // off-screen hp-continue-button-N) — stop and record the encounter for self-evolution rather
    // than returning a vague 10-step timeout.
    if (sameModuleClicks >= 2) {
      await encounter('smartapply_stall', 'advance did not change module: ' + moduleUrl.replace(/^https?:\/\/[^/]+/, ''), { url: page.url(), page }).catch(() => {});
      return { ok: false, result: 'error', detail: 'SmartApply did not advance past ' + (moduleUrl.split('/form/')[1] || moduleUrl) + ' after repeated Continue clicks (likely a dead/placeholder control)', url: page.url() };
    }

    const advanced = await clickAdvance(frame);
    prevModuleUrl = moduleUrl;
    // The final Submit can take longer than one loop beat (reCAPTCHA check + post-apply
    // redirect). Wait for the outcome here so a slow submit is not mistaken for a stall or
    // for a disabled Continue button.
    if (advanced && /submit/i.test(String(advanced))) {
      const doneBy = Date.now() + 30000;
      while (Date.now() < doneBy) {
        if (await confirmed(page)) return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };
        if (await visibleHumanCheck(page)) break;
        await SLEEP(1500);
      }
    }
    if (!advanced) {
      // No ENABLED primary and no confirmation — either done, or the Continue button is present
      // but disabled pending answers. Give the page a beat, then disambiguate.
      await SLEEP(1500);
      if (await confirmed(page)) return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };

      const disabledPrimary = await findDisabledPrimary(frame);
      if (disabledPrimary) {
        if (unanswered.length) {
          // A required question we couldn't answer from the profile left Continue disabled →
          // log it to the dashboard Questions tab rather than a generic error.
          return { ok: false, result: 'needs_answers', detail: 'needs your answer: ' + unanswered.slice(0, 4).join(' | ').slice(0, 300), questions: unanswered, url: page.url() };
        }
        // We filled everything we could, yet Continue stayed disabled — specific + debuggable.
        return { ok: false, result: 'error', detail: 'Continue stayed disabled after filling required answers', url: page.url() };
      }
      // No button found yet and nothing disabled either. On SmartApply the review-module's
      // "Submit your application" button renders a beat after the module loads, so a single miss is
      // not terminal — let the loop retry this same module. The sameModuleClicks guard above
      // bounds this so we never spin forever.
      if (step < 9) continue;
      return { ok: false, result: 'error', detail: 'could not find a Continue/Submit button to advance', url: page.url() };
    }
    // If we just clicked the final submit, a human-check often fires right here — the loop's next
    // iteration detects it and hands off.
  }

  if (await confirmed(page)) return { ok: true, result: 'submitted', detail: 'Application submitted + confirmed', url: page.url() };
  return { ok: false, result: 'error', detail: 'flow did not reach a confirmation after 10 steps', url: page.url() };
}
