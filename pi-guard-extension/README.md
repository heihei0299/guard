# Pi Guard Extension 🔒

A [pi](https://pi.dev) extension that implements **Guard Mode** — a structured planning workflow enforced at the tool-call level. While Guard Mode is active, the agent explores and plans but cannot modify files or run destructive commands except through the plan workflow.

## Problem

When an AI assistant plans a large piece of work, it may start modifying files before the plan is agreed. Guard Mode makes that impossible: write operations are limited to an allowlist, `bash` is restricted to safe commands, and the agent must submit a plan via `guard_mode_complete` before you decide to implement.

## How It Works

Guard Mode is a planning workflow:

1. Enter Guard Mode with `/guard` (or start pi with `--guard`).
2. The agent explores read-only (`read`, `grep`, `find`, `ls`), may write only to allowlisted paths, and may run only safe `bash` commands.
3. The agent asks questions with `guard_mode_question` and submits a plan with `guard_mode_complete`.
4. You decide:
   - `/guard implement` — accept the plan and start implementation (full tool access restored)
   - `/guard exit` — exit Guard Mode and discard the plan
   - start a new planning round with `/guard <prompt>`
5. The plan and Guard Mode state persist across `/resume`.

### Commands

| Command | Behavior |
|---|---|
| `/guard` | Enter Guard Mode, or show the plan menu if already active |
| `/guard <prompt>` | Enter Guard Mode with an initial planning prompt |
| `/guard show` | Show the stored plan |
| `/guard finalize` | Ask the agent to submit its final plan |
| `/guard implement` | Accept the plan and start implementation |
| `/guard tools` | Open the tool selector |
| `/guard exit`, `/guard off` | Exit Guard Mode and discard the plan |
| `--guard` (flag) | Start pi in Guard Mode |

The old `/guard-start` and `/guard:allow` commands are **removed** — use `/guard` and `/guard exit`.

### Tools

- **`guard_mode_question`** — Ask the user 1–3 clarification questions with meaningful options. Only available while Guard Mode is active.
- **`guard_mode_complete`** — Submit a plan for user review. Only available while Guard Mode is active.

## Tool Policy

While Guard Mode is active, tools are classified as:

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

Leading `./` is normalized and `~` is expanded. Any other path is blocked and the agent turn is aborted with a bilingual message.

### Bash safety

`bash` commands are classified read-only (allowed) or write (blocked):

- **Always allowed**: `cat`, `head`, `tail`, `less`, `more`, `ls`, `wc`, `grep`, `ffgrep`, `find`, `ffind`, `rg`, `ag`, `file`, `stat`, `du`, `df`, `which`, `type`, `echo`, `printf`, `ps`, `top`, `htop`, `uptime`, `date`, `cal`, `ping`, `dig`, `nslookup`, `host`, `curl` (can write files via `-o`/`-O` — currently allowed), `mkdir`, `pwd`, `sort`, `uniq`, `diff`, `tree`, `whereis`, `printenv`, `uname`, `whoami`, `id`, `jq`, `bat`, `eza`, `fd`
- **Always blocked**: `rm`, `mv`, `cp`, `touch`, `rmdir`, `ln`, `chmod`, `chown`, `chattr`, `tee`, `dd`, `mkfs`, `mount`, `sed -i`, `awk -i`, and commands whose standalone tokens include a `>` / `>>` redirect to a file (e.g. `echo hi > /tmp/x`); redirects glued to a non-numeric token (e.g. `echo hi>/tmp/x`) are not detected by the current policy, while `<` input redirects and numeric / `&` forms (`2>file`, `&>file`) are detected (`sed`/`awk` without `-i` are allowed as read-only)
- **Structured commands** allow only prefix-matched safe subcommands: `git` (`log`, `status`, `diff`, `show`, `branch`, `tag`, `describe`, `rev-parse`, `ls-files`, `stash list`), `gh` (`pr view`, `pr list`, `issue view`, `issue list`, `search`, `repo`, `auth`), `npm` (`list`, `view`, `info`, `search`, `outdated`, `audit`, `test`, `run test`, `run check`, `run typecheck`, `run lint`), `npx tsc`, `node --version`, `python --version`, `cargo test/check`, `go test/check/vet/fmt`, `pytest`, `vitest`, `jest` (prefix matching means e.g. `git branch -d` is also matched — known limitation)
- **Unknown commands** are conservatively blocked

## Installation

### Quick test

```bash
pi -e ./pi-guard-extension
```

### Install as a pi package

```bash
pi install ./pi-guard-extension
```

### Project-local installation

```bash
pi install -l ./pi-guard-extension
```

## Usage

After installation, the extension is active automatically. Start planning:

```
/guard
```

The agent enters Guard Mode (bilingual prompt), explores, asks questions with `guard_mode_question`, and submits a plan with `guard_mode_complete`. Then you choose `/guard implement` or `/guard exit`.

Start pi directly in Guard Mode:

```bash
pi --guard
```

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

A missing file is fine (defaults apply). An invalid file is ignored with a warning notification. The old config format (`targetSkills`, `allowWritePaths`) is not migrated — reconfigure with the new keys above.

## Architecture

```
pi-guard-extension/
├── package.json          # Package manifest with pi extension entry
├── tsconfig.json         # TypeScript configuration (NodeNext, strict)
├── vitest.config.ts      # Test configuration
└── src/
    ├── index.ts                    # Thin forwarder: re-exports createGuard
    ├── plan-mode.ts                # createGuard() wiring — /guard command, --guard flag, both tools, all event hooks
    ├── tool-policy.ts              # classifyPlanModeTool, path allowlist (isPathAllowed), bash safety (isSafeCommand)
    ├── state.ts                    # PlanModeState, restorePlanModeState (session resume), plan normalization
    ├── settings.ts                 # ~/.pi/agent/pi-guard.json loading and validation
    ├── prompt.ts                   # Bilingual Guard Mode system prompt
    ├── command.ts                  # /guard argument completions
    ├── message-transform.ts        # Context filtering in Guard Mode
    ├── presentation.ts             # TUI status rendering
    ├── question-tool.ts            # guard_mode_question tool
    ├── completion-tool.ts          # guard_mode_complete tool
    ├── subagent-policy.ts          # Subagent allowlist enforcement
    ├── active-implementation-menu.ts
    ├── required-tools.ts           # Tool visibility during planning
    ├── tool-selection.ts           # Tool diffing helpers
    ├── extension-runtime.ts
    └── *.test.ts                   # Vitest suite (unit + integration)
```

### Key components

- **`plan-mode.ts`** — `createGuard()` factory returning the extension entry function. Registers the `guard` flag, the `/guard` command, `guard_mode_question` / `guard_mode_complete` tools, and hooks `session_start`, `thinking_level_select`, `session_shutdown`, `tool_call`, `context`, `before_agent_start`, `agent_end`.
- **`tool-policy.ts`** — Classifies every tool into one of five policies and enforces the path allowlist and bash safety rules.
- **`state.ts`** — Owns the current plan, active implementation, tool selection, and session persistence/restore.
- **`settings.ts`** — Loads and validates `~/.pi/agent/pi-guard.json`; invalid files fail closed.

## Development

```bash
# Type-check
npx tsc --noEmit

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## License

MIT
