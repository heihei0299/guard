# 05 — Main Entry

**What to build:** 编写 `src/index.ts` 主入口，将所有模块组装为 pi 扩展——注册事件、命令、工具，对外暴露 `createGuard()` 工厂函数。删除旧的主入口代码。

**Blocked by:** 04 — Infrastructure

**Status:** resolved

- [x] `src/index.ts`：`createGuard()` 工厂函数（对外接口保持兼容）
- [x] `src/index.ts`：注册事件（session_start、thinking_level_select、session_shutdown、tool_call、context、before_agent_start、agent_end）
- [x] `src/index.ts`：注册 `/guard` 命令
- [x] `src/index.ts`：注册 `plan_mode_question` / `plan_mode_complete` 工具
- [x] `src/index.ts`：注册 `--guard` 启动标志
- [x] `src/index.ts`：状态初始化、配置加载、TUI 更新
- [x] `src/index.ts`：默认导出 `createGuard()`
- [x] 删除旧 `src/index.ts` 中的非 plan-mode 代码（规则引擎、旧状态机等）
- [x] `npx tsc --noEmit` 通过

## Answer

Ticket 05 已实现 Main Entry，按 tdd-implement 流程（seams 确认 → 11 个 seam 红-绿循环 → 完整套件 → code-review 双轴 → 修复）完成。Commit 见 map.md。

### 实现

- `src/plan-mode.ts`（新主接线模块）：`createGuard(options)` 工厂 + 默认导出；注册 `--guard` 标志、`plan_mode_question`/`plan_mode_complete` 工具、`/guard` 命令（`completePlanArguments` 补全）；接线 session_start（恢复状态 + 加载配置 + `--guard` 标志）、thinking_level_select、session_shutdown（持久化 + 恢复工具/thinking + 清 UI）、tool_call（tool-policy + subagent-policy + 路径白名单）、context（message-transform 过滤）、before_agent_start（清 pending plan + prompt 注入）、agent_end（parseProposedPlan 校验）、agent_settled（ready 菜单一次性展示）
- `src/index.ts`：薄转发器（extension-conventions 的 thin-forwarder MUST），re-export `createGuard` + 默认导出
- `src/index.test.ts`：重写为 40 个集成测试（mock 支撑在新增 `src/test-support.ts`，移植自 pi-extensions/test/support.ts）
- `src/rule-engine.ts`：1 行类型修复（`RuleOrigin` 加 `"config"`）以满足 tsc 零错误；文件删除留给 Ticket 07
- 删除 `src/plan-mode.test.ts`（旧 `createPlanModeState`/`classifyToolCall` 被 tool-policy + 集成测试取代）；`src/guard.ts` 1 行适配（不再依赖 plan-mode.ts）

### Code review 修复

- **Spec 关键缺失**：tool_call 钩子未强制 write/replace 路径白名单（`isPathAllowed` 未接线，违反 ADR-0008 核心保证）→ 已接线并修正测试（`src/x.ts` 拦截、`.scratch/`/`docs/` 放行）
- **Standards 硬违规**：index.ts 1011 行违反 thin-forwarder MUST → 接线迁至 `plan-mode.ts`，index.ts 变转发器
- **Standards 硬违规**：非 TUI（print/JSON）模式 notify-only 无可见结果 → `notifyOrThrow()`：无 UI 时 reject（可观察），TUI/RPC 保持 notify；两种模式均有测试
- question-tool.ts 用户可见 "Plan mode" 措辞 → Guard mode（handoff 约定）
- 重复通知字符串提取常量、`planModeSelectedNames` 改名 `resolvePlanModeSelectedNames`、模块注释措辞

### 判断项（未修，记录在案）

- `plan_mode_question` 返回结构化 cancelled vs `plan_mode_complete` throw 的不一致（与参考实现一致，question tool 契约使然）
- showPlanMenu/showPlanReadyMenu action 体重复（与参考实现一致）
- test-support.ts 保留参考实现完整 mock 面（供 Ticket 06 使用）
- 审查报告存于 `.scratch/guard-plan-mode/reviews/05-standards.md` 与 `05-spec.md`（按 02/03 惯例不提交）

### 测试与类型检查

- 完整套件：16/17 → 16 文件通过（320 passed；`index.test.ts` 14 个旧失败测试已随重写清除，`plan-mode.test.ts` 13 个旧测试随模块合并删除）
- `npx tsc --noEmit`：0 错误（旧 13 错误清零：index.ts ×6 / index.test.ts ×4 随重写消失，rule-engine.ts ×3 类型修复）
