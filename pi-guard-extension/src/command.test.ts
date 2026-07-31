import { describe, it, expect } from "vitest"
import { completePlanArguments, type CommandArgumentCompletion } from "./command.ts"

const ALL_LABELS = ["show", "finalize", "implement", "exit", "off", "tools"]

describe("completePlanArguments", () => {
  it("returns every management token for an empty prefix", () => {
    const result = completePlanArguments("")
    expect(result?.map((item) => item.label)).toEqual(ALL_LABELS)
  })

  it("prefix-matches tokens case-insensitively", () => {
    const result = completePlanArguments("to")
    expect(result?.map((item) => item.value)).toEqual(["tools"])
    expect(completePlanArguments("IMP")?.map((item) => item.value)).toEqual(["implement"])
  })

  it("returns null for multi-word prefixes", () => {
    expect(completePlanArguments("tools ")).toBeNull()
    expect(completePlanArguments("write a plan")).toBeNull()
  })

  it("returns null when no token matches", () => {
    expect(completePlanArguments("unknown")).toBeNull()
  })

  it("exposes descriptions on each completion", () => {
    const result = completePlanArguments("")
    expect(result).not.toBeNull()
    for (const item of result as CommandArgumentCompletion[]) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.description?.length).toBeGreaterThan(0)
    }
  })
})
