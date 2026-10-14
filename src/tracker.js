// src/tracker.js — sql.js SQLite (pure JS). ONE shared in-memory handle per process;
// every module (attempts.js etc.) must use getDB() so saves never clobber each other.
import { createRequire } from 'module';
import fs from 'fs';
import { DATA, DB_FILE } from './config.js';
import { assessJob } from './cv.js';
import { getProfile } from './profile.js';

fs.mkdirSync(DATA, { recursive: true });
const require = createRequire(import.meta.url);

let db = null;
let _initP = null;

// Statuses that mean "we already reached out — never act again".
export const DONE_STATUSES = ['emailed', 'applied', 'connected', 'dm_sent', 'skipped_duplicate'];

// Addresses that are never a hiring contact (aggregator footers, legal, bots).
const BAD_EMAIL_RE = /(^|[._-])(no-?reply|donotreply|privacy|legal|abuse|security|support|help|billing|press|media|unsubscribe|notifications?|info@linkedin|gdpr|dpo|webmaster|postmaster|admin)@|@(tinyboards\.co|example\.|sentry\.|wix|.*\.png|.*\.jpg|linkedin\.com|weworkremotely\.com|remoteok\.com|remotive\.com|himalayas\.app|users\.noreply\.github\.com)|vaga-\d+@/i;
// In-memory cache of the per-user learned fake-email set (populated from the fake_emails table on
// init). Combined with the shipped code-level FAKE_EMAIL patterns so future brains skip known fakes.
let _fakeSet = new Set();
let _fakePatterns = null;
function fakePatterns() {
  if (_fakePatterns) return _fakePatterns;
  try { // Shipped, contributable registry of known-fake/decoy address patterns (code, not data).
    // Lazy require to avoid a hard dependency during early init.
    _fakePatterns = require('./fake-emails.js').FAKE_EMAIL_PATTERNS || [];
  } catch { _fakePatterns = []; }
  return _fakePatterns;
}
/** True if the address is a KNOWN fake/decoy — learned (DB) or a shipped pattern. */
export function isFakeEmail(e = '') {
  const addr = String(e || '').toLowerCase().trim();
  if (!addr) return false;
  if (_fakeSet.has(addr)) return true;
  return fakePatterns().some(re => { try { return re.test(addr); } catch { return false; } });
}
/** Record an address as fake so it is never contacted again (persisted + cached). Idempotent. */
export function markFakeEmail(email, reason = '', source = '') {
  const addr = String(email || '').toLowerCase().trim();
  if (!addr) return false;
  _fakeSet.add(addr);
  try { getDB().run(`INSERT OR REPLACE INTO fake_emails (email, reason, source) VALUES (?,?,?)`, [addr, reason, source]); } catch {}
  return true;
}
export function listFakeEmails() { try { return rows(`SELECT email, reason, source, ts FROM fake_emails ORDER BY ts DESC`); } catch { return []; } }
function loadFakeSet() { try { _fakeSet = new Set(rows(`SELECT email FROM fake_emails`).map(r => String(r.email).toLowerCase())); } catch { _fakeSet = new Set(); } }

export function isBadEmail(e = '') { return !e || BAD_EMAIL_RE.test(e) || e.length > 80 || isFakeEmail(e); }

