// scripts/brain-loop.mjs — THE BRAIN. The always-on reasoning driver the whole pipeline runs under.
//
// ARCHITECTURE (the agreed inversion): the worker is NOT a peer that applies on its own. The worker
// runs DATA-ONLY (scrape leads into the DB + keep the dashboard fresh). THIS loop is the brain that
// sits on top: every tick it reasons over the fresh leads and performs the applies / emails /
// connects itself through the MCP tools, and also reasons over open encounters to improve the
// agent's own tools. So every job action goes THROUGH the brain — nothing acts without it.
//
// It drives whichever coding-agent CLIs are installed — Codex, Grok, Claude, Gemini — in headless
// mode, round-robin (rotation), handing each a batch of real pending leads + the top encounter.
//
// BRAIN CONTROL IS ALWAYS-ON AND NOT CONSENT-GATED. Brain-in-control is the core idea of the
// project, not an optional feature — like self-evolution, it is never bypassed. The ONLY consent
// that still applies is `consent.autoContribute` (whether CODE/DOCS get pushed to GitHub), which is
// about where code leaves the machine, NOT about whether the brain reasons and acts. The loop stops
// only on the user's explicit Stop (data/.stop) — same contract as the never-stop worker.
//
// STRICTLY CLIs — NEVER API KEYS. Only shells out to already-installed, already-logged-in CLIs; it
// strips every *_API_KEY / *_TOKEN from the child env so a brain can only run on its own CLI login.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA } from '../src/config.js';
import { getProfile } from '../src/profile.js';
import { initDB, rows } from '../src/tracker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STOPFILE = path.join(DATA, '.stop');
const STATEFILE = path.join(DATA, 'brain-loop-state.json');

const IDLE_HEARTBEAT_MS = 10 * 60 * 1000; // when there's no work, still re-check at least this often
const POLL_MS = 20 * 1000;                // how often we check the stop flag / backlog
const TURN_TIMEOUT_MS = 25 * 60 * 1000;   // hard cap on a single brain's turn
const LEADS_PER_TURN = 8;                 // how many fresh leads to hand the brain each turn

