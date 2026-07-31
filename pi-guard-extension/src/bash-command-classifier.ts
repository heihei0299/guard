/**
 * @deprecated This module is being replaced by tool-policy.ts.
 * Retained as a stub for backward compatibility during migration.
 * The new bash safety logic lives in `./tool-policy.ts` (`isSafeCommand`).
 */

import { isSafeCommand } from "./tool-policy.ts";

// ── Types ──────────────────────────────────────────────────────────────────

/** @deprecated Use the options in PlanModeSettings / SafeSubcommands instead. */
export interface BashClassifierConfig {
  readonlyCommands: readonly string[];
  writeCommands: readonly string[];
  passthroughCommands: readonly string[];
  gitReadonlySubcommands: readonly string[];
  gitWriteSubcommands: readonly string[];
}

// ── Backward-compatible stub ───────────────────────────────────────────────

/**
 * @deprecated Use `isSafeCommand()` from `./tool-policy.ts` instead.
 */
export function createBashClassifier(_config: BashClassifierConfig): (command: string) => boolean {
  return (command: string): boolean => {
    return isSafeCommand(command);
  };
}

/**
 * @deprecated Use `isSafeCommand()` from `./tool-policy.ts` instead.
 *
 * This is the default classifier instance. It delegates to the new
 * isSafeCommand function for all classification.
 */
export const isBashReadonly = createBashClassifier({
  readonlyCommands: [],
  writeCommands: [],
  passthroughCommands: [],
  gitReadonlySubcommands: [],
  gitWriteSubcommands: [],
});