export async function initDB() {
  if (db) return db;
  if (_initP) return _initP;
  _initP = (async () => {
    const SQL = await require('sql.js')();
    db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, added_at TEXT DEFAULT (datetime('now')),
        source TEXT, company TEXT, role TEXT, remote INTEGER DEFAULT 1, location TEXT, salary TEXT,
        url TEXT UNIQUE, email TEXT, portal TEXT, status TEXT DEFAULT 'new', applied_at TEXT, notes TEXT
      );
      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
        type TEXT, company TEXT, role TEXT, target TEXT, result TEXT, detail TEXT, shot TEXT
      );
      CREATE TABLE IF NOT EXISTS emails_sent (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
        to_email TEXT, company TEXT, role TEXT, subject TEXT, result TEXT, job_url TEXT
      );
      CREATE TABLE IF NOT EXISTS steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
        tool TEXT, target TEXT, args TEXT, outcome TEXT, detail TEXT,
        attempt INTEGER DEFAULT 1, duration_ms INTEGER DEFAULT 0, timeout_ms INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS attempt_counts (key TEXT PRIMARY KEY, attempts INTEGER DEFAULT 0, last_ts TEXT, last_outcome TEXT);
      CREATE TABLE IF NOT EXISTS connects (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
        profile_url TEXT UNIQUE, name TEXT, company TEXT, role TEXT, note TEXT, result TEXT
      );
      CREATE TABLE IF NOT EXISTS fake_emails (
        email TEXT PRIMARY KEY, ts TEXT DEFAULT (datetime('now')),
        reason TEXT, source TEXT
      );
    `);
    // ── Migrations: richer lead model (channel queues, freshness, relevance) ──
    const cols = new Set(rows('PRAGMA table_info(jobs)').map(c => c.name));
    const add = (n, t) => { if (!cols.has(n)) db.run(`ALTER TABLE jobs ADD COLUMN ${n} ${t}`); };
    add('channel', "TEXT DEFAULT ''");      // email | easy_apply | form | connect | none
    add('apply_url', "TEXT DEFAULT ''");    // external form / easy-apply job url
    add('poster_url', "TEXT DEFAULT ''");   // LinkedIn author profile (for connect)
    add('poster_name', "TEXT DEFAULT ''");
    add('posted_at', "TEXT DEFAULT ''");    // ISO, best-effort from "3h"/"1 day ago"
    add('relevance', 'REAL DEFAULT 0');     // 0..1 skill match
    add('description', "TEXT DEFAULT ''");
    add('attempts', 'INTEGER DEFAULT 0');
    add('updated_at', "TEXT DEFAULT ''");
    add('cv_match_percent', 'INTEGER DEFAULT NULL');
    add('cv_drift_percent', 'INTEGER DEFAULT NULL');
    add('cv_missing_terms', "TEXT DEFAULT ''");
    add('tailor_status', "TEXT DEFAULT 'not_requested'");
    add('tailored_cv_path', "TEXT DEFAULT ''");
    save();
    const { initEvolve } = await import('./evolve.js');
    initEvolve();
    loadFakeSet();   // populate the learned fake-email cache so isBadEmail skips known fakes
    return db;
  })();
  return _initP;
}

export function getDB() { if (!db) throw new Error('initDB() not called'); return db; }
let _lastSaveMs = 0;
export function save() { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); _lastSaveMs = Date.now(); }
/** Another process (the worker) may have written the DB file — reload it read-side. */
export async function reloadIfChanged() {
  if (!db) return initDB();
  try {
    const m = fs.statSync(DB_FILE).mtimeMs;
    if (m > _lastSaveMs + 50) {
      const SQL = await require('sql.js')();
      db = new SQL.Database(fs.readFileSync(DB_FILE));
      _lastSaveMs = m;
    }
  } catch {}
  return db;
}
export function rows(sql, p = []) {
  const s = db.prepare(sql); s.bind(p);
  const out = []; while (s.step()) out.push(s.getAsObject()); s.free();
  return out;
}
export function one(sql, p = []) { return rows(sql, p)[0] ?? null; }
const nowIso = () => new Date().toISOString();

// ── Jobs ──────────────────────────────────────────────────────────────────────
/** Insert new leads; for existing URLs fill in blank fields (email/apply_url/…) instead of ignoring. */
export function upsertJobs(list) {
  let n = 0;
  for (const j of list) {
    if (!j.url) continue;
    const assessment = assessJob(j, getProfile());
    const email = j.email && !isBadEmail(j.email) ? j.email.toLowerCase() : '';
    db.run(
      `INSERT OR IGNORE INTO jobs (source,company,role,remote,location,salary,url,email,portal,status,
         channel,apply_url,poster_url,poster_name,posted_at,relevance,description,updated_at,
         cv_match_percent,cv_drift_percent,cv_missing_terms,tailor_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [j.source || '', j.company || '', j.role || '', j.remote ? 1 : 0, j.location || '', j.salary || '', j.url,
       email, j.portal || 'other', j.status || 'new', j.channel || '', j.applyUrl || j.apply_url || '',
       j.posterUrl || j.poster_url || '', j.posterName || j.poster_name || '', j.postedAt || j.posted_at || '',
       +j.relevance || 0, (j.description || j.postText || '').slice(0, 2000), nowIso(),
       assessment.matchPercent, assessment.driftPercent, assessment.missingTerms.join(', '),
       assessment.tailoredEligible ? 'approval_required' : 'not_requested']
    );
    if (db.getRowsModified() > 0) { n++; continue; }
    db.run(
      `UPDATE jobs SET
         email = CASE WHEN email='' OR email IS NULL THEN ? ELSE email END,
         apply_url = CASE WHEN apply_url='' OR apply_url IS NULL THEN ? ELSE apply_url END,
         poster_url = CASE WHEN poster_url='' OR poster_url IS NULL THEN ? ELSE poster_url END,
         posted_at = CASE WHEN posted_at='' OR posted_at IS NULL THEN ? ELSE posted_at END,
         cv_match_percent=?, cv_drift_percent=?, cv_missing_terms=?,
         tailor_status=CASE WHEN tailor_status='generated' THEN tailor_status ELSE ? END
       WHERE url=?`,
      [email, j.applyUrl || '', j.posterUrl || '', j.postedAt || '', assessment.matchPercent,
       assessment.driftPercent, assessment.missingTerms.join(', '), assessment.tailoredEligible ? 'approval_required' : 'not_requested', j.url]);
  }
  save();
  return n;
}

