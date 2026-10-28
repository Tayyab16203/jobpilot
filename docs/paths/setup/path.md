# Setup

First run, and any later session whose profile is empty. Do this before any site path. No personal data belongs in this tree.

```tree
follow: reached success

node fresh
  see: the repo was just cloned, data/profile.json is missing, or profileGaps is not empty
  branch reached | install dependencies | deps

node deps
  see: node_modules is missing a JobPilot dependency
  branch reached | npm install, tell the human to leave it running, then wait | worker
  branch retry | npm install failed | deps

node worker
  see: dependencies are installed and the data worker is not running
  branch reached | npm run agent | connect

node connect
  see: the data worker is up and the JobPilot MCP answers
  branch reached | onboard_status | onboard

node onboard
  see: onboard_status reports profileGaps
  branch reached | open the browser once, open_onboarding, user signs in on every platform | wait
  branch stop | search, email, apply, connect, or DM | onboard

node wait
  see: the onboarding form is open and profileGaps is still not empty
  branch retry | get_profile | wait
  branch success | profileGaps is empty | ready

node ready
  see: onboard_status reports onboarded
  branch reached | use only this profile | cycle
```
