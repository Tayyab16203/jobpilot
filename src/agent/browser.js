// src/agent/browser.js — Attach to the user's real Chrome over CDP.
// Playwright is the automation engine; CDP (:9222) is the transport that lets it
// drive YOUR Chrome with YOUR logins, instead of a fresh logged-out browser.
// Designed to run inside ONE long-lived process (the MCP server), which launches
// debug-Chrome once and keeps it alive for the whole scrape+apply session.
import { chromium } from 'playwright';
import fetch from 'node-fetch';
import { CDP } from '../config.js';

let _browser = null;

export async function cdpStatus() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${CDP}/json/version`, { signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);
    if (!r || !r.ok) return { ok: false, reason: `CDP not reachable at ${CDP}` };
    const v = await r.json();
    // Prefer the explicit browser-level WS URL — avoids Playwright's own discovery
    // timing out when Chrome has many tabs/contexts loaded.
    return { ok: true, version: v.Browser, userAgent: v['User-Agent'], wsUrl: v.webSocketDebuggerUrl };
  } catch (e) { clearTimeout(t); return { ok: false, reason: e.message }; }
}

// Prune stale/zombie targets before attaching. connectOverCDP enumerates every open
// target on attach; a hung page/iframe/worker left over from a previous (killed) process
// makes that enumeration hang for the full timeout — the real cause of the recurring
// "connectOverCDP: Timeout 60000ms exceeded" even though /json/version returns 200.
// We close blank and about:blank pages and any obviously stuck targets via the CDP HTTP
// API (which does NOT need Playwright), keeping at most a couple of real pages.
async function pruneStaleTargets() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${CDP}/json/list`, { signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);
    if (!r || !r.ok) return;
    const targets = await r.json().catch(() => []);
    const pages = targets.filter(x => x.type === 'page');
    // Close blank/new-tab pages; they add attach cost and are never useful to us.
    const closable = pages.filter(p => /^(about:blank|chrome:\/\/newtab|chrome:\/\/new-tab-page)/i.test(p.url || '') || !(p.url || '').trim());
    // If there are a lot of pages, also close the oldest extras (keep the 3 most recent real ones).
    const realExtra = pages.filter(p => !closable.includes(p)).slice(3);
    for (const p of [...closable, ...realExtra]) {
      if (!p.id) continue;
      const c = new AbortController(); const ct = setTimeout(() => c.abort(), 2500);
      await fetch(`${CDP}/json/close/${p.id}`, { signal: c.signal }).catch(() => {});
      clearTimeout(ct);
    }
  } catch {}
}

export async function getBrowser() {
  // Validate the cached connection cheaply. isConnected() can report true on a
  // half-dead channel, so if a later newPage() fails the caller drops the cache
  // via resetBrowser(). Here we just reuse a live-looking connection.
  if (_browser && _browser.isConnected()) return _browser;
  _browser = null;
  let status = await cdpStatus();
  if (!status.ok) {
    // Self-heal: auto-launch the debug Chrome on demand so no one ever has to ask.
    try {
      const { launchChrome } = await import('../mcp/chrome.js');
      await launchChrome();
      for (let i = 0; i < 20 && !status.ok; i++) { await new Promise(r => setTimeout(r, 1500)); status = await cdpStatus(); }
    } catch {}
  }
  if (!status.ok) {
    throw new Error(`Chrome CDP not available (${status.reason}). Tried to auto-launch it; if this persists, open Chrome once.`);
  }

  // Prune stale targets BEFORE attaching so enumeration can't hang on a zombie page.
  await pruneStaleTargets();

  // Use the browser-level WebSocket URL directly from /json/version.
  // This skips Playwright's own CDP discovery step that times out when Chrome
  // has many open tabs/contexts.
  const wsEndpoint = status.wsUrl || CDP;
  let lastErr;
  // Shorter per-attempt timeout (20s) so a hung attach fails fast and we retry on a
  // fresh connection + re-prune, instead of blocking the whole lane for 60s×3.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      // Chrome 155 rejects Playwright's Browser.setDownloadBehavior command
      // when it is attached over CDP. Skip Playwright's default context-management.
      _browser = await chromium.connectOverCDP(wsEndpoint, { timeout: 20000, noDefaults: true });
      return _browser;
    } catch (e) {
      lastErr = e;
      _browser = null;
      if (attempt < 4) { await pruneStaleTargets(); await new Promise(r => setTimeout(r, 2000 * attempt)); }
    }
  }
  throw new Error(`connectOverCDP failed after 4 attempts: ${lastErr?.message}`);
}

