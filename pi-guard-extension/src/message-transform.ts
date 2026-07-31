import { PLAN_MODE_COMPLETE_TOOL_NAME } from "./completion-tool.ts"
import type { ActiveImplementationPlan } from "./state.ts"
/**
 * Guard Plan Mode message transformation helpers.
 *
 * Filters legacy and Plan Mode artifacts from the AI context so stale plan
 * blocks, completion tool calls, and handoff messages do not pollute
 * non-Plan-Mode reasoning.
 */

export type ProposedPlanParseResult =
  | { kind: "absent" }
  | { kind: "valid"; plan: string }
  | { kind: "empty" }
  | { kind: "multiple" }
  | { kind: "malformed" }
  | { kind: "unclosed" }

const PROPOSED_PLAN_PATTERN =
  /^<proposed_plan>[\t ]*\r?\n([\s\S]*?)\r?\n<\/proposed_plan>[\t ]*$/gm
const PROPOSED_PLAN_BLOCK_PATTERN =
  /^<proposed_plan>[\t ]*\r?\n[\s\S]*?\r?\n<\/proposed_plan>[\t ]*$/gm

const PLAN_CONTEXT_MESSAGE_TYPE = "plan-mode-context"
export const PLAN_IMPLEMENTATION_CONTEXT_MESSAGE_TYPE = "plan-mode-implementation-context"
const PROPOSED_PLAN_MESSAGE_TYPE = "proposed-plan"
/**
 * Prefix of the user handoff message that hands an accepted plan to
 * implementation. Exported so the implement command can write handoffs
 * with the exact same wording the filter matches on.
 */
export const PLAN_IMPLEMENTATION_HANDOFF_PREFIX =
  "Guard mode is now disabled. Full tool access is restored. Implement this proposed plan now:"
/**
 * Parse a legacy `<proposed_plan>` XML block from assistant text.
 *
 * Returns one of six results: absent, valid (with the plan), empty,
 * multiple, malformed, or unclosed.
 */
export function parseProposedPlan(text: string): ProposedPlanParseResult {
  const openingCount = text.match(/<proposed_plan>/gi)?.length ?? 0
  const closingCount = text.match(/<\/proposed_plan>/gi)?.length ?? 0
  if (openingCount === 0 && closingCount === 0) return { kind: "absent" }
  if (openingCount > 1 || closingCount > 1) return { kind: "multiple" }
  if (openingCount === 1 && closingCount === 0) return { kind: "unclosed" }
  if (openingCount !== 1 || closingCount !== 1) return { kind: "malformed" }

  const matches = Array.from(text.matchAll(PROPOSED_PLAN_PATTERN))
  if (matches.length !== 1) return { kind: "malformed" }
  const plan = matches[0]?.[1]?.trim() ?? ""
  return plan ? { kind: "valid", plan } : { kind: "empty" }
}

/**
 * Extract the plan from text when it is a valid proposed plan,
 * or undefined otherwise.
 */
export function extractProposedPlan(text: string) {
  const result = parseProposedPlan(text)
  return result.kind === "valid" ? result.plan : undefined
}

/**
 * Build a bilingual warning message describing why a proposed plan
 * is not ready, for a given failure kind.
 */
export function invalidPlanMessage(kind: "empty" | "multiple" | "malformed" | "unclosed") {
  const detail = {
    empty: "the block is empty",
    multiple: "more than one plan block was produced",
    malformed: "the tags must be on their own lines",
    unclosed: "the closing tag is missing",
  }[kind]
  return `Proposed plan is not ready: ${detail}. Continue Guard mode and produce one complete non-empty <proposed_plan> block.`
}

type SessionMessage = {
  role?: string
  content?: unknown
}

type TextBlock = {
  type?: string
  text?: string
}

/**
 * Return the latest non-empty assistant text across session messages.
 * Handles both bare message objects and { message: ... } entry wrappers.
 */
export function latestAssistantText(messages: unknown) {
  if (!Array.isArray(messages)) return ""
  for (const entry of [...messages].reverse()) {
    const message = (entry as { message?: SessionMessage })?.message ?? (entry as SessionMessage)
    if (message?.role !== "assistant") continue
    const text = messageText(message)
    if (text) return text
  }
  return ""
}

/**
 * Strip well-formed `<proposed_plan>` blocks from a text string.
 * Malformed inline tags are left untouched.
 */
export function stripProposedPlanBlocks(text: string) {
  return text.replace(PROPOSED_PLAN_BLOCK_PATTERN, "")
}

/**
 * Strip proposed-plan blocks from an assistant message's text content.
 * Returns the original message when nothing changes.
 */
export function stripProposedPlanBlocksFromMessage<T>(message: T): T {
  return replaceAssistantContent(message, stripProposedPlanBlocksFromContent)
}

/**
 * Remove `plan_mode_complete` tool-call blocks from assistant content.
 * Returns the original message when nothing changes.
 */
export function stripPlanModeCompletionCallsFromMessage<T>(message: T): T {
  return replaceAssistantContent(message, (content) => {
    if (!Array.isArray(content)) return content
    const nextContent = content.filter((block) => {
      const candidate = block as { type?: string; name?: string }
      return !(candidate.type === "toolCall" && candidate.name === PLAN_MODE_COMPLETE_TOOL_NAME)
    })
    return nextContent.length === content.length ? content : nextContent
  })
}

