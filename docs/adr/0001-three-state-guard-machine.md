# ADR-0001: Three-State Guard State Machine

A pure three-state state machine (normal → skill_active → guarded) was chosen over a simple boolean flag to enforce the "no unauthorized actions after skill conversations" policy, because it correctly handles skill re-entry, session resume, and temporary disable via `/guard:allow` without ambiguous state interpretation.

**Status**: accepted

## Context

The pi-guard extension must prevent AI agents from writing files or executing destructive commands after a skill conversation ends. The simplest approach is an on/off boolean flag (`isGuarded: true/false`), but several edge cases make this insufficient:

- A user may call a skill, then `/guard:allow`, then another skill — the guard must reactivate.
- A session may be resumed (`/resume`) and the guard must reconstruct its prior state.
- A user may call two skills consecutively; the guard should not flap between states.
- The guard must distinguish "skill is actively running" (allow everything) from "skill finished" (block writes).

## Decision

Use a state machine with three states and explicit transitions:

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

The state machine is implemented as a pure factory `createStateMachine()` in `guard.ts`. It exposes methods rather than direct state mutation: `handleInput()`, `handleAgentSettled()`, `handleAllow()`, `reset()`, `rebuildFromHistory()`. The state is a private closure variable, guaranteeing that all transitions go through the defined API.

## Considered Options

- **Three-state state machine (chosen)**: Handles all known edge cases (multiple skill calls, session resume, /guard:allow + re-trigger). Each state has an unambiguous meaning. Easy to test in isolation.
- **Simple boolean flag** (`isGuarded: boolean`): Cannot distinguish "never activated" from "user disabled with /guard:allow". Would require additional flags (e.g., `wasEverActivated`) and still fails for consecutive skill calls.
- **Event counter**: Track skill start/stop events with a counter. Breaks on session resume because event history is truncated. Overly complex for the problem at hand.

## Consequences

- The state machine is purely functional — zero side effects, fully testable with unit tests.
- Session resume requires scanning history entries in `session_start` to call `rebuildFromHistory()`.
- The extension event handlers in `index.ts` are thin wrappers that call state machine methods.
- Adding a new state (e.g., a "permanent disable") in the future requires changing the union type and all transitions — a deliberate friction that prevents accidental state proliferation.
