// src/fake-emails.js — loads the known-fake address list from fake-emails.txt.
// The list is a plain file so a brain can add an address without writing a regex.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-emails.txt');

export function parseFakeEmailList(text = '') {
  const emails = new Set();
  const domains = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim().toLowerCase();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      const domain = line.slice(1).replace(/^@+/, '');
      if (domain) domains.add(domain);
      continue;
    }
    emails.add(line);
  }
  return { emails, domains };
}

export function loadFakeEmailList(file = FILE) {
  try {
    return parseFakeEmailList(fs.readFileSync(file, 'utf8'));
  } catch {
    return { emails: new Set(), domains: new Set() };
  }
}

let cached = null;
let cachedMtime = 0;

function list() {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (!cached || mtime !== cachedMtime) {
      cached = loadFakeEmailList(FILE);
      cachedMtime = mtime;
    }
  } catch {
    cached = { emails: new Set(), domains: new Set() };
  }
  return cached;
}

/** True when the address is in fake-emails.txt (exact address, or a @domain line). */
export function isListedFakeEmail(addr = '') {
  const a = String(addr || '').toLowerCase().trim();
  if (!a) return false;
  const { emails, domains } = list();
  if (emails.has(a)) return true;
  const at = a.lastIndexOf('@');
  if (at < 0) return false;
  return domains.has(a.slice(at + 1));
}

export const FAKE_EMAIL_FILE = FILE;
