// scripts/worker-forever.mjs — NEVER-STOP supervisor for the always-on worker.
//
// Runs `src/worker.js` and respawns it if the process ever dies (crash, OOM, external kill),
// with capped backoff. A CLEAN exit (code 0) means the user pressed Stop (the worker writes
// data/.stop and exits 0) — that is honored and the supervisor exits too.
//
// Usage:  npm run worker:forever        (optional DRY=1 / RUN_MS=<ms> env still apply)
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const STOPFILE = path.join(ROOT, 'data', '.stop');
const log = (...a) => process.stderr.write('[worker-forever] ' + a.join(' ') + '\n');

let restarts = 0;

function start() {
  // If the user asked to stop, don't respawn.
  if (fs.existsSync(STOPFILE)) { log('stop flag present — not starting.'); process.exit(0); }

  const child = spawn('node', [path.join(ROOT, 'src', 'worker.js')], {
    cwd: ROOT, stdio: 'inherit', env: process.env, windowsHide: true,
  });

  child.on('exit', (code, signal) => {
    if (code === 0) { log('worker exited cleanly (Stop requested) — supervisor done.'); process.exit(0); return; }
    if (fs.existsSync(STOPFILE)) { log('stop flag present after exit — supervisor done.'); process.exit(0); return; }
    restarts++;
    const wait = Math.min(60000, 3000 * restarts);   // backoff, capped at 60s
    log(`worker died (code=${code} signal=${signal}) — restarting in ${Math.round(wait / 1000)}s (#${restarts})`);
    setTimeout(start, wait);
  });

  child.on('error', e => log('spawn error: ' + e.message));
}

// Clean up a stale stop flag from a previous run so we actually start.
try { fs.rmSync(STOPFILE, { force: true }); } catch {}
log('starting supervised worker (auto-restart on crash)…');
start();
