import { describe, it, expect } from "vitest";
import { classifyPlanModeTool, isSafeCommand, isPathAllowed } from "./tool-policy.ts";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBuiltinTool(name: string): ToolInfo {
  return {
    name,
    description: "",
    parameters: undefined as any,
    promptGuidelines: undefined as any,
    sourceInfo: { path: "", source: "pi", scope: "user", origin: "package" },
  };
}

function makeCustomTool(name: string): ToolInfo {
  return {
    name,
    description: "",
    parameters: undefined as any,
    promptGuidelines: undefined as any,
    sourceInfo: { path: "", source: "user", scope: "user", origin: "package" },
  };
}

// ── classifyPlanModeTool ────────────────────────────────────────────────────

describe("classifyPlanModeTool", () => {
  it("classifies read as read-only", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("read"))).toBe("read-only");
  });

  it("classifies grep as read-only", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("grep"))).toBe("read-only");
  });

  it("classifies find as read-only", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("find"))).toBe("read-only");
  });

  it("classifies ls as read-only", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("ls"))).toBe("read-only");
  });

  it("classifies bash as limited", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("bash"))).toBe("limited");
  });

  it("classifies write as allowlisted", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("write"))).toBe("allowlisted");
  });

  it("classifies replace as allowlisted", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("replace"))).toBe("allowlisted");
  });

  it("classifies edit as blocked", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("edit"))).toBe("blocked");
  });

  it("classifies update_plan as blocked", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("update_plan"))).toBe("blocked");
  });

  it("classifies custom tool as user-opt-in", () => {
    expect(classifyPlanModeTool(makeCustomTool("my-tool"))).toBe("user-opt-in");
  });

  it("classifies unknown built-in tool as blocked", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("subagent"))).toBe("blocked");
  });

  it("classifies ffgrep as read-only", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("ffgrep"))).toBe("read-only");
  });

  it("classifies fffind as read-only", () => {
    expect(classifyPlanModeTool(makeBuiltinTool("fffind"))).toBe("read-only");
  });
});

// ── isSafeCommand ──────────────────────────────────────────────────────────

describe("isSafeCommand", () => {
  it("allows known readonly command: cat", () => {
    expect(isSafeCommand("cat file.txt")).toBe(true);
  });

  it("allows known readonly command: ls", () => {
    expect(isSafeCommand("ls -la")).toBe(true);
  });

  it("allows known readonly command: head", () => {
    expect(isSafeCommand("head -n 20 file.log")).toBe(true);
  });

  it("blocks dangerous command: rm", () => {
    expect(isSafeCommand("rm -rf /tmp")).toBe(false);
  });

  it("blocks dangerous command: mv", () => {
    expect(isSafeCommand("mv old new")).toBe(false);
  });

  it("blocks dangerous command: cp", () => {
    expect(isSafeCommand("cp src dest")).toBe(false);
  });

  it("blocks shell expansion: $", () => {
    expect(isSafeCommand("echo $HOME")).toBe(false);
  });

  it("blocks shell expansion: backtick", () => {
    expect(isSafeCommand("echo \`pwd\`")).toBe(false);
  });

  it("blocks shell expansion: glob *", () => {
    expect(isSafeCommand("ls *.txt")).toBe(false);
  });

  it("blocks redirect to file: >", () => {
    expect(isSafeCommand("echo hello > out.txt")).toBe(false);
  });

  it("allows redirect to /dev/null", () => {
    expect(isSafeCommand("ls 2>/dev/null")).toBe(true);
  });

  it("allows redirect to &N fd", () => {
    expect(isSafeCommand("ls 2>&1")).toBe(true);
  });

  it("allows git status", () => {
    expect(isSafeCommand("git status")).toBe(true);
  });

  it("allows git diff", () => {
    expect(isSafeCommand("git diff --cached")).toBe(true);
  });

  it("allows git log", () => {
    expect(isSafeCommand("git log --oneline -5")).toBe(true);
  });

  it("blocks git commit", () => {
    expect(isSafeCommand("git commit -m 'x'")).toBe(false);
  });

  it("blocks git push", () => {
    expect(isSafeCommand("git push origin main")).toBe(false);
  });

  it("allows npm test", () => {
    expect(isSafeCommand("npm test")).toBe(true);
  });

  it("blocks npm install", () => {
    expect(isSafeCommand("npm install foo")).toBe(false);
  });

  it("allows npx tsc --noEmit", () => {
    expect(isSafeCommand("npx tsc --noEmit")).toBe(true);
  });

  it("blocks command with newline", () => {
    expect(isSafeCommand("echo hello\necho world")).toBe(false);
  });

  it("blocks command with backtick subshell", () => {
    expect(isSafeCommand("echo \`whoami\`")).toBe(false);
  });

  it("blocks env var assignment", () => {
    expect(isSafeCommand("NODE_ENV=production node app.js")).toBe(false);
  });

  it("blocks unknown command (conservative default)", () => {
    expect(isSafeCommand("some-unknown-command")).toBe(false);
  });

  it("allows empty passthrough command: rtk", () => {
    // rtk is a passthrough wrapper; with no inner command it's safe
    expect(isSafeCommand("rtk")).toBe(true);
  });

  it("allows gh pr view", () => {
    expect(isSafeCommand("gh pr view 123")).toBe(true);
  });

  it("allows cargo test", () => {
    expect(isSafeCommand("cargo test")).toBe(true);
  });

  it("allows go vet", () => {
    expect(isSafeCommand("go vet ./...")).toBe(true);
  });

  it("blocks compound command with unsafe segment", () => {
    expect(isSafeCommand("cat file && rm -rf /")).toBe(false);
  });

  it("allows compound command with all safe segments", () => {
    expect(isSafeCommand("cat file && ls -la")).toBe(true);
  });

  it("allows pipeline with safe commands", () => {
    expect(isSafeCommand("cat file | grep pattern")).toBe(true);
  });

  it("allows pipeline with sed (no -i is safe)", () => {
    expect(isSafeCommand("cat file | sed 's/a/b/'")).toBe(true);
  });

  it("allows jest command", () => {
    expect(isSafeCommand("jest --coverage")).toBe(true);
  });

  it("allows vitest run", () => {
    expect(isSafeCommand("vitest run")).toBe(true);
  });

  it("allows pytest", () => {
    expect(isSafeCommand("pytest tests/")).toBe(true);
  });

  it("blocks sed with -i flag", () => {
    expect(isSafeCommand("sed -i 's/a/b/g' file.txt")).toBe(false);
  });

  it("allows sed without -i flag", () => {
    expect(isSafeCommand("sed -n 's/a/b/p' file.txt")).toBe(true);
  });

  it("blocks subagent (unknown built-in)", () => {
    expect(isSafeCommand("subagent")).toBe(false);
  });

  it("blocks command with < input redirect", () => {
    expect(isSafeCommand("sort < input.txt")).toBe(false);
  });


  it("blocks standalone & (non-&&)", () => {
    expect(isSafeCommand("cmd &")).toBe(false);
  });

  it("allows git stash list", () => {
    expect(isSafeCommand("git stash list")).toBe(true);
  });

  it("blocks git stash push", () => {
    expect(isSafeCommand("git stash push -m wip")).toBe(false);
  });

  it("blocks git grep", () => {
    expect(isSafeCommand("git grep TODO")).toBe(false);
  });

  it("blocks git remote", () => {
    expect(isSafeCommand("git remote -v")).toBe(false);
  });

  it("allows gh issue view", () => {
    expect(isSafeCommand("gh issue view 42")).toBe(true);
  });

  it("allows gh issue list", () => {
    expect(isSafeCommand("gh issue list --state open")).toBe(true);
  });

  it("allows gh search repos", () => {
    expect(isSafeCommand("gh search repos guard")).toBe(true);
  });

  it("allows gh repo view", () => {
    expect(isSafeCommand("gh repo view owner/name")).toBe(true);
  });

  it("allows gh auth status", () => {
    expect(isSafeCommand("gh auth status")).toBe(true);
  });

  it("blocks gh pr merge", () => {
    expect(isSafeCommand("gh pr merge 218")).toBe(false);
  });

  it("allows npx tsc bare", () => {
    expect(isSafeCommand("npx tsc")).toBe(true);
  });

  it("allows npx tsc --pretty", () => {
    expect(isSafeCommand("npx tsc --pretty false")).toBe(true);
  });

  it("allows npm run lint", () => {
    expect(isSafeCommand("npm run lint")).toBe(true);
  });

  it("allows npm outdated", () => {
    expect(isSafeCommand("npm outdated")).toBe(true);
  });

  it("allows npm audit", () => {
    expect(isSafeCommand("npm audit --audit-level high")).toBe(true);
  });
});

