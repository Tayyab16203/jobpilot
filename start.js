#!/usr/bin/env node
// start.js — Zero-setup bootstrap. This is what the user's agent launches.
// On first run it: (1) installs npm deps if missing, (2) makes sure the
// dedicated debug Chrome is reachable, then (3) hands off to the real MCP
// server over the SAME stdio pipes.
//
// MCP config points here:  { "command": "node", "args": ["<path>/start.js"] }
//
// All setup logs go to STDERR so they never corrupt the MCP stdout channel.
import { spawnSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => process.stderr.write('[bootstrap] ' + a.join(' ') + '\n');

// ── 1. Dependencies ───────────────────────────────────────────────────────────
function ensureDeps() {
  const need = ['@modelcontextprotocol/sdk', 'playwright', 'sql.js', 'node-fetch'];
  const missing = need.filter(d => !fs.existsSync(path.join(__dir, 'node_modules', d)));
  if (!missing.length) return;
  log('FIRST RUN: installing dependencies. Leave this process open until it finishes. Do not open the browser yet.');
  log(`Missing: ${missing.join(', ')}`);
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: __dir, stdio: ['ignore', 'inherit', 'inherit'], shell: true,
  });
  if (r.status !== 0) { log('npm install failed'); process.exit(1); }
  log('Dependencies installed. The browser opens once, on first onboard, for sign-in.');
}

// ── 2. Chrome debug port ──────────────────────────────────────────────────────
async function ensureChrome() {
  // Boot used to spawn Chrome on its own, which raced the locked launcher in
  // chrome.js and skipped the crash-profile repair. One launcher only.
  const { launchChrome } = await import('./src/mcp/chrome.js');
  const r = await launchChrome();
  log(r.detail || (r.ok ? 'Debug Chrome is up.' : 'Debug Chrome did not start.'));
}

// ── 3. Hand off to the MCP server over the same stdio ─────────────────────────
async function main() {
  ensureDeps();
  // Skip auto-launching Chrome if the user set JOBPILOT_NO_AUTOCHROME=1.
  // Chrome will only launch when a tool (launch_chrome / ensureChrome) explicitly asks for it.
  if (process.env.JOBPILOT_NO_AUTOCHROME !== '1') {
    await ensureChrome();
  } else {
    log('JOBPILOT_NO_AUTOCHROME=1 — skipping automatic Chrome launch (call launch_chrome when ready).');
  }
  log('Starting MCP server …');

  // NEVER STOP: supervise the MCP server. A clean exit (code 0 — the agent closed the
  // connection) ends normally; a CRASH (non-zero / signal) is auto-restarted with backoff
  // so the server is never left down while the agent/CLI is still using it.
  let restarts = 0;
  let child = null;
  const startServer = () => {
    const srv = spawn('node', [path.join(__dir, 'mcp-server.js')], {
      cwd: __dir, stdio: ['inherit', 'inherit', 'inherit'],
    });
    child = srv;
    srv.on('exit', (code, signal) => {
      child = null;
      if (code === 0) { process.exit(0); return; }            // clean shutdown — honor it
      restarts++;
      if (restarts > 20) { log(`MCP server crashed ${restarts}× — giving up.`); process.exit(code ?? 1); return; }
      const wait = Math.min(30000, 2000 * restarts);
      log(`MCP server exited (code=${code} signal=${signal}) — restarting in ${Math.round(wait / 1000)}s (#${restarts})`);
      setTimeout(startServer, wait);
    });
  };
  // When agent closes stdin, kill the child MCP server so it can write the stop flag and exit
  process.stdin.on('end', () => { if (child) child.kill('SIGTERM'); });
  process.on('SIGINT',  () => { if (child) child.kill('SIGTERM'); });
  process.on('SIGTERM', () => { if (child) child.kill('SIGTERM'); });
  startServer();
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
