# 01 — Prefactor: 简化状态机，移除废弃机制

**What to build:** 将 Guard 状态机从三态（normal / skill_active / guarded）简化为两态（normal / skill_active），
并删除所有与新架构不兼容的废弃 API。这是最底层的前置变更，让后续集成更干净。

**Blocked by:** 无 — 可以立即开始

**Status:** ready-for-agent

**Acceptance criteria:**
- [ ] `guard.ts` 中移除 `"guarded"` 状态类型，状态机仅含 `"normal"` | `"skill_active"`
- [ ] 删除 `isBlocking()` 方法（不再有"阻塞"语义）
- [ ] 删除 `isPathAllowed()` 方法和 `allowWritePaths` 相关逻辑
- [ ] 删除 `getAllowWritePaths()` 方法
- [ ] 新增 `ruleEngineActive: boolean` 和 `activateRuleEngine()` / `deactivateRuleEngine()` 方法
- [ ] `handleAgentSettled()` 行为变更：不再 `skill_active → guarded`，改为若 `autoActivateAfterSkill` 则激活规则引擎
- [ ] `config.ts` 中标记 `targetSkills`、`allowWritePaths`、命令列表为 `@deprecated`
- [ ] `index.ts` 的 tool_call handler 不再调用 `isBlocking()`，暂时保留旧逻辑无报错
- [ ] 所有现有测试更新：移除 guarded 相关测试用例，新增两态状态机测试
- [ ] `src/bash-path-allowlist.ts`（如还存在）确认已按 ADR-0005 删除
