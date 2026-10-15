---
name: medusa-cloud-cli
description: >-
  Use to install, restore, or use Medusa Cloud's official CLI (mcloud) on the Grok Bot computer, and to connect the official Medusa Docs MCP and Cloud MCP as optional connectors. mcloud is a CLI, not an MCP.
---
# medusa-cloud-cli

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Endpoints marked *(verified)* were checked against the official Medusa v2 API reference on 2026-10-15; re-check after Medusa upgrades.

## What it is *(verified: https://docs.medusajs.com/cloud/cli)*
`mcloud` is the official Medusa Cloud CLI. It manages organizations, projects, environments, builds, logs and variables from the terminal. It does **not** read or write store data. Use this plugin's tools or the Cloud MCP for that.

## Install / self-restore
- Official: `npm install @medusajs/mcloud -g`, which **requires Node.js v22+**. Verify with `mcloud --version`.
- On a Grok Bot computer, run `bash scripts/setup-mcloud.sh`. It installs everything under `$HOME/.local`, which persists across box resets, and pulls in a private, checksum-verified official Node 22 if the system Node is older. It writes the `$HOME/.local/bin/mcloud` wrapper and keeps a restore copy at `$HOME/.local/share/mcloud/setup-mcloud.sh`.
- **Self-restore:** if `mcloud` is missing after an update, run `bash $HOME/.local/share/mcloud/setup-mcloud.sh`. It's safe to re-run.

## Login (a human step; the bot never logs in for you)
- Interactive: `mcloud login` opens a browser.
- Non-interactive (CI): set `MCLOUD_TOKEN` to a Cloud access key, or run `mcloud login --token <key>`. Keep the key in a secret store and never in chat.
- Context: `mcloud use`, then `mcloud whoami`. Add `--json` for machine output.

## Useful read-only commands
`mcloud whoami`, `mcloud organizations list --json`, `mcloud environments list`, `mcloud logs`, `mcloud variables list`. Anything that triggers builds or changes variables is a write: dry-run it in words and get human approval first.

## Official remote MCPs (optional connectors; OAuth with a Cloud account) *(verified)*
- Docs MCP: `https://docs.medusajs.com/mcp`. Docs Q&A (`ask_medusa_question`) and implementation guides.
- Medusa Cloud MCP: `https://cloud.medusajs.com/mcp`. **Read-only** store data for Cloud environments (Medusa v2.12.4+). Environments built before 2026-10-08 need a fresh build, e.g. `mcloud environments trigger-build`.
