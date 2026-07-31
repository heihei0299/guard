/**
 * Guard Mode — core orchestration module.
 *
 * Assembles every Guard Mode module into a pi extension: registers the
 * `--guard` startup flag, the `guard_mode_question` / `guard_mode_complete`
 * tools, the `/guard` command, and the event hooks that enforce Guard
 * mode across the session lifecycle.
 *
 * The entry point (`index.ts`) is a thin forwarder to this module.
 */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu } from "@narumitw/pi-tui-kit";
import { showActiveImplementationMenu } from "./active-implementation-menu.ts";
import { completePlanArguments } from "./command.ts";
import {
  normalizePlanModeCompletion,
  PLAN_MODE_COMPLETE_PARAMS,
  GUARD_MODE_COMPLETE_TOOL_NAME,
  planModeCompleted,
  renderPlanModeCompletion,
} from "./completion-tool.ts";
import {
  isStaleExtensionContextError,
  onAgentSettled,
  setPlanThinkingLevel,
} from "./extension-runtime.ts";
import {
  injectActiveImplementationContext,
  invalidPlanMessage,
  isEmptyAssistantMessage,
  latestAssistantText,
  messageContainsInactivePlanModeArtifact,
  messageContainsLegacyPlanModeContextArtifact,
  messageContainsPlanModeImplementationContextArtifact,
  messageContainsPlanModeImplementationHandoff,
  parseProposedPlan,
  PLAN_IMPLEMENTATION_HANDOFF_PREFIX,
  stripPlanModeCompletionCallsFromMessage,
  stripPlanModeQuestionCallsFromMessage,
  stripProposedPlanBlocksFromMessage,
} from "./message-transform.ts";
import {
  clearPlanModeUi,
  planModeStatusText as formatPlanModeStatusText,
  updatePlanModeUi,
} from "./presentation.ts";
import { buildPlanModePrompt } from "./prompt.ts";
import {
  answerPlanModeQuestions,
  normalizePlanModeQuestionParams,
  PLAN_MODE_QUESTION_PARAMS,
  GUARD_MODE_QUESTION_TOOL_NAME,
  planModeQuestionCancelled,
} from "./question-tool.ts";
import { withoutRequiredPlanModeTools, withRequiredPlanModeTools } from "./required-tools.ts";
import {
  configuredThinkingLevel,
  type PlanModeFixedThinkingLevel,
  type PlanModeSettings,
  type PlanModeSettingsLoadResult,
  readPlanModeSettings,
} from "./settings.ts";
import { type PlanCompletionSource, type PlanModeState, restorePlanModeState } from "./state.ts";
import { enforcePlanSubagentAllowlist } from "./subagent-policy.ts";
import {
  ALLOWLISTED_BUILTIN_TOOLS,
  BLOCKED_BUILTIN_TOOLS,
  classifyPlanModeTool,
  DEFAULT_ALLOW_WRITE_PATHS,
  isPathAllowed,
  isSafeCommand,
  SAFE_BUILTIN_PLAN_TOOLS,
} from "./tool-policy.ts";
import { compareTools, isBuiltinTool, unique } from "./tool-selection.ts";

const STATE_ENTRY_TYPE = "guard_plan_mode_state";
const PROPOSED_PLAN_MESSAGE_TYPE = "proposed-plan";
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
const TOOL_SELECTOR_VIEWPORT_SIZE = 10;
const GUARD_ENABLED_NOTIFY = "Guard mode enabled. I will explore and plan, but not modify files.";
const GUARD_DISABLED_NOTIFY = "Guard mode disabled. Proposed plan discarded.";
const ACTIVE_PLAN_CLEARED_NOTIFY = "Active implementation plan cleared.";
const PROPOSED_PLAN_HEADING = "**Proposed Plan**";

export interface GuardExtensionOptions {
  /** Override the settings loader (used by tests; defaults to readPlanModeSettings). */
  readSettings?(): Promise<PlanModeSettingsLoadResult>;
}

interface ReadyPresentationIntent {
  nonce: number;
  plan: string;
  source: PlanCompletionSource;
}

/**
 * Create a Guard Mode extension instance.
 *
 * Usage:
 * ```typescript
 * export default createGuard();
 * ```
 */
