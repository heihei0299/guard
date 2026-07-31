# Pi Guard 🔒

A [pi](https://pi.dev) extension that implements **Guard Mode** — a structured planning workflow enforced at the tool-call level. When Guard Mode is active, the agent explores and plans but cannot modify files or run destructive commands without going through the plan workflow.

## Overview

This project contains a pi extension (`pi-guard-extension/`) that replaces the old three-state guard with Guard Mode (a.k.a. plan mode):

- Guard Mode activation via the `/guard` command or the `--guard` startup flag
- Two workflow tools: `guard_mode_question` (ask clarification questions) and `guard_mode_complete` (submit a plan)
- Write operations (`write`/`replace`) are **only** allowed on allowlisted paths (`.scratch/`, `docs/`, `CONTEXT.md`) while planning
- `bash` is restricted to read-only / safe commands while planning
- `edit` and `update_plan` are always blocked while planning
- Custom (user) tools are disabled by default and must be opted in
- Plan and Guard Mode state survive session resume
- Messages are bilingual (English / 中文)

## Project Structure

```
pi-guard/
├── README.md                        # This file
├── .gitignore
├── pi-guard-extension/              # The extension package
│   ├── package.json                 # Pi package manifest
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts                 # Thin forwarder → plan-mode.ts
│       ├── plan-mode.ts             # createGuard() wiring: command, flag, tools, events
│       ├── tool-policy.ts           # Tool classification, path allowlist, bash safety
│       ├── state.ts                 # Plan Mode state + session restore
│       ├── settings.ts              # ~/.pi/agent/pi-guard.json loading/validation
│       ├── prompt.ts                # Bilingual system prompt
│       ├── command.ts               # /guard argument completions
│       ├── message-transform.ts     # Context filtering in Guard Mode
│       ├── presentation.ts          # TUI status rendering
│       ├── question-tool.ts         # guard_mode_question implementation
│       ├── completion-tool.ts       # guard_mode_complete implementation
│       ├── subagent-policy.ts       # Subagent allowlist enforcement
│       ├── active-implementation-menu.ts
│       ├── required-tools.ts        # Tool visibility during planning
│       ├── tool-selection.ts         # Tool diffing helpers
│       ├── extension-runtime.ts
│       └── *.test.ts                 # Vitest suite
└── skills-lock.json
```

## Getting Started

> The repo uses **npm workspaces**: `pi-guard-extension/` is declared in the root
> `package.json`, so `pi install` (which runs `npm install` at the repo root) installs
> the nested extension's dependencies automatically.

```bash
# Quick test (from repo root)
pi -e ./pi-guard-extension

# Install as a project-local extension
pi install -l ./pi-guard-extension

# Run tests
cd pi-guard-extension && npm test
```

## How It Works

Guard Mode is a **planning workflow**, not a state machine of skill triggers:

1. Enter Guard Mode with `/guard` (or start pi with `--guard`).
2. The agent explores read-only: `read`, `grep`, `find`, `ls` pass; `write`/`replace` are limited to allowlisted paths; `bash` is limited to safe commands; `edit`/`update_plan` are blocked.
3. The agent asks questions with `guard_mode_question` and submits a plan with `guard_mode_complete`.
4. You decide: `/guard implement` accepts the plan (full tool access is restored for implementation), or `/guard exit` discards the plan. Continue planning with a new `/guard <prompt>`.
5. The plan and Guard Mode state are persisted and restored on `/resume`.

### Commands

| Command | Behavior |
|---|---|
| `/guard` | Enter Guard Mode, or show the plan menu if already active |
| `/guard <prompt>` | Enter Guard Mode with an initial planning prompt |
| `/guard show` | Show the stored plan |
| `/guard finalize` | Ask the agent to submit its final plan |
| `/guard implement` | Accept the plan and start implementation (restores full tool access) |
| `/guard tools` | Open the tool selector |
| `/guard exit`, `/guard off` | Exit Guard Mode and discard the plan |
| `--guard` (flag) | Start pi in Guard Mode |

The old `/guard-start` and `/guard:allow` commands are removed; use `/guard` and `/guard exit` instead.

### Tools

- **`guard_mode_question`** — Ask the user 1–3 clarification questions with meaningful options while Guard Mode is active.
- **`guard_mode_complete`** — Submit a plan for user review. Only available while Guard Mode is active.

## Tool Policy

While Guard Mode is active, built-in tools are classified as:

| Policy | Tools | Behavior |
|---|---|---|
| `read-only` | `read`, `grep`, `ffgrep`, `find`, `ffind`, `fffind`, `ls` | Always allowed |
| `allowlisted` | `write`, `replace` | Path checked against the allowlist |
| `limited` | `bash` | Command checked against the bash safety policy |
| `blocked` | `edit`, `update_plan` | Always intercepted |
| `user-opt-in` | custom / user tools | Disabled by default |

### Path allowlist

`write`/`replace` calls targeting the following paths are **allowed** while planning:

| Path | Match Rule |
|---|---|
| `.scratch/` | Prefix match — any file under `.scratch/` |
| `docs/` | Prefix match — any file under `docs/` |
| `CONTEXT.md` | Exact / suffix match — any `CONTEXT.md` file (root or nested) |

### Bash safety

`bash` commands are classified read-only (allowed) or write (blocked):

- **Always allowed**: `cat`, `head`, `tail`, `ls`, `wc`, `grep`, `rg`, `find`, `file`, `stat`, `du`, `df`, `which`, `echo`, `printf`, `ps`, `top`, `date`, `ping`, `curl` (can write files via `-o`/`-O` — currently allowed), `mkdir`, `jq`, `diff`, `pwd`, … plus test/check commands (`npm test`, `npx tsc --noEmit`, `go test`, `vitest`, …) and `git` / `gh` subcommands matching the safe prefixes (`git log`, `git status`, `git diff`, `git show`, `git branch`, `git tag`, …; `gh pr view`, `gh issue list`, `gh search`, …).
- **Always blocked**: `rm`, `mv`, `cp`, `touch`, `sed -i`, `awk -i`, `tee`, `dd`, `chmod`, `chown`, `mount`, `mkfs`, … and commands whose standalone tokens include a `>` / `>>` redirect to a file (e.g. `echo hi > /tmp/x`). Redirects glued to a non-numeric token (e.g. `echo hi>/tmp/x`, `cmd>>log`) are also detected; `<` input redirects and numeric / `&` forms (`2>file`, `&>file`) are detected as well. Redirects to `/dev/null` or file descriptors (e.g. `2>&1`) remain allowed. (`sed`/`awk` without `-i` are allowed as read-only.)
- **Unknown commands** are conservatively blocked.

## Configuration

Guard Mode reads optional settings from `~/.pi/agent/pi-guard.json`:

```json
{
  "thinkingLevel": "medium",
  "defaultPlanTools": ["read", "bash", "edit", "write"],
  "allowedPlanSubagents": ["explore", "research"]
}
```

| Key | Type | Description |
|---|---|---|
| `thinkingLevel` | `string` | One of `inherit` (default), `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `defaultPlanTools` | `string[]` | Tool names available while planning (when unset: the read-only tools plus `bash` — `read`, `grep`, `find`, `ls`, `bash`) |
| `allowedPlanSubagents` | `string[]` | Subagent names allowed to spawn while planning |

A missing file is fine (defaults apply). An invalid file is ignored with a warning notification.

## Development

```bash
# Type-check
cd pi-guard-extension && npx tsc --noEmit

# Run tests
cd pi-guard-extension && npm test

# Run tests in watch mode
cd pi-guard-extension && npm run test:watch
```

## License

MIT
