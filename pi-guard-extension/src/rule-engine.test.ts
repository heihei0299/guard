import { describe, it, expect } from "vitest";
import {
  wildcardMatch,
  compileWildcardPattern,
  evaluate,
  evaluateFirst,
  evaluateAnyValue,
  evaluateMostRestrictive,
  composeRuleset,
  synthesizeDefaults,
  rewriteAsksToYolo,
  floorAllowsToAsk,
  normalizeFlatConfig,
} from "./rule-engine.ts";
import type { Rule, Ruleset } from "./rule-engine.ts";

// ── Slice 1: wildcardMatch / compileWildcardPattern ──────────────────────

describe("wildcardMatch", () => {
  it("matches exact string without wildcards", () => {
    expect(wildcardMatch("exact", "exact")).toBe(true);
    expect(wildcardMatch("exact", "different")).toBe(false);
  });

  it("matches * as any characters", () => {
    expect(wildcardMatch("*.ts", "file.ts")).toBe(true);
    expect(wildcardMatch("*.ts", "file.js")).toBe(false);
    expect(wildcardMatch("src/*", "src/index.ts")).toBe(true);
    expect(wildcardMatch("src/*", "lib/index.ts")).toBe(false);
  });

  it("matches * across path separators", () => {
    expect(wildcardMatch("src/**/*.ts", "src/components/button.ts")).toBe(true);
    expect(wildcardMatch("a/*/c", "a/b/c")).toBe(true);
    expect(wildcardMatch("a/*/c", "a/b/x/c")).toBe(true); // * matches / with .* join
    expect(wildcardMatch("*.ts", "a/b/c.ts")).toBe(true);
  });

  it("matches ? as single character", () => {
    expect(wildcardMatch("file.?s", "file.ts")).toBe(true);
    expect(wildcardMatch("file.?s", "file.js")).toBe(true);
    expect(wildcardMatch("file.?s", "file.txt")).toBe(false);
    expect(wildcardMatch("?.ts", "a.ts")).toBe(true);
    expect(wildcardMatch("?.ts", "ab.ts")).toBe(false);
  });

  it("handles trailing space + wildcard (optional args)", () => {
    // Pattern ending with ' *' should make the argument part optional
    expect(wildcardMatch("rm -rf *", "rm -rf /tmp")).toBe(true);
    expect(wildcardMatch("rm -rf *", "rm -rf")).toBe(true);
    expect(wildcardMatch("ls *", "ls -la")).toBe(true);
    expect(wildcardMatch("ls *", "ls")).toBe(true);
  });

  it("matches dotAll with s flag", () => {
    // With s flag, . matches newlines
    expect(wildcardMatch("*foo*", "hello\nfoo\nbar")).toBe(true);
  });

  it("matches * alone as anything", () => {
    expect(wildcardMatch("*", "")).toBe(true);
    expect(wildcardMatch("*", "anything")).toBe(true);
    expect(wildcardMatch("*", "with\nnewlines")).toBe(true);
  });

  it("expands ~ in pattern to home directory", () => {
    // We can't easily test the actual expansion, but we can test the pattern works
    const home = process.env.HOME || "/home/user";
    expect(wildcardMatch("~/docs/*", `${home}/docs/file.md`)).toBe(true);
    expect(wildcardMatch("~/docs/*", `${home}/other/file.md`)).toBe(false);
  });
});

describe("compileWildcardPattern", () => {
  it("returns an object with matches method", () => {
    const compiled = compileWildcardPattern("*.ts");
    expect(compiled).toHaveProperty("matches");
    expect(typeof compiled.matches).toBe("function");
    expect(compiled.matches("file.ts")).toBe(true);
    expect(compiled.matches("file.js")).toBe(false);
  });

  it("caches compiled regex", () => {
    const a = compileWildcardPattern("*.ts");
    const b = compileWildcardPattern("*.ts");
    expect(a).toBe(b); // Same cached instance
  });
});

// ── Slice 2: evaluate ────────────────────────────────────────────────────

