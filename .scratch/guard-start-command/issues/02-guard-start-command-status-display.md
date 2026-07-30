# 02 — 扩展：注册 /guard:start 命令 + 持久状态显示

**What to build:** 通过 `pi.registerCommand("guard:start", ...)` 注册新命令，以及通过 `ctx.ui.setStatus()` 在 footer 持续显示守卫状态。

`/guard:start` 命令从 normal 跳到 guarded，并显示通知确认。

`updateGuardStatus(ctx, guard)` 辅助函数在每次状态变化时更新 footer 的持久显示文本：
- normal → 显示 "Guard: off" 或清除状态
- skill_active → 显示 "🔒 Skill active"
- guarded → 显示 "🔒 Guarded"

状态更新被挂载到所有状态变更点：`session_start`、`input`、`agent_settled`、`/guard:allow`、`/guard:start`。

**Blocked by:** 01 — 状态机：添加 handleGuardStart()

**Status:** ready-for-agent

- [ ] 注册 `/guard:start` 命令，调用 `guard.handleGuardStart()`
- [ ] 命令处理中显示通知 + 调用 `updateGuardStatus`
- [ ] 新增 `updateGuardStatus()` 辅助函数
- [ ] 在所有状态变更点调用 `updateGuardStatus`
- [ ] 集成测试（`index.test.ts`）覆盖：
  - `/guard:start` 命令已注册
  - 从 normal 进入 guarded 后 write 被拦截
  - 已在 guarded 状态下执行时显示提示
  - 状态变化时 `setStatus` 被正确调用