// ── isPathAllowed ─────────────────────────────────────────────────────────

describe("isPathAllowed", () => {
  it("allows .scratch/ prefix path", () => {
    expect(isPathAllowed(".scratch/foo/bar.md")).toBe(true);
  });

  it("allows docs/ prefix path", () => {
    expect(isPathAllowed("docs/adr/0001-decision.md")).toBe(true);
  });

  it("allows CONTEXT.md exact", () => {
    expect(isPathAllowed("CONTEXT.md")).toBe(true);
  });

  it("allows ./CONTEXT.md with leading dot slash", () => {
    expect(isPathAllowed("./CONTEXT.md")).toBe(true);
  });

  it("blocks src/main.ts", () => {
    expect(isPathAllowed("src/main.ts")).toBe(false);
  });

  it("blocks package.json", () => {
    expect(isPathAllowed("package.json")).toBe(false);
  });

  it("allows nested .scratch/ subpath", () => {
    expect(isPathAllowed("/home/user/project/.scratch/ticket.md")).toBe(true);
  });

  it("allows nested docs/ subpath", () => {
    expect(isPathAllowed("/home/user/project/docs/adr/001.md")).toBe(true);
  });

  it("blocks absolute path outside allowlist", () => {
    expect(isPathAllowed("/home/user/project/src/main.ts")).toBe(false);
  });

  it("respects custom allowlist", () => {
    expect(isPathAllowed("src/main.ts", ["src/"])).toBe(true);
  });

  it("blocks path not in custom allowlist", () => {
    expect(isPathAllowed("dist/bundle.js", ["src/"])).toBe(false);
  });

  it("treats empty string as not allowed", () => {
    expect(isPathAllowed("")).toBe(false);
  });

  it("matches CONTEXT.md as suffix", () => {
    expect(isPathAllowed("/abs/path/to/CONTEXT.md")).toBe(true);
  });

  it("allows docs/ as directory prefix via relative path with ./", () => {
    expect(isPathAllowed("./docs/something.md")).toBe(true);
  });

  it("expands ~ to home directory before matching", () => {
    const { homedir } = require("node:os");
    expect(isPathAllowed("~/project/.scratch/ticket.md")).toBe(true);
    expect(isPathAllowed(homedir() + "/.scratch/ticket.md")).toBe(true);
  });

  it("blocks ~ path outside allowlist", () => {
    expect(isPathAllowed("~/project/src/main.ts")).toBe(false);
  });
});

