/**
 * Rule engine for pi-guard-extension.
 *
 * Pure-function core for evaluating permission rules, matching wildcard patterns,
 * composing rulesets, and normalizing configuration.
 *
 * Design follows pi-permission-system's rule.ts + synthesize.ts + normalize.ts.
 *
 * @see https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system
 */

import { expandHomePath } from "./path-normalizer.ts";
// ── Types ────────────────────────────────────────────────────────────────

export type PermissionState = "allow" | "ask" | "deny";

export type RuleOrigin = "global" | "project" | "agent" | "builtin" | "session" | "config";

export interface Rule {
  surface: string;
  pattern: string;
  action: PermissionState;
  reason?: string;
  layer?: "default" | "baseline" | "config" | "session";
  origin: RuleOrigin;
}

export type Ruleset = Rule[];

export interface DenyWithReason {
  action: "deny";
  reason?: string;
}

/** Compiled wildcard pattern with a fast matches() method. */
export interface CompiledWildcardPattern {
  matches(value: string): boolean;
}

// ── Wildcard pattern compilation ─────────────────────────────────────────

const patternCache = new Map<string, CompiledWildcardPattern>();

/**
 * Expand ~ and $HOME in a path to the user's home directory.
 */
/**
 * Compile a wildcard pattern into a CompiledWildcardPattern.
 *
 * Pattern rules:
 * 1. Expand ~ and $HOME via expandHomePath()
 * 2. Split by *, escape each segment with escapeRegExp(), replace ? with .
 * 3. Join segments with .*
 * 4. If pattern ends with " *" (space + wildcard), replace trailing " .*" with "( .*)?"
 * 5. Wrap in ^...$ with s flag (dotAll)
 * 6. Cache and return
 */
export function compileWildcardPattern(pattern: string): CompiledWildcardPattern {
  const cached = patternCache.get(pattern);
  if (cached) return cached;

  const expanded = expandHomePath(pattern);
  const parts = expanded.split("*");
  const escapedParts = parts.map((part) => {
    // Escape special regex chars, then replace ? with .
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\?/g, ".");
    return escaped;
  });
  let regexStr = "^" + escapedParts.join(".*") + "$";

  // Handle trailing " *" → make the last argument part optional
  if (pattern.endsWith(" *")) {
    // Replace the trailing " .*$" that resulted from the split+join
    // The final $ is a literal character from the + "$" concatenation
    regexStr = regexStr.replace(/ \.\*\$$/, "( .*)?$");
  }

  const regex = new RegExp(regexStr, "s");
  const compiled: CompiledWildcardPattern = {
    matches(value: string): boolean {
      return regex.test(value);
    },
  };

  patternCache.set(pattern, compiled);
  return compiled;
}

/**
 * Convenience wrapper: check if a value matches a wildcard pattern.
 */
export function wildcardMatch(pattern: string, value: string): boolean {
  return compileWildcardPattern(pattern).matches(value);
}

// ── Rule evaluation ─────────────────────────────────────────────────────

/**
 * Evaluate a single value against a ruleset.
 *
 * Scans from the end of the ruleset (last match wins). Returns the first
 * rule whose surface and pattern both match the given value.
 *
 * If no rule matches, returns a synthetic default rule:
 * `{ surface, pattern: "*", action: defaultAction ?? "ask", origin: "builtin" }`
 */
export function evaluate(
  surface: string,
  value: string,
  rules: Ruleset,
  defaultAction?: PermissionState,
): Rule {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (wildcardMatch(rule.surface, surface) && wildcardMatch(rule.pattern, value)) {
      return rule;
    }
  }
  return {
    surface,
    pattern: "*",
    action: defaultAction ?? "ask",
    layer: "default",
    origin: "builtin",
  };
}

/**
 * Evaluate multiple candidate values, returning the first non-default match.
 *
 * Iterates values in order, calls evaluate() for each.
 * The first value that does NOT return a synthetic default rule wins.
 * If all values return default, returns the first value's result.
 */
export function evaluateFirst(
  surface: string,
  values: string[],
  rules: Ruleset,
): { rule: Rule; value: string } {
  for (const value of values) {
    const rule = evaluate(surface, value, rules);
    if (rule.layer !== "default") {
      return { rule, value };
    }
  }
  // All matched defaults — return first value's result
  const rule = evaluate(surface, values[0], rules);
  return { rule, value: values[0] };
}

/**
 * Evaluate multiple values, preserving rule sorting: the last matching rule
 * across all values wins. Used for path surface with multiple alias paths.
 */
