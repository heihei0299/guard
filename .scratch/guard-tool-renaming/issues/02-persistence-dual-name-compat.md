# 02 — 持久化双名兼容

**What to build:** 会话状态持久化中的计划来源类型扩展为三种取值：`guard_mode_complete`（新）、`plan_mode_complete`（旧）、`legacy_proposed_plan`（遗留）。解析函数同时接受新旧两个工具名：新写入的状态使用 `guard_mode_complete`，旧会话数据中的 `plan_mode_complete` 仍能正确恢复 `latestPlan`。完成后用户恢复旧会话时不丢失改名之前已提交的计划。

**Blocked by:** 01 — Guard 工具改名（新名写入场景依赖 01 的注册名才能端到端演示）

**Status:** ready-for-agent

- [ ] 新写入的持久化状态用 `guard_mode_complete` 记录计划来源
- [ ] 含 `plan_mode_complete` 来源的旧会话数据仍能恢复出 `latestPlan`
- [ ] `legacy_proposed_plan` 路径回归不破坏
- [ ] 解析函数对未知来源值安全降级（不崩溃、不误恢复）
- [ ] 相关状态测试（新名写入、旧名恢复、legacy 回归）通过，测试套件全绿
