# 03 — Plan Submission Tools

**What to build:** 实现 Guard Mode 的两个核心工具——`plan_mode_question`（AI 向用户提 1-3 个结构化问题）和 `plan_mode_complete`（AI 提交完整 plan），以及 Guard Mode system prompt 构建。

**Blocked by:** 01 — Foundation

**Status:** resolved

- [x] `src/question-tool.ts`：`plan_mode_question` 参数定义（1-3 问题，每问题 2-4 选项）
- [x] `src/question-tool.ts`：参数规范化和验证（normalizePlanModeQuestionParams）
- [x] `src/question-tool.ts`：用户交互逻辑（ctx.ui.select + ctx.ui.editor）
- [x] `src/question-tool.ts`：结果格式化和取消处理
- [x] `src/completion-tool.ts`：`plan_mode_complete` 参数定义（plan 字符串，≤50K 字符）
- [x] `src/completion-tool.ts`：参数规范化和验证（normalizePlanModeCompletion）
- [x] `src/completion-tool.ts`：结果渲染（Markdown 展示，terminate: true）
- [x] `src/prompt.ts`：Guard Mode system prompt 构建（三阶段引导 + mode rules + 完成规则，中英双语）
- [x] 删除 `src/prompt-injector.ts`
- [x] `npx tsc --noEmit` 通过 — 新模块 0 错误（整仓 13 个预存错误均在旧文件 index.ts/index.test.ts/rule-engine.ts，Ticket 05 重写后清零）

## Answer

Ticket 03 已实现 Plan Submission Tools：

### 新增模块
- `src/question-tool.ts` — `plan_mode_question`：参数 schema（1-3 问题 × 每问题 2-4 选项，字段 id/header/question/options[label/description]）、`normalizePlanModeQuestionParams()` 验证、`askPlanModeQuestions()`（ctx.ui.select + ctx.ui.editor 交互，含 Other 自由输入）、`answerPlanModeQuestions()`（lifecycle 检查：session 变化/plan mode 关闭/用户取消三种取消原因）、`planModeQuestionAnswered/Cancelled()` 结果格式化（JSON payload + details）
- `src/completion-tool.ts` — `plan_mode_complete`：参数 schema（plan ≤50K 字符）、`normalizePlanModeCompletion()` 验证、`planModeCompleted()`（**Proposed Plan** Markdown + versioned details + terminate: true）、`planModeCompletionMarkdown()`/`renderPlanModeCompletion()`（TUI Markdown 渲染）
- `src/prompt.ts` — Guard Mode system prompt：三阶段引导（环境勘察/意图对话/实现细节对话）+ mode rules + 完成规则 + 路径白名单 + 状态块（planning/plan ready/active implementation），**逐行中英双语**。`buildPlanModePrompt(state)` 从 plan-mode.ts 迁移至此（用户确认的架构决策），plan-mode.ts 专注状态管理 + 工具决策

### 删除/修改
- 删除 `src/prompt-injector.ts` + `src/prompt-injector.test.ts`
- `src/index.ts`：`injectPrompt`/`removePrompt` 降级为 `@deprecated` no-op stub（Ticket 05 重写 index.ts 时移除），清理 `promptInjected` 死状态
- `src/plan-mode.ts`：删除 `buildPlanModePrompt`（迁移到 prompt.ts）
- `src/required-tools.ts`：工具名常量改为从 question-tool.ts / completion-tool.ts 导入（单一来源）

### 测试
- `question-tool.test.ts`：26 个测试（参数验证 + 交互 + 取消处理 + 结果格式化）
- `completion-tool.test.ts`：19 个测试（参数验证 + details 恢复 + 结果渲染）
- `prompt.test.ts`：10 个测试（三阶段 + mode rules + 完成规则 + 双语 + 状态块）
- 完整套件 11/12 文件通过（index.test.ts 的 14 个失败为旧行为测试，Ticket 05 处理）

### Code Review
两轴审查通过（并行 sub-agent）。修复 3 项：`promptInjected` 死代码、工具名常量双源（required-tools.ts 改为导入）、测试 `as any` 改为类型化 `QuestionUi` mock。其余为判断项（`isRecord`/Result 联合类型重复——项目惯例与参考实现一致；`renderPlanModeCompletion` 无调用点——Ticket 05 接线；工具文件错误消息英文——模型面向，与参考实现一致）。

Commit: `aa710ec`
