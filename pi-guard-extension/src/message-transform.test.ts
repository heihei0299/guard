import { describe, it, expect } from "vitest"
import {
  parseProposedPlan,
  extractProposedPlan,
  invalidPlanMessage,
  stripProposedPlanBlocks,
  stripProposedPlanBlocksFromMessage,
  stripPlanModeCompletionCallsFromMessage,
  stripPlanModeQuestionCallsFromMessage,
  latestAssistantText,
  messageContainsInactivePlanModeArtifact,
  messageContainsLegacyPlanModeContextArtifact,
  messageContainsPlanModeImplementationContextArtifact,
  messageContainsPlanModeImplementationHandoff,
  isEmptyAssistantMessage,
  injectActiveImplementationContext,
} from "./message-transform.ts"

describe("parseProposedPlan", () => {
  it("returns absent when no plan tags are present", () => {
    expect(parseProposedPlan("No plan")).toEqual({ kind: "absent" })
  })

  it("parses a valid plan on its own lines", () => {
    expect(parseProposedPlan("<proposed_plan>\n# Plan\n</proposed_plan>")).toEqual({
      kind: "valid",
      plan: "# Plan",
    })
  })

  it("reports empty when the block has no content", () => {
    expect(parseProposedPlan("<proposed_plan>\n\n</proposed_plan>").kind).toBe("empty")
  })

  it("reports multiple when more than one block is produced", () => {
    expect(
      parseProposedPlan("<proposed_plan>a</proposed_plan><proposed_plan>b</proposed_plan>").kind,
    ).toBe("multiple")
  })

  it("reports malformed when tags are not on their own lines", () => {
    expect(parseProposedPlan("before <proposed_plan>bad</proposed_plan>").kind).toBe("malformed")
  })

  it("reports unclosed when the closing tag is missing", () => {
    expect(parseProposedPlan("<proposed_plan>unfinished").kind).toBe("unclosed")
  })

  it("reports malformed for case-mismatched tags", () => {
    expect(parseProposedPlan("<PROPOSED_PLAN>\n# Plan\n</PROPOSED_PLAN>").kind).toBe("malformed")
  })
})

describe("extractProposedPlan", () => {
  it("extracts a valid plan from surrounding prose", () => {
    expect(extractProposedPlan("Intro\n<proposed_plan>\n# Plan\n</proposed_plan>")).toBe("# Plan")
  })

  it("returns undefined for non-valid results", () => {
    expect(extractProposedPlan("No plan here")).toBeUndefined()
    expect(extractProposedPlan("<proposed_plan>\n\n</proposed_plan>")).toBeUndefined()
  })
})

describe("invalidPlanMessage", () => {
  it("describes each failure kind", () => {
    expect(invalidPlanMessage("empty")).toContain("the block is empty")
    expect(invalidPlanMessage("multiple")).toContain("more than one plan block")
    expect(invalidPlanMessage("malformed")).toContain("tags must be on their own lines")
    expect(invalidPlanMessage("unclosed")).toContain("closing tag is missing")
  })
})

describe("stripProposedPlanBlocks", () => {
  it("removes a well-formed block and collapses surrounding newlines", () => {
    expect(
      stripProposedPlanBlocks("A\n<proposed_plan>\nsecret\n</proposed_plan>\nB"),
    ).toBe("A\n\nB")
  })

  it("leaves malformed inline tags untouched", () => {
    expect(
      stripProposedPlanBlocks("A<proposed_plan>malformed</proposed_plan>B"),
    ).toBe("A<proposed_plan>malformed</proposed_plan>B")
  })
})

describe("stripProposedPlanBlocksFromMessage", () => {
  it("strips blocks from assistant text blocks", () => {
    expect(
      stripProposedPlanBlocksFromMessage({
        role: "assistant",
        content: [{ type: "text", text: "Keep\n<proposed_plan>\nremove\n</proposed_plan>" }],
      }),
    ).toEqual({ role: "assistant", content: [{ type: "text", text: "Keep\n" }] })
  })

  it("returns non-assistant messages unchanged", () => {
    const message = { role: "user", content: "keep" }
    expect(stripProposedPlanBlocksFromMessage(message)).toBe(message)
  })
})

describe("stripPlanModeCompletionCallsFromMessage", () => {
  it("removes completion tool calls from assistant content", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "keep explanation" },
        { type: "toolCall", id: "plan-call", name: "guard_mode_complete", arguments: {} },
        { type: "toolCall", id: "read-call", name: "read", arguments: {} },
      ],
    }
    expect(stripPlanModeCompletionCallsFromMessage(message)).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "keep explanation" },
        { type: "toolCall", id: "read-call", name: "read", arguments: {} },
      ],
    })
  })

  it("returns the message unchanged when nothing is stripped", () => {
    const message = { role: "assistant", content: [{ type: "text", text: "keep" }] }
    expect(stripPlanModeCompletionCallsFromMessage(message)).toBe(message)
  })
})

describe("stripPlanModeQuestionCallsFromMessage", () => {
  it("removes question tool calls from assistant content", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "keep explanation" },
        { type: "toolCall", id: "q-call", name: "guard_mode_question", arguments: {} },
        { type: "toolCall", id: "read-call", name: "read", arguments: {} },
      ],
    }
    expect(stripPlanModeQuestionCallsFromMessage(message)).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "keep explanation" },
        { type: "toolCall", id: "read-call", name: "read", arguments: {} },
      ],
    })
  })

  it("returns the message unchanged when nothing is stripped", () => {
    const message = { role: "assistant", content: [{ type: "text", text: "keep" }] }
    expect(stripPlanModeQuestionCallsFromMessage(message)).toBe(message)
  })
})