function replaceAssistantContent<T>(message: T, transform: (content: unknown) => unknown): T {
  const candidate = unwrapSessionMessage(message)
  if (candidate.role !== "assistant") return message

  const content = transform(candidate.content)
  if (content === candidate.content) return message

  if (isSessionMessageEntry(message)) {
    return { ...message, message: { ...candidate, content } }
  }
  return { ...candidate, content } as T
}

function unwrapSessionMessage(message: unknown) {
  const entry = message as { message?: unknown } | null | undefined
  return (entry?.message ?? message ?? {}) as {
    role?: string
    customType?: string
    toolName?: string
    content?: unknown
  }
}

function isSessionMessageEntry<T>(message: T): message is T & { message: SessionMessage } {
  return typeof message === "object" && message !== null && "message" in message
}

function stripProposedPlanBlocksFromContent(content: unknown) {
  if (typeof content === "string") return stripProposedPlanBlocks(content)
  if (!Array.isArray(content)) return content

  let changed = false
  const nextContent = content.map((block) => {
    const textBlock = block as TextBlock
    if (textBlock.type !== "text" || typeof textBlock.text !== "string") return block

    const text = stripProposedPlanBlocks(textBlock.text)
    if (text === textBlock.text) return block

    changed = true
    return { ...textBlock, text }
  })
  return changed ? nextContent : content
}

function messageText(message: SessionMessage) {
  return contentText(message.content)
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      const textBlock = block as TextBlock
      return textBlock.type === "text" && typeof textBlock.text === "string" ? textBlock.text : ""
    })
    .filter(Boolean)
    .join("\n")
}

/**
 * Detect a legacy Plan Mode context marker message.
 */
export function messageContainsLegacyPlanModeContextArtifact(message: unknown) {
  return unwrapSessionMessage(message).customType === PLAN_CONTEXT_MESSAGE_TYPE
}

/**
 * Detect an active-implementation context marker message.
 */
export function messageContainsPlanModeImplementationContextArtifact(message: unknown) {
  return unwrapSessionMessage(message).customType === PLAN_IMPLEMENTATION_CONTEXT_MESSAGE_TYPE
}

/**
 * Detect messages that are stale when Plan Mode is inactive:
 * proposed-plan custom messages and plan_mode_complete tool results.
 */
export function messageContainsInactivePlanModeArtifact(message: unknown) {
  const candidate = unwrapSessionMessage(message)
  return (
    candidate.customType === PROPOSED_PLAN_MESSAGE_TYPE ||
    (candidate.role === "toolResult" && candidate.toolName === PLAN_MODE_COMPLETE_TOOL_NAME)
  )
}

/**
 * Detect the user handoff message that hands a plan to implementation.
 */
export function messageContainsPlanModeImplementationHandoff(message: unknown) {
  const candidate = unwrapSessionMessage(message)
  return (
    candidate.role === "user" &&
    contentText(candidate.content).trimStart().startsWith(PLAN_IMPLEMENTATION_HANDOFF_PREFIX)
  )
}

function messageContainsExactPlanModeImplementationHandoff(message: unknown, plan: string) {
  const candidate = unwrapSessionMessage(message)
  if (candidate.role !== "user") return false
  return (
    contentText(candidate.content).trim() ===
    `${PLAN_IMPLEMENTATION_HANDOFF_PREFIX}\n\n${plan}`.trim()
  )
}

function isSummaryMessage(message: unknown) {
  const role = unwrapSessionMessage(message)?.role
  return role === "compactionSummary" || role === "branchSummary"
}

/**
 * Inject the active implementation plan context marker at the head of
 * messages, keeping the matching handoff and removing stale ones.
 */
export function injectActiveImplementationContext(
  messages: unknown[],
  activeImplementation: ActiveImplementationPlan,
) {
  let foundCurrentHandoff = false
  const messagesWithoutStaleContext = messages.filter((message) => {
    if (messageContainsPlanModeImplementationContextArtifact(message)) return false
    if (!messageContainsPlanModeImplementationHandoff(message)) return true
    if (
      !foundCurrentHandoff &&
      messageContainsExactPlanModeImplementationHandoff(message, activeImplementation.plan)
    ) {
      foundCurrentHandoff = true
      return true
    }
    return false
  })
  if (foundCurrentHandoff) return messagesWithoutStaleContext

  let insertionIndex = 0
  while (isSummaryMessage(messagesWithoutStaleContext[insertionIndex])) insertionIndex += 1
  const contextMessage = {
    role: "custom" as const,
    customType: PLAN_IMPLEMENTATION_CONTEXT_MESSAGE_TYPE,
    content: `[ACTIVE IMPLEMENTATION PLAN]\n\nThe user approved the exact implementation plan below. Continue following it until the user explicitly clears or supersedes it. The exact plan is the remainder of this message:\n\n${activeImplementation.plan}`,
    display: false,
    timestamp: activeImplementation.startedAt,
  }
  return [
    ...messagesWithoutStaleContext.slice(0, insertionIndex),
    contextMessage,
    ...messagesWithoutStaleContext.slice(insertionIndex),
  ]
}

/**
 * Detect an assistant message whose content array is empty.
 */
export function isEmptyAssistantMessage(message: unknown) {
  const candidate = unwrapSessionMessage(message)
  return (
    candidate.role === "assistant" &&
    Array.isArray(candidate.content) &&
    candidate.content.length === 0
  )
}
