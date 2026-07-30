import { describe, it, expect } from "vitest";
import { isBashPathAllowed } from "./bash-path-allowlist.ts";

const ALLOW_WRITE_PATHS = [".scratch/", "docs/", "CONTEXT.md"];

describe("isBashPathAllowed", () => {
  // ── mkdir / touch / rm ─────────────────────────────────────────────
  it("allows mkdir -p with allowlisted path", () => {
    expect(isBashPathAllowed("mkdir -p docs/a", ALLOW_WRITE_PATHS)).toBe(true);
  });

  it("allows touch on allowlisted path", () => {
    expect(isBashPathAllowed("touch docs/f.md", ALLOW_WRITE_PATHS)).toBe(true);
  });

  it("allows rm on allowlisted path", () => {
    expect(isBashPathAllowed("rm docs/f.md", ALLOW_WRITE_PATHS)).toBe(true);
  });

  // ── mv ──────────────────────────────────────────────────────────────
  it("allows mv with both paths in allowlist", () => {
    expect(isBashPathAllowed("mv docs/a docs/b", ALLOW_WRITE_PATHS)).toBe(true);
  });

  it("blocks mv if source is outside allowlist", () => {
    expect(isBashPathAllowed("mv /tmp/foo docs/b", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks mv if target is outside allowlist", () => {
    expect(isBashPathAllowed("mv docs/a /tmp/foo", ALLOW_WRITE_PATHS)).toBe(false);
  });

  // ── cp ──────────────────────────────────────────────────────────────
  it("allows cp with source in allowlist, target outside", () => {
    expect(isBashPathAllowed("cp docs/guide.md ./", ALLOW_WRITE_PATHS)).toBe(true);
  });

  it("blocks cp if source is outside allowlist", () => {
    expect(isBashPathAllowed("cp /tmp/foo docs/b", ALLOW_WRITE_PATHS)).toBe(false);
  });

  // ── Redirect (>, >>) ────────────────────────────────────────────────
  it("allows echo with > redirect to allowlisted path", () => {
    expect(isBashPathAllowed("echo hi > docs/out.md", ALLOW_WRITE_PATHS)).toBe(true);
  });

  it("allows cat with > redirect to allowlisted path", () => {
    expect(isBashPathAllowed("cat > docs/list.txt", ALLOW_WRITE_PATHS)).toBe(true);
  });

  it("blocks echo with > redirect to non-allowlisted path", () => {
    expect(isBashPathAllowed("echo hi > /tmp/out.md", ALLOW_WRITE_PATHS)).toBe(false);
  });

  // ── Path not in allowlist ──────────────────────────────────────────
  it("blocks mkdir with path outside allowlist", () => {
    expect(isBashPathAllowed("mkdir /tmp/foo", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks rm with path outside allowlist", () => {
    expect(isBashPathAllowed("rm ../outside.md", ALLOW_WRITE_PATHS)).toBe(false);
  });

  // ── Non-literal paths (variable, glob, brace expansion) ────────────
  it("rejects rm with variable reference", () => {
    expect(isBashPathAllowed("rm $FILE", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("rejects rm with glob pattern", () => {
    expect(isBashPathAllowed("rm docs/*.md", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("rejects rm with brace expansion", () => {
    expect(isBashPathAllowed("rm docs/{a,b}", ALLOW_WRITE_PATHS)).toBe(false);
  });

  // ── Always-blocked commands ─────────────────────────────────────────
  it("blocks dd even if path references allowlisted dir", () => {
    expect(isBashPathAllowed("dd if=/dev/zero of=docs/out.bin", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks chmod always", () => {
    expect(isBashPathAllowed("chmod +x docs/file.sh", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks ln always", () => {
    expect(isBashPathAllowed("ln -s docs/a docs/b", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks sed -i always", () => {
    expect(isBashPathAllowed("sed -i 's/foo/bar/g' docs/file.md", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks awk -i always", () => {
    expect(isBashPathAllowed("awk -i inplace '{print}' docs/file.txt", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks tee always", () => {
    expect(isBashPathAllowed("echo hi | tee docs/out.md", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks fallocate always", () => {
    expect(isBashPathAllowed("fallocate -l 1M docs/file.bin", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks sudo always", () => {
    expect(isBashPathAllowed("sudo rm docs/file.md", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks doas always", () => {
    expect(isBashPathAllowed("doas rm docs/file.md", ALLOW_WRITE_PATHS)).toBe(false);
  });

  // ── Path normalization ──────────────────────────────────────────────
  it("normalizes ./ prefix before matching", () => {
    expect(isBashPathAllowed("touch ./docs/file.md", ALLOW_WRITE_PATHS)).toBe(true);
  });

  it("expands ~ before matching directory paths", () => {
    expect(isBashPathAllowed("touch ~/project/docs/file.md", ALLOW_WRITE_PATHS)).toBe(true);
  });

  // ── Path traversal via prefix match ────────────────────────────────
  it("allows path traversal when prefix matches", () => {
    expect(isBashPathAllowed("touch docs/../../etc/passwd", ALLOW_WRITE_PATHS)).toBe(true);
  });

  // ── Edge cases: empty, unknown commands ─────────────────────────────
  it("blocks empty command", () => {
    expect(isBashPathAllowed("", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks whitespace-only command", () => {
    expect(isBashPathAllowed("   ", ALLOW_WRITE_PATHS)).toBe(false);
  });

  it("blocks unknown command", () => {
    expect(isBashPathAllowed("some-obscure-tool", ALLOW_WRITE_PATHS)).toBe(false);
  });

  // ── Edge: git commands should not enter this function ───────────────
  it("blocks git commands (caller should filter them)", () => {
    expect(isBashPathAllowed("git add .", ALLOW_WRITE_PATHS)).toBe(false);
  });

  // ── Edge: command with only flags and no paths ──────────────────────
  it("blocks mkdir with only flags", () => {
    expect(isBashPathAllowed("mkdir -p -v", ALLOW_WRITE_PATHS)).toBe(false);
  });
});
