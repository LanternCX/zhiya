import { useEffect, useRef, useState } from "react";
import { MessageResponse } from "../../components/ai-elements/message";
import { Checkbox } from "../../components/ui/checkbox";
import type { QuestionPage as QuestionPageData } from "../../domain/learning";

export default function QuestionPage({
  question,
  onChange,
  onSubmit,
  onDefer,
}: {
  question: QuestionPageData;
  onChange: (changes: Pick<QuestionPageData, "selected" | "answerText">) => void;
  onSubmit: () => Promise<void>;
  onDefer: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const prompt = useRef<HTMLDivElement>(null);
  const submitted = question.status === "submitted";
  const multiple = question.questionKind === "multiple";
  const canSubmit = question.questionKind === "blank"
    ? Boolean(question.answerText.trim())
    : question.selected.length > 0;
  const promptId = `question-prompt-${question.id}`;

  useEffect(() => { prompt.current?.focus({ preventScroll: true }); }, []);

  const choices = question.options.map((option) => (
    <label
      className="lesson-question-choice"
      data-selected={question.selected.includes(option)}
      key={option}
    >
      {multiple ? (
        <Checkbox
          checked={question.selected.includes(option)}
          disabled={submitted || submitting}
          onCheckedChange={(checked) => onChange({
            answerText: "",
            selected: checked
              ? [...question.selected, option]
              : question.selected.filter((value) => value !== option),
          })}
        />
      ) : (
        <input
          type="radio"
          name={`question-${question.id}`}
          value={option}
          checked={question.selected.includes(option)}
          disabled={submitted || submitting}
          onChange={() => onChange({ selected: [option], answerText: "" })}
        />
      )}
      <span>{option}</span>
    </label>
  ));

  return (
    <article className="lesson-question" aria-label={`练习题：${question.title}`} aria-busy={submitting}>
      <div className="lesson-question-content">
        <header className="lesson-question-heading">
          <span>随堂练习</span>
          <span aria-hidden="true">/</span>
          <h2>{question.title}</h2>
        </header>
        <div className="lesson-question-prompt" id={promptId} ref={prompt} tabIndex={-1}>
          <MessageResponse>{question.text}</MessageResponse>
        </div>
        {question.questionKind === "blank" ? (
          <label className="lesson-question-answer">
            <span>你的回答</span>
            <textarea
              aria-label="你的答案"
              value={question.answerText}
              disabled={submitted || submitting}
              onChange={(event) => onChange({ selected: [], answerText: event.target.value })}
              placeholder="写下你的想法…"
            />
          </label>
        ) : (
          <fieldset className="lesson-question-fieldset" disabled={submitted || submitting} aria-labelledby={promptId}>
            <legend>{multiple ? "可以选择多项" : "请选择一项"}</legend>
            <div className="lesson-question-choices">{choices}</div>
          </fieldset>
        )}
        {error && <p className="lesson-question-error" role="alert">{error}</p>}
        <footer className="lesson-question-footer">
          {submitted && <span role="status">答案已提交</span>}
          {!submitted && (
            <button
              className="lesson-question-defer"
              type="button"
              disabled={submitting}
              onClick={() => {
                setSubmitting(true);
                setError("");
                void onDefer().catch((failure) => {
                  setError(failure instanceof Error ? failure.message : "暂时无法继续，请重试");
                }).finally(() => setSubmitting(false));
              }}
            >
              稍后再做
            </button>
          )}
          <button
            type="button"
            disabled={submitted || submitting || !canSubmit}
            onClick={() => {
              setSubmitting(true);
              setError("");
              void onSubmit().catch((failure) => {
                setError(failure instanceof Error ? failure.message : "提交失败，请重试");
              }).finally(() => setSubmitting(false));
            }}
          >
            {submitted ? "已提交" : submitting ? "提交中…" : "提交答案"}
          </button>
        </footer>
      </div>
    </article>
  );
}
