// scripts/ensure.mjs — make the app set itself up. Uses ONLY Node built-ins so it runs
// even before any dependency is installed. Installs npm deps on first run, so `npm run worker`
// (or the agent via start.js) never fails with "Cannot find module 'playwright'".
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = m => process.stderr.write('[ensure] ' + m + '\n');
const need = ['@modelcontextprotocol/sdk', 'playwright', 'sql.js', 'node-fetch'];
const missing = need.filter(d => !fs.existsSync(path.join(ROOT, 'node_modules', d)));

if (missing.length) {
  log('FIRST RUN: installing dependencies. Leave this process open until it finishes. Do not open the browser yet.');
  log(`missing: ${missing.join(', ')}`);
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) { log('npm install failed — run `npm install` manually'); process.exit(1); }
  log('dependencies installed. The browser opens once, on first onboard, for sign-in.');
} else {
  log('dependencies present.');
}
