import { describe, it, expect, vi } from "vitest";
import {
  normalizePlanModeQuestionParams,
  planModeQuestionAnswered,
  planModeQuestionCancelled,
  askPlanModeQuestions,
  answerPlanModeQuestions,
} from "./question-tool.ts";
import type { PlanModeQuestion, QuestionUi } from "./question-tool.ts";

const validQuestion = {
  id: "scope",
  header: "Scope",
  question: "How broad should the change be?",
  options: [
    { label: "Small", description: "Only the bug." },
    { label: "Broad", description: "Include nearby cleanup." },
  ],
};

describe("normalizePlanModeQuestionParams", () => {
  it("accepts 1-3 valid questions", () => {
    const result = normalizePlanModeQuestionParams({ questions: [validQuestion] });
    expect(result.ok).toBe(true);
  });

  it("accepts exactly 3 questions", () => {
    const result = normalizePlanModeQuestionParams({
      questions: [validQuestion, validQuestion, validQuestion],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty questions array", () => {
    const result = normalizePlanModeQuestionParams({ questions: [] });
    expect(result).toEqual({ ok: false, error: "questions must contain 1-3 items" });
  });

  it("rejects more than 3 questions", () => {
    const result = normalizePlanModeQuestionParams({
      questions: [validQuestion, validQuestion, validQuestion, validQuestion],
    });
    expect(result).toEqual({ ok: false, error: "questions must contain 1-3 items" });
  });

  it("rejects non-array questions", () => {
    const result = normalizePlanModeQuestionParams({ questions: "nope" });
    expect(result).toEqual({ ok: false, error: "questions must be an array" });
  });

  it("rejects non-object input", () => {
    expect(normalizePlanModeQuestionParams(null)).toEqual({
      ok: false,
      error: "questions must be an array",
    });
  });

  it("rejects a question missing id, header, or question", () => {
    const missingId = { ...validQuestion, id: "   " };
    expect(normalizePlanModeQuestionParams({ questions: [missingId] }).ok).toBe(false);

    const missingHeader = { ...validQuestion, header: "" };
    expect(normalizePlanModeQuestionParams({ questions: [missingHeader] }).ok).toBe(false);

    const missingQuestion = { ...validQuestion, question: undefined };
    expect(normalizePlanModeQuestionParams({ questions: [missingQuestion] }).ok).toBe(false);
  });

  it("rejects a question with fewer than 2 options", () => {
    const oneOption = {
      ...validQuestion,
      options: [{ label: "Small", description: "Only the bug." }],
    };
    const result = normalizePlanModeQuestionParams({ questions: [oneOption] });
    expect(result).toEqual({
      ok: false,
      error: "question 1 options must contain 2-4 items",
    });
  });

  it("rejects a question with more than 4 options", () => {
    const fiveOptions = {
      ...validQuestion,
      options: [
        { label: "A", description: "d" },
        { label: "B", description: "d" },
        { label: "C", description: "d" },
        { label: "D", description: "d" },
        { label: "E", description: "d" },
      ],
    };
    const result = normalizePlanModeQuestionParams({ questions: [fiveOptions] });
    expect(result.ok).toBe(false);
  });

  it("rejects an option missing a label", () => {
    const badOption = { ...validQuestion, options: [{ label: "  ", description: "d" }, { label: "B", description: "d" }] };
    const result = normalizePlanModeQuestionParams({ questions: [badOption] });
    expect(result).toEqual({
      ok: false,
      error: "question 1 option 1 requires a label",
    });
  });

  it("rejects an option missing a description", () => {
    const badOption = { ...validQuestion, options: [{ label: "A", description: "  " }, { label: "B", description: "d" }] };
    const result = normalizePlanModeQuestionParams({ questions: [badOption] });
    expect(result).toEqual({
      ok: false,
      error: "question 1 option 1 requires a description",
    });
  });

  it("trims id, header, and question values", () => {
    const padded = {
      id: "  scope  ",
      header: "  Scope  ",
      question: "  How broad?  ",
      options: [
        { label: "  Small  ", description: "  Only the bug.  " },
        { label: "Broad", description: "Include cleanup." },
      ],
    };
    const result = normalizePlanModeQuestionParams({ questions: [padded] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.questions[0].id).toBe("scope");
      expect(result.questions[0].header).toBe("Scope");
      expect(result.questions[0].question).toBe("How broad?");
      expect(result.questions[0].options[0].label).toBe("Small");
      expect(result.questions[0].options[0].description).toBe("Only the bug.");
    }
  });
});

function mockCtx(): QuestionUi {
  return {
    ui: {
      select: vi.fn<QuestionUi["ui"]["select"]>(),
      editor: vi.fn<QuestionUi["ui"]["editor"]>(),
    },
  };
}

describe("askPlanModeQuestions", () => {
  const questions: PlanModeQuestion[] = [
    {
      id: "scope",
      header: "Scope",
      question: "How broad?",
      options: [
        { label: "Small", description: "Only the bug." },
        { label: "Broad", description: "Include cleanup." },
      ],
    },
  ];

  it("returns an option answer when the user selects a choice", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue("2. Broad — Include cleanup.");
    const answers = await askPlanModeQuestions(questions, ctx);
    expect(answers).toEqual([
      {
        id: "scope",
        header: "Scope",
        question: "How broad?",
        answer: "Broad",
        wasCustom: false,
        optionIndex: 2,
      },
    ]);
  });

  it("opens the editor when the user picks Other", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue("3. Other (free-form)");
    vi.mocked(ctx.ui.editor).mockResolvedValue("  A custom scope  ");
    const answers = await askPlanModeQuestions(questions, ctx);
    expect(answers).toEqual([
      {
        id: "scope",
        header: "Scope",
        question: "How broad?",
        answer: "A custom scope",
        wasCustom: true,
      },
    ]);
    expect(vi.mocked(ctx.ui.editor)).toHaveBeenCalledWith("How broad?", "");
  });

  it("returns undefined when the user cancels the selector", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue(undefined);
    const answers = await askPlanModeQuestions(questions, ctx);
    expect(answers).toBeUndefined();
  });

  it("returns undefined when the editor returns nothing", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue("3. Other (free-form)");
    vi.mocked(ctx.ui.editor).mockResolvedValue(undefined);
    const answers = await askPlanModeQuestions(questions, ctx);
    expect(answers).toBeUndefined();
  });

  it("stops when shouldContinue returns false", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue("1. Small — Only the bug.");
    const answers = await askPlanModeQuestions(questions, ctx, () => false);
    expect(answers).toBeUndefined();
  });

  it("answers multiple questions in order", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("1. A — one.");
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("2. B — two.");
    const twoQuestions: PlanModeQuestion[] = [
      {
        id: "q1",
        header: "Q1",
        question: "First?",
        options: [
          { label: "A", description: "one." },
          { label: "B", description: "two." },
        ],
      },
      {
        id: "q2",
        header: "Q2",
        question: "Second?",
        options: [
          { label: "A", description: "one." },
          { label: "B", description: "two." },
        ],
      },
    ];
    const answers = await askPlanModeQuestions(twoQuestions, ctx);
    expect(answers?.map((a) => a.id)).toEqual(["q1", "q2"]);
    expect(answers?.[0].optionIndex).toBe(1);
    expect(answers?.[1].optionIndex).toBe(2);
  });
});

