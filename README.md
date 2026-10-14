<div align="center">

# 🧭 JobPilot

### The self-evolving, agent-driven job hunter that lives in *your* browser.

**Bring your own AI coding agent as the brain. JobPilot is the hands, the memory, and the
nervous system — it applies for you across four channels, learns from every failure, and ships
its own fixes back to this repo.**

[![MIT License](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/protocol-MCP-3b82f6.svg)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-a855f7.svg)](CONTRIBUTING.md)
[![Self-evolving](https://img.shields.io/badge/%F0%9F%A7%AC-self--evolving-f59e0b.svg)](#-the-self-evolution-loop)

![JobPilot demo](docs/demo.gif)

<sub>▶️ Full-quality demo video: [`docs/demo.mp4`](docs/demo.mp4)</sub>

</div>

---

## 💡 What is this?

JobPilot is an [MCP](https://modelcontextprotocol.io) server with **no LLM of its own**. *Your*
coding agent — Claude Code, Codex, Kiro, Crew, Grok CLI — is the brain. You point it at JobPilot
and say *“find and apply to AI jobs.”*

The agent reasons. JobPilot provides:

- **🖐 Hands** — it drives *your* already-logged-in Chrome (LinkedIn, Gmail, ATS) over the DevTools protocol.
- **🧠 Memory** — a local dedup database so you never double-apply, across runs or agents.
- **🧬 A nervous system** — it records every failure, *learns from it*, and gets measurably better each session.

No API keys. No SMTP passwords. No scraping of other people's data. Your sessions, your machine, your data.

---

## ⚡ What it actually does — four channels, freshest-first

| Channel | What happens |
|---|---|
| ✉️ **Email** | Finds hiring emails in LinkedIn posts, HN "Who is hiring", Reddit & boards → sends a tailored email from **your Gmail**, CV auto-attached & verified. |
| ⚡ **LinkedIn Easy Apply** | Walks the multi-page modal, answers every question, uploads your CV, and **verifies "Application submitted."** |
| 📋 **External ATS forms** | Greenhouse · Lever · Ashby · Workable — resolves job-board links to the real ATS, fills react-selects / radios / consent, submits, confirms. |
| 🔗 **LinkedIn connect + note** | When there's no email/form, sends the poster a personalized connection request. |

Everything is ordered **newest-posted first** — because the first applicant gets read.

---

## 🧬 The self-evolution loop

This is what makes JobPilot different from every other job bot. **It is always-on in every way you
run the system** — through your agent, the always-on worker, or even the standalone dashboard
server. There is no supported way to run JobPilot that bypasses self-evolution; it's the point.

Every time it hits something it can't handle — a weird Easy Apply question, a form with no submit
button, a login-gated ATS — it records an **encounter**: a normalized signature, a running count,
and a saved **screenshot + HTML snapshot** under `data/evolution/`. Then it:

1. **🩹 Tries to self-heal first.** A fire-and-forget heal pass (`attemptSelfHeal`) reasons about
   the failure signature and attempts a lightweight recovery (re-click a hidden submit, re-open a
   stale dialog, …) — **without ever blocking the job-hunting pipeline.**
2. **🪄 Harvests** the answers you've *already* filled on LinkedIn (your real years-of-experience,
   salary, work-authorization) and reuses them everywhere — fuzzy-matched, so a reworded question
   reuses the same answer instead of asking you again.
3. **🙋 Asks you once.** Anything it genuinely can't infer becomes a *“question for you”* in the
   dashboard — answer it one time, remembered forever. Answers the agent derives itself from your
   profile are shown under *“🤖 agent answered”* so you can review/override them.
4. **📈 Reweights itself.** It tracks which search queries and ATS domains actually convert and
   shifts toward what works (UCB bandit), auto-skipping dead ends.
5. **🔁 Contributes back + reviews PRs (on by default).** A dedicated **evolver** lane — running at
   the *same priority as job applying* — keeps the fork in sync with `main`, opens PRs for its own
   fixes, and (on the main repo) **reviews & merges open PRs from *every* contributor**, including
   other agents' forks. It files GitHub issues for blockers it can't fix.

> Your coding agent reads the auto-generated `data/evolution/PLAYBOOK.md`, patches the relevant
> module, marks the encounter fixed — and the fix is pushed back for everyone. **The repository
> literally improves itself, session over session.**

### How contribution works (fork vs. main repo)

- **If your clone is a fork** → the evolver keeps it continuously rebased on `upstream/main`, and
  opens a **PR to the main repo** for every change. When a PR merges, it **syncs again** so the
  fork never drifts.
- **If you own the main repo** → the evolver **reviews and merges every open PR** — from this agent
  *and* from other contributors' forks. Each PR is judged on **usefulness** — the merits of its diff
  plus any issues it links — **not on its label or author**. It approves pending fork CI so the
  security gate can run, merges useful PRs (even forcing past a stuck mechanical auto-merge),
  resolves conflicts where it can, and detects superseded/redundant PRs and closes them. **The one
  gate never bypassed is the CI security/data-safety check** — a failing security gate blocks the
  merge no matter who opened the PR.
- Commits are authored as the **GitHub username** (never a real/personal name), with the account's
  noreply email. Hard-guarded: the push aborts if anything under `data/`, `.env*`, drafts, logs,
  screenshots, or the DB is ever staged.

---

## 🙋 You're always in the loop (it never guesses the things that matter)

JobPilot does **not** invent answers to questions like salary, visa/work-authorization, or notice
period. Here's exactly how an application question gets answered, in order:

1. **From the post + your profile.** Most screening questions are already answered by what you gave
   it (years of experience, location, links, country-specific salary expectations) or stated in the job post itself.
2. **Harvested from your own LinkedIn.** It reuses the answers you've *already* filled on past
   Easy Apply forms — your real numbers, not a model's guess.
3. **It asks you — once.** Anything it genuinely can't infer becomes a **question for you** in the
   dashboard's 🧠 **Questions** tab. You answer it one time; it's stored and **reused on every
   future application** (and fuzzy-matched + stemmed, so a reworded version of the same question
   still hits — you're not asked twice). Nothing is submitted on a required field it had to guess.
   Anything the agent *did* answer from your profile shows under **🤖 agent answered** so you can
   review or override it.

```
unknown question ─▶ parked in the Questions tab ─▶ you answer once ─▶ remembered forever
                                                                      (reused + fuzzy-matched)
```

So salary and work-authorization are exactly the things a **person** decides — the agent surfaces
them to you and remembers your call. If a login ever lapses mid-run, you get the same treatment: a
one-click "log in here" banner, and it resumes automatically once you're back in.

> Verify it yourself: `node scripts/verify-loop.mjs` walks an unknown question through
> park → answer-once → reuse → fuzzy-match.

---

## 🏆 What's been achieved

- **All four channels working end-to-end** against the live 2026 LinkedIn / ATS DOM — including the
  shadow-DOM Easy Apply modal and the "Connect is hidden under the More menu" profile layout.
- **A real answer engine** that harvests your prefilled answers, reuses them for *similar* questions
  (fuzzy + stemmed matching), selects salary expectations by country/currency, converts
  currencies/periods, keeps current salary separate, handles yes/no work-auth
  logic, shows you everything it auto-answered, and escalates only the truly-unknown.
- **A concurrent, never-stop worker** — scout · mailer · applier · connector · **evolver** run in
  parallel lanes under a supervisor that auto-restarts any lane that crashes; global crash handlers
  + process respawn mean one bad lead or page never halts the pipeline. The detached worker is
  designed to **outlive your agent session** — the MCP server does **not** write `data/.stop` when
  the agent disconnects, so only an explicit user Stop (dashboard ⏹ / `npm run stop`) halts the loop.
- **Self-evolution as a first-class lane** — the `evolver` runs at the same priority as applying:
  it syncs with `main` + reviews/merges open PRs every ~2 min and contributes every ~10 min.
- **Usefulness-first PR review** — on the main repo, every open PR (any contributor, any fork, any
  label) is judged on the merits of its diff plus the issues it links — not on its label or author.
  Empty PRs are closed, superseded ones are detected and closed, conflicts are resolved where safe,
  and the CI security/data-safety gate is the one check never bypassed.
- **Country-scope action gating** — old/global queue entries and off-scope locations no longer leak
  into outreach or applications when the profile is set to country scope.
- **Tougher LinkedIn + form resilience** — note-less invites on custom-invite pages, a graceful
  fallback when LinkedIn's free note quota is exhausted, and learned form-skips surfaced as
  `needs_manual` (with the failing domain) instead of silently stalling leads.
- **A modular pipeline dashboard** (`src/dashboard/` partials) with per-lane live status, a 🧠
  Questions tab (with 🤖 agent-answered review), and a 🧬 Evolution tab showing every blocker with
  its screenshot + HTML snapshot.
- **Zero personal data in the codebase** — everything about you lives in `data/` (gitignored).

---

## 🚀 Getting started (clone → tell your agent → done)

JobPilot ships with ready-made MCP config for every popular agent, so there's **nothing to wire up
by hand** — no absolute paths, no JSON surgery.

### 1. Clone

```bash
git clone https://github.com/maazbin/jobpilot
cd jobpilot
```

### 2. Open the folder in your agent and just talk to it

Say something like:

> *““kill old workers and processes then find and apply to relavent  jobs — and keep self-evolving + contributing PRs while you do””*

You don't have to spell out the self-evolution part — it's always on — but it's a good reminder of
what the agent will do. Other things you can tell it:

- *“set my location scope to worldwide”* (or `continent` / `country`) — how far to search.
- *“answer screening questions from my CV where you can, only ask me when you're truly stuck.”*
- *“review and merge any open PRs, including from other contributors.”*
- *“keep running and never stop.”*

Because the repo already contains the config your agent looks for, it **auto-discovers** the
`jobpilot` MCP server and launches it via `start.js` — which self-installs dependencies on first
run, relaunches your Chrome with the debug port + session restore, and starts the server. You may
get a one-time "approve this MCP server?" prompt — say yes.

| Agent | What's already in the repo | You do |
|---|---|---|
| **Claude Code** | `.mcp.json` | open the folder, approve the server |
| **Cursor** | `.cursor/mcp.json` | open the folder, enable it in Settings → MCP |
| **Kiro** | `.kiro/settings/mcp.json` | open the folder — it's picked up automatically |
| **VS Code / Copilot** | `.vscode/mcp.json` | open the folder, click **Start** on the server |
| **Gemini CLI** | `.gemini/settings.json` | run `gemini` from the folder |
| **Codex CLI** | `.codex/config.toml` | `export CODEX_HOME="$(pwd)/.codex"` then run `codex` (TOML, not JSON) |

> All configs use a **relative** `node start.js`, so they work no matter where you cloned the repo —
> as long as you open/run the agent from the repo folder. Claude Desktop and Windsurf use a global
> config file; copy the block from `.mcp.json` into theirs (see below).

<details><summary>Manual / global clients (Claude Desktop, Windsurf)</summary>

**Claude Desktop** — add to `claude_desktop_config.json` (use the absolute path to `start.js`):
```json
{ "mcpServers": { "jobpilot": { "command": "node", "args": ["ABSOLUTE/PATH/TO/start.js"] } } }
```

**Windsurf** — add the same block to `~/.codeium/windsurf/mcp_config.json`.
</details>

### 3. The agent takes it from here

Guided by [`AGENTS.md`](AGENTS.md), it checks setup (`onboard_status`), launches your Chrome
(`launch_chrome`, restoring your tabs/logins), opens a local **setup form** where you drag-and-drop
your CV and paste your links/roles (never a file path in chat), then scrapes, dedups, emails, and
applies — reporting live on the dashboard. If a login ever lapses, it shows a one-click
"log in here" link.

### Prefer the always-on engine? Skip the agent entirely:

```bash
npm install && npm run worker          # or: npm run worker:forever  (respawns on crash)
```

Five concurrent lanes (scout · mailer · applier · connector · **evolver**), freshest-first,
self-evolving, with the dashboard + Questions tab + a **⏹ Stop** button live at
**http://127.0.0.1:7788**. It **never stops on its own**: every lane auto-restarts if it throws,
global crash handlers keep the process alive, and `worker:forever` respawns the whole process if it
ever dies. Flags: `DRY=1` (scrape only), `RUN_MS=<ms>` (time-box). The only thing that stops it is
the dashboard **⏹ Stop** button (or `npm run stop`).

---

## 📊 The dashboard

A local-only UI at **http://127.0.0.1:7788** (bound to localhost):

- **Pipeline** — fresh email leads first, then per-channel queues, newest-posted first, with live per-lane status.
- **🧠 Questions** — answer anything the agent couldn't, inline (remembered forever). A **🤖 agent
  answered** section shows every answer the agent derived from your profile, with a one-click
  **override**.
- **🧬 Evolution** — every open encounter with its screenshot + HTML snapshot, plus the learned-answers table.
- **Done log / Emails sent / Connects** — a full audit trail with over-contact warnings.

> The UI is built from small partials under `src/dashboard/` (coordinator + `styles.js` +
> `helpers.js` + `partials/`), so it's easy to modify a single section without touching the rest.

---

## 🧱 Known blockers (help wanted!)

Some sites actively fight automation or gate applications behind accounts. JobPilot handles these
gracefully (routes the lead elsewhere / asks you) and we track them as open issues:

- **Indeed** — anti-bot / login wall ([#1](https://github.com/maazbin/jobpilot/issues/1))
- **Glassdoor** — login + anti-bot wall ([#2](https://github.com/maazbin/jobpilot/issues/2))
- **Workday / iCIMS / Taleo / SuccessFactors** — account-gated multi-step ATS ([#3](https://github.com/maazbin/jobpilot/issues/3))
- **Job-board redirects** (Arbeitnow / WeWorkRemotely / Himalayas) ([#4](https://github.com/maazbin/jobpilot/issues/4))

Want to knock one out? See [CONTRIBUTING.md](CONTRIBUTING.md) — these make great first PRs.

---

## 🗂 Project structure

```
jobpilot/
├── start.js                # ← MCP config points HERE (self-installs, launches Chrome, respawns server on crash)
├── mcp-server.js           # the MCP server (32 fine-grained tools) + always-on self-evolution loop
├── AGENTS.md               # the guide your agent reads to drive everything zero-touch
├── CODING_STANDARDS.md     # conventions for every file (ESM, JSDoc, no personal data, …)
├── src/
│   ├── worker.js           # always-on engine: scout · mailer · applier · connector · evolver (concurrent, supervised)
│   ├── evolve.js           # self-evolution memory: encounters · self-heal · learned answers · strategy bandit
│   ├── evolve-loop.js      # background self-evolution for agent/server mode (stands down while worker is live)
│   ├── contribute.js       # self-improving loop: syncs, opens/reviews/merges PRs, files issues (data-safe)
│   ├── profile.js          # personalization + location scope — read from data/ (gitignored)
│   ├── tracker.js          # jobs DB + dedup guards + channel queues
│   ├── dashboard/          # modular dashboard: index.js (coordinator) + styles + helpers + partials/
│   ├── server.js           # local web server: onboarding, dashboard, /api/answers, /evidence
│   └── mcp/                # sources · easyapply · forms · connect · answers · gmail · chrome
├── scripts/
│   ├── worker-forever.mjs  # respawns the worker process if it ever dies (never-stop)
│   └── ci-security-scan.mjs# CI data-safety gate (blocks any PR that stages data/creds)
├── data/                   # EVERYTHING personal lives here — gitignored
└── docs/demo.gif
```

---

## 🔒 Privacy & safety

- **Your data never leaves your machine.** Profile, CV, scraped jobs, dedup history, harvested
  answers, and the logged-in Chrome profile all live under `data/`, which is **gitignored**.
- **No credentials in code.** JobPilot uses your existing browser sessions — no API keys, no SMTP.
- **The self-contribution loop is data-safe by construction**: on by default, but an allowlist + a
  sensitive-path tripwire abort any push that would include `data/`, `.env`, drafts, logs,
  screenshots or the DB. Toggle it off from the dashboard anytime.
- **Dedup is permanent**, and daily caps + attempt limits are enforced and recorded.
- **Easy Apply is account-safe.** LinkedIn restricts accounts that over-apply, so JobPilot keeps a
  daily-refreshed estimate of the real Easy Apply limit (conservative default 50/day) and **stops at
  an 80% safety buffer** (e.g. 40/day) — then waits a randomized cooldown (~90–240s) after each
  submission so applications never look like a bot-like burst. A bad or offline refresh never raises
  the cap. Email, forms, and connect keep running when Easy Apply is paused.

---

## 🤝 Contributing

Issues and PRs are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Great first contributions:
a new ATS adapter in `src/mcp/forms.js`, a new lead source in `src/mcp/sources.js`, or a resilience
fix driven by a real encounter in `data/evolution/PLAYBOOK.md`.

## 📄 License

[MIT](LICENSE) © [maazbin](https://github.com/maazbin) and JobPilot contributors.
