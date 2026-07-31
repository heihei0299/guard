/**
 * Guard Plan Mode question tool helpers.
 *
 * Pure validation, interaction, and result-formatting logic for the
 * `plan_mode_question` tool. Tool registration lives in the extension
 * entry point (index.ts).
 */

export const PLAN_MODE_QUESTION_TOOL_NAME = "plan_mode_question";

export type PlanModeQuestionOption = {
  label: string;
  description?: string;
};

export type PlanModeQuestion = {
  id: string;
  header: string;
  question: string;
  options: PlanModeQuestionOption[];
};

export const PLAN_MODE_QUESTION_PARAMS = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      description: "Questions to show the user. Prefer 1 and do not exceed 3.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "header", "question", "options"],
        properties: {
          id: {
            type: "string",
            description: "Stable identifier for mapping answers (snake_case).",
          },
          header: {
            type: "string",
            description: "Short header label shown in the UI (12 or fewer chars).",
          },
          question: { type: "string", description: "Single-sentence prompt shown to the user." },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            description:
              "Provide 2-4 mutually exclusive choices. Put the recommended option first when there is a clear default.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "description"],
              properties: {
                label: { type: "string", description: "User-facing label (1-5 words)." },
                description: {
                  type: "string",
                  description: "One short sentence explaining impact/tradeoff if selected.",
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

type NormalizePlanModeQuestionParamsResult =
  | { ok: true; questions: PlanModeQuestion[] }
  | { ok: false; error: string };

/**
 * Validate and normalize the `plan_mode_question` tool input.
 * Returns the normalized questions on success, or an error message.
 */
export function normalizePlanModeQuestionParams(
  input: unknown,
): NormalizePlanModeQuestionParamsResult {
  if (!isRecord(input) || !Array.isArray(input.questions)) {
    return { ok: false, error: "questions must be an array" };
  }
  if (input.questions.length < 1 || input.questions.length > 3) {
    return { ok: false, error: "questions must contain 1-3 items" };
  }

  const questions: PlanModeQuestion[] = [];
  for (const [questionIndex, rawQuestion] of input.questions.entries()) {
    if (!isRecord(rawQuestion)) {
      return { ok: false, error: `question ${questionIndex + 1} must be an object` };
    }
    const id = stringField(rawQuestion.id);
    const header = stringField(rawQuestion.header);
    const question = stringField(rawQuestion.question);
    if (!id || !header || !question) {
      return {
        ok: false,
        error: `question ${questionIndex + 1} requires non-empty id, header, and question`,
      };
    }
    if (!Array.isArray(rawQuestion.options)) {
      return { ok: false, error: `question ${questionIndex + 1} options must be an array` };
    }
    if (rawQuestion.options.length < 2 || rawQuestion.options.length > 4) {
      return { ok: false, error: `question ${questionIndex + 1} options must contain 2-4 items` };
    }
    const options: PlanModeQuestionOption[] = [];
    for (const [optionIndex, rawOption] of rawQuestion.options.entries()) {
      if (!isRecord(rawOption)) {
        return {
          ok: false,
          error: `question ${questionIndex + 1} option ${optionIndex + 1} must be an object`,
        };
      }
      const label = stringField(rawOption.label);
      if (!label) {
        return {
          ok: false,
          error: `question ${questionIndex + 1} option ${optionIndex + 1} requires a label`,
        };
      }
      const description = stringField(rawOption.description);
      if (!description) {
        return {
          ok: false,
          error: `question ${questionIndex + 1} option ${optionIndex + 1} requires a description`,
        };
      }
      options.push({ label, description });
    }
    questions.push({ id, header, question, options });
  }
  return { ok: true, questions };
}

export type PlanModeQuestionAnswer = {
  id: string;
  header: string;
  question: string;
  answer: string;
  wasCustom: boolean;
  optionIndex?: number;
};

/**
 * Ask the user each question via an interactive selector.
 *
 * Returns the collected answers, or undefined if the user cancelled
 * or shouldContinue returned false mid-flow.
 */
export async function askPlanModeQuestions(
  questions: PlanModeQuestion[],
  ctx: QuestionUi,
  shouldContinue: () => boolean = () => true,
): Promise<PlanModeQuestionAnswer[] | undefined> {
  const answers: PlanModeQuestionAnswer[] = [];
  for (const question of questions) {
    const choices = question.options.map(formatPlanModeQuestionChoice);
    const otherChoice = `${question.options.length + 1}. Other (free-form)`;
    const choice = await ctx.ui.select(
      `${question.header}: ${question.question}`,
      [...choices, otherChoice],
    );
    if (!shouldContinue() || !choice) return undefined;
    if (choice === otherChoice) {
      const customAnswer = (await ctx.ui.editor(question.question, ""))?.trim();
      if (!shouldContinue() || !customAnswer) return undefined;
      answers.push({
        id: question.id,
        header: question.header,
        question: question.question,
        answer: customAnswer,
        wasCustom: true,
      });
      continue;
    }
    const optionIndex = choices.indexOf(choice);
    const option = question.options[optionIndex];
    if (!option) return undefined;
    answers.push({
      id: question.id,
      header: question.header,
      question: question.question,
      answer: option.label,
      wasCustom: false,
      optionIndex: optionIndex + 1,
    });
  }
  return answers;
}

/**
 * Minimal interactive UI surface required by the question tool.
 *
 * A subset of ExtensionUIContext so the flow is testable with a mock.
 */
export type QuestionUi = {
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    editor(title: string, prefill?: string): Promise<string | undefined>;
  };
};

export type PlanModeQuestionReason =
  | "cancelled"
  | "ui_unavailable"
  | "plan_mode_inactive"
  | "invalid_input";

export type PlanModeQuestionDetails = {
  cancelled: boolean;
  reason?: PlanModeQuestionReason;
  questions: PlanModeQuestion[];
  answers?: PlanModeQuestionAnswer[];
};

/**
 * Run the full question flow, mapping interruptions to cancelled results.
 *
 * Checks the lifecycle after asking so a changed session or disabled
 * Plan mode is reported distinctly from a user dismissal.
 */
export async function answerPlanModeQuestions(
  questions: PlanModeQuestion[],
  ctx: QuestionUi,
  lifecycle: { isCurrent(): boolean; isEnabled(): boolean },
) {
  const answers = await askPlanModeQuestions(
    questions,
    ctx,
    () => lifecycle.isCurrent() && lifecycle.isEnabled(),
  );
  if (!lifecycle.isCurrent()) {
    return planModeQuestionCancelled(
      questions,
      "cancelled",
      "Plan-mode question cancelled because the session changed.",
    );
  }
  if (!lifecycle.isEnabled()) {
    return planModeQuestionCancelled(
      questions,
      "plan_mode_inactive",
      "Plan-mode question cancelled because Plan mode is no longer active.",
    );
  }
  if (!answers) {
    return planModeQuestionCancelled(
      questions,
      "cancelled",
      "User cancelled the Plan-mode question prompt.",
    );
  }
  return planModeQuestionAnswered(questions, answers);
}

function formatPlanModeQuestionChoice(option: PlanModeQuestionOption, index: number) {
  return `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`;
}

/**
 * Build the answered tool result with JSON payload content.
 */
export function planModeQuestionAnswered(
  questions: PlanModeQuestion[],
  answers: PlanModeQuestionAnswer[],
) {
  return {
    content: [
      { type: "text" as const, text: formatPlanModeQuestionPayload({ cancelled: false, answers }) },
    ],
    details: { cancelled: false, questions, answers } satisfies PlanModeQuestionDetails,
  };
}

/**
 * Build the cancelled tool result with a machine-readable reason.
 */
export function planModeQuestionCancelled(
  questions: PlanModeQuestion[],
  reason: PlanModeQuestionReason,
  message: string,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: formatPlanModeQuestionPayload({ cancelled: true, reason, message }),
      },
    ],
    details: { cancelled: true, reason, questions } satisfies PlanModeQuestionDetails,
  };
}

function formatPlanModeQuestionPayload(payload: {
  cancelled: boolean;
  reason?: PlanModeQuestionReason;
  message?: string;
  answers?: PlanModeQuestionAnswer[];
}) {
  return JSON.stringify(payload, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}
