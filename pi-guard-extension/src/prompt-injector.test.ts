import { describe, it, expect } from "vitest";
import { buildGuardPrompt } from "./prompt-injector.ts";
import type { Ruleset } from "./rule-engine.ts";

describe("buildGuardPrompt", () => {
  it("returns a string with header, summary, config, and notes sections", () => {
    const rules: Ruleset = [
      { surface: "*", pattern: "*", action: "allow", origin: "builtin" },
    ];
    const result = buildGuardPrompt(rules);
    expect(result).toContain("Guard 规则已激活");
    expect(result).toContain("规则摘要");
    expect(result).toContain("完整配置");
    expect(result).toContain("约束说明");
  });

  it("includes /guard:allow exit hint in header", () => {
    const result = buildGuardPrompt([]);
    expect(result).toContain("/guard:allow");
  });

  it("summarizes allow rules", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "docs/*", action: "allow", origin: "builtin" },
    ];
    const result = buildGuardPrompt(rules);
    expect(result).toContain("允许");
    expect(result).toContain("docs/");
  });

  it("summarizes ask rules", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "src/*", action: "ask", origin: "builtin" },
    ];
    const result = buildGuardPrompt(rules);
    expect(result).toContain("需要用户确认");
  });

  it("summarizes deny rules", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
    ];
    const result = buildGuardPrompt(rules);
    expect(result).toContain("禁止");
    expect(result).toContain(".env");
  });

  it("includes reason in summary when provided", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin", reason: "Sensitive environment file" },
    ];
    const result = buildGuardPrompt(rules);
    expect(result).toContain("Sensitive environment file");
  });

  it("includes JSON config section with rules", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "*.ts", action: "allow", origin: "config" },
    ];
    const result = buildGuardPrompt(rules);
    expect(result).toContain('"path"');
    expect(result).toContain('"*.ts"');
    expect(result).toContain('"allow"');
  });

  it("includes constraint notes for deny and ask", () => {
    const rules: Ruleset = [
      { surface: "*", pattern: "*", action: "ask", origin: "builtin" },
    ];
    const result = buildGuardPrompt(rules);
    expect(result).toContain("deny");
    expect(result).toContain("ask");
    expect(result).toContain("确认对话框");
  });

  it("handles empty ruleset with default message", () => {
    const result = buildGuardPrompt([]);
    // Empty ruleset should still produce a valid prompt structure
    expect(result).toContain("规则摘要");
    expect(result).toContain("完整配置");
  });

  it("groups rules by surface in summary", () => {
    const rules: Ruleset = [
      { surface: "path", pattern: "docs/*", action: "allow", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
      { surface: "bash", pattern: "rm -rf *", action: "deny", origin: "builtin" },
    ];
    const result = buildGuardPrompt(rules);
    // Should mention each surface
    expect(result).toContain("path");
    expect(result).toContain("bash");
  });

  it("shows default strategy (*) separately", () => {
    const rules: Ruleset = [
      { surface: "*", pattern: "*", action: "allow", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
    ];
    const result = buildGuardPrompt(rules);
    expect(result).toContain("默认");
    expect(result).toContain("allow");
  });

  it("formats multi-surface rules correctly", () => {
    const rules: Ruleset = [
      { surface: "*", pattern: "*", action: "allow", origin: "builtin" },
      { surface: "path", pattern: "*.env", action: "deny", origin: "builtin" },
      { surface: "bash", pattern: "rm -rf *", action: "deny", origin: "builtin" },
    ];
    const result = buildGuardPrompt(rules);
    // The result should be a well-formed multi-line string
    expect(result.split("\n").length).toBeGreaterThan(5);
  });
});
