// Site login, then Google. If both fail, ask the human and keep the site. data/ only.
import fs from 'fs';
import path from 'path';
import { DATA } from './config.js';

const FILE = path.join(DATA, 'login-asks.json');

export const LOGIN_SITES = {
  x: ['X', 'https://x.com/i/flow/login', 'debug'],
  linkedin: ['LinkedIn', 'https://www.linkedin.com/login', 'debug'],
  gmail: ['Gmail', 'https://mail.google.com/', 'google'],
  instagram: ['Instagram', 'https://www.instagram.com/accounts/login/', 'debug'],
  glassdoor: ['Glassdoor', 'https://www.glassdoor.com/profile/login_input.htm', 'normal'],
  indeed: ['Indeed', 'https://secure.indeed.com/account/login', 'normal'],
};

export function judgeLogin(site, direct, google) {
  if (direct === 'ok' || google === 'ok') return { ask: false, keep: false };
  if (google !== 'fail') return { ask: false, keep: direct === 'fail' };
  if (site === 'gmail') return { ask: true, keep: true };
  return { ask: direct === 'fail', keep: direct === 'fail' };
}

function readAsks() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

export function applyLoginResult(site, direct, google, detail = '') {
  const spec = LOGIN_SITES[site];
  if (!spec) return null;
  const decision = judgeLogin(site, direct, google);
  const all = readAsks();
  if (!decision.keep) delete all[site];
  else all[site] = {
    label: spec[0], url: spec[1], how: spec[2], direct, google, ...decision,
    detail: String(detail || '').slice(0, 180), at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  return { site, ...decision };
}

export function listLoginAsks() {
  return Object.values(readAsks()).filter(row => row.ask && row.keep);
}
