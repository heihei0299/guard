import { describe, it, expect } from "vitest";
import { extractTextContent, createStateMachine, DEFAULT_TARGET_SKILLS, DEFAULT_ALLOW_WRITE_PATHS } from "./guard.ts";

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
  it("starts in normal state and is not blocking", () => {
    const g = createStateMachine();
    expect(g.getState()).toBe("normal");
    expect(g.isBlocking()).toBe(false);
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
    expect(g.isTargetSkill('plain text')).toBe(false);
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

  it("full flow: XML skill tag → guarded after agent_settled", () => {
    const g = createStateMachine();
    g.handleInput('<skill name="to-spec">');
    expect(g.getState()).toBe("skill_active");
    g.handleAgentSettled();
    expect(g.getState()).toBe("guarded");
    expect(g.isBlocking()).toBe(true);
  });

  it("transitions from skill_active to guarded on agent_settled", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    expect(g.getState()).toBe("skill_active");
    g.handleAgentSettled();
    expect(g.getState()).toBe("guarded");
    expect(g.isBlocking()).toBe(true);
  });

  it("does nothing on agent_settled from normal state", () => {
    const g = createStateMachine();
    g.handleAgentSettled();
    expect(g.getState()).toBe("normal");
  });

  it("does nothing on agent_settled from guarded state", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    g.handleAgentSettled();
    expect(g.getState()).toBe("guarded");
    g.handleAgentSettled();
    expect(g.getState()).toBe("guarded");
  });

  it("transitions from guarded to skill_active on another target skill", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    g.handleAgentSettled();
    expect(g.getState()).toBe("guarded");
    g.handleInput("/skill:grill-me");
    expect(g.getState()).toBe("skill_active");
  });

  it("handleAllow transitions to normal from any state", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    g.handleAgentSettled();
    expect(g.getState()).toBe("guarded");
    g.handleAllow();
    expect(g.getState()).toBe("normal");
    expect(g.isBlocking()).toBe(false);
  });

  it("reset returns to normal and stops blocking", () => {
    const g = createStateMachine();
    g.handleInput("/skill:to-spec");
    g.handleAgentSettled();
    expect(g.getState()).toBe("guarded");
    g.reset();
    expect(g.getState()).toBe("normal");
    expect(g.isBlocking()).toBe(false);
  });

  it("isBlocking returns true in skill_active state (BUG: currently false)", () => {
    const g = createStateMachine();
    expect(g.isBlocking()).toBe(false); // normal
    g.handleInput("/skill:grill-with-docs");
    expect(g.getState()).toBe("skill_active");
    // BUG: isBlocking() should be true in skill_active —
    // otherwise the model writes code in the same turn as skill invocation.
    expect(g.isBlocking()).toBe(true);
  });

  // ── Session history rebuild ─────────────────────────────────────────────

  it("rebuildFromHistory sets guarded when user entry contains target skill", () => {
    const g = createStateMachine();
    const entries = [
      { role: "user" as const, content: "/skill:to-spec" },
    ];
    g.rebuildFromHistory(entries);
    expect(g.getState()).toBe("guarded");
  });

  it("rebuildFromHistory stays normal when no target skill found", () => {
    const g = createStateMachine();
    const entries = [
      { role: "user" as const, content: "hello world" },
      { role: "assistant" as const, content: "hi" },
    ];
    g.rebuildFromHistory(entries);
    expect(g.getState()).toBe("normal");
  });

  it("rebuildFromHistory ignores assistant entries", () => {
    const g = createStateMachine();
    const entries = [
      { role: "assistant" as const, content: "/skill:to-spec" },
    ];
    g.rebuildFromHistory(entries);
    expect(g.getState()).toBe("normal");
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
    expect(g.getState()).toBe("guarded");
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
    expect(g.getState()).toBe("guarded");
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
    expect(g.getState()).toBe("guarded");
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

// ── Slice 2: path allowlist ──────────────────────────────────────────

describe("DEFAULT_ALLOW_WRITE_PATHS", () => {
  it("contains .scratch/, docs/, and CONTEXT.md", () => {
    expect(DEFAULT_ALLOW_WRITE_PATHS).toEqual([
      ".scratch/",
      "docs/",
      "CONTEXT.md",
    ]);
  });
});

describe("isPathAllowed", () => {
  it("allows paths under .scratch/ directory prefix", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed(".scratch/test.txt")).toBe(true);
    expect(g.isPathAllowed(".scratch/sub/dir/file.ts")).toBe(true);
  });

  it("allows paths under docs/ directory prefix", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("docs/guide.md")).toBe(true);
    expect(g.isPathAllowed("docs/api/README.md")).toBe(true);
  });

  it("allows CONTEXT.md exact match", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("CONTEXT.md")).toBe(true);
  });

  it("rejects paths outside allowlist", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("src/index.ts")).toBe(false);
    expect(g.isPathAllowed("package.json")).toBe(false);
    expect(g.isPathAllowed("lib/utils.ts")).toBe(false);
  });

  it("normalizes ./ prefix before matching", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("./.scratch/test.txt")).toBe(true);
    expect(g.isPathAllowed("./docs/guide.md")).toBe(true);
    expect(g.isPathAllowed("./CONTEXT.md")).toBe(true);
    expect(g.isPathAllowed("./src/index.ts")).toBe(false);
  });

  it("does not partially match file names", () => {
    const g = createStateMachine();
    // CONTEXT.md should match exactly, not .md files
    expect(g.isPathAllowed("README.md")).toBe(false);
    expect(g.isPathAllowed("docs.md")).toBe(false);
  });

  it("does not partially match directory prefixes", () => {
    const g = createStateMachine();
    // .scratch-other/ should not match .scratch/
    expect(g.isPathAllowed(".scratch-other/file.ts")).toBe(false);
    expect(g.isPathAllowed("documentation/guide.md")).toBe(false);
  });

  it("expands ~ to home directory for CONTEXT.md matching", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("~/Project/CONTEXT.md")).toBe(true);
    expect(g.isPathAllowed("~/Project/Pi/ri/CONTEXT.md")).toBe(true);
  });

  it("allows CONTEXT.md via suffix match for cross-project paths", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("ri/CONTEXT.md")).toBe(true);
    expect(g.isPathAllowed("./ri/CONTEXT.md")).toBe(true);
    expect(g.isPathAllowed("src/utils/CONTEXT.md")).toBe(true);
  });

  it("still rejects CONTEXT.md.bak and similar variants", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("CONTEXT.md.bak")).toBe(false);
    expect(g.isPathAllowed("CONTEXT.md.tmp")).toBe(false);
    expect(g.isPathAllowed("backup-CONTEXT.md")).toBe(false);
  });

  it("expands ~ to home directory for docs/ paths", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("~/Project/docs/guide.md")).toBe(true);
    expect(g.isPathAllowed("~/Project/Pi/ri/docs/1.md")).toBe(true);
    expect(g.isPathAllowed("~/Project/Pi/ri/docs/adr/2.md")).toBe(true);
  });

  it("expands ~ to home directory for .scratch/ paths", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("~/Project/.scratch/notes.txt")).toBe(true);
    expect(g.isPathAllowed("~/Project/Pi/ri/.scratch/3.md")).toBe(true);
  });

  it("allows absolute paths containing docs/ via subpath match", () => {
    const g = createStateMachine();
    expect(g.isPathAllowed("/home/user/project/docs/guide.md")).toBe(true);
    expect(g.isPathAllowed("/home/user/project/.scratch/tmp.txt")).toBe(true);
    expect(g.isPathAllowed("/home/user/project/docs/sub/file.md")).toBe(true);
  });

  it("does not false-match subpath on similar directory names", () => {
    const g = createStateMachine();
    // directory prefix "docs/" should not match "documentation/" or "custom-docs/"
    expect(g.isPathAllowed("documentation/guide.md")).toBe(false);
    expect(g.isPathAllowed("/home/user/custom-docs/file.md")).toBe(false);
    expect(g.isPathAllowed("/home/user/scratchwork/tmp.txt")).toBe(false);
  });

  it("accepts custom allowWritePaths in options", () => {
    const g = createStateMachine({ allowWritePaths: ["custom/", "special.txt"] });
    expect(g.isPathAllowed("custom/file.ts")).toBe(true);
    expect(g.isPathAllowed("special.txt")).toBe(true);
    expect(g.isPathAllowed(".scratch/test.txt")).toBe(false);
    expect(g.isPathAllowed("docs/guide.md")).toBe(false);
  });
});
