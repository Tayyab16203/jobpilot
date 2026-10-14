// scripts/agent-forever.mjs — the single NEVER-STOP entrypoint for the brain-driven architecture.
//
// Supervises TWO processes, each respawned independently on crash (capped backoff):
//   1. the DATA-ONLY worker (src/worker.js with WORKER_DATA_ONLY=1) — the HANDS: it only scrapes
//      leads into the DB and keeps the dashboard fresh. It never emails/applies/connects.
//   2. the BRAIN driver (scripts/brain-loop.mjs) — reasons over the fresh leads + open encounters
//      and performs every apply/email/connect through the MCP tools, and improves the tools.
//
// So the worker is UNDER the brain: scraping is a tool the brain's pipeline feeds from; all action
// goes through reasoning. Brain control is always-on (not consent-gated). Both halt only on the
// user's explicit Stop (data/.stop) — same never-stop contract as worker:forever.
//
// Usage:  npm run agent   (or: node scripts/agent-forever.mjs)
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STOPFILE = path.join(ROOT, 'data', '.stop');
const log = (...a) => process.stderr.write('[agent-forever] ' + a.join(' ') + '\n');

// Clear a stale stop flag so we actually start.
try { fs.rmSync(STOPFILE, { force: true }); } catch {}

const stopped = () => fs.existsSync(STOPFILE);

/** Supervise one child: respawn on non-clean exit unless the user has Stopped. */
function supervise(name, scriptRelPath, extraEnv = {}) {
  let restarts = 0;
  const start = () => {
    if (stopped()) { log(`${name}: stop flag present — not starting.`); return; }
    const child = spawn('node', [path.join(ROOT, scriptRelPath)], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...extraEnv },
    });
    child.on('exit', (code, signal) => {
      if (code === 0 || stopped()) { log(`${name}: exited cleanly / stop requested — not respawning.`); return; }
      restarts++;
      const wait = Math.min(60000, 3000 * restarts);
      log(`${name}: died (code=${code} signal=${signal}) — restarting in ${Math.round(wait / 1000)}s (#${restarts})`);
      setTimeout(start, wait);
    });
    child.on('error', e => log(`${name}: spawn error: ${e.message}`));
  };
  start();
}

log('starting brain-driven agent (data-only worker + always-on brain driver)…');
// 1) HANDS: data-only worker. WORKER_NO_EVOLVE=1 so the worker never git-syncs/contributes on boot
//    (that is the brain's job now) and never wipes local changes on restart.
supervise('worker(data-only)', 'src/worker.js', { WORKER_DATA_ONLY: '1', WORKER_NO_EVOLVE: '1' });
// 2) BRAIN: the reasoning driver. Give it a moment so the DB/dashboard exist first.
setTimeout(() => supervise('brain', 'scripts/brain-loop.mjs'), 8000);

// Keep the supervisor alive; exit promptly once the user Stops.
const iv = setInterval(() => { if (stopped()) { log('⏹ Stop requested — supervisor exiting.'); clearInterval(iv); process.exit(0); } }, 3000);
