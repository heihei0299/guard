Status: ready-for-agent

# Guard v1 收尾（closing milestone）

## Problem Statement

Guard Mode（Plan Mode 架构）v1 已完整实现（`.scratch/guard-plan-mode/` 7 个 ticket 全部 resolved，343 测试通过，tsc 零错误），但存在 3 处与设计文档/承诺不符的缺口，以及仓库状态混乱：

- **bash 安全策略 HIGH 级纯漏检**：`isSafeCommand()` 按空格切 token 检查重定向，`echo hi>/tmp/x` 这类无空格粘连的输出重定向不被检测（`<` 输入重定向与数字/`&` 形式已覆盖）。这是纯漏检，连"纪律提醒"都算不上，v1 承诺（工作流约束）要求修复。
- **上下文过滤未对齐 ADR-0009**：Guard Mode 关闭后，`guard_mode_question` 的调用与结果（含问题与用户答案）仍留在上下文中；ADR-0009 设计明确应剥离。关键决策本应写入 plan（plan 是实现阶段唯一权威），Q&A 退出后即 stale。
- **配置面存在死键**：`safeSubcommands` 被 `settings.ts` 解析并透传，但 `isSafeCommand(command, _safeSubcommands)` 参数从未使用——"存在但不生效"的配置键会误导用户。
- **仓库状态混乱**：新架构文档（ADR 0006-0011、AGENTS.md、`.scratch/guard-plan-mode/` 等）未提交；旧架构死文件（`.pi/pi-guard.json`、`_review_diff.txt`）仍在；`对话分析总结.md` 记录了已被新架构设计取代的旧版 bug 分析。

## Solution

完成 Guard Mode v1 的收尾里程碑：修复 HIGH 级漏检、补齐 question 过滤、移除配置死键、清理并提交仓库。**不改动任何已对齐确认的设计决策**（激活语义、状态模型、工具策略、路径白名单、违规处理链、UX 均保持现状）。

## User Stories

1. 作为用户，当 AI 在 Guard Mode 中执行 `echo hi>/tmp/x` 这类无空格重定向时，我希望命令被拦截，以便写文件意图不被漏检。
2. 作为用户，当 AI 在 Guard Mode 中执行 `cmd>/dev/null` 或 `cmd 2>&1` 时，我希望命令仍被放行，以便合法的标准输出抑制不受影响。
3. 作为用户，当 AI 在 Guard Mode 中执行 `echo hi > out.txt`（独立 token）、`2>file`、`&>file` 时，我希望行为与现状一致（仍被拦截），以便修复不引入回归。
4. 作为用户，当 Guard Mode 关闭后，我希望 `guard_mode_question` 的提问与答案不再出现在 AI 上下文中，以便 stale 的规划 Q&A 不干扰后续推理。
5. 作为用户，当 Guard Mode 激活时，我希望 AI 仍能看到自己的提问记录，以便规划中的追问有上下文。
6. 作为用户，当我在 `~/.pi/agent/pi-guard.json` 中写了 `safeSubcommands` 键时，我希望该键不再被接受为有效配置，以便不会有"配置了但不生效"的错觉。
7. 作为用户，我希望 README 对 bash 重定向检测能力的描述与实现一致（不再声称"粘连形式不检测"），以便文档不失实。
8. 作为维护者，我希望仓库中不再残留旧架构的死配置文件（`.pi/pi-guard.json`）与临时审查产物（`_review_diff.txt`），以便新架构的配置入口（`~/.pi/agent/pi-guard.json`）不被混淆。
9. 作为维护者，我希望新架构的文档资产（ADR 0006-0011、AGENTS.md、`.scratch/guard-plan-mode/`、本 spec 与 tickets）被提交到 git，以便 v1 状态可追溯。
10. 作为维护者，我希望 `对话分析总结.md` 作为历史背景被存档（而非删除），以便"为何纯显式激活"的决策背景可查。
11. 作为 AFK agent，我希望本里程碑有完整 spec 与按序 tickets，以便无需人工澄清即可实施。

## Implementation Decisions

以下决策来自本次 grill-with-docs 对齐会话（Q1-Q13 全部分支已确认，均为对既有 ADR-0007~0011 的确认或对齐，**不新增 ADR**）：

### 已确认保持现状的设计（不改动）

- **核心承诺**：Guard Mode 是工作流约束（纪律提醒）而非安全边界；MEDIUM 级两项（git/gh 前缀匹配过宽、`curl -o/-O` 可写文件）文档化接受，不修复。（已记入 CONTEXT.md Guard Mode 词条）
- **激活语义**：纯显式激活（`/guard` 命令 + `--guard` 标志），无自动提示、无自动技能检测。
- **状态模型**：扁平 enabled/disabled + 派生阶段；plan 生命周期限于提交它的那一轮 agent 回合，新一轮开始即清除，跨轮/跨 session 恢复仅用于用户展示与 implement/exit 决策。（已记入 CONTEXT.md Plan Ready 词条）
- **工具策略**：五分类（read-only / limited / allowlisted / blocked / user-opt-in），user-opt-in 启用后完全放行。
- **路径白名单**：`.scratch/`、`docs/`、`CONTEXT.md` 三条目，编译时固定；匹配规则（绝对路径子串、任意嵌套 CONTEXT.md）作为已文档化宽松点接受。
- **plan 流程**：`guard_mode_question` 限 1-3 题、每题 2-4 选项；`guard_mode_complete` 限非空、≤50K、最后独立动作；保留 legacy `<proposed_plan>` 回退路径。
- **违规处理链**：5 层机制（tool_call 硬阻断 → agent_end 验证 → before_agent_start 重置 → context 过滤 → TUI 提示）+ subagent 白名单，阻断不 abort、AI 自然重试。
- **UX**：中英双语消息、statusline 三态展示、实现阶段菜单。
- **发布形态**：本地安装（`pi install -l`），不发布 npm。

