// src/strategies.js — one playbook per platform, plus the human's corrections.
// The seed records what already worked or failed. Notes live in data/ and are never committed.
import fs from 'fs';
import path from 'path';
import { DATA } from './config.js';

const NOTES = path.join(DATA, 'strategy-notes.json');

export const STRATEGIES = [
  { id: 'x-link', platform: 'X', when: 'The post has an apply link', step: 'Open the link and submit the employer form.', result: 'worked', evidence: 'The employer page said the application was submitted.' },
  { id: 'x-email-reply', platform: 'X', when: 'A reply publishes an email address', step: 'Send the CV to that address and name the remote role.', result: 'worked', evidence: 'Gmail showed Message sent with the CV attached.' },
  { id: 'x-reply-instead', platform: 'X', when: 'The post has an apply link', step: 'Leave a public reply and stop.', result: 'failed', evidence: 'A reply is not the application when the post has a link.' },
  { id: 'ig-comments', platform: 'Instagram', when: 'A hiring post is open', step: 'Read the comments first. The email, link, or instruction is often there.', result: 'open', evidence: '' },
  { id: 'ig-bio', platform: 'Instagram', when: 'The caption points at the bio, or the comments do not name a link', step: 'Open the profile and use the link in the bio.', result: 'open', evidence: '' },
  { id: 'ig-dm', platform: 'Instagram', when: 'The post says to send a message', step: 'Send a short note with the portfolio in the inbox.', result: 'open', evidence: '' },
  { id: 'ig-old-grid', platform: 'Instagram', when: 'The keyword grid is on screen', step: 'Treat the first posts as the newest jobs.', result: 'failed', evidence: 'That grid was weeks old. Open a post from the last day.' },
  { id: 'ig-personal', platform: 'Instagram', when: 'The inbox shows a personal chat or a promotion', step: 'Reply in that thread.', result: 'failed', evidence: 'Those threads are not an application.' },
  { id: 'li-easy', platform: 'LinkedIn', when: 'The job shows Easy Apply and the location is in scope', step: 'Submit once, then wait. A burst gets the account restricted.', result: 'worked', evidence: 'Count it only when the page says the application was sent.' },
];

/** Merge saved human notes onto the seed. A verdict of "wrong" blocks that step. */
export function applyNotes(list, notes = {}) {
  return list.map(s => {
    const human = notes[s.id] || null;
    return { ...s, human, blocked: human?.verdict === 'wrong' };
  });
}

export function readNotes() {
  try { return JSON.parse(fs.readFileSync(NOTES, 'utf8')); } catch { return {}; }
}

export function listStrategies() {
  return applyNotes(STRATEGIES, readNotes());
}

export function saveStrategyNote(id, verdict, note) {
  if (!STRATEGIES.some(s => s.id === id)) return false;
  if (verdict !== 'works' && verdict !== 'wrong') return false;
  const notes = readNotes();
  notes[id] = { verdict, note: String(note || '').slice(0, 500), at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(NOTES), { recursive: true });
  fs.writeFileSync(NOTES, JSON.stringify(notes, null, 2));
  return true;
}
