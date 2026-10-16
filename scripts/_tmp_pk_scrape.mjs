import { scrapeBrowserSite } from '../src/mcp/scrape.js';
import * as t from '../src/tracker.js';
await t.initDB();

const queries = process.argv.slice(2);
const qs = queries.length ? queries : ['Next.js Developer Pakistan', 'Full Stack Developer Pakistan', 'React Developer Pakistan'];
let all = [];
for (const q of qs) {
  try {
    console.log(`\n[scrape] "${q}" ...`);
    const jobs = await scrapeBrowserSite('linkedin', q, { max: 25, timeoutMs: 45000 });
    console.log(`[scrape] "${q}" -> ${Array.isArray(jobs) ? jobs.length : 0} jobs`);
    if (Array.isArray(jobs)) all = all.concat(jobs);
  } catch (e) {
    console.log(`[scrape] "${q}" ERROR: ${e.message}`);
  }
}
// Dedup by url
const seen = new Set();
const uniq = all.filter(j => { const u = j.url || j.jobUrl; if (!u || seen.has(u)) return false; seen.add(u); return true; });
console.log(`\n=== ${uniq.length} unique leads ===`);
uniq.slice(0, 40).forEach(j => console.log(`${(j.company||'?').slice(0,22)} | ${(j.role||j.title||'').slice(0,34)} | ${(j.location||'').slice(0,18)} | ${j.channel||j.apply_method||''} | ${(j.url||j.jobUrl||'').slice(0,60)}`));

// Save to DB (only when --save passed, to avoid racing the live data worker)
if (uniq.length && process.argv.includes('--save')) {
  const n = t.upsertJobs(uniq.map(j => ({
    source: 'li_jobs', company: j.company||'', role: j.role||j.title||'', url: j.url||j.jobUrl||'',
    location: j.location||'', email: j.email||'', channel: j.channel||j.apply_method||'', apply_url: j.apply_url||j.applyUrl||'',
    remote: /remote/i.test((j.location||'')+(j.role||'')) ? 1 : 0,
  })));
  console.log(`\n[save] ${n} new leads saved to DB`);
}
process.exit(0);
