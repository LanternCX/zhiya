import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { Checkbox } from "../../components/ui/checkbox";
import { api, APIError, type User } from "../../api";
import type {
  ModelRetryStatus,
  ConversationView as Conversation,
  ModelInfo,
  Question,
  AssistantOutput,
} from "../../domain/learning";
import type { ProfileSession } from "../../pi";
import { ProfileConnection } from "./runtime";
import "./profile.css";
import Mark from "../../components/Mark";
import Icon from "../../components/Icon";
import { Spinner } from "../../components/ui/spinner";
import ConnectionRetry from "../../components/ConnectionRetry";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputProvider,
  usePromptInputController,
} from "../../components/ai-elements/prompt-input";

const AssistantResponse = lazy(() => import("./AssistantResponse"));
const MessageResponse = lazy(() =>
  import("../../components/ai-elements/message").then((module) => ({
    default: module.MessageResponse,
  })),
);

export default function Profile({
  user,
  memoryOpen,
  editing,
  setEditing,
  ending,
  setEnding,
  onOnboardingChange,
  onContextChange,
  visible = true,
}: {
  user: User;
  memoryOpen: boolean;
  editing: boolean;
  setEditing: (value: boolean) => void;
  ending: boolean;
  setEnding: (value: boolean) => void;
  onOnboardingChange: (value: boolean) => void;
  onContextChange: (context: { memory: string; model: ModelInfo | null }) => void;
  visible?: boolean;
}) {
  const [state, setState] = useState<Conversation | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState("");
  const [liveOutput, setLiveOutput] = useState<AssistantOutput | null>(null);
  const [modelRetry, setModelRetry] = useState<ModelRetryStatus | null>(null);
  const memoryTitle = useRef<HTMLHeadingElement>(null);
  const [correction, setCorrection] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const paused = useRef(false);
  const [introduced, setIntroduced] = useState(false);
  const session = useRef<ProfileSession | null>(null);
  const channel = useRef<ProfileConnection | null>(null);
  const generation = useRef(0);
  const latest = useRef<Conversation | null>(null);
  const alive = useRef(true);
  const receive = (next: Conversation) => {
    if (!alive.current) return;
    if (latest.current && next.revision < latest.current.revision) return;
    const justEnded = next.correctionEnded && !latest.current?.correctionEnded;
    latest.current = next;
    if (justEnded) {
      session.current?.stop();
      setEditing(true);
      setCorrection("");
    }
    setState(next);
  };
  const run = async (model: ModelInfo, text?: string) => {
    if (session.current || !channel.current || !alive.current) return false;
    const epoch = generation.current;
    const current = channel.current.createSession(
      model,
      (next) => {
        if (generation.current === epoch) receive(next);
      },
      (value) => {
        if (alive.current && generation.current === epoch) setLiveOutput(value);
      },
      (status) => {
        if (alive.current && generation.current === epoch)
          setModelRetry(status);
      },
    );
    session.current = current;
    paused.current = false;
    setStopped(false);
    setRunning(true);
    setError("");
    setModelRetry(null);
    setLiveOutput({ text: "", reasoning: "", isReasoning: false });
    try {
      await current.run(text);
      return !current.isStopped;
    } catch (e) {
      if (
        alive.current &&
        generation.current === epoch &&
        !current.isStopped &&
        !(e instanceof APIError && e.status === 409)
      )
        setError(e instanceof Error ? e.message : "暂时无法继续，请重试");
      return false;
    } finally {
      if (session.current === current) session.current = null;
      if (alive.current && generation.current === epoch) {
        setRunning(false);
        setModelRetry(null);
      }
    }
  };
  const stopGenerating = () => {
    if (!session.current) return;
    paused.current = true;
    setStopped(true);
    setLiveOutput({ text: "", reasoning: "", isReasoning: false });
    session.current.stop();
  };
  useEffect(() => {
    if (!ending) return;
    paused.current = true;
    session.current?.stop();
    void channel.current
      ?.endCorrection()
      .then((next) => {
        if (!alive.current) return;
        receive(next);
        setError("");
        setLiveOutput(null);
      })
      .catch((error) => {
        if (alive.current)
          setError(
            error instanceof Error ? error.message : "未能结束对话，请重试",
          );
      })
      .finally(() => {
        if (alive.current) setEnding(false);
      });
  }, [ending]);
  const submitCorrection = async () => {
    if (!info?.available || !correction.trim() || correcting || session.current)
      return;
    setCorrecting(true);
    setEditing(false);
    if (!alive.current) return;
    const saved = await run(info, correction.trim());
    if (!alive.current) return;
    if (saved) setCorrection("");
    setCorrecting(false);
  };
  useEffect(() => {
    generation.current++;
    alive.current = true;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connection = new ProfileConnection();
    channel.current = connection;
    const unsubscribe = connection.subscribe((next) => {
      if (disposed) return;
      receive(next);
    });
    const start = async () => {
      try {
        const [initial, model] = await Promise.all([
          connection.open(),
          api<ModelInfo>("/learning/model"),
        ]);
        if (disposed) return;
        receive(initial);
        if (initial.correction && !initial.correction.saved) {
          receive(await connection.endCorrection());
        }
        setInfo(model);
        if (
          model.available &&
          !initial.completed &&
          !paused.current &&
          !session.current &&
          initial.status === "running" &&
          Date.parse(initial.leaseUntil) < Date.now()
        )
          void run(model);
      } catch (e) {
        if (disposed) return;
        setError(e instanceof Error ? e.message : "暂时无法同步，请重试");
        retry = setTimeout(() => void start(), 3000);
      }
    };
    void start();
    return () => {
      disposed = true;
      generation.current++;
      alive.current = false;
      clearTimeout(retry);
      unsubscribe();
      session.current?.stop();
      session.current = null;
      connection.close();
      if (channel.current === connection) channel.current = null;
    };
  }, [user.id]);
  useEffect(() => {
    if (state) onContextChange({ memory: state.memory, model: info });
  }, [state?.memory, info, onContextChange]);
  const active =
    !stopped &&
    (running ||
      (state?.status === "running" &&
        Date.parse(state.leaseUntil) > Date.now()));
  const progress = state?.correction;
  const output = liveOutput ?? {
    text: state?.output.text ?? "",
    reasoning: state?.output.reasoning ?? "",
    isReasoning: Boolean(active),
  };
  useEffect(() => {
    onOnboardingChange(!state?.completed);
  }, [state?.completed, onOnboardingChange]);
  useEffect(() => {
    if (progress?.saved) setCorrection("");
  }, [progress?.saved]);
  useEffect(() => {
    if (visible && memoryOpen && editing) memoryTitle.current?.focus();
  }, [visible, memoryOpen, editing]);
  return (
    <section
      className="learning-surface"
      data-hidden={!visible}
      aria-label="建档与档案维护"
    >
      {!state ? (
        <div className="learning-loading">
          <Spinner aria-label="正在加载建档" />
        </div>
      ) : (
        <>
          <div hidden={state.completed && (!memoryOpen || editing)}>
            {!introduced &&
            !state.completed &&
            !state.question &&
            state.messageCount === 0 &&
            state.status === "idle" ? (
              <div className="onboarding-welcome">
                <div className="welcome-mark">
                  <Mark />
                </div>
                <h1>欢迎来到知芽</h1>
                <p>先聊聊你的学习习惯，建立属于你的学习档案。</p>
                <button
                  className="primary"
                  onClick={() => {
                    setIntroduced(true);
                    if (info?.available) void run(info);
                  }}
                >
                  开始 <Icon name="send" />
                </button>
              </div>
            ) : state.completed &&
              progress?.saved &&
              !active &&
              !correction.trim() ? (
              <div className="workspace-empty">
                <div className="subject-art learning">
                  <Icon name="check" />
                </div>
                <h1>档案已更新</h1>
                <button className="primary" onClick={() => setEditing(true)}>
                  查看档案
                </button>
              </div>
            ) : (
              <>
                {state.question ? (
                  <PromptInputProvider key={state.question.id}>
                    <QuestionCard
                      question={state.question}
                      focus={
                        visible &&
                        (!state.completed || (memoryOpen && !editing))
                      }
                      submit={async (answer) => {
                        if (!channel.current) throw new Error("会话尚未连接");
                        const next = await channel.current.answer(
                          state.question!.id,
                          answer,
                        );
                        receive(next);
                        setLiveOutput(null);
                        if (
                          info?.available &&
                          !session.current &&
                          Date.parse(next.leaseUntil) < Date.now()
                        )
                          void run(info);
                      }}
                    />
                  </PromptInputProvider>
                ) : (
                  <div className="learning-progress">
                    <Suspense fallback={<Spinner aria-label="正在思考" />}>
                      <AssistantResponse
                        output={
                          state.completed ? { ...output, text: "" } : output
                        }
                        active={Boolean(active)}
                        stopped={stopped}
                        thinkingLabel={
                          state.completed
                            ? "正在整理你的学习档案…"
                            : "正在了解你的学习方式…"
                        }
                      />
                    </Suspense>
                    <ConnectionRetry status={modelRetry} />
                    {!state.completed && active && running && (
                      <div
                        className={`learning-progress-controls ${!output.reasoning ? "is-waiting" : ""}`}
                      >
                        <PromptInputSubmit
                          className="generation-stop"
                          status="streaming"
                          onStop={stopGenerating}
                          aria-label="停止生成"
                          title="停止生成"
                        />
                      </div>
                    )}
                    {!state.completed && !active && (
                      <>
                        {!info?.available ? (
                          <p>知芽暂时无法开始交流，请稍后再来。</p>
                        ) : (
                          <button
                            className="primary"
                            disabled={running}
                            onClick={() =>
                              void run(
                                info,
                                state.completed && (!progress || progress.saved)
                                  ? correction.trim() || undefined
                                  : !state.completed &&
                                      state.lastAssistant
                                    ? "请继续我们的交流。"
                                    : undefined,
                              )
                            }
                          >
                            继续交流
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {memoryOpen && editing && (
            <section className="memory-panel" aria-labelledby="memory-title">
              <header className="memory-header">
                <h1 ref={memoryTitle} tabIndex={-1} id="memory-title">
                  学习档案
                </h1>
              </header>
              <div className="memory-document ai-elements">
                {memoryOpen && (
                  <Suspense fallback={<Spinner aria-label="正在加载档案" />}>
                    <MessageResponse
                      mode="static"
                      allowedElements={[
                        "p",
                        "h1",
                        "h2",
                        "h3",
                        "ul",
                        "ol",
                        "li",
                        "strong",
                        "em",
                        "blockquote",
                        "code",
                        "pre",
                        "br",
                      ]}
                      unwrapDisallowed
                    >
                      {state.memory || "还没有记录"}
                    </MessageResponse>
                  </Suspense>
                )}
              </div>
              <p className="memory-note">
                用于调整教学方式。修改档案不会删除交流记录
              </p>
              {state.completed && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitCorrection();
                  }}
                >
                  <label htmlFor="memory-correction">修改或忘记</label>
                  <textarea
                    id="memory-correction"
                    value={correction}
                    onChange={(e) => setCorrection(e.target.value)}
                    maxLength={4000}
                    placeholder="例如：我现在想先自己试试，再看讲解。"
                  />
                  <button
                    className="primary"
                    disabled={
                      Boolean(active) ||
                      correcting ||
                      !info?.available ||
                      !correction.trim()
                    }
                  >
                    提交修改
                  </button>
                </form>
              )}
            </section>
          )}
        </>
      )}
      {error && (!state?.completed || memoryOpen) && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function QuestionCard({
  question: q,
  submit,
  focus,
}: {
  question: Question;
  focus: boolean;
  submit: (answer: {
    selected: string[];
    text: string;
    skipped: boolean;
  }) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"options" | "custom" | "skip">(
    q.kind === "text" ? "custom" : "options",
  );
  const { value: text, setInput: setText } =
    usePromptInputController().textInput;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) title.current?.focus();
  }, [focus]);
  const canSend =
    mode === "skip" ||
    (mode === "custom" ? Boolean(text.trim()) : selected.length > 0);
  const send = async () => {
    if (busy || !canSend) return;
    setBusy(true);
    setError("");
    try {
      await submit({
        selected: mode === "options" ? selected : [],
        text: mode === "custom" ? text.trim() : "",
        skipped: mode === "skip",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "未能提交，请重试");
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="question-card" aria-busy={busy}>
      <div className="question-companion">
        <Mark />
        <span>知芽</span>
      </div>
      <h1 ref={title} tabIndex={-1} id="student-question">
        {q.text}
      </h1>
      {q.description && <p className="question-description">{q.description}</p>}
      <PromptInput
        className="question-answer"
        onSubmit={() => send()}
        maxFiles={0}
        onError={() => setError("建档暂不支持附件，请用文字回答")}
      >
        <fieldset
          className="question-options"
          aria-labelledby="student-question"
          disabled={busy}
        >
          <legend className="visually-hidden">
            {q.kind === "multiple" ? "可以选择多项" : "请选择一项"}
          </legend>
          <RadioGroup
            className="question-choices"
            disabled={busy}
            aria-labelledby="student-question"
            value={
              mode === "options" ? String(q.options.indexOf(selected[0])) : mode
            }
            onValueChange={(value) => {
              if (value === "custom" || value === "skip") {
                setMode(value);
                setSelected([]);
              } else {
                setMode("options");
                setSelected([q.options[Number(value)]]);
              }
            }}
          >
            {(q.kind === "text" ? [] : q.options).map((option, index) => (
              <label
                key={option}
                className={`question-option ${mode === "options" && selected.includes(option) ? "selected" : ""}`}
              >
                {q.kind === "multiple" ? (
                  <Checkbox
                    disabled={busy}
                    checked={mode === "options" && selected.includes(option)}
                    onCheckedChange={(checked) => {
                      setMode("options");
                      setSelected(
                        checked
                          ? [...(mode === "options" ? selected : []), option]
                          : selected.filter((v) => v !== option),
                      );
                    }}
                  />
                ) : (
                  <RadioGroupItem value={String(index)} />
                )}
                <span>{option}</span>
              </label>
            ))}
            <label
              className={`question-option ${mode === "custom" ? "selected" : ""}`}
            >
              <RadioGroupItem value="custom" />
              <span>自己填写</span>
            </label>
            {mode === "custom" && (
              <PromptInputTextarea
                id="student-answer"
                aria-label="你的回答"
                autoFocus
                disabled={busy}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={4000}
                rows={2}
                placeholder="说说你的想法…"
              />
            )}
            <label
              className={`question-option ${mode === "skip" ? "selected" : ""}`}
            >
              <RadioGroupItem value="skip" />
              <span>还不确定</span>
            </label>
          </RadioGroup>
        </fieldset>
        <PromptInputFooter className="question-actions">
          <PromptInputSubmit
            className="primary"
            status={busy ? "submitted" : "ready"}
            aria-label={busy ? "正在提交" : "提交回答"}
            title="提交回答"
            disabled={busy || !canSend}
          >
            {busy ? <Spinner aria-hidden="true" /> : <Icon name="send" />}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