describe("answerPlanModeQuestions", () => {
  const questions: PlanModeQuestion[] = [
    {
      id: "scope",
      header: "Scope",
      question: "How broad?",
      options: [
        { label: "Small", description: "Only the bug." },
        { label: "Broad", description: "Include cleanup." },
      ],
    },
  ];

  it("cancels with reason cancelled when the session changed", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue("1. Small — Only the bug.");
    const result = await answerPlanModeQuestions(questions, ctx, {
      isCurrent: () => false,
      isEnabled: () => true,
    });
    expect(result.details.cancelled).toBe(true);
    const details = result.details as unknown as { reason?: string };
    expect(details.reason).toBe("cancelled");
  });

  it("cancels with reason plan_mode_inactive when plan mode turned off", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue("1. Small — Only the bug.");
    const result = await answerPlanModeQuestions(questions, ctx, {
      isCurrent: () => true,
      isEnabled: () => false,
    });
    expect(result.details.cancelled).toBe(true);
    const details = result.details as unknown as { reason?: string };
    expect(details.reason).toBe("plan_mode_inactive");
  });

  it("cancels when the user dismisses the prompt", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue(undefined);
    const result = await answerPlanModeQuestions(questions, ctx, {
      isCurrent: () => true,
      isEnabled: () => true,
    });
    expect(result.details.cancelled).toBe(true);
    const details = result.details as unknown as { reason?: string };
    expect(details.reason).toBe("cancelled");
  });

  it("returns answers when the user responds", async () => {
    const ctx = mockCtx();
    vi.mocked(ctx.ui.select).mockResolvedValue("2. Broad — Include cleanup.");
    const result = await answerPlanModeQuestions(questions, ctx, {
      isCurrent: () => true,
      isEnabled: () => true,
    });
    expect(result.details.cancelled).toBe(false);
    const details = result.details as unknown as { answers?: unknown[] };
    expect(details.answers).toEqual([
      {
        id: "scope",
        header: "Scope",
        question: "How broad?",
        answer: "Broad",
        wasCustom: false,
        optionIndex: 2,
      },
    ]);
  });
});

describe("planModeQuestionAnswered", () => {
  const questions: PlanModeQuestion[] = [
    {
      id: "scope",
      header: "Scope",
      question: "How broad?",
      options: [
        { label: "Small", description: "Only the bug." },
        { label: "Broad", description: "Include cleanup." },
      ],
    },
  ];
  const answers = [
    { id: "scope", header: "Scope", question: "How broad?", answer: "Broad", wasCustom: false, optionIndex: 2 },
  ];

  it("serializes the answers as JSON text content", () => {
    const result = planModeQuestionAnswered(questions, answers);
    expect(result.content).toHaveLength(1);
    const payload = JSON.parse(result.content[0].text) as { cancelled: boolean; answers: unknown[] };
    expect(payload.cancelled).toBe(false);
    expect(payload.answers).toEqual(answers);
  });

  it("exposes structured details with the original questions", () => {
    const result = planModeQuestionAnswered(questions, answers);
    expect(result.details).toEqual({
      cancelled: false,
      questions,
      answers,
    });
  });
});

describe("planModeQuestionCancelled", () => {
  const questions: PlanModeQuestion[] = [
    {
      id: "scope",
      header: "Scope",
      question: "How broad?",
      options: [
        { label: "Small", description: "Only the bug." },
        { label: "Broad", description: "Include cleanup." },
      ],
    },
  ];

  it("serializes the cancellation reason as JSON text content", () => {
    const result = planModeQuestionCancelled(questions, "ui_unavailable", "No UI available.");
    const payload = JSON.parse(result.content[0].text) as {
      cancelled: boolean;
      reason: string;
      message: string;
    };
    expect(payload.cancelled).toBe(true);
    expect(payload.reason).toBe("ui_unavailable");
    expect(payload.message).toBe("No UI available.");
  });

  it("exposes structured details with reason and questions", () => {
    const result = planModeQuestionCancelled(questions, "invalid_input", "Bad input.");
    expect(result.details).toEqual({
      cancelled: true,
      reason: "invalid_input",
      questions,
    });
  });
});
