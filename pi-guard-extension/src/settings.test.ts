import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizePlanModeSettings,
  readPlanModeSettings,
  type PlanModeSettings,
  type PlanModeSettingsLoadResult,
} from "./settings.ts";

describe("normalizePlanModeSettings", () => {
  it("returns undefined for non-object values", () => {
    expect(normalizePlanModeSettings(null)).toBeUndefined();
    expect(normalizePlanModeSettings("string")).toBeUndefined();
    expect(normalizePlanModeSettings(42)).toBeUndefined();
    expect(normalizePlanModeSettings([])).toBeUndefined();
    expect(normalizePlanModeSettings(undefined)).toBeUndefined();
  });

  it("returns default settings for empty object", () => {
    const result = normalizePlanModeSettings({});
    expect(result).toBeDefined();
    expect(result!.thinkingLevel).toBe("inherit");
  });

  it("accepts valid thinkingLevel", () => {
    const levels = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
    for (const level of levels) {
      const result = normalizePlanModeSettings({ thinkingLevel: level });
      expect(result).toBeDefined();
      expect(result!.thinkingLevel).toBe(level);
    }
  });

  it("returns undefined for invalid thinkingLevel", () => {
    expect(normalizePlanModeSettings({ thinkingLevel: "super-max" })).toBeUndefined();
    expect(normalizePlanModeSettings({ thinkingLevel: 123 })).toBeUndefined();
    expect(normalizePlanModeSettings({ thinkingLevel: null })).toBeUndefined();
  });

  it("accepts defaultPlanTools as string array", () => {
    const result = normalizePlanModeSettings({
      defaultPlanTools: ["read", "bash"],
    });
    expect(result).toBeDefined();
    expect(result!.defaultPlanTools).toEqual(["read", "bash"]);
  });

  it("deduplicates defaultPlanTools", () => {
    const result = normalizePlanModeSettings({
      defaultPlanTools: ["read", "bash", "read"],
    });
    expect(result).toBeDefined();
    expect(result!.defaultPlanTools).toEqual(["read", "bash"]);
  });

  it("returns undefined for invalid defaultPlanTools", () => {
    expect(normalizePlanModeSettings({ defaultPlanTools: "not-array" })).toBeUndefined();
    expect(normalizePlanModeSettings({ defaultPlanTools: [1, 2] })).toBeUndefined();
    expect(normalizePlanModeSettings({ defaultPlanTools: [""] })).toBeUndefined();
  });

  it("accepts allowedPlanSubagents as string array", () => {
    const result = normalizePlanModeSettings({
      allowedPlanSubagents: ["research"],
    });
    expect(result).toBeDefined();
    expect(result!.allowedPlanSubagents).toEqual(["research"]);
  });

  it("accepts safeSubcommands with git and gh", () => {
    const result = normalizePlanModeSettings({
      safeSubcommands: {
        git: ["status", "log"],
        gh: ["pr", "issue"],
      },
    });
    expect(result).toBeDefined();
    expect(result!.safeSubcommands?.git).toEqual(["status", "log"]);
    expect(result!.safeSubcommands?.gh).toEqual(["pr", "issue"]);
  });

  it("returns undefined for safeSubcommands with unknown keys", () => {
    expect(
      normalizePlanModeSettings({
        safeSubcommands: { npm: ["install"] },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for invalid git subcommand values", () => {
    expect(
      normalizePlanModeSettings({
        safeSubcommands: { git: ["unknown-cmd"] },
      }),
    ).toBeUndefined();
  });
});

describe("readPlanModeSettings", () => {
  const testSettingsPath = "/tmp/test-pi-guard-settings.json";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    try {
      await import("fs/promises").then((fs) => fs.unlink(testSettingsPath));
    } catch {
      // ignore
    }
  });

  it("returns missing when file does not exist", async () => {
    const result = await readPlanModeSettings("/tmp/nonexistent-settings.json");
    expect(result.kind).toBe("missing");
  });

  it("returns loaded for valid settings file", async () => {
    const fs = await import("fs/promises");
    await fs.writeFile(
      testSettingsPath,
      JSON.stringify({ thinkingLevel: "medium", defaultPlanTools: ["read", "bash"] }),
      "utf-8",
    );
    const result = await readPlanModeSettings(testSettingsPath);
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.settings.thinkingLevel).toBe("medium");
      expect(result.settings.defaultPlanTools).toEqual(["read", "bash"]);
    }
  });

  it("returns invalid for malformed JSON", async () => {
    const fs = await import("fs/promises");
    await fs.writeFile(testSettingsPath, "not json", "utf-8");
    const result = await readPlanModeSettings(testSettingsPath);
    expect(result.kind).toBe("invalid");
  });

  it("returns invalid for invalid settings shape", async () => {
    const fs = await import("fs/promises");
    await fs.writeFile(
      testSettingsPath,
      JSON.stringify({ thinkingLevel: "super-max" }),
      "utf-8",
    );
    const result = await readPlanModeSettings(testSettingsPath);
    expect(result.kind).toBe("invalid");
  });
});
