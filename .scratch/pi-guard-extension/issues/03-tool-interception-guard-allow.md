# 03 — Tool interception + /guard:allow 命令

**What to build:** 守卫模式下拦截 `write`/`edit`/`bash` 工具调用并通过 `ctx.abort()` 强制终止 agent 回合。注册 `/guard:allow` 命令暂时关闭守卫模式。

**Blocked by:** 02 — Guard state machine + skill detection

**Status:** ready-for-agent

- [ ] `tool_call` 事件：守卫模式下拦截 `write` 工具 → `{ block: true }` + `ctx.abort()`
- [ ] `tool_call` 事件：守卫模式下拦截 `edit` 工具 → `{ block: true }` + `ctx.abort()`
- [ ] `tool_call` 事件：守卫模式下拦截 `bash` 工具（全部拦截，不含白名单）→ `{ block: true }` + `ctx.abort()`
- [ ] `read`/`grep`/`find`/`ls` 等只读工具放行
- [ ] 拦截提示信息：中英文双语（"🔒 技能讨论已完成，禁止擅自操作…"）
- [ ] 注册 `/guard:allow` 命令：从 `guarded` / `skill_active` → `normal`
- [ ] `/guard:allow` 调用时通过 `ctx.ui.notify` 显示确认提示
- [ ] 切换到 `normal` 后，再次触发目标技能可重新激活守卫
