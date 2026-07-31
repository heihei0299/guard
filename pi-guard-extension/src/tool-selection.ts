import type { ToolInfo, SourceInfo } from "@earendil-works/pi-coding-agent";

/**
 * Deduplicate an array of strings, preserving first-seen order.
 */
export function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Check whether a tool is a built-in pi tool.
 *
 * Built-in tools are those shipped with pi. The host reports them with
 * source === "pi" (older mock fixtures) or source === "builtin"
 * (pi-coding-agent's synthetic source info for its own built-in tools).
 * User/custom tools have source === "extension" (extension-registered),
 * source === "sdk" (host-registered custom tools), or other custom sources.
 */
export function isBuiltinTool(tool: ToolInfo): boolean {
  return tool.sourceInfo?.source === "pi" || tool.sourceInfo?.source === "builtin";
}

/**
 * Resolve a tool name from a legacy key.
 *
 * Legacy keys may include a \x1f-separated suffix (e.g. "toolName\u001fsuffix").
 * This function extracts the tool name and looks it up in the tools array.
 *
 * @param key - The legacy key to resolve
 * @param tools - Array of available ToolInfo objects
 * @returns The matching tool name, or undefined if not found
 */
export function toolNameFromLegacyKey(key: string, tools: ToolInfo[]): string | undefined {
  const directName = tools.find((tool) => tool.name === key)?.name;
  if (directName) return directName;

  // Try extracting the prefix before the \x1f separator
  const [name] = key.split("\u001f");
  return tools.find((tool) => tool.name === name) ? name : undefined;
}

/**
 * Compare two tools for sorting.
 *
 * Built-in tools sort before user/custom tools.
 * Within the same category, tools are sorted alphabetically by name.
 */
export function compareTools(left: ToolInfo, right: ToolInfo): number {
  const leftBuiltin = isBuiltinTool(left);
  const rightBuiltin = isBuiltinTool(right);
  if (leftBuiltin !== rightBuiltin) return leftBuiltin ? -1 : 1;
  return left.name.localeCompare(right.name);
}