### 收尾改动

1. **HIGH 修复——粘连输出重定向检测**（`isSafeCommand`）：
   - 新增对 token 内 `>` 的兜底检测：非数字/`&` 前缀字符粘连的输出重定向（`echo hi>/tmp/x`、`cmd>>log`）判定为不安全。
   - 保留例外：目标为 `/dev/null` 或以 `&` 开头（`cmd>/dev/null`、`cmd 2>&1`、`ls 2>/dev/null`）放行。
   - 数字/`&` 形式（`2>file`、`&>file`、`2>>file`）已有覆盖，不回归；`<` 输入重定向（含 `cat<file`、heredoc `<<`）已有覆盖，不回归。
   - 同步更新 README 中重定向检测的措辞（移除"非数字粘连形式不检测"的免责声明）。
2. **补过滤 `guard_mode_question` Q&A**（上下文过滤）：
   - Guard Mode 关闭时：剥离 `guard_mode_question` 的 toolResult 消息，并剥离 assistant 内容中的 `guard_mode_question` 工具调用块；与 `guard_mode_complete` 的过滤对称实现，复用 `GUARD_MODE_QUESTION_TOOL_NAME` 常量。
   - Guard Mode 激活时不剥离（规划中 AI 需要提问记录）。
   - 对齐 ADR-0009 设计；legacy 旧名（`plan_mode_question`）残留按 ADR-0011 既定口径接受。
3. **移除 `safeSubcommands` 死键**（配置面）：
   - `PlanModeSettings` 移除 `safeSubcommands` 字段；移除 `SafeSubcommands` 类型族与 `normalizeSafeSubcommands`。
   - `isSafeCommand` 签名移除未使用参数。
   - 配置文件中含 `safeSubcommands` 键时按现有 normalize 行为视为 invalid（配置整体被忽略并警告）。
   - README 未提及该键，无文档同步负担。
4. **仓库收尾**：
   - 删除 `.pi/pi-guard.json`（旧架构死配置，新代码零引用）与 `_review_diff.txt`（临时审查产物）。
   - `对话分析总结.md` 移至 `.scratch/` 存档，注明已被新架构设计取代。
   - 提交新架构文档：`docs/adr/0006~0011`、`AGENTS.md`、`docs/agents/`、`.scratch/guard-plan-mode/`、`.scratch/guard-v1-closing/`（本 spec + 4 tickets）、`CONTEXT.md` 更新、`pi-guard-extension/` 代码修复。
   - `pi-extensions/` 是独立嵌套 git 仓库，不纳入根仓库提交。

## Testing Decisions

- 测试原则：只测外部行为（安全判定结果、过滤结果、配置归一化结果），不耦合实现细节；纯函数优先——三个改动全部落在既有纯函数 seam 上，**不新增 seam**。
- 测试 seams（已与用户确认）：
  1. `isSafeCommand()`（tool-policy.ts）——HIGH 修复的单元测试位；现有 `tool-policy.test.ts` 的重定向测试组为 prior art。
  2. message-transform.ts 过滤纯函数 + `context` 事件管道——question 过滤的单元测试位；现有 `message-transform.test.ts` 与集成测试（context 管道断言）为 prior art。
  3. `normalizePlanModeSettings()`（settings.ts）——死键移除的测试位；现有 `settings.test.ts` 为 prior art。
- 每个改动先补红测试（含不回归断言：独立 `>`、`2>file`、`&>file`、`/dev/null`、`2>&1`、`cat<file`、激活时 question 可见），再实现。
- 验收门槛：全量 `npm test` 通过（基线 343 + 新增）、`npx tsc --noEmit` 零错误。

## Out of Scope

- MEDIUM 级两项（git/gh 前缀过宽、`curl -o/-O` 可写）——文档化接受，不修复
- 自动技能检测 / 激活提示——纯显式激活已确认
- 路径白名单运行时配置、扩充白名单条目（如 `.pi/`）
- 移除 legacy `<proposed_plan>` 回退路径
- 违规处理链、UX、工具策略的任何改动
- npm 发布
- `pi-extensions/` 嵌套仓库的任何操作

## Further Notes

- 实施分解为 4 个 tickets：`issues/01-high-redirect-detection.md`、`issues/02-filter-question-artifacts.md`、`issues/03-remove-safe-subcommands-dead-key.md`、`issues/04-repo-cleanup-and-commit.md`（04 被 01-03 阻塞，收尾 commit 在代码修复后）。
- 对齐会话产出：CONTEXT.md 已更新 2 个词条（Guard Mode 非安全边界定位、Plan Ready 生命周期语义）。
- 参考文档：`docs/adr/0007-replace-guard-with-plan-mode.md`、`docs/adr/0009-plan-mode-context-and-persistence.md`、`docs/adr/0011-guard-tool-renaming-for-coexistence.md`、`.scratch/guard-plan-mode/spec.md`、`.scratch/guard-plan-mode/issues/07.md`（安全审查记录）。