/** Drop the cached browser so the next getBrowser() reconnects fresh. */
export function resetBrowser() { try { _browser?.close?.().catch(() => {}); } catch {} _browser = null; }

export async function getContext() {
  try {
    const b = await getBrowser();
    return b.contexts()[0] || await b.newContext();
  } catch (e) {
    // Half-dead cached connection: reset and reconnect once before giving up.
    resetBrowser();
    const b = await getBrowser();
    return b.contexts()[0] || await b.newContext();
  }
}

export async function newPage(timeout = 30000) {
  let ctx;
  try {
    ctx = await getContext();
    const p = await ctx.newPage();
    p.setDefaultTimeout(timeout);
    return p;
  } catch (e) {
    // Context went stale between attach and newPage — reset and try once more.
    resetBrowser();
    ctx = await getContext();
    const p = await ctx.newPage();
    p.setDefaultTimeout(timeout);
    return p;
  }
}

// Verify a REAL logged-in session by navigating and reading auth signals —
// not by checking whether a tab happens to be open (a fresh profile has none).
// Returns { linkedin: bool, gmail: bool, detail: {...} }.
export async function verifyLogins() {
  const out = { linkedin: false, gmail: false, detail: {} };
  let page;
  try {
    page = await newPage(35000);
  } catch (e) {
    out.detail.error = e.message;
    return out;
  }
  // LinkedIn: authenticated feed shows the member nav (Home/Jobs/Messaging/Me)
  // and the member's own name. authwall/login URL = logged out.
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    const li = await page.evaluate(() => {
      const url = location.href;
      if (/\/login|\/uas\/login|authwall|\/signup/.test(url)) return { in: false, why: 'authwall/login url' };
      const txt = (document.body?.innerText || '');
      const hasNav = /\bMessaging\b/.test(txt) && /\bNotifications\b/.test(txt) && /\bJobs\b/.test(txt);
      const hasMe = !!document.querySelector('.global-nav__me, img.global-nav__me-photo, button.global-nav__primary-link-me-menu-trigger, [data-control-name="nav.settings_myprofile"]');
      return { in: hasNav || hasMe, why: hasNav ? 'member nav present' : hasMe ? 'me element' : 'no auth signal' };
    });
    out.linkedin = li.in;
    out.detail.linkedin = li.why;
  } catch (e) { out.detail.linkedin = 'error: ' + e.message; }

  // Gmail: inbox loads at mail.google.com/mail (no accounts.google.com redirect).
  try {
    await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);
    const gurl = page.url();
    out.gmail = /mail\.google\.com\/mail/.test(gurl) && !/accounts\.google\.com|ServiceLogin|signin/.test(gurl);
    out.detail.gmail = out.gmail ? 'inbox loaded' : ('redirected: ' + gurl);
  } catch (e) { out.detail.gmail = 'error: ' + e.message; }

  await page.close().catch(() => {});
  return out;
}

export async function listTabs() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(`${CDP}/json`, { signal: ctrl.signal });
    clearTimeout(t);
    const tabs = await r.json();
    return tabs
      .filter(t => t.type === 'page' && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-untrusted://'))
      .map(t => ({ title: t.title?.slice(0, 60), url: t.url?.slice(0, 80) }));
  } catch { clearTimeout(t); return []; }
}
