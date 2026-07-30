import { describe, it, expect } from "vitest";
import { extractTextContent, createStateMachine, DEFAULT_TARGET_SKILLS } from "./guard.ts";

// ── Slice 1: helpers + skeleton ───────────────────────────────────────

describe("extractTextContent", () => {
  it("returns a plain string as-is", () => {
    expect(extractTextContent("hello")).toBe("hello");
  });

  it("extracts first text from an array of content parts", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];
    expect(extractTextContent(content)).toBe("first");
  });

  it("returns undefined for empty array", () => {
    expect(extractTextContent([])).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(extractTextContent(null)).toBeUndefined();
  });

  it("returns undefined for non-text content", () => {
    const content = [{ type: "image", source: { data: "abc" } }];
    expect(extractTextContent(content)).toBeUndefined();
  });
});

describe("createStateMachine", () => {
  it("starts in normal state", () => {
    const g = createStateMachine();
    expect(g.getState()).toBe("normal");
  });

  it("rule engine is not active by default", () => {
    const g = createStateMachine();
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("detects target skill commands with isTargetSkill", () => {
    const g = createStateMachine();
    expect(g.isTargetSkill("/skill:to-spec")).toBe(true);
    expect(g.isTargetSkill("/skill:grill-me")).toBe(true);
    expect(g.isTargetSkill("hello world")).toBe(false);
    expect(g.isTargetSkill("/skill:unknown")).toBe(false);
  });

  it("detects target skill via XML <skill name=...> tag", () => {
    const g = createStateMachine();
    // XML double-quoted tag
    expect(g.isTargetSkill('<skill name="to-spec">')).toBe(true);
    // XML single-quoted tag
    expect(g.isTargetSkill("<skill name='grill-me'>")).toBe(true);
    // XML tag with extra attributes
    expect(g.isTargetSkill('<skill name="grill-with-docs" location="...">')).toBe(true);
    // Self-closing tag
    expect(g.isTargetSkill('<skill name="wayfinder" />')).toBe(true);
    // Non-target skill in XML tag
    expect(g.isTargetSkill('<skill name="unknown">')).toBe(false);
    // Plain text - no match
    expect(g.isTargetSkill("plain text")).toBe(false);
  });

  it("detects XML skill tag embedded in larger message text", () => {
    const g = createStateMachine();
    const message = `<skill name="grill-with-docs" location="/home/.../SKILL.md">
References are relative to ...

Run a /grilling session.
</skill>

将模板文件追加到订阅文件`;
    expect(g.isTargetSkill(message)).toBe(true);
  });

  it("transitions to skill_active on target skill input", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    expect(g.getState()).toBe("skill_active");
  });

  it("stays normal on non-target input", () => {
    const g = createStateMachine();
    g.handleInput("hello world");
    expect(g.getState()).toBe("normal");
  });

  it("transitions to skill_active via XML <skill name=...> tag", () => {
    const g = createStateMachine();
    g.handleInput('<skill name="to-spec">');
    expect(g.getState()).toBe("skill_active");
  });

  it("transitions to skill_active via XML tag with extra attributes", () => {
    const g = createStateMachine();
    g.handleInput('<skill name="grill-with-docs" location="/path/to/SKILL.md">');
    expect(g.getState()).toBe("skill_active");
  });

  it("transitions to skill_active via multiline XML skill message", () => {
    const g = createStateMachine();
    const message = `<skill name="grill-with-docs" location="/home/.../SKILL.md">
References are relative to ...

Run a /grilling session.
</skill>

将模板文件追加到订阅文件`;
    g.handleInput(message);
    expect(g.getState()).toBe("skill_active");
  });

  it("full flow: XML skill tag → agent_settled → rule engine activated with autoActivateAfterSkill default", () => {
    const g = createStateMachine();
    expect(g.isRuleEngineActive()).toBe(false);

    g.handleInput('<skill name="to-spec">');
    expect(g.getState()).toBe("skill_active");

    g.handleAgentSettled();
    // Default autoActivateAfterSkill is true, so rule engine should activate
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(true);
  });

  it("does not activate rule engine on agent_settled when autoActivateAfterSkill is false", () => {
    const g = createStateMachine({ autoActivateAfterSkill: false });
    g.handleInput("/skill:to-spec");
    expect(g.getState()).toBe("skill_active");

    g.handleAgentSettled();
    // autoActivateAfterSkill is false, so rule engine should NOT activate
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("does nothing on agent_settled from normal state", () => {
    const g = createStateMachine();
    g.handleAgentSettled();
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("stays on skill_active after handleAgentSettled when autoActivateAfterSkill is false", () => {
    // With autoActivateAfterSkill: false, handleAgentSettled does nothing (stays skill_active)
    const g = createStateMachine({ autoActivateAfterSkill: false });
    g.handleInput("/skill:to-spec");
    expect(g.getState()).toBe("skill_active");

    g.handleAgentSettled();
    // agent_settled with autoActivateAfterSkill: false — goes to normal, no rule engine
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("handleAllow transitions to normal and deactivates rule engine", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    g.handleAgentSettled();
    expect(g.isRuleEngineActive()).toBe(true);

    g.handleAllow();
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("handleAllow from normal state does nothing", () => {
    const g = createStateMachine();
    g.handleAllow();
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("reset returns to normal and deactivates rule engine", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    g.handleAgentSettled();
    expect(g.isRuleEngineActive()).toBe(true);

    g.reset();
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("transitions from rule engine active to skill_active on another target skill", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    g.handleAgentSettled();
    expect(g.isRuleEngineActive()).toBe(true);

    g.handleInput("/skill:grill-me");
    expect(g.getState()).toBe("skill_active");
    // Rule engine should be deactivated when entering skill_active
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("activateRuleEngine / deactivateRuleEngine work independently of state", () => {
    const g = createStateMachine();
    expect(g.isRuleEngineActive()).toBe(false);

    g.activateRuleEngine();
    expect(g.isRuleEngineActive()).toBe(true);

    g.deactivateRuleEngine();
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("multiple activations don't change state", () => {
    const g = createStateMachine();
    g.activateRuleEngine();
    g.activateRuleEngine();
    expect(g.isRuleEngineActive()).toBe(true);

    g.deactivateRuleEngine();
    expect(g.isRuleEngineActive()).toBe(false);
  });

  // ── Session history rebuild ─────────────────────────────────────────────

  it("rebuildFromHistory sets rule engine active when user entry contains target skill", () => {
    const g = createStateMachine();
    const entries = [
      { role: "user" as const, content: "/skill:to-spec" },
    ];
    g.rebuildFromHistory(entries);
    expect(g.isRuleEngineActive()).toBe(true);
    expect(g.getState()).toBe("normal");
  });

  it("rebuildFromHistory stays normal when no target skill found", () => {
    const g = createStateMachine();
    const entries = [
      { role: "user" as const, content: "hello world" },
      { role: "assistant" as const, content: "hi" },
    ];
    g.rebuildFromHistory(entries);
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("rebuildFromHistory ignores assistant entries", () => {
    const g = createStateMachine();
    const entries = [
      { role: "assistant" as const, content: "/skill:to-spec" },
    ];
    g.rebuildFromHistory(entries);
    expect(g.getState()).toBe("normal");
    expect(g.isRuleEngineActive()).toBe(false);
  });

  it("rebuildFromHistory parses content array parts", () => {
    const g = createStateMachine();
    const entries = [
      {
        role: "user" as const,
        content: [{ type: "text", text: "/skill:grill-me" }],
      },
    ];
    g.rebuildFromHistory(entries);
    expect(g.isRuleEngineActive()).toBe(true);
  });

  it("rebuildFromHistory handles SessionMessageEntry shape", () => {
    const g = createStateMachine();
    const entries = [
      {
        type: "message",
        id: "123",
        parentId: null,
        timestamp: "2024-01-01T00:00:00Z",
        message: {
          role: "user",
          content: "/skill:to-spec",
        },
      },
    ];
    g.rebuildFromHistory(entries);
    expect(g.isRuleEngineActive()).toBe(true);
  });

  it("rebuildFromHistory handles SessionMessageEntry with content array", () => {
    const g = createStateMachine();
    const entries = [
      {
        type: "message",
        id: "456",
        parentId: null,
        timestamp: "2024-01-01T00:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "/skill:grill-me" }],
        },
      },
    ];
    g.rebuildFromHistory(entries);
    expect(g.isRuleEngineActive()).toBe(true);
  });

  // ── Custom target skills ────────────────────────────────────────────────

  it("accepts custom target skills", () => {
    const g = createStateMachine({ targetSkills: ["my-skill", "other"] });
    expect(g.isTargetSkill("/skill:my-skill")).toBe(true);
    expect(g.isTargetSkill("/skill:other")).toBe(true);
    expect(g.isTargetSkill("/skill:to-spec")).toBe(false);
  });

  it("DEFAULT_TARGET_SKILLS contains the 6 expected skills", () => {
    expect(DEFAULT_TARGET_SKILLS).toEqual([
      "to-spec",
      "to-tickets",
      "grill-me",
      "grill-with-docs",
      "wayfinder",
      "grilling",
    ]);
  });
});
