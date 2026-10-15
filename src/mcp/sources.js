// src/mcp/sources.js — Lead sources, FRESHEST FIRST. Every lead carries posted_at (ISO) so
// queues can be sorted newest-first, and a `channel` (email > easy_apply > form > connect).
//   liPosts      — LinkedIn hiring posts (past-24h, date-sorted) → emails / forms / poster
//   liJobs       — LinkedIn job listings (past-24h, remote, worldwide + PK), Easy Apply flag
//   hnHiring     — latest HN "Who is hiring?" thread, comments with emails, newest first
//   redditHiring — r/forhire, r/remotejs, r/jobbit … [Hiring] posts with emails
//   publicBoards — remoteok / remotive / himalayas / jobicy (email in description if any)
import fetch from 'node-fetch';
import { getContext } from '../agent/browser.js';
import { getProfile, excludedCompanyMatch } from '../profile.js';
import { isBadEmail } from '../tracker.js';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36';
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
// 2-letter ccTLDs + common gTLDs; rejects "name@first.last" false positives
const TLD_OK = /\.([a-z]{2}|com|net|org|io|ai|dev|app|tech|xyz|run|info|biz|cloud|group|studio|energy|health|works|agency|systems|digital|solutions|global|ventures|careers|jobs|team|today|software|email|codes|inc|llc|company|network|labs|finance|capital|world|media|design|tools|games|space|site|online|pro|so|sh|gg|me)$/;

export function emailsIn(text = '', { needContext = false } = {}) {
  const deob = text.replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, '@').replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, '.');
  const found = [...new Set((deob.match(EMAIL_RE) || []).map(e => e.replace(/\.$/, '').toLowerCase()))].filter(e => !isBadEmail(e) && TLD_OK.test(e));
  if (!needContext) return found;
  // boards: only addresses that sit next to an apply instruction (not HR/legal boilerplate)
  return found.filter(e => { const i = deob.toLowerCase().indexOf(e); const ctx = deob.slice(Math.max(0, i - 160), i).toLowerCase(); return /apply|cv|resume|send|email (us|me)|reach out|interested|application|to:|contact/.test(ctx) && !/accommodat|disabilit|privacy|eeo|equal opportunity|questions about/.test(ctx); });
}