export function getJob(url) { return one('SELECT * FROM jobs WHERE url=?', [url]); }

export function setStatus(url, status, notes = '', when = '') {
  db.run(`UPDATE jobs SET status=?, notes=?, updated_at=?,
            applied_at = CASE WHEN ? != '' THEN ? ELSE applied_at END WHERE url=?`,
    [status, String(notes).slice(0, 500), nowIso(),
     when || (DONE_STATUSES.includes(status) ? nowIso() : ''), when || (DONE_STATUSES.includes(status) ? nowIso() : ''), url]);
  save();
}

export function setFields(url, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.run(`UPDATE jobs SET ${keys.map(k => `${k}=?`).join(',')}, updated_at=? WHERE url=?`,
    [...keys.map(k => fields[k]), nowIso(), url]);
  save();
}

export function bumpAttempt(url) { db.run('UPDATE jobs SET attempts=COALESCE(attempts,0)+1 WHERE url=?', [url]); save(); }

// One-time, idempotent revival of email leads frozen by the pre-fix transient-attempt bug:
// status still 'new' but attempts exhausted → they'd never be re-queued under the attempts<max
// filter. Reset attempts to 0 so the fixed mailer (which no longer burns attempts on transient
// CDP/login failures) can act on them again. CODE-ONLY: mutates the in-memory DB via save(),
// never hand-edits or commits data/jobs.db. Idempotent: once revived + emailed/failed, a lead
// no longer matches status='new' AND attempts>=max.
export function reviveStuckEmailLeads(maxAttempts = 3) {
  const r = rows(`SELECT COUNT(*) AS n FROM jobs WHERE channel='email' AND status='new' AND COALESCE(attempts,0)>=?`, [maxAttempts]);
  const n = (r[0] && r[0].n) || 0;
  if (n > 0) { db.run(`UPDATE jobs SET attempts=0 WHERE channel='email' AND status='new' AND COALESCE(attempts,0)>=?`, [maxAttempts]); save(); }
  return n;
}

// ── Dedup guards ──────────────────────────────────────────────────────────────
/** Has this address ever been emailed (by any run / any agent)? */
export function alreadyEmailed(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  const a = one(`SELECT COUNT(*) n FROM emails_sent WHERE lower(to_email)=? AND result IN ('sent','draft')`, [e])?.n || 0;
  const b = one(`SELECT COUNT(*) n FROM jobs WHERE lower(email)=? AND status IN ('emailed','draft')`, [e])?.n || 0;
  return a + b > 0;
}

/** Has this company+role combo already been actioned? */
export function alreadyApplied(company, role) {
  if (!company || !role) return false;
  const r = one(`SELECT COUNT(*) n FROM jobs WHERE lower(company)=lower(?) AND lower(role)=lower(?) AND status IN (${DONE_STATUSES.map(() => '?').join(',')})`,
    [company, role, ...DONE_STATUSES]);
  return (r?.n || 0) > 0;
}

