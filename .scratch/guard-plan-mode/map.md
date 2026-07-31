# Guard → Plan Mode（含路径白名单）

将原 Guard 扩展改造为 Guard Mode（Plan Mode）+ 路径白名单的混合模式：
- Guard Mode 激活时，写操作（write/replace）**仅允许**白名单路径（`.scratch/`、`docs/`、`CONTEXT.md`），其余拦截
- Guard Mode 提供 `/guard` 命令、`plan_mode_question`/`plan_mode_complete` 工具、bash 安全策略
- 目标：适配 Matt 技能组，wayfinder 可创建 tickets，domain-modeling 可写 ADRs，同时防止 src/ 等路径被乱写

## Destination

将 guard 扩展改造为 guard-mode 扩展，代码写完、测试通过、类型检查通过，不发布到 npm。

## Notes

- 包名保持 `pi-guard-extension`，原地改造
- 完全移除旧命令 `/guard-start`、`/guard:allow`，改为 `/guard` 系列命令
- 不迁移旧配置，用户重新配置 `~/.pi/agent/pi-guard.json`
- 消息用中英双语
- 参考实现：`/home/shial/Project/Pi/guard/pi-extensions/extensions/pi-plan-mode/`
- 每个 ticket 一个会话，按 wayfinder 流程逐个解决
- **Guard Mode 含路径白名单**：`.scratch/`、`docs/`、`CONTEXT.md` 在 Guard Mode 中可写
  - wayfinder 创建 `.scratch/` 下的 tickets 和 map
  - domain-modeling 创建 `docs/adr/` ADRs 和更新 `CONTEXT.md`
  - 其他路径（`src/`、`package.json`、`lib/` 等）仍被拦截

## Decisions so far

- **Ticket 02 (core logic) resolved** — 工具策略分类 / bash 安全 / 路径白名单 / 状态管理已实现。Commit `73dbab6`。详见 `issues/02-core-logic.md`
- **Ticket 03 (plan submission tools) resolved** — `plan_mode_question` / `plan_mode_complete` 工具 + 双语 system prompt 已实现；`buildPlanModePrompt` 迁至 `prompt.ts`；`prompt-injector` 已删除。Commit `aa710ec`。详见 `issues/03-plan-submission-tools.md`
- **Ticket 04 (infrastructure) resolved** — 上下文过滤（message-transform.ts）、TUI 展示（presentation.ts）、`/guard` 参数补全（command.ts）、subagent 白名单（subagent-policy.ts）、实现菜单（active-implementation-menu.ts）已实现；`PLAN_IMPLEMENTATION_HANDOFF_PREFIX` 导出供 Ticket 05 复用；面向用户文本统一用 Guard Mode 措辞（非参考实现的 Plan mode）。详见 `issues/04-infrastructure.md`

## Not yet specified

<!-- 暂无 -->

## Out of scope

- npm 发布
- 旧配置自动迁移
- `/guard-start` / `/guard:allow` 兼容别名
- pi-permission-system 集成
- **Ticket 05 (main entry) resolved** — 主入口接线完成：`createGuard()` 工厂 + `/guard` 命令 + `--guard` 标志 + 两个工具 + 全部事件钩子；接线位于 `src/plan-mode.ts`（index.ts 为薄转发器）；code review 修复 tool_call 路径白名单强制、非 TUI reject、thin-forwarder 硬违规。详见 `issues/05-main-entry.md`
- **Ticket 06 (tests) resolved** — 测试套件补强至 391 个（20 文件）；修复状态恢复真实缺陷（`restorePlanModeState` 恢复 selectedToolNames/thinking/plan 归一化，`session_start` 重新应用 thinking level）；新增 default-tools/subagent-allowlist/safe-subcommands/active-implementation 集成测试文件。详见 `issues/06-tests.md`
- **Ticket 07 (cleanup & verification) resolved** — 删除全部旧模块（guard/config/rule-engine/bash-command-classifier/path-normalizer/permission-config 及 rule-engine.test.ts，共 7 文件，删除前基线 391 passed）；两份 README 重写为 Guard Mode 架构（`/guard` 命令族替代 `/guard-start`/`/guard:allow`、`~/.pi/agent/pi-guard.json` 配置、安装用法示例）；code review 修复 4 处文档与代码不符；最终 343 passed + tsc 零错误。详见 `issues/07.md`
