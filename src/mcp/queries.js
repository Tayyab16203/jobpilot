// src/mcp/queries.js — Generate diverse search queries from the user profile.
// Search only the roles explicitly selected during onboarding.  The worker must
// not broaden a DevOps/cloud profile into generic software, AI, or freelance work.
import { getProfile } from '../profile.js';

// Phrasings that surface HIRING POSTS (not just listings) on LinkedIn content search.
const HIRING_PHRASES = ['hiring', 'we are hiring', 'looking for', 'join our team', 'open role', 'now hiring'];
const APPLY_SIGNALS = ['email your cv', 'dm me', 'apply', 'remote'];

/**
 * Build a deduped list of search queries from the profile's roles + keywords.
 * Each role gets a few phrasings; country-scoped profiles also inject location terms
 * so LinkedIn content search surfaces local hiring posts.
 */
export function buildQueries({ limit = 30 } = {}) {
  const p = getProfile();
  const roles = (p.preferences?.roles || []).length
    ? p.preferences.roles
    : ['DevOps Engineer', 'Site Reliability Engineer', 'Cloud Engineer', 'Platform Engineer', 'Cloud Infrastructure Engineer', 'Cloud Solution Architect'];
  const remote = p.preferences?.remoteOnly ? ' remote' : '';

  // Country-scoped: append location terms so LinkedIn content search surfaces local hiring posts.
  const isCountryScope = p.preferences?.locationScope === 'country';
  const isPakistan = isCountryScope && String(p.country || '').toLowerCase() === 'pakistan';
  const locationVariants = isPakistan ? [' Pakistan', ' Karachi', ' Lahore', ''] : [''];

  // Preferred relocation regions (Middle East, EU, …) from the profile — when the user is open to
  // relocation, actively surface regional + visa-sponsorship/relocation hiring, not just remote.
  const prefLocs = (p.preferences?.locations || []).slice(0, 8);
  const wantsRelo = p.workAuth?.willingToRelocate === true || prefLocs.length > 0;

  const out = new Set();
  for (const role of roles) {
    for (const loc of locationVariants) {   // all location variants per role
      out.add(`hiring ${role}${loc}${remote}`);
      out.add(`we are hiring ${role}${loc}${remote}`);
    }
    out.add(`looking for ${role}${remote} email your cv`);
    // Region-targeted + relocation/visa-sponsorship phrasings (Middle East / EU preference).
    if (wantsRelo) {
      for (const loc of prefLocs) {
        out.add(`hiring ${role} ${loc}`);
        out.add(`${role} ${loc} visa sponsorship`);
      }
      out.add(`${role} relocation visa sponsorship`);
      out.add(`hiring ${role} relocation Middle East`);
      out.add(`hiring ${role} relocation Europe`);
    }
  }
  return [...out].slice(0, limit);
}

/** Queries for LinkedIn JOB LISTINGS (jobs/search), roles + skills + freelance. */
export function buildListingQueries({ limit = 18 } = {}) {
  const p = getProfile();
  const roles = (p.preferences?.roles || []).length ? p.preferences.roles : ['DevOps Engineer', 'Site Reliability Engineer', 'Cloud Engineer', 'Platform Engineer', 'Cloud Infrastructure Engineer', 'Cloud Solution Architect'];
  const remote = p.preferences?.remoteOnly ? ' remote' : '';
  const prefLocs = (p.preferences?.locations || []).slice(0, 6);
  const wantsRelo = p.workAuth?.willingToRelocate === true || prefLocs.length > 0;
  const out = new Set();
  for (const r of roles) {
    out.add(`${r}${remote}`);
    if (wantsRelo) { for (const loc of prefLocs) out.add(`${r} ${loc}`); out.add(`${r} visa sponsorship`); }
  }
  return [...out].slice(0, limit);
}

/** Freelance/marketplace listing queries (login-free boards too). */
export function buildFreelanceQueries() {
  const p = getProfile();
  const roles = (p.preferences?.roles || []).length ? p.preferences.roles : ['DevOps Engineer', 'Cloud Engineer', 'Platform Engineer'];
  const base = roles.map(r => `freelance ${r}`);
  const out = new Set(base);
  return [...out];
}

/**
 * Relevance by SKILLS + EXPERIENCE, not fixed role titles (steering).
 * Returns a 0..1 score: fraction of the user's skills/keywords/role-words that
 * appear in the job text. The AGENT sets its own threshold; this is a signal.
 */
export function relevantBySkills(text = '') {
  const p = getProfile();
  const t = (text || '').toLowerCase();
  if (!t) return 0;
  const terms = new Set();
  for (const s of (p.skills || p.preferences?.skills || [])) terms.add(s.toLowerCase());
  for (const k of (p.preferences?.keywords || [])) terms.add(k.toLowerCase());
  for (const r of (p.preferences?.roles || [])) r.toLowerCase().split(/\s+/).forEach(w => w.length > 2 && terms.add(w));
  if (!terms.size) return 0;
  let hit = 0;
  for (const term of terms) if (t.includes(term)) hit++;
  return hit / terms.size;
}
