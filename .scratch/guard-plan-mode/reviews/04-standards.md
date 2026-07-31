# Ticket 04 (Infrastructure) — Standards Review

Status: complete
Reviewer: standards reviewer
Scope: 10 new files in pi-guard-extension/src/ (message-transform, presentation, command, subagent-policy, active-implementation-menu, each + .test.ts)

## Standards sources
- AGENTS.md (project instructions)
- CONTEXT.md (domain language: Guard Mode, /guard; _Avoid_: plan mode)
- Ticket 03 modules (completion-tool.ts, question-tool.ts, prompt.ts, state.ts) — house style
- Conventions: 2-space indent, no semicolons, relative imports w/ .ts suffix, JSDoc on exported fns, bilingual user text, vitest describe/it/expect

## Verification (passed)
- `npx tsc --noEmit`: 13 errors, all in old files (index.ts, index.test.ts, rule-engine.ts); 0 in new files.
- `npx vitest run` (5 test files): 56/56 passed.

## Hard violations (documented standards)

1. **CONTEXT.md domain language — "Plan mode" instead of "Guard Mode"** (`message-transform.ts`, `subagent-policy.ts`). CONTEXT.md glossary: Guard Mode, _Avoid_: "plan mode". Wording divergence to Guard Mode was mandated and is "intentional and CORRECT"; these strings are verbatim copies from the reference (`pi-extensions/.../pi-plan-mode/src/message-transform.ts`, `subagent-policy.ts`) that failed to apply it:
   - `message-transform.ts:8` `PLAN_IMPLEMENTATION_HANDOFF_PREFIX = "Plan mode is now disabled. Full tool access is restored. Implement this proposed plan now:"`
   - `message-transform.ts` `invalidPlanMessage()`: "Continue Plan mode and produce one complete non-empty <proposed_plan> block."
   - `subagent-policy.ts` reasons: "Plan mode could not verify subagent roles…", "Plan mode blocks subagent role(s)…", "Allowed Plan subagents: …", "No subagent roles are allowed in Plan mode."
   - Inconsistent with `presentation.ts` in the same ticket, which correctly says "Guard mode".

## Judgement calls / baseline smells

2. **Bilingual user text (stated convention)** — all user-facing strings in the 5 modules are English-only (widget/status text, menu labels, completion descriptions, handoff prefix, subagent reasons). Ticket 03's tool-internal error strings are also English-only, so practical house style is bilingual for the system prompt only (`prompt.ts`); strongest case here is the conversation-level handoff prefix / `invalidPlanMessage`. Judgement call.

3. **Unwired modules (Speculative Generality, temporary)** — none of the 5 new modules is imported by any non-test file; `src/index.ts` still wires the old rule-engine architecture. Expected for Ticket 04 (integration lands in 05-main-entry), but every export is currently dead code whose only consumers are its own tests.

4. **Duplicated Code** — `command.ts`: `exit` and `off` carry identical descriptions ("Leave Guard mode or clear the active plan"). `off` matches the ticket spec, so only the literal is duplicated.

5. **Duplicated regex** — `message-transform.ts`: `PROPOSED_PLAN_PATTERN` vs `PROPOSED_PLAN_BLOCK_PATTERN` differ only by the capture group.

6. **Mirrored conditionals** — `presentation.ts`: `updatePlanModeUi()` and `formatStatus()` each encode the same state→(status/widget) mapping; risk of divergence on future state changes.

## Compliance
2-space indent, no semicolons, `.ts`-suffixed relative imports, JSDoc on every exported fn, vitest describe/it/expect — all met. Note: Ticket 03 modules use semicolons, so new files follow the documented convention but split the codebase's style.