describe("evaluate", () => {
  // Rules ordered: defaults first, overrides last (last wins)
  const rules: Ruleset = [
    { surface: "*", pattern: "*", action: "allow", origin: "builtin" },      // default catch-all
    { surface: "bash", pattern: "*", action: "ask", origin: "builtin" },          // bash default
    { surface: "bash", pattern: "rm -rf *", action: "deny", origin: "builtin" },
    { surface: "path", pattern: "docs/*", action: "allow", origin: "builtin" },
    { surface: "path", pattern: ".scratch/*", action: "allow", origin: "builtin" },
    { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },      // last wins
  ];

  it("matches last rule wins (from tail)", () => {
    const result = evaluate("path", ".scratch/notes.txt", rules);
    expect(result.action).toBe("allow");
    expect(result.pattern).toBe(".scratch/*");
  });

  it("matches deny for .env files", () => {
    const result = evaluate("path", ".env", rules);
    expect(result.action).toBe("deny");
    expect(result.surface).toBe("path");
    expect(result.pattern).toBe("*.env");
  });

  it("matches deny for .env in subdirectory", () => {
    const result = evaluate("path", "src/.env", rules);
    expect(result.action).toBe("deny");
    expect(result.pattern).toBe("*.env");
  });

  it("matches ask for bash default", () => {
    const result = evaluate("bash", "some-command", rules);
    expect(result.action).toBe("ask");
  });

  it("matches deny for rm -rf", () => {
    const result = evaluate("bash", "rm -rf /tmp", rules);
    expect(result.action).toBe("deny");
  });

  it("returns default action when no match", () => {
    const result = evaluate("unknown_surface", "some-value", rules);
    expect(result.action).toBe("allow"); // fallback to "*" pattern
  });

  it("uses provided defaultAction when no match", () => {
    const result = evaluate("unknown_surface", "some-value", [], "deny");
    expect(result.action).toBe("deny");
    expect(result.origin).toBe("builtin");
  });

  it("returns synthetic default with ask when no defaultAction provided", () => {
    const result = evaluate("unknown", "value", []);
    expect(result.action).toBe("ask");
    expect(result.pattern).toBe("*");
  });

  it("matches surface-specific rules before wildcard surface", () => {
    const specificRules: Ruleset = [
      { surface: "*", pattern: "*", action: "deny", origin: "builtin" },      // default catch-all (first)
      { surface: "path", pattern: "*.md", action: "allow", origin: "builtin" },  // specific override (last wins)
    ];
    // The more specific path rule is last, so it wins over the catch-all
    const result = evaluate("path", "readme.md", specificRules);
    expect(result.action).toBe("allow");
  });

  it("includes reason when provided", () => {
    const rulesWithReason: Ruleset = [
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin", reason: "Sensitive file" },
    ];
    const result = evaluate("path", ".env", rulesWithReason);
    expect(result.reason).toBe("Sensitive file");
  });
});

// ── Slice 3: evaluateFirst ──────────────────────────────────────────────

describe("evaluateFirst", () => {
  it("returns first non-default rule match", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.ts", action: "allow", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
    ];
    const result = evaluateFirst("path", ["file.ts", ".env", "file.js"], rules);
    // file.ts matches first (allow), so it returns that
    expect(result.rule.action).toBe("allow");
    expect(result.value).toBe("file.ts");
  });

  it("returns first value's result when all match defaults", () => {
    const result = evaluateFirst("unknown", ["a", "b"], []);
    expect(result.value).toBe("a");
    expect(result.rule.action).toBe("ask");
  });

  it("returns first match even if later values have stronger rules", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.ts", action: "allow", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
    ];
    const result = evaluateFirst("path", [".env", "file.ts"], rules);
    // .env is first, matches deny
    expect(result.rule.action).toBe("deny");
    expect(result.value).toBe(".env");
  });
});

// ── Slice 4: evaluateAnyValue ──────────────────────────────────────────