export function evaluateAnyValue(
  surface: string,
  values: string[],
  rules: Ruleset,
): { rule: Rule; value: string } {
  let bestRule: Rule | null = null;
  let bestValue: string | null = null;
  let bestIndex = -1;

  for (const value of values) {
    // Scan from the end to find the last matching rule for this value
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      if (wildcardMatch(rule.surface, surface) && wildcardMatch(rule.pattern, value)) {
        if (i > bestIndex) {
          bestRule = rule;
          bestValue = value;
          bestIndex = i;
        }
        break; // Found the last matching rule for this value, move to next value
      }
    }
  }

  if (bestRule) {
    return { rule: bestRule, value: bestValue! };
  }

  // No match — return synthetic default
  const defaultRule = evaluate(surface, values[0] ?? "", rules);
  return { rule: defaultRule, value: values[0] ?? "" };
}

/**
 * Evaluate multiple values and return the most restrictive result.
 * Order: deny > ask > allow. Short-circuits on first deny.
 */
export function evaluateMostRestrictive(
  surface: string,
  values: string[],
  rules: Ruleset,
): { rule: Rule; value: string } | null {
  if (values.length === 0) return null;

  let best: { rule: Rule; value: string } | null = null;

  for (const value of values) {
    const rule = evaluate(surface, value, rules);
    if (rule.action === "deny") {
      return { rule, value };
    }
    if (rule.action === "ask") {
      best = { rule, value };
    }
    if (rule.action === "allow" && best === null) {
      best = { rule, value };
    }
  }

  return best;
}

// ── Rule composition & transformation ─────────────────────────────────────

/**
 * Compose multiple rulesets into one, preserving order.
 * Later rules (config) take precedence over earlier ones (defaults, baseline).
 *
 * Order: defaults → baseline → config
 */
export function composeRuleset(
  defaults: Ruleset,
  baseline: Ruleset,
  config: Ruleset,
): Ruleset {
  return [...defaults, ...baseline, ...config];
}

/**
 * Synthesize a single catch-all default rule.
 *
 * @param universalDefault - The action for unmatched operations.
 * @param origin - Origin source (default: "builtin").
 */
export function synthesizeDefaults(
  universalDefault: PermissionState,
  origin: RuleOrigin = "builtin",
): Ruleset {
  return [
    {
      surface: "*",
      pattern: "*",
      action: universalDefault,
      layer: "default",
      origin,
    },
  ];
}

/**
 * Rewrite all `ask` actions to `allow` — "YOLO mode".
 * Returns a new array; does not mutate the original.
 */
export function rewriteAsksToYolo(rules: Ruleset): Ruleset {
  return rules.map((r) => (r.action === "ask" ? { ...r, action: "allow" as const } : r));
}

/**
 * Floor all `allow` actions to `ask` — fail-closed clamp.
 * Returns a new array; does not mutate the original.
 */
export function floorAllowsToAsk(rules: Ruleset): Ruleset {
  return rules.map((r) => (r.action === "allow" ? { ...r, action: "ask" as const } : r));
}

// ── Config normalization ─────────────────────────────────────────────────

/**
 * Normalize a FlatPermissionConfig into a Ruleset.
 *
 * Handles:
 * - `"surface": "string"` → `{ surface, pattern: "*", action }`
 * - `"surface": { "pattern": "action" }` → per-pattern rules
 * - `DenyWithReason`: `{ action: "deny", reason: "..." }`
 * - Invalid values are silently skipped
 *
 * The special `"*"` key defines the default action and is placed first.
 */
export function normalizeFlatConfig(permission: Record<string, unknown>): Ruleset {
  const rules: Ruleset = [];

  for (const [surface, value] of Object.entries(permission)) {
    if (typeof value === "string" && (value === "allow" || value === "ask" || value === "deny")) {
      rules.push({
        surface,
        pattern: "*",
        action: value,
        origin: "config",
      });
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const patternMap = value as Record<string, unknown>;
      for (const [pattern, action] of Object.entries(patternMap)) {
        if (typeof action === "string" && (action === "allow" || action === "ask" || action === "deny")) {
          rules.push({
            surface,
            pattern,
            action,
            origin: "config",
          });
        } else if (typeof action === "object" && action !== null && "action" in action) {
          const denyWithReason = action as DenyWithReason;
          if (denyWithReason.action === "deny") {
            rules.push({
              surface,
              pattern,
              action: "deny",
              reason: denyWithReason.reason,
              origin: "config",
            });
          }
        }
        // Silently skip invalid entries
      }
    }
    // Silently skip other types
  }

  return rules;
}
