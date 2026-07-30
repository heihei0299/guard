/**
 * Prompt injector for pi-guard-extension.
 *
 * Generates a three-section system prompt describing the currently active rules:
 *   1. Rule Summary (natural language)
 *   2. Complete Config (JSON)
 *   3. Constraint Notes
 *
 * This prompt is injected into the AI's system message so the AI can
 * self-censor before executing operations.
 */

import type { Ruleset, Rule } from "./rule-engine.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  allow: "允许自由写入",
  ask: "需要用户确认",
  deny: "禁止操作",
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Build a human-readable summary line for a single rule.
 */
function summarizeRule(rule: Rule): string {
  let summary = `• \`${rule.pattern}\`：${formatAction(rule.action)}`;
  if (rule.reason) {
    summary += `（${rule.reason}）`;
  }
  return summary;
}

/**
 * Group rules by surface, then build summary lines for each group.
 */
function buildSummary(rules: Ruleset): string {
  // Separate default rule from surface-specific rules
  const defaults = rules.filter((r) => r.surface === "*" && r.pattern === "*");
  const bySurface = new Map<string, Rule[]>();

  for (const rule of rules) {
    // Skip the catch-all default (handled separately)
    if (rule.surface === "*" && rule.pattern === "*") continue;
    const existing = bySurface.get(rule.surface) ?? [];
    existing.push(rule);
    bySurface.set(rule.surface, existing);
  }

  const lines: string[] = [];

  // Default strategy first
  if (defaults.length > 0) {
    const defaultAction = defaults[defaults.length - 1].action;
    lines.push(`• 默认策略（未匹配规则的兜底）：${formatAction(defaultAction)}`);
    lines.push("");
  }

  // Surface groups
  for (const [surface, surfaceRules] of bySurface) {
    lines.push(`  【${surface}】`);
    for (const rule of surfaceRules) {
      lines.push(summarizeRule(rule));
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Build the JSON config section from rules.
 */
function buildConfigSection(rules: Ruleset): string {
  // Group by surface
  const bySurface = new Map<string, Record<string, string>>();
  for (const rule of rules) {
    if (rule.surface === "*" && rule.pattern === "*") continue;
    const existing = bySurface.get(rule.surface) ?? {};
    existing[rule.pattern] = rule.action;
    bySurface.set(rule.surface, existing);
  }

  // Build a compact JSON representation
  const configObj: Record<string, unknown> = {};

  // Add default if present
  const defaultRule = rules.find((r) => r.surface === "*" && r.pattern === "*");
  if (defaultRule) {
    configObj["*"] = defaultRule.action;
  }

  // Add surface-specific rules
  for (const [surface, patterns] of bySurface) {
    if (Object.keys(patterns).length === 1 && "*" in patterns) {
      // Single catch-all pattern → string shorthand
      configObj[surface] = patterns["*"];
    } else {
      configObj[surface] = patterns;
    }
  }

  return JSON.stringify(configObj, null, 2);
}

// ── Main API ─────────────────────────────────────────────────────────────

/**
 * Build the Guard prompt for injection into the AI's system message.
 *
 * The prompt has three sections:
 * 1. Rule Summary (natural language description)
 * 2. Complete Config (JSON)
 * 3. Constraint Notes (behavioral guidelines)
 *
 * @param rules - The current active ruleset.
 * @returns A formatted multi-line prompt string.
 */
export function buildGuardPrompt(rules: Ruleset): string {
  const sections: string[] = [];

  // Header
  sections.push("🔒 Guard 规则已激活（/guard:allow 可退出）");
  sections.push("");

  // Section 1: Rule Summary
  sections.push("【规则摘要】");
  const summary = buildSummary(rules);
  if (summary) {
    sections.push(summary);
  } else {
    sections.push("• 暂无自定义规则");
  }
  sections.push("");

  // Section 2: Complete Config
  sections.push("【完整配置】");
  sections.push("```json");
  sections.push(buildConfigSection(rules));
  sections.push("```");
  sections.push("");

  // Section 3: Constraint Notes
  sections.push("【约束说明】");
  sections.push("• deny 的操作会被直接拦截，不要重试");
  sections.push("• ask 的操作会弹出确认对话框，需用户同意后执行");
  sections.push("• 如果不确定是否会违规，先自查规则再操作");

  return sections.join("\n");
}
