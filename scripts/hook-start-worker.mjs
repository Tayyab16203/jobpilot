// scripts/hook-start-worker.mjs — Kiro UserPromptSubmit hook gate.
//
// Kiro's UserPromptSubmit hook fires on EVERY prompt (its matcher is ignored for this trigger),
// so this gate reads the prompt from stdin and starts the DATA-ONLY worker ONLY when the prompt
// contains an explicit start signal. Otherwise it exits 0 and does nothing.
//
// Start signals (case-insensitive): "start-worker", "start worker", "start the worker",
// "start scraping", "start scout". A stop signal is handled too: "stop worker" / "stop-worker"
// / "stop the worker" writes the stop flag so the worker halts.
//
// The worker it starts NEVER emails/applies/connects — it only scrapes leads into the DB. All
// job finding, CV matching, applying, emailing and connecting is done by the agent (Kiro).
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Read the hook payload from stdin (Kiro sends session context as JSON).
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let prompt = '';
try {
  const j = JSON.parse(raw || '{}');
  prompt = String(j.prompt ?? j.userPrompt ?? j.message ?? j.input ?? raw ?? '');
} catch { prompt = raw || ''; }
const text = prompt.toLowerCase();

const START = /\b(start[- ](the[- ])?worker|start[- ](scraping|scout)|start[- ]data[- ]worker)\b/;
const STOP  = /\b(stop[- ](the[- ])?worker|stop[- ]scraping|stop[- ]data[- ]worker)\b/;

if (STOP.test(text)) {
  spawnSync('node', [path.join(ROOT, 'scripts', 'stop.mjs')], { cwd: ROOT, stdio: 'inherit' });
  process.stdout.write('⏹ Stop signal detected — data worker will halt within a few seconds.\n');
  process.exit(0);
}

if (START.test(text)) {
  // Fire-and-forget: worker-data.mjs itself spawns the worker detached and returns immediately.
  spawnSync('node', [path.join(ROOT, 'scripts', 'worker-data.mjs')], { cwd: ROOT, stdio: 'inherit' });
  // stdout is forwarded into the agent context for UserPromptSubmit — tell the agent what happened.
  process.stdout.write('🟢 Start signal detected — data-only worker launched (scrapes leads into the DB only). You (the agent) handle job finding, CV matching, applying, emailing and connecting via the MCP tools.\n');
  process.exit(0);
}

// No signal in this prompt — do nothing.
process.exit(0);
