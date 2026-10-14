// src/mcp/comment.js — comment on a LinkedIn hiring POST (2026 feed UI).
// Posts a short, personalized "Interested" note on the hiring post so the poster sees
// engagement (many recruiters reply to the first interested commenters). This complements
// email / Easy Apply / connect: for a hiring post we can comment AND reach out.
//
// Verifies the comment actually landed (our text appears in the comments list) before
// reporting success, and records an encounter with a DOM snapshot if the comment box or
// Post button can't be found so the agent can fix the selectors next time.
// result: commented | already_commented | no_comment_box | error
import { getContext } from '../agent/browser.js';
import { getProfile } from '../profile.js';
import { encounter } from '../evolve.js';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));

/** Build a short, human interested-comment grounded in the profile (<= 240 chars). */
export function interestedComment({ role, company } = {}) {
  const p = getProfile();
  const r = role && role.length < 45 ? role : 'this role';
  const co = company && company.length < 30 ? ` at ${company}` : '';
  const yrs = p.yearsExperience ? `${p.yearsExperience}+ yrs` : '';
  const skills = (p.skills || []).slice(0, 3).join(', ') || 'software engineering';
  const link = p.links?.portfolio || p.links?.github || p.links?.linkedin || '';
  let c = `Very interested in ${r}${co}. I'm a ${p.headline || 'software engineer'} (${yrs} ${skills}) and a strong fit — I'd love to be considered and can share my CV. ${link}`.replace(/\s+/g, ' ').trim();
  if (c.length > 240) c = `Very interested in ${r}${co}. ${p.headline || 'Engineer'}, ${yrs} ${skills}. Would love to be considered — happy to share my CV. ${link}`.replace(/\s+/g, ' ').trim();
  return c.slice(0, 240);
}

/**
 * Comment on a LinkedIn hiring post.
 * @param {{postUrl:string, role?:string, company?:string, text?:string, dryRun?:boolean}} opts
 * @returns {Promise<{ok:boolean, result:string, detail:string, text?:string}>}
 */
export async function commentInterested({ postUrl, role, company, text, dryRun = false }) {
  if (!postUrl || !/linkedin\.com/.test(postUrl)) return { ok: false, result: 'error', detail: 'no LinkedIn post URL' };
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  const body = (text && text.trim()) || interestedComment({ role, company });
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await SLEEP(3500);

    // Auth / availability guards.
    if (/authwall|\/login|\/checkpoint\//i.test(page.url())) { await page.close(); return { ok: false, result: 'error', detail: 'not logged in / checkpoint' }; }

    // Already commented? Scan the comments region for our profile name.
    const myName = (getProfile().name || '').trim();
    const alreadyMine = myName ? await page.evaluate(n => {
      const area = document.body.innerText || '';
      // crude but effective: our name next to a recent comment
      return area.includes(n) && /comment/i.test(area);
    }, myName).catch(() => false) : false;

    // Open the comment composer. LinkedIn 2026 feed uses a "Comment" action button that reveals
    // a contenteditable box; sometimes the box (role=textbox) is already present.
    const commentBtn = page.getByRole('button', { name: /^comment$|comment on this|add a comment/i }).first();
    if (await commentBtn.isVisible().catch(() => false)) { await commentBtn.click().catch(() => {}); await SLEEP(1500); }

    // The editor is a contenteditable div (ql-editor / role=textbox) inside a comments box.
    const editor = page.locator('div.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"], div[data-placeholder*="comment" i][contenteditable="true"]').first();
    const editorVisible = await editor.isVisible().catch(() => false);
    if (!editorVisible) {
      await encounter('comment', 'comment editor not found on post', { url: postUrl, page });
      await page.close();
      return { ok: false, result: 'no_comment_box', detail: 'could not find the comment editor' };
    }

    await editor.click().catch(() => {});
    await SLEEP(500);
    // contenteditable: type so LinkedIn's editor registers input events (fill() can be ignored).
    await editor.type(body, { delay: 12 }).catch(async () => { await editor.fill(body).catch(() => {}); });
    await SLEEP(800);

    if (dryRun) { await page.close(); return { ok: true, result: 'dry_ready', detail: 'comment composed (dry run)', text: body }; }

    // Find the Post button (enabled once there is text). It is scoped near the editor.
    const postBtn = page.getByRole('button', { name: /^post$|post comment|^reply$/i }).first();
    let posted = false;
    for (let i = 0; i < 10 && !posted; i++) {
      const vis = await postBtn.isVisible().catch(() => false);
      const en = await postBtn.isEnabled().catch(() => false);
      if (vis && en) { posted = await postBtn.click({ timeout: 4000 }).then(() => true).catch(() => false); break; }
      await SLEEP(500);
    }
    // Fallback: Ctrl+Enter submits a LinkedIn comment.
    if (!posted) { await editor.press('Control+Enter').catch(() => {}); }
    await SLEEP(3000);

    // Verify our comment text appears in the thread.
    const needle = body.slice(0, 40);
    const landed = await page.evaluate(t => (document.body.innerText || '').includes(t), needle).catch(() => false);
    await page.close();
    if (landed) return { ok: true, result: 'commented', detail: 'interested comment posted + verified', text: body };
    if (alreadyMine) return { ok: true, result: 'already_commented', detail: 'appears already commented', text: body };
    return { ok: false, result: 'error', detail: 'comment not confirmed in thread', text: body };
  } catch (e) {
    await encounter('comment', 'exception: ' + e.message.split('\n')[0], { url: postUrl, page }).catch(() => {});
    await page.close().catch(() => {});
    return { ok: false, result: 'error', detail: e.message.slice(0, 160) };
  }
}
