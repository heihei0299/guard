# 01 — 状态机：添加 handleGuardStart()

**What to build:** 在 `GuardMachine` 接口中新增 `handleGuardStart()` 方法，允许从 normal 状态直接跳转到 guarded 模式。该方法是纯函数式的，不依赖任何外部 API。

调用 `handleGuardStart()` 后：
- 如果当前状态为 `normal` → 转移到 `guarded`，`isBlocking()` 返回 true
- 如果当前状态为 `skill_active` 或 `guarded` → no-op，状态不变

**Blocked by:** 无 — 可立即开工

**Status:** ready-for-agent

- [ ] `GuardMachine` 接口新增 `handleGuardStart(): void` 方法声明
- [ ] 工厂函数中实现该方法
- [ ] 单元测试（`guard.test.ts`）覆盖：
  - normal → guarded 转移
  - 转移后 isBlocking() 返回 true
  - 在 skill_active 状态下调用是 no-op
  - 在 guarded 状态下调用是 no-op
  - 完整流程：normal → /guard:start → guarded → /guard:allow → normal
