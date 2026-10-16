import * as t from '../src/tracker.js';
await t.initDB();

// Pakistan signal: location, company, url host, or PK-specific boards.
const pkRe = /pakistan|islamabad|lahore|karachi|rawalpindi|faisalabad|peshawar|rozee|mustakbil|\bpk\b/i;
const feRe = /front|react|next|vue|full[\s-]?stack|javascript|typescript|web developer|ui developer|mern|angular/i;
const skipRe = /java full|\.net|intern|unpaid/i;

const all = t.rows("SELECT id,source,company,role,email,url,apply_url,channel,status,location,cv_match_percent,notes FROM jobs");
const pk = all.filter(r => pkRe.test([r.company, r.role, r.url, r.location, r.source].join(' ')));
console.log(`Total jobs: ${all.length}; Pakistan-signal: ${pk.length}`);

const pkFe = pk.filter(r => feRe.test(r.role||'') && !skipRe.test(r.role||''));
console.log(`Pakistan + FE/FS: ${pkFe.length}`);
const byStatus = {}; pkFe.forEach(r => byStatus[r.status]=(byStatus[r.status]||0)+1);
console.log('by status:', JSON.stringify(byStatus));
console.log('--- Pakistan FE/FS leads ---');
pkFe.slice(0,40).forEach(r => console.log(`${r.id} | ${r.status} | ${(r.company||'?').slice(0,16)} | ${(r.role||'').replace(/\n/g,' ').slice(0,30)} | ch=${r.channel} | email=${r.email||'-'} | loc=${(r.location||'').slice(0,14)} | ${(r.apply_url||r.url||'').slice(0,55)}`));
process.exit(0);
