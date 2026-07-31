import { describe, it, expect } from "vitest"
import { showActiveImplementationMenu } from "./active-implementation-menu.ts"

function nonTuiCtx() {
  return {
    mode: "print" as const,
    hasUI: false,
    ui: {},
  } as never
}

describe("showActiveImplementationMenu", () => {
  it("resolves without throwing in a non-TUI mode", async () => {
    const result = await showActiveImplementationMenu(nonTuiCtx(), {
      statusText: "An implementation plan is active.",
      signal: new AbortController().signal,
      isCurrent: () => true,
      show: () => {},
      startNew: () => {},
      clear: () => {},
    })
    expect(result).toMatchObject({ kind: "unsupported" })
  })

  it("does not invoke any action when the menu cannot open", async () => {
    let invoked = false
    await showActiveImplementationMenu(nonTuiCtx(), {
      statusText: "An implementation plan is active.",
      signal: new AbortController().signal,
      isCurrent: () => true,
      show: () => {
        invoked = true
      },
      startNew: () => {
        invoked = true
      },
      clear: () => {
        invoked = true
      },
    })
    expect(invoked).toBe(false)
  })
})