export function createGuard(options: GuardExtensionOptions = {}) {
  return function guardExtension(pi: ExtensionAPI): void {
    let state: PlanModeState = { enabled: false, awaitingAction: false };
    let settings: PlanModeSettings = { thinkingLevel: "inherit" };
    let previousTools: string[] | undefined;
    let readyPresentationIntent: ReadyPresentationIntent | undefined;
    let nextReadyPresentationNonce = 0;
    let menuGeneration = 0;
    let workflowGeneration = 0;
    let menuController = new AbortController();

    pi.registerFlag("guard", {
      description: "Start in Guard mode",
      type: "boolean",
      default: false,
    });

    pi.registerTool({
      name: GUARD_MODE_QUESTION_TOOL_NAME,
      label: "Plan question",
      description:
        "Ask the user one to three Guard-mode clarification questions with meaningful options, then wait for the answer. Only available while Guard mode is active.",
      promptSnippet: "Ask user decision questions while Guard mode is active",
      promptGuidelines: [
        "In Guard mode, use guard_mode_question for important preferences, tradeoffs, or assumptions that cannot be discovered from read-only exploration.",
      ],
      parameters: PLAN_MODE_QUESTION_PARAMS,
      async execute(_toolCallId, params: unknown, _signal, _onUpdate, ctx) {
        if (!state.enabled) {
          return planModeQuestionCancelled(
            [],
            "plan_mode_inactive",
            "Error: guard_mode_question is only available while Guard mode is active.",
          );
        }

        const parsed = normalizePlanModeQuestionParams(params);
        if (!parsed.ok) {
          return planModeQuestionCancelled([], "invalid_input", `Error: ${parsed.error}`);
        }

        if (!ctx.hasUI) {
          return planModeQuestionCancelled(
            parsed.questions,
            "ui_unavailable",
            "Unable to ask Guard-mode questions because interactive UI is not available.",
          );
        }

        const sessionGeneration = menuGeneration;
        const questionWorkflowGeneration = workflowGeneration;
        return answerPlanModeQuestions(parsed.questions, ctx, {
          isCurrent: () =>
            sessionGeneration === menuGeneration &&
            questionWorkflowGeneration === workflowGeneration,
          isEnabled: () => state.enabled,
        });
      },
    });

    pi.registerTool({
      name: GUARD_MODE_COMPLETE_TOOL_NAME,
      label: "Complete plan",
      description:
        "Submit the complete decision-ready implementation plan for user review. Only available while Guard mode is active, and must be the final standalone action.",
      promptSnippet: "Submit the final Guard-mode implementation plan",
      promptGuidelines: [
        "Call guard_mode_complete alone as the final action only after the implementation plan is decision-complete.",
      ],
      parameters: PLAN_MODE_COMPLETE_PARAMS,
      renderResult: renderPlanModeCompletion,
      async execute(_toolCallId, params: unknown, _signal, _onUpdate, ctx) {
        if (!state.enabled) {
          throw new Error("guard_mode_complete is only available while Guard mode is active");
        }
        const parsed = normalizePlanModeCompletion(params);
        if (!parsed.ok) throw new Error(parsed.error);

        acceptCompletedPlan(parsed.plan, GUARD_MODE_COMPLETE_TOOL_NAME, ctx);
        return planModeCompleted(parsed.plan);
      },
    });

    pi.registerCommand("guard", {
      description: "Enter or manage Guard mode",
      getArgumentCompletions: completePlanArguments,
      handler: async (args, ctx) => {
        const prompt = args.trim();
        const command = prompt.toLowerCase();
        if (command === "show") {
          showStoredPlan(ctx);
          return;
        }
        if (command === "finalize") {
          requestFinalPlan(ctx);
          return;
        }
        if (command === "implement") {
          if (!state.enabled || !state.latestPlan?.trim()) {
            notifyOrThrow(ctx, "No completed plan is available to implement.", "warning");
            return;
          }
          startImplementation(ctx);
          return;
        }
        if (command === "exit" || command === "off") {
          const hadActiveImplementation = state.activeImplementation !== undefined;
          exitPlanMode(ctx);
          ctx.ui.notify(
            hadActiveImplementation ? ACTIVE_PLAN_CLEARED_NOTIFY : GUARD_DISABLED_NOTIFY,
            "info",
          );
          return;
        }
        if (command === "tools") {
          if (!state.enabled) enterPlanMode(ctx);
          await showToolSelector(ctx);
          return;
        }
        if (prompt) {
          enterPlanModeWithPrompt(prompt, ctx);
          return;
        }
        if (!state.enabled) {
          if (state.activeImplementation && ctx.hasUI) {
            await showActivePlanMenu(ctx);
            return;
          }
          enterPlanMode(ctx);
          ctx.ui.notify(GUARD_ENABLED_NOTIFY, "info");
          return;
        }
        await showPlanMenu(ctx);
      },
    });

    pi.on("session_start", async (_event, ctx) => {
      const generation = ++menuGeneration;
      menuController.abort(new DOMException("Guard-mode session replaced", "AbortError"));
      menuController = new AbortController();
      readyPresentationIntent = undefined;
      settings = { thinkingLevel: "inherit" };
      restoreState(ctx);
      const loadedSettings = await (options.readSettings?.() ?? readPlanModeSettings());
      if (generation !== menuGeneration || menuController.signal.aborted) return;
      if (loadedSettings.kind === "loaded") settings = loadedSettings.settings;
      else if (loadedSettings.kind === "invalid") {
        ctx.ui.notify(`Guard mode settings ignored: ${loadedSettings.reason}`, "warning");
      }
      if (loadedSettings.notice) ctx.ui.notify(loadedSettings.notice, "warning");
      const persistFlagActivation = pi.getFlag("guard") === true && !state.enabled;
      if (persistFlagActivation) {
        state = { ...state, enabled: true, activeImplementation: undefined };
      }
      if (state.enabled) {
        activatePlanModeTools();
        applyPlanThinkingLevel();
      } else {
        deactivatePlanModeQuestionTool();
      }
      if (persistFlagActivation) persistState();
      updateUi(ctx);
    });

    pi.on("thinking_level_select", (event) => {
      if (!state.enabled || !state.appliedThinkingLevel) return;
      if (event.level !== state.appliedThinkingLevel) {
        state = {
          ...state,
          manualThinkingLevel: event.level,
          previousThinkingLevel: undefined,
          appliedThinkingLevel: undefined,
        };
        persistState();
      }
    });

    pi.on("session_shutdown", (_event, ctx) => {
      menuGeneration += 1;
      menuController.abort(new DOMException("Guard-mode session shut down", "AbortError"));
      readyPresentationIntent = undefined;
      captureManualThinkingLevel();
      persistState();
      if (state.enabled) {
        restoreTools();
        restoreThinkingLevel();
      }
      clearUi(ctx);
    });

    pi.on("tool_call", async (event) => {
      if (!state.enabled) return;
      if (event.toolName === "update_plan") {
        return {
          block: true,
          reason:
            "Guard mode blocks update_plan because it tracks execution progress rather than conversational planning.",
        };
      }
      if (settings.allowedPlanSubagents !== undefined) {
        const blocked = enforcePlanSubagentAllowlist(
          event.toolName,
          event.input,
          settings.allowedPlanSubagents,
        );
        if (blocked) return blocked;
      }
      const calledTool = toolByName(event.toolName);
      if (calledTool && classifyPlanModeTool(calledTool) === "blocked") {
        return {
          block: true,
          reason: `Guard mode blocks built-in tool '${event.toolName}' because its policy class is blocked.`,
        };
      }
      if (!calledTool && BLOCKED_BUILTIN_TOOLS.has(event.toolName)) {
        return {
          block: true,
          reason: `Guard mode blocks built-in tool '${event.toolName}' because its metadata is unavailable.`,
        };
      }
      const policy = calledTool ? classifyPlanModeTool(calledTool) : undefined;
      if (policy === "allowlisted") {
        const path = readPath(event.input);
        if (isPathAllowed(path)) return;
        return {
          block: true,
          reason: `Guard mode blocks write to '${path}'. Allowed: ${DEFAULT_ALLOW_WRITE_PATHS.join(", ")}`,
        };
      }
      if (event.toolName !== "bash") return;

      const command = typeof event.input.command === "string" ? event.input.command : "";
      if (!isSafeCommand(command)) {
        return {
          block: true,
          reason: `Guard mode blocks mutating or non-allowlisted bash commands.\nCommand: ${command}`,
        };
      }
    });

    pi.on("context", async (event) => {
      const messagesWithoutPlanContext = event.messages.filter(
        (message: unknown) =>
          !messageContainsLegacyPlanModeContextArtifact(message) &&
          !messageContainsPlanModeImplementationContextArtifact(message),
      );
      if (state.enabled) {
        return {
          messages: messagesWithoutPlanContext.filter(
            (message: unknown) => !messageContainsPlanModeImplementationHandoff(message),
          ),
        };
      }
      const inactiveMessages = state.activeImplementation
        ? messagesWithoutPlanContext
        : messagesWithoutPlanContext.filter(
            (message: unknown) => !messageContainsPlanModeImplementationHandoff(message),
          );
      const messages = inactiveMessages
        .filter((message: unknown) => !messageContainsInactivePlanModeArtifact(message))
        .map(stripProposedPlanBlocksFromMessage)
        .map(stripPlanModeCompletionCallsFromMessage)
        .map(stripPlanModeQuestionCallsFromMessage)
        .filter((message: unknown) => !isEmptyAssistantMessage(message));
      const contextualMessages = state.activeImplementation
        ? injectActiveImplementationContext(messages, state.activeImplementation)
        : messages;
      return { messages: contextualMessages as typeof event.messages };
    });

    pi.on("before_agent_start", (event, ctx) => {
      if (!state.enabled) return;
      if (state.latestPlan || state.awaitingAction) {
        readyPresentationIntent = undefined;
        state = {
          ...state,
          latestPlan: undefined,
          latestPlanSource: undefined,
          awaitingAction: false,
        };
        persistState();
        updateUi(ctx);
      }
      applyPlanModeTools();
      return {
        systemPrompt: `${event.systemPrompt}\n\n${buildPlanModePrompt(state)}`,
      };
    });

    pi.on("agent_end", async (event, ctx) => {
      if (!state.enabled) return;

      const text = latestAssistantText(event.messages);
      const parsedPlan = parseProposedPlan(text);
      if (parsedPlan.kind !== "valid") {
        if (parsedPlan.kind !== "absent") {
          ctx.ui.notify(invalidPlanMessage(parsedPlan.kind), "warning");
        }
        persistState();
        updateUi(ctx);
        return;
      }
      acceptCompletedPlan(parsedPlan.plan, "legacy_proposed_plan", ctx);
    });

    onAgentSettled(pi, async (_event, ctx) => {
      const intent = readyPresentationIntent;
      if (!intent || !readyPresentationIsCurrent(intent)) return;
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

      readyPresentationIntent = undefined;
      try {
        if (intent.source === "legacy_proposed_plan") {
          pi.sendMessage(
            {
              customType: PROPOSED_PLAN_MESSAGE_TYPE,
              content: `${PROPOSED_PLAN_HEADING}\n\n${intent.plan}`,
              display: true,
            },
            { triggerTurn: false },
          );
        }
        if (ctx.hasUI && completedPlanIsCurrent(intent)) {
          await showPlanReadyMenu(ctx);
        }
      } catch (error: unknown) {
        if (!isStaleExtensionContextError(error)) throw error;
      }
    });

    // ── Command lifecycle ──────────────────────────────────────────────

    /**
     * Notify in UI-capable modes; reject in print/JSON modes where
     * ctx.ui.notify is a no-op, so commands never fail silently.
     */
    function notifyOrThrow(ctx: ExtensionContext, message: string, level: "info" | "warning" = "info") {
      if (ctx.hasUI) {
        ctx.ui.notify(message, level);
        return;
      }
      throw new Error(message);
    }

    function enterPlanMode(ctx: ExtensionContext) {
      workflowGeneration += 1;
      if (!state.enabled) previousTools = withoutRequiredPlanModeTools(safeGetActiveTools());
      state = {
        ...state,
        enabled: true,
        awaitingAction: false,
        activeImplementation: undefined,
      };
      activatePlanModeTools();
      applyPlanThinkingLevel();
      persistState();
      updateUi(ctx);
    }

    function enterPlanModeWithPrompt(prompt: string, ctx: ExtensionContext) {
      const previousState = state;
      const wasEnabled = state.enabled;
      enterPlanMode(ctx);
      if (!wasEnabled) {
        ctx.ui.notify(GUARD_ENABLED_NOTIFY, "info");
      }
      if (sendPlanModeUserMessage(prompt, ctx)) return;
      if (!previousState.enabled) {
        restoreTools();
        restoreThinkingLevel();
      }
      state = previousState;
      persistState();
      updateUi(ctx);
    }

    function exitPlanMode(ctx: ExtensionContext) {
      workflowGeneration += 1;
      const wasEnabled = state.enabled;
      readyPresentationIntent = undefined;
      state = {
        ...state,
        enabled: false,
        latestPlan: undefined,
        latestPlanSource: undefined,
        awaitingAction: false,
        activeImplementation: undefined,
        manualThinkingLevel: undefined,
      };
      if (wasEnabled) {
        restoreTools();
        restoreThinkingLevel();
      }
      persistState();
      updateUi(ctx);
    }

    function sendPlanModeUserMessage(message: string, ctx: ExtensionContext) {
      try {
        if (ctx.isIdle()) pi.sendUserMessage(message);
        else pi.sendUserMessage(message, { deliverAs: "followUp" });
        return true;
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to send Guard-mode message: ${detail}`, "error");
        return false;
      }
    }

    function startImplementation(ctx: ExtensionContext) {
      const plan = state.latestPlan?.trim();
      const source = state.latestPlanSource ?? "legacy_proposed_plan";
      if (!plan) {
        ctx.ui.notify("Guard mode disabled. No proposed plan is available to implement.", "warning");
        return;
      }

      workflowGeneration += 1;
      const wasEnabled = state.enabled;
      readyPresentationIntent = undefined;
      state = {
        ...state,
        enabled: false,
        latestPlan: undefined,
        latestPlanSource: undefined,
        awaitingAction: false,
        activeImplementation: {
          id: randomUUID(),
          plan,
          source,
          startedAt: Date.now(),
        },
        manualThinkingLevel: undefined,
      };
      if (wasEnabled) {
        restoreTools();
        restoreThinkingLevel();
      }
      persistState();
      updateUi(ctx);

      const sent = sendPlanModeUserMessage(
        `${PLAN_IMPLEMENTATION_HANDOFF_PREFIX}\n\n${plan}`,
        ctx,
      );
      if (!sent) {
        enterPlanMode(ctx);
        state = { ...state, latestPlan: plan, latestPlanSource: source, awaitingAction: true };
        persistState();
        updateUi(ctx);
      }
    }

    function showStoredPlan(ctx: ExtensionContext) {
      const readyPlan = state.enabled ? state.latestPlan?.trim() : undefined;
      const activePlan = state.activeImplementation?.plan.trim();
      const plan = readyPlan ?? activePlan;
      if (!plan) {
        notifyOrThrow(
          ctx,
          "No completed plan is available. Use /guard finalize when planning is complete.",
          "info",
        );
        return;
      }
      try {
        pi.sendMessage(
          {
            customType: PROPOSED_PLAN_MESSAGE_TYPE,
            content: `**${readyPlan ? "Proposed Plan" : "Active Implementation Plan"}**\n\n${plan}`,
            display: true,
          },
          { triggerTurn: false },
        );
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to show completed plan: ${detail}`, "error");
      }
    }

    function requestFinalPlan(ctx: ExtensionContext) {
      if (!state.enabled) {
        notifyOrThrow(ctx, "Guard mode is not active. Use /guard first.", "warning");
        return;
      }
      sendPlanModeUserMessage(
        "Finalize the current implementation plan now. If any material decision remains, use guard_mode_question instead. Otherwise call guard_mode_complete alone as your final action with the complete decision-ready plan.",
        ctx,
      );
    }

    // ── Menus ──────────────────────────────────────────────────────────

    async function showActivePlanMenu(ctx: ExtensionContext) {
      if (!ctx.hasUI) {
        notifyOrThrow(ctx, planStatusText());
        return;
      }
      const lifecycle = captureMenuLifecycle();
      await showActiveImplementationMenu(ctx, {
        statusText: planStatusText(),
        signal: lifecycle.signal,
        isCurrent: lifecycle.isCurrent,
        show: () => showStoredPlan(ctx),
        startNew: () => {
          enterPlanMode(ctx);
          ctx.ui.notify(GUARD_ENABLED_NOTIFY, "info");
        },
        clear: () => {
          exitPlanMode(ctx);
          ctx.ui.notify(ACTIVE_PLAN_CLEARED_NOTIFY, "info");
        },
      });
    }

    async function showPlanMenu(ctx: ExtensionContext) {
      if (!ctx.hasUI) {
        notifyOrThrow(ctx, planStatusText());
        return;
      }
      const lifecycle = captureMenuLifecycle();
      type Action = "show" | "finalize" | "implement" | "tools" | "stay" | "exit";
      const menu = defineMenu<undefined, "main", Action, ExtensionContext>({
        start: "main",
        screens: {
          main: () => ({
            kind: "actions",
            title: "Guard mode",
            lines: [planStatusText()],
            items: state.latestPlan
              ? [
                  { id: "show", label: "Show latest proposed plan", action: "show" },
                  { id: "implement", label: "Implement this plan", action: "implement" },
                  { id: "tools", label: "Configure Guard-mode tools", action: "tools" },
                  { id: "stay", label: "Stay in Guard mode", action: "stay" },
                  { id: "exit", label: "Exit Guard mode", action: "exit" },
                ]
              : [
                  { id: "finalize", label: "Request final plan", action: "finalize" },
                  { id: "tools", label: "Configure Guard-mode tools", action: "tools" },
                  { id: "stay", label: "Stay in Guard mode", action: "stay" },
                  { id: "exit", label: "Exit Guard mode", action: "exit" },
                ],
            hint: "close",
          }),
        },
        actions: {
          show: async () => {
            showStoredPlan(ctx);
            return { kind: "close" };
          },
          finalize: async () => {
            requestFinalPlan(ctx);
            return { kind: "close" };
          },
          implement: async () => {
            startImplementation(ctx);
            return { kind: "close" };
          },
          tools: async () => {
            await showToolSelector(ctx);
            return { kind: "stay" };
          },
          stay: async () => {
            updateUi(ctx);
            return { kind: "close" };
          },
          exit: async () => {
            exitPlanMode(ctx);
            ctx.ui.notify(GUARD_DISABLED_NOTIFY, "info");
            return { kind: "close" };
          },
        },
      });
      await runMenu(ctx, menu, {
        getState: () => undefined,
        ...lifecycle,
      });
    }

    async function showPlanReadyMenu(ctx: ExtensionContext) {
      const lifecycle = captureMenuLifecycle();
      type Action = "implement" | "stay" | "exit";
      const menu = defineMenu<undefined, "ready", Action, ExtensionContext>({
        start: "ready",
        screens: {
          ready: () => ({
            kind: "actions",
            title: "Proposed plan ready. What next?",
            items: [
              { id: "implement", label: "Implement this plan", action: "implement" },
              { id: "stay", label: "Stay in Guard mode", action: "stay" },
              { id: "exit", label: "Exit Guard mode", action: "exit" },
            ],
            hint: "close",
          }),
        },
        actions: {
          implement: async () => {
            startImplementation(ctx);
            return { kind: "close" };
          },
          stay: async () => ({ kind: "close" }),
          exit: async () => {
            exitPlanMode(ctx);
            ctx.ui.notify(GUARD_DISABLED_NOTIFY, "info");
            return { kind: "close" };
          },
        },
      });
      await runMenu(ctx, menu, {
        getState: () => undefined,
        ...lifecycle,
      });
    }

    async function showToolSelector(ctx: ExtensionContext) {
      if (!ctx.hasUI) {
        notifyOrThrow(ctx, formatToolSummary());
        return;
      }
      const lifecycle = captureMenuLifecycle();
      const tools = selectableTools();
      const toolById = new Map(tools.map((tool, index) => [`${index}:${tool.name}`, tool]));
      const menu = defineMenu<undefined, "tools", "toggle", ExtensionContext>({
        start: "tools",
        screens: {
          tools: () => {
            const selectedNames = resolvePlanModeSelectedNames(tools);
            return {
              kind: "multiSelect",
              title: "Guard-mode tools",
              lines: ["Non-built-in tools run at user risk."],
              enableSearch: true,
              viewportSize: TOOL_SELECTOR_VIEWPORT_SIZE,
              items: tools.map((tool, index) => {
                const selectable = canSelectToolInPlanMode(tool);
                return {
                  id: `${index}:${tool.name}`,
                  label: tool.name,
                  description: `${toolPolicyLabel(tool)} · ${tool.description}`,
                  searchText: [toolPolicyLabel(tool), tool.description].filter(Boolean).join(" "),
                  selected: selectedNames.has(tool.name),
                  disabled: !selectable,
                  disabledReason: selectable ? undefined : "Blocked by Guard-mode policy",
                };
              }),
              action: "toggle",
              hint: "close",
              doneLabel: "Done",
            };
          },
        },
        actions: {
          toggle: async ({ itemId, selected }) => {
            const tool = toolById.get(itemId);
            if (!tool || !canSelectToolInPlanMode(tool)) return { kind: "rejected" };
            const names = resolvePlanModeSelectedNames(tools);
            if (selected) names.add(tool.name);
            else {
              names.delete(tool.name);
              // 用户显式取消 allowlisted 工具（如 write）：同时从宿主活动集
              // 移除，否则 applyPlanModeTools 的合并逻辑会把它重新注入，
              // 导致宿主激活的 write 永远无法被取消。
              // 条件与 isAllowlistedToolName 对齐：仅内置 allowlisted 工具。
              if (
                ALLOWLISTED_BUILTIN_TOOLS.has(tool.name) &&
                isBuiltinTool(tool)
              ) {
                pi.setActiveTools(
                  safeGetActiveTools().filter((name) => name !== tool.name),
                );
              }
            }
            state = {
              ...state,
              selectedToolNames: filterAvailableSelectedNames(Array.from(names), tools),
            };
            applyPlanModeTools();
            persistState();
            updateUi(ctx);
            return { kind: "stay" };
          },
        },
      });
      await runMenu(ctx, menu, {
        getState: () => undefined,
        ...lifecycle,
      });
      if (!lifecycle.isCurrent()) return;
      applyPlanModeTools();
      persistState();
      updateUi(ctx);
    }

    function captureMenuLifecycle() {
      const sessionGeneration = menuGeneration;
      const planWorkflowGeneration = workflowGeneration;
      const controller = menuController;
      return {
        signal: controller.signal,
        isCurrent: () =>
          sessionGeneration === menuGeneration &&
          planWorkflowGeneration === workflowGeneration &&
          !controller.signal.aborted,
      };
    }

    // ── Tool management ────────────────────────────────────────────────

    function activatePlanModeTools() {
      previousTools ??= withoutRequiredPlanModeTools(safeGetActiveTools());
      applyPlanModeTools();
    }

    function applyPlanModeTools() {
      const planned = planModeToolNames();
      // Preserve allowlisted tools the host/user activated (e.g. write,
      // replace) on top of the planned set: without this, before_agent_start
      // would silently drop a host-activated write tool every turn.
      // Tools already active before entering Guard mode are excluded — they
      // are restored from previousTools on exit and must not leak into the
      // planned set.
      const hostAllowlisted = safeGetActiveTools().filter(
        (name) => !previousTools?.includes(name) && isAllowlistedToolName(name),
      );
      pi.setActiveTools(unique([...planned, ...hostAllowlisted]));
    }

    function isAllowlistedToolName(name: string) {
      if (!ALLOWLISTED_BUILTIN_TOOLS.has(name)) return false;
      const tool = toolByName(name);
      // Only built-in allowlisted tools (write/replace) are merged in: a
      // user/extension tool that happens to share the name is user-opt-in
      // and must not bypass the opt-in gate via the host-active merge.
      return tool !== undefined && isBuiltinTool(tool) && canSelectToolInPlanMode(tool);
    }

    function planModeToolNames() {
      const tools = selectableTools();
      if (
        tools.length === 0 &&
        state.selectedToolNames === undefined &&
        settings.defaultPlanTools === undefined
      ) {
        return ["read", "bash", GUARD_MODE_QUESTION_TOOL_NAME, GUARD_MODE_COMPLETE_TOOL_NAME];
      }

      const selectedNames = resolvePlanModeSelectedNames(tools);
      return withRequiredPlanModeTools(
        tools
          .filter((tool) => selectedNames.has(tool.name) && canSelectToolInPlanMode(tool))
          .map((tool) => tool.name),
      );
    }

    function resolvePlanModeSelectedNames(tools: ToolInfo[]) {
      const selectedToolNames = state.selectedToolNames;
      if (selectedToolNames === undefined) return new Set(defaultPlanModeToolNames(tools));

      state = {
        ...state,
        selectedToolNames: filterAvailableSelectedNames(selectedToolNames, tools),
      };
      return new Set(state.selectedToolNames);
    }

    function defaultPlanModeToolNames(tools: ToolInfo[]) {
      if (settings.defaultPlanTools !== undefined) {
        return filterAvailableSelectedNames(settings.defaultPlanTools, tools);
      }
      return tools
        .filter(
          (tool) =>
            isBuiltinTool(tool) &&
            (SAFE_BUILTIN_PLAN_TOOLS.has(tool.name) || tool.name === "bash") &&
            canSelectToolInPlanMode(tool),
        )
        .map((tool) => tool.name);
    }

    function filterAvailableSelectedNames(names: string[], tools: ToolInfo[]) {
      const availableNames = new Set(tools.filter(canSelectToolInPlanMode).map((tool) => tool.name));
      return unique(names.filter((name) => availableNames.has(name)));
    }

    function selectableTools() {
      return safeGetAllTools()
        .filter(
          (tool) =>
            tool.name !== GUARD_MODE_QUESTION_TOOL_NAME && tool.name !== GUARD_MODE_COMPLETE_TOOL_NAME,
        )
        .sort(compareTools);
    }

    function safeGetAllTools() {
      try {
        return pi.getAllTools();
      } catch {
        return [];
      }
    }

    function safeGetActiveTools() {
      try {
        return pi.getActiveTools();
      } catch {
        return DEFAULT_TOOLS;
      }
    }

    function restoreTools() {
      const restoredTools = previousTools ?? DEFAULT_TOOLS;
      pi.setActiveTools(withoutRequiredPlanModeTools(restoredTools));
      previousTools = undefined;
    }

    // ── State persistence and UI ───────────────────────────────────────

    function restoreState(ctx: ExtensionContext) {
      state = restorePlanModeState(ctx.sessionManager.getBranch(), STATE_ENTRY_TYPE);
    }

    function persistState() {
      pi.appendEntry<PlanModeState>(STATE_ENTRY_TYPE, state);
    }

    function updateUi(ctx: ExtensionContext) {
      updatePlanModeUi(ctx, state, formatToolSummary);
    }

    function clearUi(ctx: ExtensionContext) {
      clearPlanModeUi(ctx);
    }

    function planStatusText() {
      return formatPlanModeStatusText(state, formatToolSummary);
    }

    function formatToolSummary() {
      const names = planModeToolNames();
      return `Tools: ${names.length > 0 ? names.join(", ") : "none"}`;
    }

    function toolByName(toolName: string) {
      return safeGetAllTools().find((candidate) => candidate.name === toolName);
    }

    function readPath(input: unknown) {
      const candidate = input as { path?: unknown } | undefined;
      return typeof candidate?.path === "string" ? candidate.path : "";
    }

    function deactivatePlanModeQuestionTool() {
      const activeTools = safeGetActiveTools();
      const filteredTools = withoutRequiredPlanModeTools(activeTools);
      if (filteredTools.length !== activeTools.length) {
        pi.setActiveTools(filteredTools);
      }
    }

    // ── Thinking level management ──────────────────────────────────────

    function applyPlanThinkingLevel() {
      if (state.manualThinkingLevel) {
        if (pi.getThinkingLevel() !== state.manualThinkingLevel) {
          setPlanThinkingLevel(pi, state.manualThinkingLevel as PlanModeFixedThinkingLevel);
        }
        return;
      }
      const configured = configuredThinkingLevel(settings);
      if (!configured) {
        state = {
          ...state,
          previousThinkingLevel: undefined,
          appliedThinkingLevel: undefined,
        };
        return;
      }
      const current = pi.getThinkingLevel();
      if (!state.appliedThinkingLevel) state.previousThinkingLevel = current;
      if (current !== configured) setPlanThinkingLevel(pi, configured);
      state.appliedThinkingLevel = pi.getThinkingLevel();
    }

    function captureManualThinkingLevel() {
      if (!state.appliedThinkingLevel) return;
      const current = pi.getThinkingLevel();
      if (current === state.appliedThinkingLevel) return;
      state = {
        ...state,
        manualThinkingLevel: current,
        previousThinkingLevel: undefined,
        appliedThinkingLevel: undefined,
      };
    }

    function restoreThinkingLevel() {
      captureManualThinkingLevel();
      const { appliedThinkingLevel, previousThinkingLevel } = state;
      if (
        appliedThinkingLevel &&
        previousThinkingLevel &&
        pi.getThinkingLevel() === appliedThinkingLevel
      ) {
        setPlanThinkingLevel(pi, previousThinkingLevel as PlanModeFixedThinkingLevel);
      }
      state = { ...state, appliedThinkingLevel: undefined, previousThinkingLevel: undefined };
    }

    // ── Local policy helpers ───────────────────────────────────────────

    function canSelectToolInPlanMode(tool: ToolInfo) {
      return classifyPlanModeTool(tool) !== "blocked";
    }

    function toolPolicyLabel(tool: ToolInfo) {
      const policy = classifyPlanModeTool(tool);
      if (policy === "read-only") return "built-in read-only";
      if (policy === "limited") return "built-in limited";
      if (policy === "allowlisted") return "built-in allowlisted";
      if (policy === "blocked") return "built-in blocked";
      return `user opt-in: ${toolSourceLabel(tool)}`;
    }

    function toolSourceLabel(tool: ToolInfo) {
      const sourceInfo = tool.sourceInfo;
      const source = `${sourceInfo.scope}/${sourceInfo.source}`;
      return sourceInfo.path ? `${source} ${sourceInfo.path}` : source;
    }

    // ── Plan acceptance ───────────────────────────────────────────────

    function acceptCompletedPlan(plan: string, source: PlanCompletionSource, ctx: ExtensionContext) {
      const normalized = normalizePlanModeCompletion({ plan });
      if (!normalized.ok) {
        ctx.ui.notify(`Proposed plan is not ready: ${normalized.error}.`, "warning");
        persistState();
        updateUi(ctx);
        return;
      }
      if (
        state.enabled &&
        state.awaitingAction &&
        state.latestPlan === normalized.plan &&
        state.latestPlanSource === source
      ) {
        return;
      }
      state = {
        ...state,
        latestPlan: normalized.plan,
        latestPlanSource: source,
        awaitingAction: true,
      };
      readyPresentationIntent = {
        nonce: ++nextReadyPresentationNonce,
        plan: normalized.plan,
        source,
      };
      persistState();
      updateUi(ctx);
    }

    function completedPlanIsCurrent(intent: ReadyPresentationIntent) {
      return (
        state.enabled &&
        state.awaitingAction &&
        state.latestPlan === intent.plan &&
        state.latestPlanSource === intent.source
      );
    }

    function readyPresentationIsCurrent(intent: ReadyPresentationIntent) {
      return completedPlanIsCurrent(intent) && readyPresentationIntent?.nonce === intent.nonce;
    }
  };
}

/** Default export: Guard Mode extension with default options. */
export default createGuard();
