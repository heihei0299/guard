/**
 * Guard state machine for pi-guard-extension.
 *
 * Three states: normal → skill_active → guarded
 * Transitions are driven by input detection, agent_settled, and /guard:allow.
 */
import { homedir } from "os";

// ── Types ────────────────────────────────────────────────────────────────

export type GuardState = "normal" | "skill_active" | "guarded";

export interface GuardMachineOptions {
  /** List of skill names (without "/skill:" prefix) that trigger the guard. */
  targetSkills?: readonly string[];
  /** Additional paths allowed for write/replace in guarded mode.
   *  Directory-type paths (ending with "/") match by prefix;
   *  file-type paths match by exact filename or suffix (any path
   *  ending with "/<filename>"). Leading "./" is normalized and
   *  "~" is expanded to the home directory before matching. */
  allowWritePaths?: readonly string[];
}

export interface GuardMachine {
  /** Current state. */
  getState(): GuardState;
  /** Whether the guard is currently blocking tools. */
  isBlocking(): boolean;
  /** Check if a command string matches a target skill. */
  isTargetSkill(command: string): boolean;
  /** Process an input text to detect target skill commands. */
  handleInput(text: string): void;
  /** Handle agent_settled → transition to guarded if in skill_active. */
  handleAgentSettled(): void;
  /** Handle /guard:allow → transition to normal. */
  handleAllow(): void;
  /** Reset to normal state. */
  reset(): void;
  /** Rebuild state by scanning session history for target skill calls. */
  rebuildFromHistory(entries: readonly any[]): void;
  /** Check if a file path is allowed for write/replace in guarded mode.
   *  Directory paths in allowlist use prefix matching; file paths use exact
   *  or suffix match. Leading "./" is normalized, and "~" is expanded to
   *  the home directory before matching.
   *  File-type entries match by exact filename or as the last path component
   *  (e.g. "CONTEXT.md" matches both "CONTEXT.md" and "ri/CONTEXT.md"). */
  isPathAllowed(filePath: string): boolean;
}

// ── Defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_TARGET_SKILLS = [
  "to-spec",
  "to-tickets",
  "grill-me",
  "grill-with-docs",
  "wayfinder",
] as const;

export const DEFAULT_ALLOW_WRITE_PATHS = [
  ".scratch/",
  "docs/",
  "CONTEXT.md",
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract plain text content from a user/assistant message.
 *
 * Content can be:
 * - A plain string (returned as-is)
 * - An array of content parts (extract the first `type: "text"` part)
 * - null / undefined (return undefined)
 */
export function extractTextContent(
  content: string | ReadonlyArray<{ type: string; text?: string }> | null | undefined,
): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const first = content[0];
  if (typeof first === "object" && first !== null && "type" in first && first.type === "text") {
    return first.text;
  }
  return undefined;
}

// ── State machine factory ────────────────────────────────────────────────

export function createStateMachine(options?: GuardMachineOptions): GuardMachine {
  const targetSkills = options?.targetSkills ?? DEFAULT_TARGET_SKILLS;
  const allowWritePaths = options?.allowWritePaths ?? DEFAULT_ALLOW_WRITE_PATHS;
  let state: GuardState = "normal";

  return {
    getState(): GuardState {
      return state;
    },

    isBlocking(): boolean {
      return state === "guarded";
    },

    isTargetSkill(command: string): boolean {
      // Check /skill:<name> format (exact match)
      for (const skill of targetSkills) {
        if (command === `/skill:${skill}`) return true;
      }
      // Check <skill name="..."> XML tag format (search anywhere in text)
      const match = command.match(/<skill\s+name\s*=\s*(["'])([^"']+)\1[^>]*\/?\s*>/i);
      if (match) {
        return targetSkills.includes(match[2]);
      }
      return false;
    },

    handleInput(text: string): void {
      const extracted = extractTextContent(text) ?? text;
      const trimmed = extracted.trim();

      if (this.isTargetSkill(trimmed)) {
        state = "skill_active";
      }
      // Non-target-skill commands do not change state.
    },

    handleAgentSettled(): void {
      if (state === "skill_active") {
        state = "guarded";
      }
      // No-op in other states.
    },

    handleAllow(): void {
      state = "normal";
    },

    reset(): void {
      state = "normal";
    },

    rebuildFromHistory(entries: readonly any[]): void {
      for (const entry of entries) {
        // Duck-type: extract role and content from various entry shapes
        // SessionMessageEntry: { type: "message", message: { role, content } }
        // Test HistoryEntry: { role, content }
        const role = entry.role ?? entry.message?.role;
        if (role !== "user" && role !== "User") continue;

        // Try direct content field first, then message.content for SessionMessageEntry
        const rawContent = entry.content ?? entry.message?.content ?? "";
        const text = extractTextContent(rawContent) ?? "";
        const trimmed = text.trim();

        if (this.isTargetSkill(trimmed)) {
          state = "guarded";
          break; // Once we find one, we know we're in guarded territory.
        }
      }
    },

    isPathAllowed(filePath: string): boolean {
      // Normalize ./ prefix
      let normalized = filePath.startsWith("./") ? filePath.slice(2) : filePath;
      // Expand ~ to home directory for cross-project path support
      if (normalized.startsWith("~")) {
        const home = homedir();
        normalized = normalized === "~" ? home : home + normalized.slice(1);
      }
      for (const allowedPath of allowWritePaths) {
        if (allowedPath.endsWith("/")) {
          // Directory-type: prefix match
          if (normalized.startsWith(allowedPath)) return true;
        } else {
          // File-type: exact match or suffix match for any path ending with /<filename>
          if (normalized === allowedPath || normalized.endsWith("/" + allowedPath)) return true;
        }
      }
      return false;
    },
  };
}