describe("evaluateAnyValue", () => {
  it("returns the last match across all values (last wins)", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.ts", action: "deny", origin: "builtin" },
      { surface: "path", pattern: "*.js", action: "allow", origin: "builtin" },
    ];
    const result = evaluateAnyValue("path", ["file.ts", "file.js"], rules);
    // file.ts matches deny, file.js matches allow; last matching rule wins
    expect(result.rule.action).toBe("allow");
    expect(result.value).toBe("file.js");
  });

  it("deny overrides allow when deny is later in rule order", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.js", action: "allow", origin: "builtin" },
      { surface: "path", pattern: "*.ts", action: "deny", origin: "builtin" },
    ];
    const result = evaluateAnyValue("path", ["file.ts", "file.js"], rules);
    // file.ts matches deny (last rule), file.js matches allow (first rule)
    // Last winning rule across all values: deny for *.ts
    expect(result.rule.action).toBe("deny");
    expect(result.value).toBe("file.ts");
  });

  it("returns default when no values match", () => {
    const result = evaluateAnyValue("path", ["file.py"], []);
    expect(result.rule.action).toBe("ask");
    expect(result.rule.origin).toBe("builtin");
  });

  it("finds match across multiple values with different surfaces", () => {
    const rules: Ruleset = [
      { surface: "bash", pattern: "rm *", action: "deny", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
    ];
    const result = evaluateAnyValue("path", ["readme.md", ".env"], rules);
    // .env matches deny on path surface
    expect(result.rule.action).toBe("deny");
    expect(result.value).toBe(".env");
  });
});

// ── Slice 5: evaluateMostRestrictive ─────────────────────────────────────

describe("evaluateMostRestrictive", () => {
  it("returns deny if any value matches deny", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*", action: "allow", origin: "builtin" },       // default
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },     // override (last wins)
    ];
    const result = evaluateMostRestrictive("path", ["readme.md", ".env"], rules);
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe("deny");
    expect(result!.value).toBe(".env");
  });

  it("returns ask if no deny but any is ask", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.md", action: "allow", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "ask", origin: "builtin" },
    ];
    const result = evaluateMostRestrictive("path", ["readme.md", ".env"], rules);
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe("ask");
  });

  it("returns allow if all are allow", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*", action: "allow", origin: "builtin" },
    ];
    const result = evaluateMostRestrictive("path", ["a.txt", "b.ts"], rules);
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe("allow");
  });

  it("short-circuits on deny (no further evaluation)", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.deny", action: "deny", origin: "builtin" },
      { surface: "path", pattern: "*.allow", action: "allow", origin: "builtin" },
    ];
    // Even if we check allow first, deny should win when it appears
    const result = evaluateMostRestrictive("path", ["file.allow", "file.deny"], rules);
    expect(result!.rule.action).toBe("deny");
  });

  it("returns null for empty values", () => {
    const result = evaluateMostRestrictive("path", [], []);
    expect(result).toBeNull();
  });
});

// ── Slice 6: composeRuleset ──────────────────────────────────────────────

describe("composeRuleset", () => {
  it("concatenates rulesets in order: defaults, baseline, config", () => {
    const defaults: Ruleset = [
      { surface: "*", pattern: "*", action: "ask", origin: "builtin" },
    ];
    const baseline: Ruleset = [
      { surface: "path", pattern: ".scratch/*", action: "allow", origin: "builtin" },
    ];
    const config: Ruleset = [
      { surface: "path", pattern: "*.env", action: "deny", origin: "project" },
    ];
    const result = composeRuleset(defaults, baseline, config);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(defaults[0]);
    expect(result[1]).toBe(baseline[0]);
    expect(result[2]).toBe(config[0]);
  });

  it("allows empty rulesets", () => {
    const result = composeRuleset([], [], []);
    expect(result).toEqual([]);
  });

  it("later rules override earlier ones in evaluation (last wins)", () => {
    const defaults: Ruleset = [
      { surface: "*", pattern: "*", action: "allow", origin: "builtin" },
    ];
    const config: Ruleset = [
      { surface: "*", pattern: "*", action: "deny", origin: "project" },
    ];
    const composed = composeRuleset(defaults, [], config);
    const result = evaluate("path", "anything", composed);
    expect(result.action).toBe("deny");
    expect(result.origin).toBe("project");
  });
});

// ── Slice 7: synthesizeDefaults ──────────────────────────────────────────

