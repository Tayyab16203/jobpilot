// src/dashboard/partials/header.js — Top header bar + banner alerts.
// Renders the worker status dot, live beat info, login-needed banners,
// consent toggle, and the "questions pending" alert banner.

import { esc } from '../helpers.js';

/**
 * Render the fixed top header bar.
 * @param {object} opts
 * @param {string} opts.name - user display name
 * @param {boolean} opts.live - is the worker currently running?
 * @param {object} opts.state - worker-state.json contents
 * @param {number} opts.hbAge - heartbeat age in seconds
 * @param {number} opts.totalJobs - total jobs in DB
 * @param {number} UIPORT - dashboard port
 * @returns {string} HTML
 */
export function renderHeader({ name, live, state, hbAge, totalJobs, UIPORT }) {
  return `
<div class="hdr">
  <div>
    <h1><span class="dot" style="background:${live ? '#22c55e' : '#ef4444'}"></span>Job Agent — ${esc(name || '')}</h1>
    <div class="dim">${live
      ? `Worker LIVE · ${esc(Object.entries(state.lanes || {}).map(([k, v]) => k + ':' + (v.phase || '')).join(' · ').slice(0, 160)) || esc(state.phase || '')} · beat ${Math.round(hbAge)}s ago`
      : 'Worker not running'} · ${new Date().toLocaleString('en-GB')} · auto-refresh 45s</div>
  </div>
  <div style="text-align:right">
    <div class="kv" style="color:#60a5fa">${totalJobs}</div>
    <div class="dim">leads in bank</div>
    ${live ? `<button class="stopbtn" onclick="stopAll()">⏹ Stop worker</button>` : ''}
  </div>
</div>`.trim();
}

/**
 * Render login-needed banners (one per site that needs re-auth).
 * @param {object} loginNeeded - { site: { reason, url } }
 * @returns {string} HTML (empty string if no logins needed)
 */
export function renderLoginBanners(loginNeeded = {}) {
  if (!Object.keys(loginNeeded).length) return '';
  return Object.entries(loginNeeded).map(([site, info]) =>
    `<div class="loginbanner">🔑 <b>${esc(site)} needs you to log in.</b> ${esc(info.reason || '')} &nbsp;→&nbsp;
    <a class="loginbtn" href="${esc(info.url)}" target="_blank" rel="noopener">Open ${esc(site)} &amp; log in ↗</a>
    <span class="dim">(in the JobPilot Chrome window — the agent resumes automatically once you're back in)</span></div>`
  ).join('');
}

/**
 * Render the self-contribution consent toggle bar.
 * @param {boolean} autoContribute - current consent state
 * @returns {string} HTML
 */
export function renderConsentBar(autoContribute) {
  return autoContribute
    ? `<div class="consentbar">🧬 <b>Self-contribution: ON.</b> JobPilot may file blocker issues and push <i>code/doc</i> improvements to the public repo (never your data). <button class="cbtn off" onclick="consent(false)">Turn off</button></div>`
    : `<div class="consentbar">🧬 <b>Self-contribution: OFF.</b> JobPilot keeps every improvement local. Opt in to let it file issues &amp; push <i>code/doc</i> fixes back (hard-guarded — never your data/creds). <button class="cbtn on" onclick="consent(true)">Enable contributing back</button></div>`;
}

/**
 * Render the brain-driver STATUS bar. Brain control is ALWAYS-ON (not consent-gated) — this is a
 * status indicator, not a toggle. It shows whether installed coding-agent CLIs are driving the
 * pipeline, and what the brain is doing right now.
 * @param {object} brain - brain-loop-state.json contents ({ phase, driver, ts })
 * @param {string[]} installed - names of installed brains (codex/grok/claude/gemini)
 * @returns {string} HTML
 */
export function renderBrainLoopBar(brain = {}, installed = []) {
  const age = brain.ts ? (Date.now() - Date.parse(brain.ts)) / 1000 : 1e9;
  const live = age < 180;                   // brain tick within last 3 min
  const names = installed.length ? installed.join(' · ') : 'none installed';
  if (live) {
    return `<div class="consentbar">🧠 <b>Brain in control (always-on).</b> ${esc(brain.driver ? brain.driver + ' ' : '')}driving every apply/email/connect by reasoning — ${esc(brain.phase || 'working')}. Brains: ${esc(names)}. <span class="dim">Stops only when you Stop.</span></div>`;
  }
  return installed.length
    ? `<div class="consentbar">🧠 <b>Brain driver idle/not started.</b> Installed brains: ${esc(names)}. Start it with <code>npm run brain-loop</code> — it then drives all outreach by reasoning. <span class="dim">(Not consent-gated; only code-push honors Self-contribution.)</span></div>`
    : `<div class="consentbar">🧠 <b>No coding-agent CLI installed.</b> Install one of Codex · Grok · Claude · Gemini (CLIs only, never API keys) so the brain can drive the pipeline. The data-only worker still scrapes leads meanwhile.</div>`;
}

/**
 * Render the "questions pending" alert banner if any questions need answers.
 * @param {number} pendCount - number of pending questions
 * @returns {string} HTML (empty if no pending questions)
 */
export function renderQuestionsBanner(pendCount) {
  if (!pendCount) return '';
  return `<div class="qbanner">🧠 The agent needs <b>${pendCount}</b> answer${pendCount > 1 ? 's' : ''} from you to apply to more jobs → <a href="#tab-questions" onclick="switchTab('questions')" style="color:#fcd34d;text-decoration:underline">answer them in the Questions tab ↓</a>. It remembers every answer forever.</div>`;
}
