/**
 * Guard Plan Mode `/guard` command argument completions.
 *
 * Suggests the management subcommands (show / finalize / implement /
 * exit / off / tools) while typing the first argument after `/guard`.
 */

export interface CommandArgumentCompletion {
  value: string
  label: string
  description?: string
}

const GUARD_COMMAND_COMPLETIONS: readonly CommandArgumentCompletion[] = [
  { value: "show", label: "show", description: "Show the ready or active plan" },
  { value: "finalize", label: "finalize", description: "Request a completed plan" },
  { value: "implement", label: "implement", description: "Implement the completed plan" },
  { value: "exit", label: "exit", description: "Leave Guard mode or clear the active plan" },
  { value: "off", label: "off", description: "Leave Guard mode or clear the active plan" },
  { value: "tools", label: "tools", description: "Select tools allowed in Guard mode" },
]

/**
 * Complete the first `/guard` argument.
 *
 * Returns all tokens for an empty prefix, prefix-matches the token list
 * case-insensitively, and returns null when the prefix is multi-word or
 * matches nothing (no suggestions).
 */
export function completePlanArguments(argumentPrefix: string): CommandArgumentCompletion[] | null {
  const prefix = argumentPrefix.trimStart().toLowerCase()
  if (prefix === "") return [...GUARD_COMMAND_COMPLETIONS]
  if (/\s/.test(prefix)) return null

  const matches = GUARD_COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(prefix))
  return matches.length > 0 ? [...matches] : null
}