/** "3h", "20 minutes ago", "1 day ago", "2w", "1mo" → ISO */
export function relToIso(s = '') {
  const m = String(s).toLowerCase().match(/(\d+)\s*(s|sec|m(?!o)|min|minute|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\b/);
  if (!m) return '';
  const n = +m[1], u = m[2];
  const sec = /^s/.test(u) ? 1 : /^(m|min|minute)$/.test(u) ? 60 : /^h/.test(u) ? 3600 : /^d/.test(u) ? 86400 : /^w/.test(u) ? 604800 : /^mo/.test(u) ? 2592000 : 31536000;
  return new Date(Date.now() - n * sec * 1000).toISOString();
}

export function detectPortal(url = '') {
  const u = url.toLowerCase();
  for (const k of ['greenhouse', 'lever.co', 'ashbyhq', 'workable', 'workday', 'smartrecruiters', 'breezy', 'recruitee', 'bamboohr', 'jobvite', 'teamtailor', 'rippling', 'personio', 'linkedin', 'google.com/forms', 'forms.gle', 'typeform', 'tally.so'])
    if (u.includes(k)) return k.replace('.co', '').replace('google.com/forms', 'gform').replace('forms.gle', 'gform');
  return 'other';
}
const FORM_RE = /greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|breezy|recruitee|bamboohr|jobvite|teamtailor|rippling|personio|forms\.gle|docs\.google\.com\/forms|typeform|tally\.so|\/careers?\/|\/jobs?\//i;

/** Relevance 0..1 + hard skip. Title drives it (the full text has every buzzword).
 *  Returns {rel, skip, why} */
const CV_TITLE = /\b(devops|site reliability|sre|cloud|platform|infrastructure|solutions? architect|cloud architect|kubernetes|terraform)\b/i;
const NON_CV_TITLE = /\b(ai|a\.i\.|ml|machine learning|llm|gen ?ai|generative|nlp|rag|agent(ic)?|data scientist|data engineer|analytics|backend|back[- ]end|full[- ]?stack|software engineer|frontend|front[- ]end|developer|application engineer|product engineer|project manager|manager|director|vp|head of|chief|course|training|certification|tutorial|bootcamp|class)\b/i;
const OFF_STACK = /\b(java(?!script)|\.net|c#|ruby|rails|rust|golang|ios|android|swift|kotlin|flutter|php|wordpress|shopify|salesforce|sap|servicenow|qa|test(er|ing)?|quality|sdet|manager|director|vp|head of|chief|designer|sales|marketing|support|analyst|embedded|firmware|hardware|mechanical|electrical|civil|network engineer|security engineer|unity|game|blockchain|solidity|mainframe|cobol|angular|react native|frontend|front[- ]end)\b/i;
const GEO_LOCK = /\b(us|u\.s\.|usa|united states|uk|eu|europe|canada|india|brazil|br|latam|germany|australia)[- ]?(only|based only|residents? only|citizens? only)\b|\bmust (be|reside|live) (located |based )?in (the )?(us|usa|united states|uk|eu|canada|india)\b|\b(remote|hybrid)\s*\([^)]*\b(tx|md|in|ca|ny|wa|ma|va|fl|nj|il|ga|co|az|or|ut|dc)\b[^)]*\)|\b(remote|hybrid)\s*\(?(?:u\.?s\.?|usa|united states)\)?|\b100%\s+remote\s*\(?(?:u\.?s\.?|usa|united states)\)?|\b(onsite|on-site|work from office|wfo|hybrid)\b(?![^.]{0,40}remote)|\bus citizen|security clearance|\bh1b\b|\bvisa sponsorship\b|\bsponsorship required\b|\bmust have work authorization\b|(?:us|u\.s\.|united states)\s+(?:citizens?|nationals?|permanent residents?|green card holders?|ead holders?)|\bgreen card holders?\b|\bead holders?\b|\b(?:unable|cannot|can\'t) sponsor\b|\bno sponsorship\b|\bsponsorship (?:is )?(?:not|isn\'t) (?:available|provided|offered)\b|\bw-?2\b/i;
export function score(text = '', title = '') {
  const p = getProfile();
  const t = text.toLowerCase();
  const excluded = excludedCompanyMatch(text, p);
  // CRITICAL: skip-term and off-stack checks must ONLY fire on the job TITLE, never the
  // description. "Backend Engineer" was being skipped because the post body mentioned
  // "sales team" or "QA process" in an unrelated context.
  const titleOnly = (title || '').toLowerCase().trim();
  const head = titleOnly || text.slice(0, 100).split('\n')[0].toLowerCase(); // first line as fallback
  const skipHit = titleOnly
    ? (p.preferences?.skip || []).find(s => new RegExp(`\\b${s}\\b`, 'i').test(titleOnly))
    : null; // no clean title → never skip based on description content
  const terms = new Set([...(p.skills || []), ...(p.preferences?.keywords || [])].map(s => s.toLowerCase()));
  // A configured target role (Backend Engineer, AI Engineer, …) is aligned. The old rule
  // required a DevOps-only title and treated "software engineer" / "AI" as not-the-CV,
  // so those emails were skipped before anyone could send them.
  const headGlued = head.replace(/[^a-z0-9]+/g, '');
  const roleHit = (p.preferences?.roles || []).some(role => {
    const key = String(role || '').toLowerCase().trim();
    if (key.length < 3) return false;
    const glued = key.replace(/[^a-z0-9]+/g, '');
    return head.includes(key) || (glued.length > 3 && headGlued.includes(glued));
  });
  const core = roleHit || (CV_TITLE.test(head) && !NON_CV_TITLE.test(head));
  const offStack = OFF_STACK.test(head) && !/\b(python|ai|ml|llm|fastapi|django)\b/.test(head);
  let hit = 0; for (const s of terms) if (t.includes(s)) hit++;
  const rel = Math.min(1, (core ? 0.45 : 0) + 0.55 * Math.min(1, hit / 6));
  // Junior check: title + first 120 chars of body only — not the full description.
  const tooJunior = /\b(freshers?|0\s*[-–]\s*[12]\s*(years|yrs)|entry[- ]level|internship|interns?\b|trainee|graduate program)\b/.test(titleOnly + ' ' + t.slice(0, 120));
  const equityOnly = /\b(co-?founder|cofondat|equity[- ]only|unpaid|sweat equity|no salary)\b/.test(t.slice(0, 700));
  // Relocation / visa-sponsorship preference: if the user is open to relocating (profile), then
  // "visa sponsorship" / "relocation" / a preferred region (Middle East, EU, …) is a POSITIVE
  // signal, not a geo-lock to skip. Only treat geo as a hard skip when the role is locked to a
  // region the user is NOT targeting AND no relocation/sponsorship is offered.
  const prefLocs = (p.preferences?.locations || []).map(s => String(s).toLowerCase());
  const wantsRelo = p.workAuth?.willingToRelocate === true || prefLocs.length > 0;
  const head2500 = text.slice(0, 2500).toLowerCase();
  const offersReloOrSponsor = /\b(visa sponsorship|sponsorship (available|provided|offered)|relocation (assistance|package|support|provided|offered)|will sponsor|we sponsor|work permit (provided|sponsored))\b/.test(head2500);
  const inPrefRegion = prefLocs.some(loc => loc && head2500.includes(loc));
  const geoRaw = GEO_LOCK.test(text.slice(0, 2500));
  const geo = geoRaw && !(wantsRelo && (offersReloOrSponsor || inPrefRegion));
  const why = excluded ? `excluded company "${excluded}"` : skipHit ? `skip term "${skipHit}"` : !core ? 'title not aligned with CV target roles' : offStack ? 'off-stack title' : tooJunior ? 'junior/fresher' : equityOnly ? 'co-founder / equity-only' : geo ? 'location-restricted / authorization' : '';
  return { rel: +rel.toFixed(2), skip: !!why, why };
}

function guessRole(text) {
  const m = text.match(/(?:hiring|looking for|seeking|need(?:ed)?|opening for|position[:\s]+|role[:\s]+)\s*(?:an?\s+|our\s+next\s+)?((?:senior|sr\.?|lead|staff|principal|mid[- ]level|founding)?\s*[A-Za-z/+.#\- ]{2,40}?(?:engineer|developer|architect|scientist|lead|specialist|manager))/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}
function guessCompany(text) {
  const m = text.match(/(?:\bat|\@|join)\s+([A-Z][A-Za-z0-9&.\- ]{1,30}?)(?=\s+(?:is|are|we|as|to|in|for)\b|[,.!\n(|])/) || text.match(/^([A-Z][A-Za-z0-9&. ]{1,30}?) (?:is|are) hiring/m);
  return m ? m[1].trim() : '';
}

// ── LinkedIn hiring posts ─────────────────────────────────────────────────────
export async function liPosts(query, { maxScroll = 6, datePosted = 'past-24h' } = {}) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  try {
    const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&sortBy=%22date_posted%22&datePosted=%22${datePosted}%22`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await SLEEP(4000);
    if (/login|authwall/.test(page.url())) return { ok: false, leads: [], detail: 'LinkedIn not logged in' };
    for (let i = 0; i < maxScroll; i++) { await page.mouse.wheel(0, 2500); await SLEEP(900); }
    // expand truncated posts so hidden emails become visible
    await page.evaluate(() => [...document.querySelectorAll('button, span[role=button]')].filter(b => /^…?\s*more$|see more/i.test(b.innerText.trim())).forEach(b => b.click())).catch(() => {});
    await SLEEP(800);
    const raw = await page.evaluate(() => {
      const posts = [...document.querySelectorAll('div[componentkey*="FeedType"]')].filter(p => !p.parentElement.closest('div[componentkey*="FeedType"]'));
      return posts.map(p => {
        const actor = [...p.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')].find(a => a.innerText.trim());
        const txt = p.innerText.replace(/[ \t]+/g, ' ');
        const links = [...p.querySelectorAll('a[href]')].map(a => a.href);
        const urn = (p.innerHTML.match(/urn:li:(?:activity|ugcPost|share):\d+/) || [])[0] || '';
        return { actorUrl: actor ? actor.href.split('?')[0] : '', actorName: actor ? actor.innerText.split('•')[0].split('\n')[0].trim() : '', txt: txt.slice(0, 4000), links, urn, key: p.getAttribute('componentkey') };
      });
    });
    const leads = [];
    for (const r of raw) {
      const text = r.txt;
      const time = (text.match(/\n\s*(\d+\s*(?:m|h|d|w|mo|yr))\s*[•·\n]/) || text.match(/\b(\d+\s*(?:m|h|d|w|mo))\s*•/) || [])[1] || '';
      const mailto = r.links.filter(h => h.startsWith('mailto:')).map(h => decodeURIComponent(h.slice(7).split('?')[0]).toLowerCase());
      const emails = [...new Set([...mailto, ...emailsIn(text)])].filter(e => !isBadEmail(e));
      const ext = r.links.map(h => { try { const u = new URL(h); return u.pathname.startsWith('/safety/go') ? decodeURIComponent(u.searchParams.get('url') || '') : h; } catch { return ''; } })
        .filter(h => h && !/linkedin\.com\/(in|company|feed|search|posts|safety)|^mailto:/.test(h));
      const jobUrl = (ext.find(h => /linkedin\.com\/jobs\/view\/\d+/.test(h)) || '').split('?')[0];
      const formUrl = ext.find(h => FORM_RE.test(h) && !/linkedin\.com/.test(h)) || ext.find(h => /lnkd\.in\//.test(h)) || '';
      const hiring = /hiring|looking for|we.?re seeking|open (role|position)|join (our|the) team|send (your )?(cv|resume)|apply|vacanc|opening/i.test(text);
      if (!hiring) continue;
      // body = post content after the author header ("… 3h • Follow/Connect")
      const cut = text.search(/\n\s*(Follow|Connect|Subscribe)\s*\n/);
      const bodyTxt = cut > 0 ? text.slice(cut).replace(/^\s*(Follow|Connect|Subscribe)\s*/, '') : text;
      const role = guessRole(bodyTxt);
      const s = score(bodyTxt, role);
      const postUrl = r.urn ? `https://www.linkedin.com/feed/update/${r.urn}/` : '';
      const channel = emails[0] ? 'email' : jobUrl ? 'easy_apply' : formUrl ? 'form' : r.actorUrl.includes('/in/') ? 'connect' : 'none';
      leads.push({
        source: 'linkedin_post', company: guessCompany(bodyTxt), role: role || query.replace(/hiring|remote|email|send|share|cv|resume|dm me|urgent|we are/gi, '').replace(/\s+/g, ' ').trim(),
        url: postUrl || (emails[0] ? `email:${emails[0]}` : r.actorUrl + '#' + (r.key || '').slice(-12)),
        email: emails[0] || '', emails, applyUrl: jobUrl || formUrl, posterUrl: r.actorUrl.includes('/in/') ? r.actorUrl : '', posterName: r.actorName,
        postedAt: relToIso(time), postedRaw: time, description: text.slice(0, 2000), channel,
        portal: emails[0] ? 'email' : jobUrl ? 'linkedin' : formUrl ? detectPortal(formUrl) : 'linkedin', relevance: s.rel, skip: s.skip, skipWhy: s.why, remote: /remote/i.test(text),
      });
    }
    return { ok: true, leads, detail: `${raw.length} posts → ${leads.length} hiring leads (${leads.filter(l => l.email).length} with email)` };
  } catch (e) {
    return { ok: false, leads: [], detail: e.message.slice(0, 200) };
  } finally { await page.close().catch(() => {}); }
}

// ── LinkedIn job listings (freshest) ─────────────────────────────────────────
// geo 92000000 = Worldwide. tpr seconds: 86400 = 24h.
export async function liJobs(query, { easyOnly = true, tpr = 86400, geoId = '92000000', pages = 2 } = {}) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const out = [];
  try {
    for (let pg = 0; pg < pages; pg++) {
      const u = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&f_WT=2${easyOnly ? '&f_AL=true' : ''}&f_TPR=r${tpr}&sortBy=DD${geoId ? '&geoId=' + geoId : ''}&start=${pg * 25}`;
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await SLEEP(3500);
      // scroll the results list so all 25 cards render
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => { const li = document.querySelector('li[data-occludable-job-id]'); let s = li?.parentElement; while (s && s.scrollHeight <= s.clientHeight + 5) s = s.parentElement; (s || window).scrollBy?.(0, 900); }).catch(() => {});
        await SLEEP(500);
      }
      const cards = await page.$$eval('li[data-occludable-job-id]', ls => ls.map(l => {
        const t = l.innerText.split('\n').map(s => s.trim()).filter(Boolean);
        return { id: l.getAttribute('data-occludable-job-id'), lines: t, text: t.join(' | ') };
      })).catch(() => []);
      if (!cards.length) break;
      for (const c of cards) {
        const [title, company, location] = [c.lines[0], c.lines[1] === c.lines[0] ? c.lines[2] : c.lines[1], c.lines.find(l => /remote|\(|,/i.test(l)) || ''];
        const ago = (c.text.match(/(\d+\s+(?:minute|hour|day|week|month)s?\s+ago)/) || [])[1] || '';
        const s = score(`${title} ${company} ${location}`, title);
        out.push({
          source: easyOnly ? 'linkedin_easy' : 'linkedin_jobs', role: title, company, location, url: `https://www.linkedin.com/jobs/view/${c.id}/`, applyUrl: `https://www.linkedin.com/jobs/view/${c.id}/`,
          postedAt: relToIso(ago) || (/within the past 24/i.test(c.text) ? new Date(Date.now() - 12 * 3600e3).toISOString() : ''), postedRaw: ago,
          channel: /easy apply/i.test(c.text) ? 'easy_apply' : 'form', portal: 'linkedin', relevance: s.rel, skip: s.skip, skipWhy: s.why,
          alreadyApplied: /\bApplied\b/.test(c.text), remote: true,
        });
      }
      if (cards.length < 20) break;
    }
    const seen = new Set();
    const uniq = out.filter(j => !seen.has(j.url) && seen.add(j.url));
    return { ok: true, leads: uniq, detail: `${uniq.length} listings` };
  } catch (e) {
    return { ok: false, leads: out, detail: e.message.slice(0, 200) };
  } finally { await page.close().catch(() => {}); }
}