const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const stopped = () => fs.existsSync(STOPFILE);
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('en-GB')}] brain-loop:`, ...a);

// NOTE on launch syntax (NOT behavior — behavior lives in AGENTS.md): each entry is just how to
// start that CLI headlessly reading its prompt. codex uses --dangerously-bypass-approvals-and-sandbox
// because its default sandbox blocks it from spawning the JobPilot MCP subprocess on Windows (the
// repo is already marked trusted in ~/.codex/config.toml). Adding a future brain = one line here.
const BRAINS = [
  { name: 'codex',  bin: 'codex',  stdin: true,  args: () => ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', ROOT, '-'] },
  { name: 'grok',   bin: 'grok',   stdin: false, args: p => ['--no-auto-update', '--cwd', ROOT, '-p', p] },
  { name: 'claude', bin: 'claude', stdin: false, args: p => ['-p', '--permission-mode', 'acceptEdits', p] },
  { name: 'gemini', bin: 'gemini', stdin: false, args: p => ['-p', p] },
];

function onPath(bin) { return !!resolveBin(bin); }
// Resolve a CLI to its concrete path (incl. Windows .cmd/.exe/.ps1 shims) so we can spawn WITHOUT
// shell:true — which is what mangled the multi-line prompt and triggered the arg-escaping warning.
function resolveBin(bin) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', '.ps1', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) for (const e of exts) {
    try { const full = path.join(d, bin + e); if (d && fs.existsSync(full)) return full; } catch {}
  }
  return null;
}
function installedBrains() { return BRAINS.filter(b => onPath(b.bin)); }

// If a brain burns a turn without reaching the tools, bench it for a while so a working brain
// (rotation) carries the load instead of wasting cycles. Benched brains are retried later.
const benchedUntil = {};   // name → epoch ms
function availableBrains() {
  const now = Date.now();
  return installedBrains().filter(b => !(benchedUntil[b.name] > now));
}
const BENCH_MS = 30 * 60 * 1000;

// Strip API keys/tokens so a brain runs purely on its own CLI login (subscription), never a key.
// Also point each brain at THIS repo's MCP config so it actually has the JobPilot tools, and make
// any MCP server a brain launches NOT auto-start its own worker (we already run the data-only one).
function sanitizedEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/(_API_KEY|_APIKEY|_SECRET|_TOKEN|OPENAI_KEY|ANTHROPIC_KEY|XAI_KEY|GEMINI_KEY)$/i.test(k)) delete env[k];
  }
  // One-time MCP wiring is per-brain client config, NOT behavior: each CLI must have the JobPilot
  // MCP server registered once in ITS OWN config (codex: ~/.codex/config.toml; grok: .grok/
  // config.toml; etc.) — documented in AGENTS.md "Wire a brain" setup. We must NOT repoint a brain's
  // home dir (that loses its CLI login). We only ensure a launched MCP server does not spawn its own
  // worker/evolve loop — we already run the data-only worker — so there is no process sprawl.
  env.JOBPILOT_NO_AUTOWORKER = '1';
  return env;
}

// ── What is there to reason about? Fresh leads to act on + open encounters to fix. ──
function freshLeads(limit = LEADS_PER_TURN) {
  // Newest first, same priority spirit as the worker queue (LinkedIn-post email leads first).
  try {
    return rows(
      `SELECT role, company, channel, email, apply_url, url, poster_url, poster_name, relevance, source
       FROM jobs WHERE status='new' AND COALESCE(attempts,0) < 3
       ORDER BY CASE WHEN channel='email' AND source='linkedin_post' THEN 0 ELSE 1 END,
                CASE WHEN posted_at='' OR posted_at IS NULL THEN 1 ELSE 0 END, posted_at DESC, relevance DESC
       LIMIT ?`, [limit]);
  } catch { return []; }
}
function backlog() {
  let encounters = 0, questions = 0, leads = 0;
  try { encounters = rows(`SELECT COUNT(*) n FROM encounters WHERE status IN ('open','regressed')`)[0]?.n || 0; } catch {}
  try { questions = rows(`SELECT COUNT(*) n FROM answers WHERE pending=1`)[0]?.n || 0; } catch {}
  try { leads = rows(`SELECT COUNT(*) n FROM jobs WHERE status='new' AND COALESCE(attempts,0) < 3`)[0]?.n || 0; } catch {}
  return { encounters, questions, leads, total: encounters + questions + leads };
}

// Build the standing instruction. We deliberately keep this TINY and brain-agnostic: the brain is
// pointed at AGENTS.md — the SINGLE instruction guide every coding agent (now or future) reads — and
// told to do one cycle. ALL behavior (how to connect to the MCP, which tools to call per channel,
// the rules, the self-evolution loop) lives in AGENTS.md, not here. The only per-cycle context we
// inject is the list of real pending leads, so the brain acts on concrete work. Adding a new brain
// never requires touching this prompt — only (optionally) its launch syntax in BRAINS.
function buildPrompt(leads) {
  const leadLines = leads.length
    ? leads.map((j, i) => `  ${i + 1}. [${j.channel || '?'}] ${j.role || '(role?)'} @ ${j.company || '(company?)'}`
        + `${j.email ? ' · email ' + j.email : ''}${j.apply_url || j.url ? ' · ' + (j.apply_url || j.url) : ''}`
        + `${j.poster_url ? ' · poster ' + j.poster_url : ''}`).join('\n')
    : '  (none right now — focus on PART B)';
  return [
    'You are the BRAIN driving JobPilot from inside its own repo. Read AGENTS.md first — it is the',
    'single guide for every agent: how to connect to the JobPilot MCP server and exactly what your',
    'job is. Follow it. Then do ONE productive cycle and exit (do not start long-running processes).',
    '',
    'This cycle, prioritize these fresh leads already scraped into the bank (act on each per AGENTS.md',
    '— judge relevance, pick the channel, call the MCP tool, check_already_actioned first):',
    leadLines,
    '',
    'Then advance self-evolution once (top open encounter → fix → resolve → contribute) per AGENTS.md.',
  ].join('\n');
}

function readState() { try { return JSON.parse(fs.readFileSync(STATEFILE, 'utf8')); } catch { return { turn: 0, history: [] }; } }
function writeState(s) { try { fs.writeFileSync(STATEFILE, JSON.stringify(s, null, 2)); } catch {} }
function beat(phase, extra = {}) {
  const s = readState();
  s.phase = phase; s.ts = new Date().toISOString(); Object.assign(s, extra);
  writeState(s);
}

function runBrain(brain, prompt) {
  return new Promise(resolve => {
    log(`▶ dispatching ${brain.name} …`);
    const full = resolveBin(brain.bin) || brain.bin;
    const ext = (full.match(/\.(cmd|bat|ps1|exe)$/i) || [, ''])[1].toLowerCase();

    // Build the real command WITHOUT ever putting the prompt on a shell command line:
    //   • .exe (native, e.g. grok) → spawn directly, shell:false. argv (incl. a multi-line prompt
    //     arg) is passed to the process verbatim by the OS — no shell to mangle it.
    //   • .ps1 shim (e.g. codex) → run via pwsh -File; codex takes its prompt on STDIN ('-'), so
    //     no prompt ever appears as an arg anyway.
    //   • .cmd/.bat shim → run via cmd /c; prompt (if arg-mode) is passed as a separate argv entry.
    let cmd, argv;
    const promptArgs = brain.args(brain.stdin ? '-' : prompt);  // for stdin brains, '-' is ignored by our args()
    if (ext === 'ps1') { cmd = 'pwsh'; argv = ['-NoProfile', '-File', full, ...promptArgs]; }
    else if (ext === 'cmd' || ext === 'bat') { cmd = 'cmd'; argv = ['/c', full, ...promptArgs]; }
    else { cmd = full; argv = promptArgs; }   // .exe or extensionless → direct

    const child = spawn(cmd, argv, {
      cwd: ROOT, env: sanitizedEnv(), stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true,
    });
    let out = '', err = '';
    const timer = setTimeout(() => { log(`⏱ ${brain.name} exceeded ${Math.round(TURN_TIMEOUT_MS / 60000)}m — killing turn`); try { child.kill('SIGKILL'); } catch {} }, TURN_TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); log(`✗ ${brain.name} failed to launch: ${e.message}`); resolve({ ok: false, detail: e.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      const tail = (out || err).toString().trim().split('\n').slice(-3).join(' | ').slice(0, 300);
      log(`■ ${brain.name} exited ${code}. ${tail}`);
      resolve({ ok: code === 0, code, tail });
    });
    // Deliver the prompt on stdin for stdin-brains; otherwise just close stdin.
    try { if (brain.stdin) child.stdin.write(prompt); child.stdin.end(); } catch (e) { log(`stdin write failed for ${brain.name}: ${e.message}`); }
  });
}

async function tick() {
  const brains = availableBrains();
  if (!brains.length) {
    const anyInstalled = installedBrains().length;
    beat(anyInstalled ? 'all brains benched (retrying later)' : 'no brains installed');
    log(anyInstalled ? 'all installed brains temporarily benched — will retry' : 'no coding-agent CLIs on PATH — standing by');
    return;
  }

  const leads = freshLeads();
  const bl = backlog();
  if (bl.total === 0) { beat('idle (no leads, no encounters)'); log('nothing to do this tick (0 leads, 0 encounters, 0 questions)'); return; }

  // ROTATION: next available brain, round-robin.
  const state = readState();
  const brain = brains[(state.turn || 0) % brains.length];
  log(`work: ${bl.leads} leads · ${bl.encounters} encounters · ${bl.questions} questions · brains: ${brains.map(b => b.name).join(',')} · turn → ${brain.name}`);
  beat(`reasoning via ${brain.name} (${leads.length} leads + top encounter)`, { driver: brain.name });
  const result = await runBrain(brain, buildPrompt(leads));
  // If the brain couldn't reach the tools (common failure signatures), bench it so a working brain
  // carries the load. Not a per-brain hack — any brain that can't connect gets benched the same way.
  if (!result.ok || /no_tools|no jobpilot|no mcp|tools unavailable/i.test(result.tail || '')) {
    benchedUntil[brain.name] = Date.now() + BENCH_MS;
    log(`⚠ ${brain.name} turn unproductive — benched ${Math.round(BENCH_MS / 60000)}m (a working brain will drive).`);
  }
  state.turn = ((state.turn || 0) + 1) % 1000;
  state.history = [{ ts: new Date().toISOString(), brain: brain.name, ...result, backlog: bl }, ...(state.history || [])].slice(0, 50);
  state.lastTick = new Date().toISOString();
  writeState(state);
  beat('idle (between turns)', { driver: brain.name });
  // Brief cooldown so a brain that fails instantly can't spin; real turns take minutes anyway.
  await SLEEP(15000);
}

async function main() {
  await initDB();
  const brains = installedBrains();
  log(`started (ALWAYS-ON brain driver). root=${ROOT}`);
  log(`installed brains: ${brains.length ? brains.map(b => b.name).join(', ') : '(none — standing by until one is installed)'}`);
  log(`brain control is NOT consent-gated; code-push still honors consent.autoContribute=${getProfile().consent?.autoContribute !== false}`);
  log(`drives every apply/email/connect through reasoning + fixes tools; stops only on data/.stop`);
  beat('started');

  let lastHeartbeat = 0;
  while (!stopped()) {
    const now = Date.now();
    const bl = backlog();
    // Always-on: dispatch whenever there is ANY work (leads to act on OR encounters to fix). The
    // idle heartbeat just guarantees a periodic re-check even if nothing changed. No consent gate.
    if (bl.total > 0 || now - lastHeartbeat >= IDLE_HEARTBEAT_MS) {
      lastHeartbeat = now;
      try { await tick(); } catch (e) { log('tick error (continuing): ' + ((e && e.message) || e)); beat('tick error (continuing)'); }
    }
    for (let i = 0; i < Math.ceil(POLL_MS / 1000) && !stopped(); i++) await SLEEP(1000);
  }
  log('⏹ data/.stop present — brain driver exiting cleanly.');
  beat('stopped');
  process.exit(0);
}

process.on('uncaughtException', e => log('⚠ uncaughtException (continuing): ' + ((e && e.stack) || e)));
process.on('unhandledRejection', e => log('⚠ unhandledRejection (continuing): ' + ((e && e.stack) || e)));
main();
