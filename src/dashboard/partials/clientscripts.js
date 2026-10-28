// src/dashboard/partials/clientscripts.js — Browser-side JavaScript for the dashboard.
// Returned as a <script> block string. Handles tab switching, answer saving,
// consent toggle, worker stop, bank filtering, and answer override.
//
// API BASE: when the page is served over HTTP (the normal case — you open
// http://127.0.0.1:<port>/ from the server), all API calls use `location.origin`, so they ALWAYS
// hit the exact server that served the page. This fixes the previous bug where a baked-in port
// (sometimes wrong, e.g. the Chrome debug port, or a stale instance's port) broke saving answers.
// Only the file:// fallback uses the known port passed from the coordinator.

/**
 * Returns the inline <script> block for the dashboard.
 * @param {number} UIPORT - fallback dashboard port, used only when opened as a file:// URL
 * @returns {string} HTML <script>...</script>
 */
export function dashScripts(UIPORT) {
  return `<script>
// ── API base — always talk to the server that served this page ─────────────────
function apiBase(){
  // Served over http(s): use this page's own origin (correct port, every time).
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  // Opened as a local file: fall back to the known dashboard port.
  return 'http://127.0.0.1:${UIPORT}';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(t, scroll){
  document.querySelectorAll('.pane').forEach(e => e.classList.toggle('on', e.id === 'p-' + t));
  document.querySelectorAll('.tabs button').forEach(e => e.classList.toggle('on', e.id === 'b-' + t));
  history.replaceState(null, '', '#tab-' + t);
  if (!scroll) return;
  const btn = document.getElementById('b-' + t);
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  if (r.top < 8 || r.bottom > window.innerHeight - 8) {
    const bar = document.querySelector('.tabs');
    if (bar) bar.scrollIntoView({ block: 'start' });
  }
}
(function(){
  // The tab bar sits under the email table. Scroll only for a hash the user
  // asked for. The default Easy Apply hash is written on every load, and the
  // 45s refresh must not pull the page down to the bar.
  const tab = (fromHashChange) => {
    const m = location.hash.match(/tab-(\\w+)/);
    const name = m ? m[1] : 'easy_apply';
    const scroll = fromHashChange ? !!m : (!!m && name !== 'easy_apply');
    switchTab(name, scroll);
  };
  tab(false);
  window.addEventListener('hashchange', () => tab(true));
})();

// ── Bank filter ───────────────────────────────────────────────────────────────
function flt(v){
  v = v.toLowerCase();
  document.querySelectorAll('#bank tbody tr').forEach(r => r.style.display = r.innerText.toLowerCase().includes(v) ? '' : 'none');
}

// ── Save a user-provided answer ───────────────────────────────────────────────
async function ans(qkey, value){
  if (!value) return;
  const base = apiBase();
  const btn = event && event.target;
  if (btn) { btn.disabled = true; btn.textContent = 'saving…'; }
  try {
    const r = await fetch(base + '/api/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qkey, answer: value })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    location.hash = '#tab-questions';
    location.reload();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'save'; }
    alert('Could not save — open the dashboard from the server URL (' + base + '), not the .html file.\\n\\nError: ' + e.message);
  }
}

// ── Train a platform strategy ─────────────────────────────────────────────────
async function trainStrategy(ev, id){
  ev.preventDefault();
  const verdict = ev.submitter ? ev.submitter.value : 'works';
  const note = ev.target.note ? ev.target.note.value : '';
  const base = apiBase();
  try {
    const r = await fetch(base + '/api/strategy-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, verdict, note })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    location.hash = '#tab-strategies';
    location.reload();
  } catch(e) {
    alert('Could not save the strategy note. Open the dashboard from the server URL (' + base + ').\\n\\n' + e.message);
  }
  return false;
}

// ── Override an agent-answered question ───────────────────────────────────────
function overrideAns(qkey, currentVal){
  const newVal = prompt('Override agent answer for this question:\\n\\n(current: ' + currentVal + ')', currentVal);
  if (newVal !== null && newVal.trim()) ans(qkey, newVal.trim());
}

// ── Consent toggle ────────────────────────────────────────────────────────────
async function consent(on){
  const base = apiBase();
  try {
    const r = await fetch(base + '/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoContribute: on })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    location.reload();
  } catch(e) {
    alert('Could not update consent — open the dashboard from the server URL (' + base + ').\\n\\nError: ' + e.message);
  }
}

// Explicit approval gate for job-specific CV drafts/uploads. Disabled by default.
async function tailoredConsent(on){
  const base = apiBase();
  const label = on ? 'Approve generating/uploading tailored CV drafts for slightly related roles?' : 'Disable tailored CV generation and uploads?';
  if (!confirm(label)) return;
  try {
    const r = await fetch(base + '/api/tailored-cv-consent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowTailoredCv: on })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    location.replace(location.pathname + location.search);
  } catch(e) { alert('Could not update tailored CV approval: ' + e.message); }
}

// ── X, LinkedIn, and Gmail sign-in probe ─────────────────────────────────────
async function testSessions(){
  const el = document.getElementById('sessionStatus');
  if (el) el.textContent = 'Testing X, LinkedIn, and Gmail…';
  try {
    const r = await fetch(apiBase() + '/api/session-check', { method: 'POST' });
    const j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || 'test failed');
    const bit = (name, on) => name + (on ? ' signed in' : ' signed out');
    if (el) el.textContent = [bit('X', j.x), bit('LinkedIn', j.linkedin), bit('Gmail', j.gmail)].join(' · ');
  } catch (e) { if (el) el.textContent = e.message; }
}

// ── Glassdoor, then Indeed, in a normal window ───────────────────────────────
async function openBoardLogin(){
  const el = document.getElementById('boardLoginStatus');
  if (el) el.textContent = 'Opening Glassdoor…';
  try {
    const r = await fetch(apiBase() + '/api/open-board-login', { method: 'POST' });
    const j = await r.json();
    if (el) el.textContent = j.detail || (j.ok ? 'Opened.' : 'Could not open.');
  } catch (e) {
    if (el) el.textContent = e.message;
  }
}

// ── Stop the worker ───────────────────────────────────────────────────────────
async function stopAll(){
  if (!confirm('Stop the JobPilot worker? All lanes halt within a few seconds. Your logged-in Chrome stays open.')) return;
  const base = apiBase();
  const b = event && event.target;
  if (b) { b.disabled = true; b.textContent = 'Stopping…'; }
  try {
    const r = await fetch(base + '/api/stop', { method: 'POST' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (b) b.textContent = 'Stopped ✓';
  } catch(e) {
    if (b) { b.disabled = false; b.textContent = '⏹ Stop worker'; }
    alert('Could not stop — open the dashboard from the server URL (' + base + ').\\n\\nError: ' + e.message);
  }
}
</script>`;
}
