# Pi Guard 🔒

A [pi](https://pi.dev) extension that enforces the **"no unauthorized actions after skill conversations"** policy at the tool-call level.

## Overview

This project contains a pi extension (`pi-guard-extension/`) that implements a three-state state machine to prevent AI assistants from writing files or executing commands after completing skill-based conversations — unless explicitly permitted via `/guard:allow`.

```
                  input target skill command
  ┌─────┐  ──────────────────────────────────► ┌──────┐
  │normal│                                      │skill │
  │      │◄──── /guard:allow ────────────────── │_active│
  └─────┘                                       └──┬───┘
       ▲                                            │
       │                              agent_settled  │
       │                                            ▼
       │                                        ┌────────┐
       └───────── /guard:allow ──────────────── │guarded │
                                                └────────┘
```

## Project Structure

```
pi-guard/
├── README.md                        # This file
├── .gitignore
├── pi-guard-extension/              # The extension package
│   ├── package.json                 # Pi package manifest
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts                 # Extension logic (event handlers + factory)
│   │   ├── index.test.ts            # Integration tests
│   │   ├── guard.ts                 # Pure state machine
│   │   └── guard.test.ts            # Unit tests
│   └── README.md                    # Extension-specific documentation
└── skills-lock.json
```

## Getting Started

```bash
# Quick test (from repo root)
pi -e ./pi-guard-extension

# Install as a project-local extension
pi install -l ./pi-guard-extension

# Run tests
cd pi-guard-extension && npm test
```

## How It Works

The guard transitions through three states:

| Transition | Trigger |
|---|---|
| `normal` → `skill_active` | User runs `/skill:to-spec`, `/skill:to-tickets`, `/skill:grill-me`, `/skill:grill-with-docs`, or `/skill:wayfinder` |
| `skill_active` → `guarded` | `agent_settled` event (skill processing fully complete) |
| `guarded` → `normal` | User runs `/guard:allow` command |
| `guarded` → `skill_active` | User runs another target skill command |

In **`guarded`** mode, the following tools are blocked:
- `write` — blocked + `ctx.abort()`
- `replace` — blocked + `ctx.abort()`
- `bash` — blocked + `ctx.abort()`

Read-only tools (`read`, `grep`, `ffgrep`, `fffind`, `bash` with safe commands) pass through normally.

## Configuration

Customize which skills trigger the guard:

```typescript
import { createGuard } from "./pi-guard-extension/src/index.ts";

export default createGuard({
  targetSkills: ["to-tickets", "grill-me", "my-custom-skill"],
});
```

## License

MIT
