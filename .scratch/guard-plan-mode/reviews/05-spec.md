# Spec Review — Ticket 05 (Main Entry)

Reviewed: `src/index.ts` (rewritten), `src/index.test.ts` (rewritten), `src/test-support.ts` (new), `src/rule-engine.ts` (1-line fix) vs `05-main-entry.md`, `/tmp/guard-ticket05-handoff.md`, `04-infrastructure.md` Answer, `spec.md`, `CONTEXT.md`, ADR-0007–0010.

Verdict: **PASS with 1 major and 1 minor finding.** All checklist items present: `createGuard()` factory + default export; all 7 events (+ `agent_settled`); `/guard` with `completePlanArguments`; both tools; `--guard` flag; state init/config load/TUI; old rule-engine/state-machine/`/guard-start`/`/guard:allow`/`skill_active` code removed from index.ts. `npx tsc --noEmit` passes; 17/17 test files, 331 tests pass; implement handoff uses the exact `PLAN_IMPLEMENTATION_HANDOFF_PREFIX` (asserted verbatim).

## (a) Missing / partial

1. **Write/replace path allowlist is not wired into `tool_call` (major).** ADR-0008: "| **`allowlisted`** | **路径白名单内放行，其余拦截** | **`write`、`replace`** |"; ADR-0010 layer 1: "// (c) 工具策略检查 + 路径白名单 … if (calledTool && classifyPlanModeTool(calledTool) === \"allowlisted\") { // write/replace: 检查路径白名单 }"; spec.md user story 9: "只有白名单路径（`.scratch/`、`docs/`、`CONTEXT.md`）被放行，其余被拦截并显示明确原因". `index.ts`'s `tool_call` only blocks `blocked`-class tools and unsafe bash; `isPathAllowed()` is never called — the `allowlisted` branch exists only in `plan-mode.ts`'s `classifyToolCall()`, which this entry does not use. Since `write`/`replace` are selectable via `/guard tools` (`canSelectToolInPlanMode` returns true for `allowlisted`), Guard mode can be configured to allow writes anywhere, including `src/`.

2. **Guard-mode wording leak (minor, pre-existing file newly wired).** Handoff: "所有用户可见字符串…都要用 Guard mode 措辞，禁止 Plan mode". `question-tool.ts:247` still returns user-visible "Plan-mode question cancelled because Plan mode is no longer active." (also `:231`, `:254` "Plan-mode question prompt"). The file predates this diff (Ticket 03) but Ticket 05 registers the tool, so the assembled extension still violates the convention.

## (b) Scope creep

- `rule-engine.ts:17` one-line type fix (`RuleOrigin` += `"config"`) touches an old module Ticket 07 schedules for deletion; minimal and required to clear the 3 pre-existing tsc errors demanded by "npx tsc --noEmit 通过" — acceptable. Menus, thinking-level restore, and `agent_settled` ready presentation all trace to spec.md/reference; no other creep.

## (c) Implemented but looks wrong

1. The allowlist gap is codified by the new test: `index.test.ts` "blocks update_plan and edit while active, and passes allowlisted writes" asserts `write` with `path: "src/x.ts"` returns `undefined` (allowed) while Guard mode is active — directly contradicting spec.md user story 9 and ADR-0008 ("其余拦截").

**Worst issue:** `write`/`replace` bypass the path allowlist in `tool_call`, so Guard mode does not actually restrict writes to `.scratch/`/`docs/`/`CONTEXT.md` when those tools are enabled.
