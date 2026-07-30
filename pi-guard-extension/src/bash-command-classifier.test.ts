import { describe, it, expect } from "vitest";
import { isBashReadonly } from "./bash-command-classifier.ts";

describe("isBashReadonly", () => {
  // ── Readonly commands ──────────────────────────────────────────────
  it("allows ls", () => {
    expect(isBashReadonly("ls -la")).toBe(true);
  });

  it("allows cat", () => {
    expect(isBashReadonly("cat file.txt")).toBe(true);
  });

  it("allows grep", () => {
    expect(isBashReadonly("grep foo file.ts")).toBe(true);
  });

  it("allows curl", () => {
    expect(isBashReadonly("curl -s https://example.com")).toBe(true);
  });

  // ── Write commands ────────────────────────────────────────────────
  it("blocks rm", () => {
    expect(isBashReadonly("rm -rf /tmp/test")).toBe(false);
  });

  it("blocks npm install", () => {
    expect(isBashReadonly("npm install foo")).toBe(false);
  });

  it("blocks mv", () => {
    expect(isBashReadonly("mv a b")).toBe(false);
  });

  // ── Redirect operators ────────────────────────────────────────────
  it("blocks command with stdout redirect to real file", () => {
    expect(isBashReadonly("echo foo > file.txt")).toBe(false);
  });

  it("blocks command with stderr redirect to real file", () => {
    expect(isBashReadonly("cat foo 2>> error.log")).toBe(false);
  });
  
  // ── Redirect operators: harmless patterns (previously false positives) ──
  it("allows ls with stderr to /dev/null", () => {
    expect(isBashReadonly("ls docs/ 2>/dev/null")).toBe(true);
  });
  
  it("allows command with stderr to /dev/null and shell operators", () => {
    expect(isBashReadonly("ls docs/ 2>/dev/null || echo x")).toBe(true);
  });
  
  it("allows cat with input redirect", () => {
    expect(isBashReadonly("cat < input.txt")).toBe(true);
  });
  
  it("allows grep with input redirect", () => {
    expect(isBashReadonly("grep foo < bar.txt")).toBe(true);
  });
  
  it("allows command with stderr to stdout fd redirect", () => {
    expect(isBashReadonly("cat file 2>&1")).toBe(true);
  });
  
  it("allows echo to /dev/null (harmless write target)", () => {
    expect(isBashReadonly("echo hello > /dev/null")).toBe(true);
  });
  
  
  it("blocks command with combined N> redirect to real file", () => {
    expect(isBashReadonly("ls nonexistent 2> err.log")).toBe(false);
  });
  // ── Git subcommands ───────────────────────────────────────────────
  it("allows git status", () => {
    expect(isBashReadonly("git status")).toBe(true);
  });

  it("allows git log", () => {
    expect(isBashReadonly("git log --oneline")).toBe(true);
  });

  it("allows git diff", () => {
    expect(isBashReadonly("git diff HEAD")).toBe(true);
  });

  it("blocks git commit", () => {
    expect(isBashReadonly("git commit -m 'test'")).toBe(false);
  });

  it("blocks git push", () => {
    expect(isBashReadonly("git push origin main")).toBe(false);
  });

  it("blocks git checkout", () => {
    expect(isBashReadonly("git checkout main")).toBe(false);
  });

  it("blocks git stash (without list)", () => {
    expect(isBashReadonly("git stash")).toBe(false);
  });

  it("allows git stash list", () => {
    expect(isBashReadonly("git stash list")).toBe(true);
  });

  it("blocks git branch -d", () => {
    expect(isBashReadonly("git branch -d old-feature")).toBe(false);
  });

  it("blocks git tag -d", () => {
    expect(isBashReadonly("git tag -d v1.0")).toBe(false);
  });

  // ── sed/awk ───────────────────────────────────────────────────────
  it("allows sed without -i", () => {
    expect(isBashReadonly("sed 's/foo/bar/' file.txt")).toBe(true);
  });

  it("blocks sed with -i", () => {
    expect(isBashReadonly("sed -i 's/foo/bar/' file.txt")).toBe(false);
  });

  it("allows awk without -i", () => {
    expect(isBashReadonly("awk '{print $1}' file.txt")).toBe(true);
  });

  it("blocks awk with -i", () => {
    expect(isBashReadonly("awk -i inplace '{print}' file.txt")).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────
  it("blocks empty string", () => {
    expect(isBashReadonly("")).toBe(false);
  });

  it("blocks whitespace-only string", () => {
    expect(isBashReadonly("   ")).toBe(false);
  });

  it("blocks unknown command conservatively", () => {
    expect(isBashReadonly("some-obscure-tool")).toBe(false);
  });

  // ── Passthrough (rtk) ─────────────────────────────────────────────
  it("allows rtk ls (passthrough to readonly)", () => {
    expect(isBashReadonly("rtk ls -la")).toBe(true);
  });

  it("blocks rtk rm (passthrough to write)", () => {
    expect(isBashReadonly("rtk rm -rf /tmp")).toBe(false);
  });

  it("allows rtk git status (passthrough to git readonly)", () => {
    expect(isBashReadonly("rtk git status")).toBe(true);
  });

  it("blocks rtk git commit (passthrough to git write)", () => {
    expect(isBashReadonly("rtk git commit -m 'test'")).toBe(false);
  });

  it("blocks bare rtk with no inner command", () => {
    expect(isBashReadonly("rtk")).toBe(false);
  });

  it("allows nested passthrough (rtk rtk ls)", () => {
    expect(isBashReadonly("rtk rtk ls -la")).toBe(true);
  });

  it("blocks rtk command with redirect", () => {
    expect(isBashReadonly("rtk echo foo > file.txt")).toBe(false);
  });

  it("blocks rtk npm install (passthrough to write)", () => {
    expect(isBashReadonly("rtk npm install foo")).toBe(false);
  });

  it("allows rtk cat (passthrough to readonly)", () => {
    expect(isBashReadonly("rtk cat file.txt")).toBe(true);
  });
});
