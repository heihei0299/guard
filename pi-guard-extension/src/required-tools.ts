/**
 * Guard Plan Mode required tools management.
 *
 * Manages the two mandatory Plan Mode tools:
 * - plan_mode_question: Ask structured questions during planning
 * - plan_mode_complete: Submit a completed plan for review
 *
 * These tools must always be available while Plan Mode is active.
 */

import { unique } from "./tool-selection.ts";
import { PLAN_MODE_QUESTION_TOOL_NAME } from "./question-tool.ts";
import { PLAN_MODE_COMPLETE_TOOL_NAME } from "./completion-tool.ts";

/**
 * Ensure the Plan Mode required tools are present in a tool name array.
 * Adds them at the end if missing, avoids duplicates.
 */
export function withRequiredPlanModeTools(toolNames: string[]): string[] {
  return unique([
    ...withoutRequiredPlanModeTools(toolNames),
    PLAN_MODE_QUESTION_TOOL_NAME,
    PLAN_MODE_COMPLETE_TOOL_NAME,
  ]);
}

/**
 * Remove only the question tool from a tool name array.
 * The complete tool is preserved.
 */
export function withoutPlanModeQuestionTool(toolNames: string[]): string[] {
  return toolNames.filter((toolName) => toolName !== PLAN_MODE_QUESTION_TOOL_NAME);
}

/**
 * Remove both required Plan Mode tools from a tool name array.
 */
export function withoutRequiredPlanModeTools(toolNames: string[]): string[] {
  return toolNames.filter(
    (toolName) =>
      toolName !== PLAN_MODE_QUESTION_TOOL_NAME && toolName !== PLAN_MODE_COMPLETE_TOOL_NAME,
  );
}