// ── Hacker News "Who is hiring?" (newest comments first, emails extracted) ───
export async function hnHiring({ maxAgeHours = 24 * 10 } = {}) {
  const s = await (await fetch('https://hn.algolia.com/api/v1/search_by_date?query=%22who%20is%20hiring%22&tags=story,author_whoishiring&hitsPerPage=3', { headers: { 'User-Agent': UA } })).json();
  const story = (s.hits || []).find(h => /who is hiring/i.test(h.title));
  if (!story) return { ok: false, leads: [], detail: 'no thread' };
  const since = Math.floor(Date.now() / 1000) - maxAgeHours * 3600;
  const leads = [];
  for (let page = 0; page < 5; page++) {
    const r = await (await fetch(`https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${story.objectID}&numericFilters=created_at_i>${since}&hitsPerPage=200&page=${page}`, { headers: { 'User-Agent': UA } })).json();
    for (const c of r.hits || []) {
      if (c.parent_id != +story.objectID) continue; // top-level only = one company per comment
      const html = c.comment_text || '';
      const text = html.replace(/<p>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&#x2F;/g, '/').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
      if (!/remote/i.test(text)) continue;
      if (/remote\s*\(?\s*(us|usa|u\.s\.|united states|us[- ]only|north america|eu only|uk only|canada)\b[^\n]{0,20}(only)?/i.test(text) && !/worldwide|anywhere|global/i.test(text)) continue;
      const emails = emailsIn(text);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&#x2F;/g, '/').replace(/&amp;/g, '&'));
      const form = links.find(l => FORM_RE.test(l)) || '';
      const head = text.split('\n')[0];
      const sc = score(text, head);
      leads.push({
        source: 'hn_hiring', company: head.split('|')[0].trim().slice(0, 60), role: (head.split('|').find(x => /engineer|developer|scientist/i.test(x)) || guessRole(text) || 'Software Engineer').trim().slice(0, 90),
        url: `https://news.ycombinator.com/item?id=${c.objectID}`, email: emails[0] || '', emails, applyUrl: form, description: text.slice(0, 2000),
        postedAt: new Date(c.created_at_i * 1000).toISOString(), channel: emails[0] ? 'email' : form ? 'form' : 'none', portal: emails[0] ? 'email' : detectPortal(form),
        relevance: sc.rel, skip: sc.skip, skipWhy: sc.why, remote: true,
      });
    }
    if ((r.nbPages || 0) <= page + 1) break;
  }
  return { ok: true, leads, detail: `HN "${story.title}": ${leads.length} remote (${leads.filter(l => l.email).length} email)` };
}

// ── Reddit hiring posts (public JSON, newest first) ──────────────────────────
export async function redditHiring({ subs = ['forhire', 'remotejs', 'jobbit', 'PythonJobs', 'MachineLearningJobs', 'hiring', 'RemoteJobs'], maxAgeHours = 72 } = {}) {
  const leads = []; const since = Date.now() / 1000 - maxAgeHours * 3600;
  // Reddit 403s non-browser clients → fetch the JSON from inside the user's Chrome.
  const ctx = await getContext();
  const page = await ctx.newPage();
  await page.goto('https://www.reddit.com/r/forhire/new/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await SLEEP(6000); // reddit does a client-side redirect/bot check before same-origin fetch works
  for (const sub of subs) {
    try {
      const j = await page.evaluate(async s => { const r = await fetch(`/r/${s}/new.json?limit=50&raw_json=1`); return r.ok ? r.json() : null; }, sub).catch(() => null);
      if (!j) continue;
      for (const { data: d } of j.data?.children || []) {
        if (d.created_utc < since) continue;
        const title = d.title || '';
        if (!/\bhiring\b/i.test(title)) continue;
        if (/\[for hire\]/i.test(title)) continue;
        const text = `${title}\n${d.selftext || ''}`;
        const sc = score(text, title);
        const emails = emailsIn(text);
        const form = (text.match(/https?:\/\/[^\s)\]]+/g) || []).find(l => FORM_RE.test(l)) || '';
        leads.push({
          source: `reddit_${sub}`, company: guessCompany(text) || `r/${sub}`, role: guessRole(title) || title.replace(/\[[^\]]*\]/g, '').trim().slice(0, 90),
          url: `https://www.reddit.com${d.permalink}`, email: emails[0] || '', emails, applyUrl: form, description: text.slice(0, 2000),
          postedAt: new Date(d.created_utc * 1000).toISOString(), channel: emails[0] ? 'email' : form ? 'form' : 'none', portal: emails[0] ? 'email' : detectPortal(form),
          relevance: sc.rel, skip: sc.skip, skipWhy: sc.why, remote: true,
        });
      }
    } catch {}
    await SLEEP(1200);
  }
  await page.close().catch(() => {});
  return { ok: true, leads, detail: `${leads.length} reddit leads (${leads.filter(l => l.email).length} email)` };
}

