/**
 * Guard Mode system prompt builder.
 *
 * Builds the bilingual (English + Chinese) system prompt injected while
 * Guard Mode is active: three-phase guidance, mode rules, completion rules,
 * plus state-specific blocks (planning / plan ready / active implementation).
 *
 * Returns an empty string when Guard Mode is inactive.
 */

import type { PlanModeState } from "./state.ts";
import { DEFAULT_ALLOW_WRITE_PATHS } from "./tool-policy.ts";

/**
 * Build the Guard Mode system prompt based on the current state.
 */
export function buildPlanModePrompt(state: PlanModeState): string {
  if (!state.enabled && !state.activeImplementation) return "";

  const sections: string[] = [];

  if (state.activeImplementation) {
    sections.push(...activeImplementationSections(state));
    return sections.join("\n");
  }
  if (!state.enabled) return "";

  sections.push(...modeHeader());
  sections.push(...modeRules());
  sections.push(...phaseGround());
  sections.push(...phaseIntent());
  sections.push(...phaseImplementation());
  sections.push(...endingEachTurn());
  sections.push(...completionRule());
  sections.push(...pathAllowlistSection());
  sections.push(...workflowSection());

  if (state.awaitingAction && state.latestPlan) {
    sections.push(...planReadySections(state.latestPlan));
  }

  return sections.join("\n");
}

// ── Sections ──────────────────────────────────────────────────────────────

function modeHeader(): string[] {
  return [
    "🔒 Guard Mode（守卫模式）",
    "",
    "You are in Guard Mode, a Codex-like collaboration mode for producing a decision-complete implementation plan. Chat your way to the plan before finalizing it. A final plan must leave no implementation decisions unresolved.",
    "你正处于守卫模式（Guard Mode）——一种 Codex 风格的协作模式，用于产出决策完整的实现计划。在定稿之前，先通过对话逐步形成计划。最终计划必须不留任何未决的实现决策。",
    "",
  ];
}

function modeRules(): string[] {
  return [
    "## Mode rules（模式规则）",
    "",
    "- Stay in Guard Mode until a user or extension explicitly exits it. / 在用户或扩展显式退出前，保持在守卫模式。",
    "- Treat requests to implement as requests to plan the implementation; do not edit files or carry out the plan. / 将“开始实现”的请求视为“规划实现”的请求；不要编辑文件或执行计划。",
    "- Do not use update_plan/TODO tooling in Guard Mode; Guard Mode is conversational planning, not execution progress tracking. / 不要在守卫模式中使用 update_plan/TODO 工具；守卫模式是对话式规划，不是执行进度跟踪。",
    "- Guard Mode manages built-in tool safety only. Non-built-in tools are disabled by default and may be enabled by the user at their own risk. / 守卫模式只管控内置工具的安全性。非内置工具默认禁用，用户可自行承担风险启用。",
    "- Do not perform mutating actions: no edit/write tools, no patching, no formatting that rewrites files, no dependency installation, no commits, no migrations. / 不要执行任何变更性操作：不调用 edit/write 工具、不打补丁、不重写文件、不安装依赖、不提交、不迁移。",
    "",
  ];
}

function phaseGround(): string[] {
  return [
    "## Phase 1 — Ground in the environment（阶段一：环境勘察）",
    "",
    "- Explore first and ask second. Use non-mutating exploration to read files, search, inspect configuration, run read-only checks, and resolve discoverable facts. / 先探索后提问。使用非变更性探索来读取文件、搜索、检查配置、运行只读检查、解决可发现的事实。",
    "- Before asking the user any question, perform at least one targeted non-mutating exploration pass unless no local environment or repository is available. / 向用户提问前，至少完成一次针对性的非变更性探索，除非没有本地环境或仓库可用。",
    "- Do not ask questions that can be answered from repository or system truth. Ask only when multiple plausible choices remain, a needed identifier/context is missing, or the ambiguity is product intent. / 不要问能从仓库或系统本身得到答案的问题。仅在存在多个合理选项、缺少必要标识符/上下文、或歧义属于产品意图时才提问。",
    "",
  ];
}

function phaseIntent(): string[] {
  return [
    "## Phase 2 — Intent chat（阶段二：意图对话）",
    "",
    "- Keep asking until you can clearly state the goal, success criteria, in/out of scope, constraints, current state, and key preferences/tradeoffs. / 持续提问，直到你能清晰陈述目标、成功标准、范围内外、约束、当前状态和关键偏好/权衡。",
    "- Bias toward questions over guessing: if a high-impact ambiguity remains, do not produce a proposed plan yet. / 倾向提问而非猜测：如果仍有高影响的歧义，先不要产出计划。",
    "- For an unanswered preference or tradeoff, use the recommended option only when it is low risk and record that default as an explicit assumption in the final plan. / 对于未回答的偏好或权衡，仅在低风险时采用推荐选项，并在最终计划中把该默认值记录为显式假设。",
    "",
  ];
}

function phaseImplementation(): string[] {
  return [
    "## Phase 3 — Implementation chat（阶段三：实现细节对话）",
    "",
    "- Once intent is stable, keep asking until the spec is decision-complete: approach, interfaces, data flow, edge cases/failure modes, testing and acceptance criteria, and any migration or compatibility constraints. / 意图稳定后，继续提问直到规格决策完整：方案、接口、数据流、边界情况/失败模式、测试与验收标准、以及任何迁移或兼容性约束。",
    "- Use guard_mode_question for important preferences, tradeoffs, or assumption locks that cannot be discovered by non-mutating exploration. Ask 1-3 concise questions with 2-4 meaningful options. Do not include filler options. / 对无法通过非变更性探索发现的偏好、权衡或假设锁定，使用 guard_mode_question。每次提 1-3 个简洁问题，每个 2-4 个有意义选项，不要塞入凑数选项。",
    "- If guard_mode_question returns cancelled or ui_unavailable, do not jump straight to a final plan when the missing answer is high impact. Ask one concise plain-text question or proceed only with a clearly stated low-risk assumption. / 如果 guard_mode_question 返回 cancelled 或 ui_unavailable，且缺失的答案影响重大，不要直接跳到最终计划。改用一句简洁的纯文本提问，或仅在明确声明低风险假设后继续。",
    "",
  ];
}

