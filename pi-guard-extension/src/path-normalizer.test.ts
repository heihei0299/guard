import { describe, it, expect } from "vitest";
import { expandHomePath, normalizePathPolicyLiteral, getPathPolicyValues } from "./path-normalizer.ts";

describe("expandHomePath", () => {
  it("expands ~/ to home directory", () => {
    const home = process.env.HOME || "/home/user";
    expect(expandHomePath("~/docs/file.md")).toBe(`${home}/docs/file.md`);
  });

  it("expands standalone ~ to home directory", () => {
    const home = process.env.HOME || "/home/user";
    expect(expandHomePath("~")).toBe(home);
  });

  it("expands $HOME/ to home directory", () => {
    const home = process.env.HOME || "/home/user";
    expect(expandHomePath("$HOME/docs/file.md")).toBe(`${home}/docs/file.md`);
  });

  it("expands standalone $HOME to home directory", () => {
    const home = process.env.HOME || "/home/user";
    expect(expandHomePath("$HOME")).toBe(home);
  });

  it("returns path unchanged if no expansion needed", () => {
    expect(expandHomePath("/absolute/path")).toBe("/absolute/path");
    expect(expandHomePath("relative/path")).toBe("relative/path");
    expect(expandHomePath(".scratch/file.ts")).toBe(".scratch/file.ts");
  });

  it("does not expand ~ when not at start", () => {
    expect(expandHomePath("foo~/bar")).toBe("foo~/bar");
    expect(expandHomePath("foo~")).toBe("foo~");
  });
});

describe("normalizePathPolicyLiteral", () => {
  it("trims whitespace", () => {
    expect(normalizePathPolicyLiteral("  /path/to/file  ")).toBe(
      expandHomePath("/path/to/file"),
    );
  });

  it("strips double quotes", () => {
    expect(normalizePathPolicyLiteral('"/path/to/file"')).toBe(
      expandHomePath("/path/to/file"),
    );
  });

  it("strips single quotes", () => {
    expect(normalizePathPolicyLiteral("'/path/to/file'")).toBe(
      expandHomePath("/path/to/file"),
    );
  });

  it("strips @ prefix", () => {
    expect(normalizePathPolicyLiteral("@/path/to/file")).toBe(
      expandHomePath("/path/to/file"),
    );
  });

  it("strips quotes wrapping @ prefix", () => {
    expect(normalizePathPolicyLiteral('"@/path/to/file"')).toBe(
      expandHomePath("/path/to/file"),
    );
  });

  it("expands ~ after normalization", () => {
    const home = process.env.HOME || "/home/user";
    expect(normalizePathPolicyLiteral("~/docs")).toBe(`${home}/docs`);
  });

  it("expands $HOME after normalization", () => {
    const home = process.env.HOME || "/home/user";
    expect(normalizePathPolicyLiteral("$HOME/docs")).toBe(`${home}/docs`);
  });
});

describe("getPathPolicyValues", () => {
  const cwd = "/home/user/project";
  const home = process.env.HOME || "/home/user";

  it("returns [absolute, cwdRelative, literal] for a relative path", () => {
    const result = getPathPolicyValues(".scratch/file.ts", { cwd });
    expect(result).toContain(`${cwd}/.scratch/file.ts`); // absolute
    expect(result).toContain(".scratch/file.ts"); // literal
    expect(result).toContain(".scratch/file.ts"); // cwd relative (same as literal here)
  });

  it("returns [absolute, cwdRelative, literal] for an absolute path", () => {
    const result = getPathPolicyValues("/home/user/project/src/index.ts", { cwd });
    expect(result).toContain("/home/user/project/src/index.ts"); // absolute
    expect(result).toContain("src/index.ts"); // cwd relative
    expect(result).toContain("/home/user/project/src/index.ts"); // literal
  });

  it("expands ~ and returns home path", () => {
    const result = getPathPolicyValues("~/docs/file.md", { cwd });
    expect(result).toContain(`${home}/docs/file.md`); // expanded absolute
    // literal is also expanded after normalizePathPolicyLiteral
    expect(result).toContain(`${home}/docs/file.md`);
  });

  it("deduplicates equivalent paths", () => {
    const result = getPathPolicyValues("src/index.ts", { cwd });
    // Should contain each variant at most once
    const unique = new Set(result);
    expect(result.length).toBe(unique.size);
  });

  it("uses resolveBase when provided", () => {
    const result = getPathPolicyValues("src/index.ts", {
      cwd,
      resolveBase: "/other/base",
    });
    expect(result).toContain("/other/base/src/index.ts");
  });

  it("handles paths already in allowlist format", () => {
    const result = getPathPolicyValues("docs/", { cwd });
    expect(result).toContain(`${cwd}/docs`); // resolve strips trailing slash
    expect(result).toContain("docs/");
  });

  it("normalizes path before generating values", () => {
    const result = getPathPolicyValues('  "src/index.ts"  ', { cwd });
    expect(result).toContain(`${cwd}/src/index.ts`);
    expect(result).toContain("src/index.ts");
  });

  it("returns at least the literal path", () => {
    const result = getPathPolicyValues("some/path", { cwd });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result).toContain("some/path");
  });
});