export function alreadyConnected(profileUrl) {
  if (!profileUrl) return false;
  return (one(`SELECT COUNT(*) n FROM connects WHERE profile_url=? AND result IN ('connected','pending','dm_sent')`, [profileUrl])?.n || 0) > 0;
}
export function logConnect(profileUrl, name, company, role, note, result) {
  db.run(`INSERT OR REPLACE INTO connects (profile_url,name,company,role,note,result) VALUES (?,?,?,?,?,?)`,
    [profileUrl, name || '', company || '', role || '', note || '', result]);
  save();
}

/** How many of an action type succeeded in the last 24h (for daily caps). */
export function doneToday(kind) {
  if (kind === 'email') return one(`SELECT COUNT(*) n FROM emails_sent WHERE result='sent' AND ts > datetime('now','-1 day')`)?.n || 0;
  if (kind === 'connect') return one(`SELECT COUNT(*) n FROM connects WHERE result IN ('connected','dm_sent') AND ts > datetime('now','-1 day')`)?.n || 0;
  return one(`SELECT COUNT(*) n FROM actions WHERE type=? AND result='ok' AND ts > datetime('now','-1 day')`, [kind])?.n || 0;
}

export function allJobs(filter = {}) {
  let sql = 'SELECT * FROM jobs';
  const conds = [], p = [];
  if (filter.status) { conds.push('status=?'); p.push(filter.status); }
  if (filter.channel) { conds.push('channel=?'); p.push(filter.channel); }
  if (filter.hasEmail) conds.push("email != ''");
  if (filter.noEmail) conds.push("(email IS NULL OR email='')");
  if (filter.portal) { conds.push('portal=?'); p.push(filter.portal); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY id DESC';
  return rows(sql, p);
}

export function counts() {
  return {
    byStatus: rows('SELECT status, COUNT(*) n FROM jobs GROUP BY status ORDER BY n DESC'),
    bySource: rows('SELECT source, COUNT(*) n FROM jobs GROUP BY source ORDER BY n DESC'),
    byPortal: rows('SELECT portal, COUNT(*) n FROM jobs GROUP BY portal ORDER BY n DESC'),
    byChannel: rows("SELECT channel, status, COUNT(*) n FROM jobs GROUP BY channel, status"),
    total: one('SELECT COUNT(*) n FROM jobs').n,
    withEmail: one("SELECT COUNT(*) n FROM jobs WHERE email != ''").n,
    actions: {
      all: rows('SELECT type, result, COUNT(*) n FROM actions GROUP BY type,result ORDER BY n DESC'),
      total: one('SELECT COUNT(*) n FROM actions').n,
      recent: rows('SELECT * FROM actions ORDER BY id DESC LIMIT 200'),
    },
  };
}

// ── Actions ───────────────────────────────────────────────────────────────────
export function log(type, company, role, target, result, detail = '', shot = '') {
  db.run(`INSERT INTO actions (type,company,role,target,result,detail,shot) VALUES (?,?,?,?,?,?,?)`,
    [type, company || '', role || '', target || '', result, String(detail).slice(0, 500), shot]);
  save();
}

export function logEmail(toEmail, company, role, subject, result, jobUrl = '') {
  db.run(`INSERT INTO emails_sent (to_email,company,role,subject,result,job_url) VALUES (?,?,?,?,?,?)`,
    [String(toEmail).toLowerCase(), company || '', role || '', subject || '', result, jobUrl || '']);
  save();
}

export function allEmailsSent() { return rows('SELECT * FROM emails_sent ORDER BY id DESC'); }
export function allConnects() { return rows('SELECT * FROM connects ORDER BY id DESC'); }

export function sentEmails() {
  return new Set(rows(`SELECT DISTINCT lower(to_email) e FROM emails_sent WHERE result IN ('sent','draft')`).map(r => r.e));
}
export function actioned() {
  return new Set(rows(`SELECT lower(company)||':::'||lower(role) k FROM jobs WHERE status IN (${DONE_STATUSES.map(() => '?').join(',')})`, DONE_STATUSES).map(r => r.k));
}
