# 01 — Guard 工具改名（guard_mode_question / guard_mode_complete）

**What to build:** guard 扩展的两个规划工具改名为 `guard_mode_question` 和 `guard_mode_complete`（常量同步改为 `GUARD_MODE_QUESTION_TOOL_NAME` / `GUARD_MODE_COMPLETE_TOOL_NAME`），全部运行时引用（工具注册、必需工具管理、事件拦截、上下文过滤）经常量自动跟随；prompt 中所有模型可见的指令文本同步为新名；行为测试断言更新。完成后 `createGuard()` 注册的是新工具名，Guard Mode 全流程（结构化提问、计划提交、`tool_call` 拦截、上下文过滤）以新名端到端工作，不再与 `@narumitw/pi-plan-mode` 的同名工具冲突。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 扩展注册的工具名为 `guard_mode_question` / `guard_mode_complete`，不再注册 `plan_mode_*`
- [ ] Guard Mode 激活时默认工具集合包含新工具名
- [ ] Guard Mode 激活期间 `guard_mode_question` 执行 guard 自己的提问流程（enabled 检查、1-3 题/2-4 选项校验、UI 菜单）
- [ ] `guard_mode_complete` 提交计划后进入 plan ready 状态，`/guard implement` 可用
- [ ] Guard Mode 未激活时调用新工具返回明确拒绝
- [ ] prompt 指令文本全部使用新工具名，与注册名一致
- [ ] `tool_call` 拦截与上下文过滤对 `guard_mode_*` 记录生效
- [ ] 测试套件（vitest）与类型检查（tsc --noEmit）全绿
