# Ticket 05 — Standards review (pi-guard-extension)

Verified: `npx tsc --noEmit` ✓; `npx vitest run src/index.test.ts` 38/38 ✓ (type/test failures skipped).

## Documented-standard breaches

1. **Thin-forwarder MUST — `extension-conventions.md`, "Package layout and boundaries"** (hard): "Give every active extension a thin `src/index.ts` default-export forwarder… keep implementation in descriptive modules." `index.ts` grew 360 → 1011 lines; it inlines five responsibilities: `/guard` routing (L177–232), three menus (L560–750), tool/thinking-level management (L757–915), plan acceptance (L944–1006), lifecycle hooks. Also trips the >1,000-line "responsibility-based decomposition" review guidance.

2. **Non-TUI safety MUST — "Commands, tools, and state"** (hard): "Provide safe behavior in every non-TUI mode… a notify-only path therefore does not provide a print or JSON result." `/guard` no-arg in non-UI contexts → `ctx.ui.notify(planStatusText(), "info")` (L570, L606); `/guard finalize` inactive and `/guard implement` without a plan are notify-only. In print/JSON, notify is a no-op — the handler neither rejects nor emits a channel result. Tests mask this: `createMockContext({hasUI:false})` leaves `mode` undefined and its `notify` always records, so "non-TUI" tests assert notify as observable.

3. **Tool-failure MUST — "Commands, tools, and state"** (judgement): "Make tool failures observable by throwing rather than returning only an error-looking result." `plan_mode_question` inactive/`ui_unavailable` returns `planModeQuestionCancelled([], …, "Error: …")` (error-looking result) while sibling `plan_mode_complete` throws for the same condition — inconsistent; structured cancellation may be intentional.

## Baseline smells (judgement)

4. **Duplicated Code**: `"Guard mode disabled. Proposed plan discarded."` (L201–202, 637–638, 673–674); `"Guard mode enabled. I will explore and plan, but not modify files."` (L222, 434, 575); identical `implement`/`stay`/`exit` action bodies in `showPlanMenu` vs `showPlanReadyMenu` (L619–676); `**Proposed Plan**` content built twice (L532 vs L390).

5. **Middle Man**: `updateUi`/`clearUi`/`planStatusText` (L882–893) are one-line delegations to imported functions.

6. **Speculative Generality** (`test-support.ts`, new): unused by its only consumer (`index.test.ts`): `registerProvider`, `unregisterProvider`, `registerEntryRenderer`, `setModel`, `providerRegistrations`, `entryRenderers`, `setModels`, `setFooter`, `editorText`, `getContextUsage`, `modelRegistry`, `waitForIdle`.

7. **Mysterious Name**: `planModeSelectedNames()` (L792–801) mutates `state.selectedToolNames` as a side effect; the name reads as a pure query.

8. **CONTEXT.md wording** (judgement): header comment "Guard Plan Mode" (L2) uses the avoided term; all user-facing strings correctly say "Guard mode", and tests assert `/Plan mode/` absence.

## Compliant
Tests are integration-style through the mock pi/ctx boundary with literal, non-tautological expectations and no internal-module mocks — matches `.agents/skills/tdd/tests.md` and `mocking.md`.

**Worst issue**: #1 — the 1011-line non-thin entry violates a MUST and concentrates five responsibilities, which is also the root of #4/#5.
