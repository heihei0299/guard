# 08 — 重构：提取共享测试辅助函数

**What to build:** 将 `index.test.ts` 中 `path allowlist` describe 块的 `setupGuarded()` 辅助函数提升到顶层作用域，使 `tool_call handler` describe 中的 9 个 bash 分类测试复用同一个辅助函数。消除 code review 发现的 Duplicated Code 坏味。

**Blocked by:** None — 可立即开始

**Status:** ready-for-agent

- [ ] 将 `setupGuarded()` 从 `describe("path allowlist")` 提升到文件顶层（或外层 `describe("createGuard")` 作用域）
- [ ] 将 `tool_call handler` describe 中的 9 个 bash 测试改为调用 `setupGuarded()`，删除重复的 `input`+`agent_settled` setup
- [ ] 确保 `edit`、`read`、`grep`、`find`、`ls` 等非 bash 测试也复用同一 helper（它们重复了相同 setup）
- [ ] 运行 `npm test` 确认 72+ 测试全部通过，无行为变更
