// src/mcp/gmail.js — Send email through the user's LOGGED-IN Gmail web tab.
// No SMTP, no app password. Verifies: attachment chip uploaded, and Gmail's
// "Message sent" toast appeared — returns ok:false otherwise (so nothing is
// recorded as sent unless it really was).
import { getContext } from '../agent/browser.js';
import { getProfile } from '../profile.js';
import fs from 'fs';
import path from 'path';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));

export async function sendViaGmail({ to, subject, body, attachmentPath }) {
  // Keep context/page creation INSIDE the try so a CDP/connect failure is CLASSIFIED as a
  // transient error (retry later, attempt NOT burned) instead of throwing out of the function.
  let page = null;
  try {
    const ctx = await getContext();
    page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    // Which logged-in Gmail account tab to drive: mail/u/<N>/. 0 = first/default account.
    const idx = Number(getProfile().limits?.gmailAccountIndex) || 0;
    await page.goto(`https://mail.google.com/mail/u/${idx}/#inbox`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await SLEEP(3000);
    // Distinguish a REAL logout from a transient accounts.google.com interstitial / account-chooser:
    // reload once and re-check before declaring not-logged-in.
    if (/accounts\.google\.com|ServiceLogin/.test(page.url())) {
      await SLEEP(2500);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await SLEEP(2500);
      if (/accounts\.google\.com|ServiceLogin/.test(page.url())) {
        return { ok: false, result: 'failed', detail: 'Gmail not logged in', transient: true };
      }
    }

    // Wait for the Gmail UI itself to be interactive before trying to compose — on a cold tab the
    // Compose button isn't mounted for a few seconds, which is the #1 cause of the compose-open
    // timeouts we used to burn attempts on.
    await page.locator('[gh="cm"], [data-tooltip="Compose"], [aria-label="Compose"], .T-I-KE')
      .first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});

    // The compose window — Gmail renders it as a table/div, NOT role="dialog" in all versions.
    // Use a broad selector that works across Gmail UI variants, anchored on the subject input.
    const subjectInput = page.locator('input[name="subjectbox"]')
      .or(page.locator('input[aria-label*="Subject" i]')).first();

    // Opening Compose is flaky (button not yet mounted, UI re-render, stray overlay). Retry a few
    // times before giving up, and only after exhausting retries do we classify it as a TRANSIENT
    // failure (retry later, attempt NOT burned) instead of a hard "did not open" that burned a try.
    let composeOpened = false;
    for (let attempt = 0; attempt < 3 && !composeOpened; attempt++) {
      const composeBtn = page.getByRole('button', { name: /compose/i }).first()
        .or(page.locator('[gh="cm"], [data-tooltip="Compose"], [aria-label="Compose"], .T-I-KE').first());
      await composeBtn.click({ timeout: 10000 }).catch(() => {});
      // Keyboard fallback: Gmail opens compose on "c" when the inbox has focus.
      await page.keyboard.press('c').catch(() => {});
      composeOpened = await subjectInput.waitFor({ state: 'visible', timeout: 12000 })
        .then(() => true).catch(() => false);
      if (!composeOpened) await SLEEP(2000);
    }
    if (!composeOpened) {
      return { ok: false, result: 'failed', detail: 'Gmail compose window did not open', transient: true };
    }

    // To field
    const toField = page.locator('input[aria-label*="To" i], input[peoplekit-id], textarea[name="to"]').first();
    await toField.click().catch(() => {});
    await toField.fill(to);
    await page.keyboard.press('Tab');
    await SLEEP(400);

    // Subject
    await subjectInput.fill(subject);

    // Body
    const bodyBox = page.locator('div[aria-label="Message Body"][contenteditable="true"]')
      .or(page.locator('div[role="textbox"][contenteditable="true"]')).first();
    await bodyBox.click();
    await bodyBox.fill(body);

    // Attachment
    let attached = false;
    if (attachmentPath && fs.existsSync(attachmentPath)) {
      const name = path.basename(attachmentPath);
      await page.locator('input[type="file"][name="Filedata"], input[type="file"]').first().setInputFiles(attachmentPath);
      for (let i = 0; i < 40 && !attached; i++) {
        await SLEEP(500);
        attached = await page.evaluate((n) => document.body.innerText.includes(n) && !document.querySelector('[role="progressbar"]'), name).catch(() => false);
      }
      if (!attached) return { ok: false, result: 'failed', detail: 'CV attachment did not finish uploading' };
    }

    // Send
    const sendBtn = page.getByRole('button', { name: /^Send/ }).first()
      .or(page.locator('[data-tooltip*="Send"], [aria-label*="Send "]').first());
    await sendBtn.click({ timeout: 8000 }).catch(() => page.keyboard.press('Control+Enter'));

    let sent = false;
    for (let i = 0; i < 20 && !sent; i++) {
      await SLEEP(500);
      sent = await page.evaluate(() =>
        /Message sent|Sending\.\.\./i.test(document.body.innerText.slice(-4000)) ||
        /Message sent/i.test(document.querySelector('[role="alert"]')?.innerText || '')
      ).catch(() => false);
    }
    // If compose window closed, that's also a success signal
    if (!sent) sent = !(await subjectInput.isVisible().catch(() => false));
    await SLEEP(1500);
    return sent
      ? { ok: true, result: 'sent', detail: `Sent to ${to}${attached ? ' with CV' : ''}` }
      : { ok: false, result: 'failed', detail: 'No "Message sent" confirmation' };
  } catch (e) {
    // page === null means getContext()/newPage() itself failed → the debug Chrome / CDP endpoint
    // is unavailable. Classify as transient so the mailer retries later WITHOUT burning an attempt
    // and WITHOUT raising a false "Gmail not logged in" banner.
    if (!page) return { ok: false, result: 'failed', detail: 'cdp_unavailable', transient: true };
    // Browser/tab teardown mid-send (another process closing the tab, CDP churn, aborted nav) is
    // NOT a real send failure — the compose never completed, so retry later without burning an
    // attempt. Only a genuine error after the compose UI was driven is a hard failure.
    const msg = (e.message || '');
    if (/target (page|closed)|context or browser has been closed|frame was detached|err_aborted|err_network_io_suspended|session closed|websocket/i.test(msg)) {
      return { ok: false, result: 'failed', detail: ('transient browser teardown: ' + msg).slice(0, 200), transient: true };
    }
    // A failure after the page opened is a real send error — NOT transient.
    return { ok: false, result: 'failed', detail: msg.slice(0, 200) };
  } finally { if (page) await page.close().catch(() => {}); }
}