describe("synthesizeDefaults", () => {
  it("creates a single catch-all rule with given action", () => {
    const result = synthesizeDefaults("deny", "project");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      surface: "*",
      pattern: "*",
      action: "deny",
      layer: "default",
      origin: "project",
    });
  });

  it("defaults origin to builtin", () => {
    const result = synthesizeDefaults("allow");
    expect(result[0].origin).toBe("builtin");
  });
});

// ── Slice 8: rewriteAsksToYolo ───────────────────────────────────────────

describe("rewriteAsksToYolo", () => {
  it("converts all ask to allow", () => {
    const rules: Ruleset = [
      { surface: "*", pattern: "*", action: "ask", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
    ];
    const result = rewriteAsksToYolo(rules);
    expect(result[0].action).toBe("allow");
    expect(result[1].action).toBe("deny"); // unchanged
  });

  it("does not modify original rules", () => {
    const rules: Ruleset = [
      { surface: "*", pattern: "*", action: "ask", origin: "builtin" },
    ];
    const result = rewriteAsksToYolo(rules);
    expect(rules[0].action).toBe("ask"); // original unchanged
    expect(result[0].action).toBe("allow");
  });
});

// ── Slice 9: floorAllowsToAsk ────────────────────────────────────────────

describe("floorAllowsToAsk", () => {
  it("converts all allow to ask", () => {
    const rules: Ruleset = [
      { surface: "*", pattern: "*", action: "allow", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
    ];
    const result = floorAllowsToAsk(rules);
    expect(result[0].action).toBe("ask");
    expect(result[1].action).toBe("deny"); // unchanged
  });

  it("does not modify original rules", () => {
    const rules: Ruleset = [
      { surface: "*", pattern: "*", action: "allow", origin: "builtin" },
    ];
    const result = floorAllowsToAsk(rules);
    expect(rules[0].action).toBe("allow");
    expect(result[0].action).toBe("ask");
  });
});

// ── Slice 10: normalizeFlatConfig ────────────────────────────────────────

describe("normalizeFlatConfig", () => {
  it("converts string values to catch-all rules", () => {
    const result = normalizeFlatConfig({
      "*": "allow",
      path: "deny",
    });
    expect(result).toContainEqual({
      surface: "*",
      pattern: "*",
      action: "allow",
      origin: "config",
    });
    expect(result).toContainEqual({
      surface: "path",
      pattern: "*",
      action: "deny",
      origin: "config",
    });
  });

  it("converts object values to pattern-level rules", () => {
    const result = normalizeFlatConfig({
      path: {
        "*": "allow",
        "*.env": "deny",
      },
    });
    expect(result).toContainEqual({
      surface: "path",
      pattern: "*",
      action: "allow",
      origin: "config",
    });
    expect(result).toContainEqual({
      surface: "path",
      pattern: "*.env",
      action: "deny",
      origin: "config",
    });
  });

  it("handles DenyWithReason format", () => {
    const result = normalizeFlatConfig({
      path: {
        "*.env": { action: "deny", reason: "Sensitive environment file" },
      },
    });
    expect(result).toContainEqual({
      surface: "path",
      pattern: "*.env",
      action: "deny",
      reason: "Sensitive environment file",
      origin: "config",
    });
  });

  it("skips invalid entries silently", () => {
    const result = normalizeFlatConfig({
      path: {
        "*.ts": "allow",
        "*.invalid": 123, // Invalid value type
      },
    } as any);
    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe("*.ts");
  });

  it("handles empty config", () => {
    const result = normalizeFlatConfig({});
    expect(result).toEqual([]);
  });

  it("handles config with non-object surface values", () => {
    const result = normalizeFlatConfig({
      "*": "allow",
      path: {
        "*.env": "deny",
      },
    });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("default action (*) is placed first in the output", () => {
    const result = normalizeFlatConfig({
      "*": "deny",
      path: {
        "*.md": "allow",
      },
    });
    // The first rule should be the default with surface "*"
    expect(result[0].surface).toBe("*");
    expect(result[0].pattern).toBe("*");
    expect(result[0].action).toBe("deny");
  });
});
