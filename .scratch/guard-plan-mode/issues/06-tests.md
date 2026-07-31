# 06 — Tests

**What to build:** 编写全面的测试套件，覆盖 Guard Mode 的所有核心行为——工具策略、bash 安全、状态管理、消息过滤、plan 提交、配置加载、subagent 策略。

**Blocked by:** 05 — Main Entry

**Status:** resolved

- [x] `src/tool-policy.test.ts`：工具策略分类 + bash 安全策略测试（Ticket 02 已有 76+，本 ticket 补结构化命令边界至 84）
- [x] `src/state.test.ts`：状态管理测试（已有 + 本 ticket 补 selectedToolNames/thinking/plan 归一化恢复）
- [x] `src/question-tool.test.ts`：问题工具参数验证 + 格式化（Ticket 03 完成）
- [x] `src/completion-tool.test.ts`：完成工具参数验证 + 渲染（+ renderPlanModeCompletion 渲染测试）
- [x] `src/settings.test.ts`：配置加载测试（Ticket 02 完成）
- [x] `src/subagent-policy.test.ts`：子代理白名单测试（已有 unit；本 ticket 补集成测试）
- [x] `src/message-transform.test.ts`：消息过滤测试（Ticket 04 完成）
- [x] `src/index.test.ts`：集成测试（Ticket 05 重写 40 个；本 ticket 补 thinking 恢复/交付失败/ready 呈现边缘）
- [x] `npm test` 全部通过

## Answer

Ticket 06 完成测试补强：对照参考实现补齐缺口测试，并修复测试暴露的 2 处真实实现缺陷。

### 实现修复（由红-绿驱动）

- **`src/state.ts`** — `restorePlanModeState()` 补齐 CONTEXT.md 承诺的恢复语义：恢复 `selectedToolNames`（去重/过滤非字符串）；仅 enabled 时恢复 thinking 三字段（合法固定级别）；持久化 plan 与 active implementation plan 经 `normalizePlanModeCompletion` 归一化（trim + 50K 上限，超限 fail-closed）
- **`src/plan-mode.ts`** — `session_start` 对恢复的 enabled 状态重新调用 `applyPlanThinkingLevel()`（与参考实现一致），使 resume 后 thinking level 与手动选择正确恢复

### 新增测试（+71：320 → 391）

- `src/default-tools.test.ts`（12）：`defaultPlanTools` 生效/缺失 vs 空/无元数据 fail-closed/重载、恢复的工具选择覆盖配置、空集合恢复、invalid settings 回退、仅 active branch 恢复、implement 后恢复原工具、工具选择器光标与搜索
- `src/subagent-allowlist.test.ts`（5）：角色白名单集成（tasks 数组/spawn/空 allowlist/惰性/重载/会话级选择仍受约束）
- `src/safe-subcommands.test.ts`（2）：默认 bash 结构化命令策略集成（`gh pr view` 放行 / `gh pr merge` 拦截 / heredoc 拦截）
- `src/active-implementation.test.ts`（9）：实现态恢复/失败闭合/context 注入/`/guard show`/压过/清理/菜单/shutdown 保留/`--guard` 压过、issue-302 重进隐藏旧 handoff
- `src/index.test.ts`（+15）：thinking 会话恢复 4 个、交付失败回滚 5 个、ready 呈现边缘 5 个、finalize 拆分
- `src/state.test.ts`（+11）、`src/completion-tool.test.ts`（+2）、`src/tool-policy.test.ts`（+16 单断言结构化命令边界）

### 明确不做（记录在案）

- `safeSubcommands` 配置生效：Ticket 02 review 有意保留的前瞻 API，语义不变（settings 归一化仍在）
- `selectedToolKeys` 旧格式恢复：本项目无此承诺
- compaction 后从 toolResult 恢复 ready plan（`latestCompletionPlan`）：参考实现 issue-471 行为，本项目无对应承诺
- superseded-session-start 竞态测试：参考实现深竞态场景，超出本 ticket 范围

### Code Review

双轴审查（Standards/Spec）共 10+ 项发现全部处理：tool-policy 测试移入 describe 并拆单断言、finalize 双行为拆分、thinking 测试命名与语义修正、render 测试提取辅助、fixture 提取到 test-support.ts（`settingsLoader`/`planModeStateEntry`）、补 4 个参考实现缺口测试。审查报告存于 `.scratch/guard-plan-mode/reviews/`（按惯例不提交）。

### 测试与类型检查

- 完整套件：20/20 文件通过（391 passed）
- `npx tsc --noEmit`：0 错误

Commit: 见 `map.md`。
