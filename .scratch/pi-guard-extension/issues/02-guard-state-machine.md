# 02 — Guard state machine + skill detection

**What to build:** 三态守卫（normal → skill_active → guarded）的核心状态机。通过 `input` 事件检测 5 个目标技能命令，通过 `agent_settled` 进入守卫态，通过 `session_start` 从会话历史重建守卫状态。

**Blocked by:** 01 — Package scaffold

**Status:** ready-for-agent

- [ ] 实现 StateMachine 三态管理（normal / skill_active / guarded）
- [ ] `input` 事件拦截 `/skill:to-spec`、`/skill:to-tickets`、`/skill:grill-me`、`/skill:grill-with-docs`、`/skill:wayfinder` → 切换到 `skill_active`
- [ ] `agent_settled` 事件 → 从 `skill_active` 切换到 `guarded`
- [ ] `session_start` 事件：扫描会话历史中是否有目标技能调用，重建守卫状态
- [ ] 非目标技能/命令不触发状态变化
- [ ] `guarded` 状态下再次输入目标技能命令 → 切换到 `skill_active`（重新激活）