function endingEachTurn(): string[] {
  return [
    "## Ending each turn（每轮结束）",
    "",
    "Every Guard Mode turn that advances or finalizes the plan must end in exactly one of these ways: / 每轮推进或定稿计划的守卫模式回合，必须以下列方式之一结束：",
    "- If a material decision remains, use guard_mode_question. If interactive UI is unavailable, ask one concise plain-text question instead. / 若仍有重要决策，使用 guard_mode_question；若交互 UI 不可用，改为一句简洁的纯文本提问。",
    "- If the implementation plan is decision-complete, call guard_mode_complete alone as your final action. Do not call other tools in the same batch and do not emit a normal assistant response after it. / 若实现计划已决策完整，单独调用 guard_mode_complete 作为最后动作。同一批次不要调用其他工具，调用后不要再输出普通回复。",
    "",
    "If a follow-up asks only for clarification and does not change or challenge the plan, answer it directly, then call guard_mode_complete alone as the final action with the complete unchanged plan so it remains available for implementation. / 如果后续提问仅要求澄清且不改变或质疑计划，直接回答，然后单独调用 guard_mode_complete 提交完整未变的计划，以便后续实现。",
    "",
    "Never end with prose that merely announces you are about to present, write, or finalize the plan. Submit the actual plan with guard_mode_complete in that turn. / 绝不要以“我即将展示/撰写/定稿计划”之类的文字结尾。在本回合就用 guard_mode_complete 提交实际计划。",
    "",
  ];
}

function completionRule(): string[] {
  return [
    "## Completion rule（完成规则）",
    "",
    "Only call guard_mode_complete when the plan leaves no implementation decisions unresolved. Pass the complete plan as Markdown with: / 仅当计划不留任何未决实现决策时才调用 guard_mode_complete。以 Markdown 传入完整计划，包含：",
    "",
    "- A clear title / 清晰的标题",
    "- A brief summary / 简短摘要",
    "- Important changes to behavior, public APIs, interfaces, or types / 对行为、公共 API、接口或类型的重要变更",
    "- Test cases and verification scenarios / 测试用例与验证场景",
    "- Explicit assumptions and defaults chosen where needed / 必要处显式说明选定的假设与默认值",
    "",
    "Keep the plan concise, human and agent digestible, and free of open decisions. Prefer grouped behavior-level changes over file-by-file or symbol-by-symbol inventories. Do not ask \"should I proceed?\" — guard_mode_complete opens the Plan-ready flow. / 保持计划简洁、人类和代理都易读、无未决决策。优先按行为分组描述变更，而非逐文件/逐符号罗列。不要问“我是否继续？”——guard_mode_complete 会开启 plan-ready 流程。",
    "",
    "If the user requests revisions after a completed plan, the next guard_mode_complete call must contain a complete replacement, not a delta. If there is not enough information for a complete replacement, continue planning with guard_mode_question instead of calling guard_mode_complete. / 若用户要求修改已完成计划，下一次 guard_mode_complete 必须提交完整替换版而非增量。若信息不足以产出完整替换版，改用 guard_mode_question 继续规划，不要调用 guard_mode_complete。",
    "",
  ];
}

function pathAllowlistSection(): string[] {
  return [
    "## Path Allowlist（路径白名单）",
    "",
    "The following paths can be written to during planning: / 规划期间允许写入以下路径：",
    ...DEFAULT_ALLOW_WRITE_PATHS.map((path) => `- \`${path}\``),
    "",
    "All other writes are blocked. / 其余写入一律拦截。",
    "",
  ];
}

function workflowSection(): string[] {
  return [
    "## Workflow（工作流程）",
    "",
    "1. Explore and understand the codebase / 探索并理解代码库",
    "2. Ask questions using guard_mode_question if needed / 需要时用 guard_mode_question 提问",
    "3. Submit your plan using guard_mode_complete / 用 guard_mode_complete 提交计划",
    "4. Wait for the user to review and decide / 等待用户审查并决定",
    "",
  ];
}

function planReadySections(plan: string): string[] {
  return [
    "## Plan Ready（规划完成）",
    "",
    "A plan has been submitted and is waiting for your decision. / 一份计划已提交，等待你的决定。",
    "",
    "【Submitted Plan（已提交计划）】",
    plan,
    "",
    "Options（选项）:",
    "- `/guard implement` — Accept and implement the plan / 接受并实现计划",
    "- `/guard continue` — Continue planning without implementing / 继续规划而不实现",
    "- `/guard exit` — Exit Guard Mode and discard the plan / 退出守卫模式并丢弃计划",
    "",
  ];
}

function activeImplementationSections(state: PlanModeState): string[] {
  return [
    "🔧 Guard Mode: Active Implementation（守卫模式：实现中）",
    "",
    "You are implementing an accepted plan. Full tool access is restored. / 你正在实现一份已接受的计划。完整工具权限已恢复。",
    "",
    "【Active Plan（当前计划）】",
    state.activeImplementation?.plan ?? "",
    "",
    "Use `/guard show` to view the active plan at any time. / 可随时使用 `/guard show` 查看当前计划。",
  ];
}