// ── Public remote boards (fresh, filtered) ───────────────────────────────────
export async function publicBoards({ maxAgeHours = 72 } = {}) {
  const since = Date.now() - maxAgeHours * 3600e3;
  const leads = [];
  const push = (src, title, company, url, desc, dateMs, applyUrl = '') => {
    if (!title || !url || (dateMs && dateMs < since)) return;
    const text = `${title} ${company} ${desc}`; const sc = score(text, title); const emails = emailsIn(desc, { needContext: true });
    leads.push({ source: src, role: title, company, url, email: emails[0] || '', emails, applyUrl: applyUrl || url, description: desc.slice(0, 2000),
      postedAt: dateMs ? new Date(dateMs).toISOString() : '', channel: emails[0] ? 'email' : 'form', portal: emails[0] ? 'email' : detectPortal(applyUrl || url), relevance: sc.rel, skip: sc.skip, skipWhy: sc.why, remote: true });
  };
  const get = async u => { try { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 20000 }); return r.ok ? r.json() : null; } catch { return null; } };
  const strip = h => (h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ').replace(/\s+/g, ' ');
  for (const tag of ['devops', 'kubernetes', 'terraform', 'cloud', 'sre']) {
    const j = await get(`https://remoteok.com/api?tag=${tag}`);
    for (const x of (j || []).slice(1)) push('remoteok', x.position, x.company, x.url, strip(x.description), Date.parse(x.date), x.apply_url);
  }
  const rm = await get('https://remotive.com/api/remote-jobs?category=software-dev&limit=150');
  for (const x of rm?.jobs || []) push('remotive', x.title, x.company_name, x.url, strip(x.description), Date.parse(x.publication_date));
  const jb = await get('https://jobicy.com/api/v2/remote-jobs?count=50&industry=engineering');
  for (const x of jb?.jobs || []) push('jobicy', x.jobTitle, x.companyName, x.url, strip(x.jobDescription), Date.parse(x.pubDate));
  const hm = await get('https://himalayas.app/jobs/api?limit=100');
  for (const x of hm?.jobs || []) push('himalayas', x.title, x.companyName, x.applicationLink || x.guid, strip(x.description || x.excerpt), (x.pubDate || 0) * 1000);
  const seen = new Set();
  const uniq = leads.filter(l => !seen.has(l.url) && seen.add(l.url));

  // ── Pakistani job boards ──────────────────────────────────────────────────
  // Helper to fetch XML/text (not JSON)
  const getText = async u => { try { const r = await fetch(u, { headers: { 'User-Agent': UA }, timeout: 20000 }); return r.ok ? r.text() : null; } catch { return null; } };
  const parseRssItems = xml => (String(xml || '')).match(/<item>[\s\S]*?<\/item>/g) || [];
  const rssField = (item, tag) => (item.match(new RegExp(`<${tag}><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`)) || []).slice(1).find(Boolean) || '';

  // Rozee.pk RSS — largest Pakistani job board
  for (const kw of ['AI Engineer', 'Machine Learning', 'Python Developer', 'Backend Developer', 'LLM', 'FastAPI']) {
    try {
      const xml = await getText(`https://www.rozee.pk/job/rss/q/${encodeURIComponent(kw)}`);
      for (const item of parseRssItems(xml).slice(0, 15)) {
        const title = rssField(item, 'title');
        const link = rssField(item, 'link') || rssField(item, 'guid');
        const desc = strip(rssField(item, 'description'));
        const pubDate = rssField(item, 'pubDate');
        const company = rssField(item, 'rozee:company') || rssField(item, 'author') || '';
        if (title && link) push('rozee.pk', title, company, link, desc, pubDate ? Date.parse(pubDate) : Date.now() - 12 * 3600e3, link);
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 600));
  }

  // Mustakbil.com RSS — second-largest Pakistani board
  for (const kw of ['AI Engineer', 'Python Developer', 'Backend Developer']) {
    try {
      const xml = await getText(`https://mustakbil.com/jobs/rss/?q=${encodeURIComponent(kw)}&l=Pakistan`);
      for (const item of parseRssItems(xml).slice(0, 12)) {
        const title = rssField(item, 'title');
        const link = rssField(item, 'link') || rssField(item, 'guid');
        const desc = strip(rssField(item, 'description'));
        const pubDate = rssField(item, 'pubDate');
        if (title && link) push('mustakbil', title, '', link, desc, pubDate ? Date.parse(pubDate) : Date.now() - 12 * 3600e3, link);
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 600));
  }

  // Jobs.com.pk / Paperpk RSS (Pakistani job aggregators)
  try {
    const xml = await getText('https://www.paperpk.com/rss/category/technology-jobs/');
    for (const item of parseRssItems(xml).slice(0, 20)) {
      const title = rssField(item, 'title');
      const link = rssField(item, 'link') || rssField(item, 'guid');
      const desc = strip(rssField(item, 'description'));
      const pubDate = rssField(item, 'pubDate');
      if (title && link && /python|ai|ml|backend|machine learning|llm|fastapi|software engineer/i.test(title + ' ' + desc))
        push('paperpk', title, '', link, desc, pubDate ? Date.parse(pubDate) : Date.now() - 24 * 3600e3, link);
    }
  } catch { /* skip */ }

  const seen2 = new Set();
  const all = [...uniq, ...leads.slice(uniq.length)].filter(l => !seen2.has(l.url) && seen2.add(l.url));
  return { ok: true, leads: all, detail: `${all.length} fresh board jobs (${all.filter(l => l.email).length} email)` };
}
