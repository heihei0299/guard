import { describe, it, expect } from "vitest"
import { enforcePlanSubagentAllowlist } from "./subagent-policy.ts"

const ALLOWED = ["plan-scout", "plan-researcher", "plan-reviewer"]

describe("enforcePlanSubagentAllowlist", () => {
  it("ignores unrelated tools and permits allowed single roles", () => {
    expect(enforcePlanSubagentAllowlist("custom_delegate", { agent: "worker" }, ALLOWED)).toBeUndefined()
    expect(
      enforcePlanSubagentAllowlist("subagent", { agent: "plan-scout", task: "Inspect" }, ALLOWED),
    ).toBeUndefined()
  })

  it("blocks disallowed and case-mismatched single roles", () => {
    expect(
      enforcePlanSubagentAllowlist("subagent", { agent: "worker", task: "Implement" }, ALLOWED),
    ).toEqual({
      block: true,
      reason:
        "Guard mode blocks subagent role(s): worker. Allowed Guard subagents: plan-scout, plan-researcher, plan-reviewer.",
    })
    expect(
      enforcePlanSubagentAllowlist("subagent", { agent: "Plan-Scout", task: "Inspect" }, ALLOWED)
        ?.reason ?? "",
    ).toMatch(/Plan-Scout/)
  })

  it("checks every parallel task", () => {
    expect(
      enforcePlanSubagentAllowlist(
        "subagent",
        {
          tasks: [
            { agent: "plan-scout", task: "Inspect A" },
            { agent: "plan-reviewer", task: "Inspect B" },
          ],
        },
        ALLOWED,
      ),
    ).toBeUndefined()
    expect(
      enforcePlanSubagentAllowlist(
        "subagent",
        {
          tasks: [
            { agent: "plan-scout", task: "Inspect A" },
            { agent: "worker", task: "Implement B" },
          ],
        },
        ALLOWED,
      )?.reason ?? "",
    ).toMatch(/role\(s\): worker/)
  })

  it("checks every chain step and the fan-in aggregator", () => {
    expect(
      enforcePlanSubagentAllowlist(
        "subagent",
        {
          chain: [
            { agent: "plan-scout", task: "Inspect" },
            { agent: "plan-reviewer", task: "Review {previous}" },
          ],
        },
        ALLOWED,
      ),
    ).toBeUndefined()
    expect(
      enforcePlanSubagentAllowlist(
        "subagent",
        {
          tasks: [{ agent: "plan-scout", task: "Inspect" }],
          aggregator: { agent: "plan-reviewer", task: "Combine {previous}" },
        },
        ALLOWED,
      ),
    ).toBeUndefined()
    expect(
      enforcePlanSubagentAllowlist(
        "subagent",
        {
          chain: [
            { agent: "plan-scout", task: "Inspect" },
            { agent: "worker", task: "Use {previous}" },
          ],
        },
        ALLOWED,
      )?.reason ?? "",
    ).toMatch(/role\(s\): worker/)
    expect(
      enforcePlanSubagentAllowlist(
        "subagent",
        {
          tasks: [{ agent: "plan-scout", task: "Inspect" }],
          aggregator: { agent: "worker", task: "Combine {previous}" },
        },
        ALLOWED,
      )?.reason ?? "",
    ).toMatch(/role\(s\): worker/)
  })

  it("checks detached spawn roles", () => {
    expect(
      enforcePlanSubagentAllowlist("subagent_spawn", { agent: "plan-researcher", task: "Research" }, ALLOWED),
    ).toBeUndefined()
    expect(
      enforcePlanSubagentAllowlist("subagent_spawn", { agent: "worker", task: "Implement" }, ALLOWED)
        ?.reason ?? "",
    ).toMatch(/role\(s\): worker/)
  })

  it("rejects malformed covered launch payloads", () => {
    const cases: Array<[string, unknown]> = [
      ["subagent", undefined],
      ["subagent", {}],
      ["subagent", { agent: "" }],
      ["subagent", { tasks: [] }],
      ["subagent", { tasks: [{ task: "Missing role" }] }],
      ["subagent", { chain: "plan-scout" }],
      ["subagent", { aggregator: {} }],
      ["subagent_spawn", {}],
    ]
    for (const [toolName, input] of cases) {
      expect(
        enforcePlanSubagentAllowlist(toolName, input, ALLOWED)?.reason ?? "",
      ).toMatch(/could not verify subagent roles/)
    }
  })

  it("denies every valid covered launch when the allowlist is empty", () => {
    expect(
      enforcePlanSubagentAllowlist("subagent", { agent: "plan-scout", task: "Inspect" }, []),
    ).toEqual({
      block: true,
      reason: "Guard mode blocks subagent role(s): plan-scout. No subagent roles are allowed in Guard mode.",
    })
  })
})
