# Spec Review — Ticket 04 (Infrastructure)

Reviewed: `pi-guard-extension/src/{message-transform,presentation,command,subagent-policy,active-implementation-menu}.ts` (+ `.test.ts`), against `04-infrastructure.md`, ADR-0009/0010, and the reference `pi-extensions/extensions/pi-plan-mode/src/`.

Verdict: **PASS with one minor wording finding.** All 11 spec checklist items are present and the logic is a faithful port of the reference (normalized diff is identical — differences are only reordering, doc comments, semicolons/whitespace, `.js`→`.ts` imports, and Guard Mode wording). `npx tsc --noEmit` shows only pre-existing errors (`git diff HEAD` on `index.ts`, `index.test.ts`, `rule-engine.ts` is empty — untouched by this ticket). All 56 new tests pass.

## (a) Missing or partial requirements

None. Every spec item verified:

- `message-transform.ts`: `parseProposedPlan()` 6-kind logic (absent/valid/empty/multiple/malformed/unclosed) matches reference; `stripProposedPlanBlocks()`/`stripProposedPlanBlocksFromMessage()`; `stripPlanModeCompletionCallsFromMessage()` (filters `type==="toolCall" && name===plan_mode_complete`); `messageContainsInactivePlanModeArtifact()` (proposed-plan custom + toolResult); `injectActiveImplementationContext()` (removes stale impl-context markers, keeps only exact-matching handoff, injects marker after leading summary messages — insertion/removal rules identical); `isEmptyAssistantMessage()`. Seams confirmed by user (`extractProposedPlan`, `invalidPlanMessage`, `latestAssistantText`, three `messageContains*` checks) all exported; export surface matches reference exactly (only ordering differs).
- `presentation.ts`: `updatePlanModeUi`/`clearPlanModeUi`/`planModeStatusText` — status strings (`plan active`/`plan ready`/`plan implementing`) and widget content match reference, wording adapted to Guard Mode.
- `command.ts`: completions show/finalize/implement/exit/off/tools with descriptions; empty-prefix / case-insensitive prefix / multi-word→null / no-match→null — identical to reference.
- `subagent-policy.ts`: allowlist covers `subagent` + `subagent_spawn`; blocking payload reads `agent`, every `tasks`/`chain` entry, and `aggregator.agent`; unverifiable payloads block; empty allowlist blocks all. Identical to reference.
- `active-implementation-menu.ts`: 3 items (show / start-new / clear), `hint: "close"`, smoke tests only (per user-confirmed seam) — pass.

## (b) Scope creep

None material. Added JSDoc comments throughout; `return await runMenu(...)` instead of bare `await` (needed by the smoke-test contract `result.kind === "unsupported"`; reference returns `undefined` here) — benign deviation. Test files are part of the deliverable.

## (c) Implemented but looks wrong (minor)

1. **Incomplete Guard Mode wording adaptation** — the task brief requires the port "adapted to this project's Guard Mode wording", and CONTEXT.md's glossary explicitly lists `_Avoid_: plan mode` / `/plan`. `presentation.ts` and `command.ts` are adapted ("Guard mode", `/guard`), but user-facing strings in `subagent-policy.ts` and `message-transform.ts` still say "Plan mode":
   - `subagent-policy.ts:36,46` — "Plan mode could not verify…", "Plan mode blocks subagent role(s)…"
   - `subagent-policy.ts:108` — "No subagent roles are allowed in Plan mode." and `formatAllowedRoles` "Allowed Plan subagents"
   - `message-transform.ts:69` `invalidPlanMessage` — "Continue Plan mode and produce…" (shown via `ctx.ui.notify`)
   These are visible to the user (block reasons / warnings) and inconsistent with the rest of the extension. Low severity; recommend s/Plan mode/Guard mode/ (and "Plan subagents" → "Guard subagents") in these strings.
2. **Handoff prefix cross-ticket constant** — `PLAN_IMPLEMENTATION_HANDOFF_PREFIX` ("Plan mode is now disabled…", `message-transform.ts:28`) intentionally keeps reference wording and is the exact-match anchor for `injectActiveImplementationContext`. Not a defect, but Ticket 05's implement command must write handoffs using this same constant or the filter will strip/inject incorrectly — flag for the wiring ticket.

## Evidence

- `npx tsc --noEmit`: 13 errors, all in `index.ts`/`index.test.ts`/`rule-engine.ts` (pre-existing, verified via empty `git diff HEAD` on those files).
- `npx vitest run` on the 5 new test files: 5 files, 56 tests, all pass.
- Normalized (comments/whitespace-stripped) diff vs reference: logic identical across all 5 modules.
