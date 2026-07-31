import { describe, it, expect } from "vitest";
import {
  withRequiredPlanModeTools,
  withoutRequiredPlanModeTools,
  withoutPlanModeQuestionTool,
} from "./required-tools.ts";

const Q = "plan_mode_question";
const C = "plan_mode_complete";

describe("withRequiredPlanModeTools", () => {
  it("adds question and complete tools to empty list", () => {
    expect(withRequiredPlanModeTools([])).toEqual([Q, C]);
  });

  it("adds missing required tools to existing list", () => {
    expect(withRequiredPlanModeTools(["read", "bash"])).toEqual(["read", "bash", Q, C]);
  });

  it("does not duplicate when already present", () => {
    expect(withRequiredPlanModeTools(["read", Q, C])).toEqual(["read", Q, C]);
  });
});

describe("withoutRequiredPlanModeTools", () => {
  it("removes question and complete tools", () => {
    expect(withoutRequiredPlanModeTools(["read", Q, "bash", C])).toEqual(["read", "bash"]);
  });

  it("returns empty array when only required tools", () => {
    expect(withoutRequiredPlanModeTools([Q, C])).toEqual([]);
  });
});

describe("withoutPlanModeQuestionTool", () => {
  it("removes question tool only", () => {
    expect(withoutPlanModeQuestionTool(["read", Q, "bash", C])).toEqual(["read", "bash", C]);
  });
});
