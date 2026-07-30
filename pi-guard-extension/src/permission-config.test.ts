import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock file system ─────────────────────────────────────────────────────

// Use vi.hoisted to create shared mutable state
const mockFiles = vi.hoisted(() => new Map<string, string | null>());

// Mock fs module (hoisted by vitest)
vi.mock("fs", () => ({
  existsSync: vi.fn((path: string) => {
    const val = mockFiles.get(path);
    return val !== undefined && val !== null;
  }),
  readFileSync: vi.fn((path: string, _encoding?: string) => {
    const val = mockFiles.get(path);
    if (val === undefined || val === null) {
      throw new Error("ENOENT: no such file or directory");
    }
    return val;
  }),
}));

function setMockFile(path: string, content: string | null) {
  mockFiles.set(path, content);
}

function clearMockFiles() {
  mockFiles.clear();
}

import { loadPermissionConfig } from "./permission-config.ts";

describe("loadPermissionConfig", () => {
  beforeEach(() => {
    clearMockFiles();
  });

  it("returns empty objects when no config files exist", () => {
    const result = loadPermissionConfig("/project");
    expect(result).toEqual({ global: {}, project: {} });
  });

  it("loads global config from ~/.pi/agent/extensions/pi-guard/config.json", () => {
    const globalPath = process.env.HOME + "/.pi/agent/extensions/pi-guard/config.json";
    setMockFile(globalPath, JSON.stringify({
      permission: {
        "*": "ask",
        path: { "*.env": "deny" },
      },
    }));

    const result = loadPermissionConfig("/project");
    expect(result.global).toEqual({
      permission: {
        "*": "ask",
        path: { "*.env": "deny" },
      },
    });
    expect(result.project).toEqual({});
  });

  it("loads project config from <projectRoot>/.pi/pi-guard.json", () => {
    const projectPath = "/project/.pi/pi-guard.json";
    setMockFile(projectPath, JSON.stringify({
      permission: {
        "*": "allow",
        path: { "*.ts": "allow" },
      },
      autoActivateAfterSkill: false,
    }));

    const result = loadPermissionConfig("/project");
    expect(result.project).toEqual({
      permission: {
        "*": "allow",
        path: { "*.ts": "allow" },
      },
      autoActivateAfterSkill: false,
    });
    expect(result.global).toEqual({});
  });

  it("returns empty object for malformed JSON, without throwing", () => {
    const globalPath = process.env.HOME + "/.pi/agent/extensions/pi-guard/config.json";
    setMockFile(globalPath, "this is not json");

    const result = loadPermissionConfig("/project");
    expect(result.global).toEqual({});
  });

  it("loads both global and project config when both exist", () => {
    const globalPath = process.env.HOME + "/.pi/agent/extensions/pi-guard/config.json";
    const projectPath = "/project/.pi/pi-guard.json";
    setMockFile(globalPath, JSON.stringify({
      permission: { "*": "ask" },
    }));
    setMockFile(projectPath, JSON.stringify({
      permission: { path: { "*.env": "deny" } },
      autoActivateAfterSkill: true,
    }));

    const result = loadPermissionConfig("/project");
    expect(result.global).toEqual({ permission: { "*": "ask" } });
    expect(result.project).toEqual({
      permission: { path: { "*.env": "deny" } },
      autoActivateAfterSkill: true,
    });
  });

  it("returns empty project config when projectRoot is not provided", () => {
    const globalPath = process.env.HOME + "/.pi/agent/extensions/pi-guard/config.json";
    setMockFile(globalPath, JSON.stringify({
      permission: { "*": "allow" },
    }));

    const result = loadPermissionConfig();
    expect(result.global).toEqual({ permission: { "*": "allow" } });
    expect(result.project).toEqual({});
  });

  it("returns empty objects when only project path exists but not global", () => {
    const projectPath = "/project/.pi/pi-guard.json";
    setMockFile(projectPath, JSON.stringify({
      permission: { "*": "deny" },
    }));

    const result = loadPermissionConfig("/project");
    expect(result.global).toEqual({});
    expect(result.project).toEqual({ permission: { "*": "deny" } });
  });
});