describe("latestAssistantText", () => {
  it("returns the latest non-empty assistant text", () => {
    expect(
      latestAssistantText([
        { role: "user", content: "ignore" },
        { message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
      ]),
    ).toBe("answer")
  })

  it("returns empty string for non-array input", () => {
    expect(latestAssistantText(undefined)).toBe("")
  })
})

describe("messageContainsInactivePlanModeArtifact", () => {
  it("detects proposed-plan custom messages", () => {
    expect(
      messageContainsInactivePlanModeArtifact({
        role: "custom",
        customType: "proposed-plan",
      }),
    ).toBe(true)
  })

  it("detects guard_mode_complete tool results", () => {
    expect(
      messageContainsInactivePlanModeArtifact({
        role: "toolResult",
        toolName: "guard_mode_complete",
      }),
    ).toBe(true)
  })

  it("detects guard_mode_question tool results", () => {
    expect(
      messageContainsInactivePlanModeArtifact({
        role: "toolResult",
        toolName: "guard_mode_question",
      }),
    ).toBe(true)
  })

  it("returns false for unrelated messages", () => {
    expect(messageContainsInactivePlanModeArtifact({ role: "user", content: "x" })).toBe(false)
    expect(
      messageContainsInactivePlanModeArtifact({
        role: "toolResult",
        toolName: "read",
      }),
    ).toBe(false)
  })
})

describe("messageContainsLegacyPlanModeContextArtifact", () => {
  it("detects the plan-mode-context custom type", () => {
    expect(
      messageContainsLegacyPlanModeContextArtifact({
        role: "custom",
        customType: "plan-mode-context",
      }),
    ).toBe(true)
  })

  it("returns false for other messages", () => {
    expect(messageContainsLegacyPlanModeContextArtifact({ role: "user" })).toBe(false)
  })
})

describe("messageContainsPlanModeImplementationContextArtifact", () => {
  it("detects the implementation-context custom type", () => {
    expect(
      messageContainsPlanModeImplementationContextArtifact({
        role: "custom",
        customType: "plan-mode-implementation-context",
      }),
    ).toBe(true)
  })

  it("returns false for other messages", () => {
    expect(
      messageContainsPlanModeImplementationContextArtifact({ role: "user" }),
    ).toBe(false)
  })
})

describe("messageContainsPlanModeImplementationHandoff", () => {
  it("detects a user handoff message with the exact prefix", () => {
    expect(
      messageContainsPlanModeImplementationHandoff({
        role: "user",
        content: "Guard mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n# Plan",
      }),
    ).toBe(true)
  })

  it("returns false for other roles", () => {
    expect(
      messageContainsPlanModeImplementationHandoff({ role: "assistant", content: "x" }),
    ).toBe(false)
  })
})

describe("isEmptyAssistantMessage", () => {
  it("detects assistant messages with an empty content array", () => {
    expect(isEmptyAssistantMessage({ role: "assistant", content: [] })).toBe(true)
  })

  it("returns false for non-empty or non-assistant messages", () => {
    expect(isEmptyAssistantMessage({ role: "assistant", content: [{ type: "text" }] })).toBe(false)
    expect(isEmptyAssistantMessage({ role: "user", content: [] })).toBe(false)
  })
})

describe("injectActiveImplementationContext", () => {
  const activeImplementation = {
    id: "plan-1",
    plan: "# Approved plan",
    source: "guard_mode_complete" as const,
    startedAt: 1700000000000,
  }

  it("injects a context marker when no handoff is present", () => {
    const messages = [{ role: "user", content: "hello" }]
    const result = injectActiveImplementationContext(messages, activeImplementation)
    expect(result).toHaveLength(2)
    const [context, user] = result as Array<Record<string, unknown>>
    expect(context.role).toBe("custom")
    expect(context.customType).toBe("plan-mode-implementation-context")
    expect(String(context.content)).toContain("# Approved plan")
    expect(user).toBe(messages[0])
  })

  it("keeps the matching handoff and removes stale ones", () => {
    const handoff = {
      role: "user",
      content: "Guard mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n# Approved plan",
    }
    const staleHandoff = {
      role: "user",
      content: "Guard mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n# Old plan",
    }
    const result = injectActiveImplementationContext([staleHandoff, handoff], activeImplementation)
    expect(result).toContain(handoff)
    expect(result).not.toContain(staleHandoff)
  })

  it("removes stale implementation-context artifacts", () => {
    const stale = {
      role: "custom",
      customType: "plan-mode-implementation-context",
      content: "old",
    }
    const result = injectActiveImplementationContext([stale], activeImplementation)
    expect(result).not.toContain(stale)
    expect(result[0] as { role?: string }).toMatchObject({ role: "custom" })
  })

  it("inserts the marker after leading summary messages", () => {
    const summary = { role: "compactionSummary", content: "sum" }
    const result = injectActiveImplementationContext([summary], activeImplementation)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(summary)
    expect(result[1] as { role?: string }).toMatchObject({ role: "custom" })
  })
})
