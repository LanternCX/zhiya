import { useLayoutEffect, useRef, useState } from "react";
import { MessageResponse } from "../../components/ai-elements/message";
import { Spinner } from "../../components/ui/spinner";
import type { CodingExercise } from "../../domain/learning";
import type { CodeRunResult } from "../../domain/learning";
import CodeEditor from "./CodeEditor";

function exerciseFilename(languageName: string) {
  const language = languageName.toLowerCase();
  if (language.includes("typescript")) return "main.ts";
  if (language.includes("javascript")) return "main.js";
  if (language.includes("python")) return "main.py";
  if (language.includes("c++")) return "main.cpp";
  if (/^c(?:\s|\(|$)/.test(language)) return "main.c";
  if (language.includes("java")) return "Main.java";
  if (/^go(?:\s|\(|$)/.test(language)) return "main.go";
  if (language.includes("rust")) return "main.rs";
  return "main.txt";
}

export default function CodingPage({
  exercise,
  running,
  onChange,
  onRun,
  onEnd,
}: {
  exercise: CodingExercise;
  running: boolean;
  onChange: (changes: Pick<CodingExercise, "code" | "stdin">) => void;
  onRun: () => Promise<CodeRunResult>;
  onEnd: () => Promise<void>;
}) {
  const [rerunning, setRerunning] = useState(false);
  const [ending, setEnding] = useState(false);
  const [actionError, setActionError] = useState("");
  const [localResult, setLocalResult] = useState<
    CodeRunResult | null | undefined
  >(undefined);
  const pageRef = useRef<HTMLElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const revealResultRef = useRef(false);
  const stdinLabelRef = useRef<HTMLLabelElement>(null);
  const stdinRef = useRef<HTMLTextAreaElement>(null);
  const ended = exercise.status === "ended";
  const result = localResult === undefined ? exercise.result : localResult;
  const output = result
    ? [result.compileOutput, result.stdout, result.stderr, result.message]
        .filter(Boolean)
        .join("\n")
    : "";

  useLayoutEffect(() => {
    if (!revealResultRef.current || running || (!localResult && !actionError)) return;
    // Wait for the completed result layout; scroll only this classroom pane.
    const frame = requestAnimationFrame(() => {
      const page = pageRef.current;
      const output = outputRef.current;
      if (!page || !output) return;
      page.scrollTo({
        top: page.scrollTop + output.getBoundingClientRect().top - page.getBoundingClientRect().top - 12,
        behavior: "instant",
      });
      revealResultRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [running, localResult, actionError]);

  useLayoutEffect(() => {
    const label = stdinLabelRef.current;
    const textarea = stdinRef.current;
    if (!label || !textarea) return;

    const labelChromeHeight = label.offsetHeight - textarea.offsetHeight;
    const observer = new ResizeObserver(() => {
      label.style.minHeight = `${textarea.offsetHeight + labelChromeHeight}px`;
    });
    observer.observe(textarea);

    return () => observer.disconnect();
  }, []);

  return (
    <article ref={pageRef} className="coding-page" aria-label={`编程练习：${exercise.title}`}>
      <header>
        <div>
          <p>编程练习</p>
          <h2>{exercise.title}</h2>
        </div>
        <span data-status={exercise.status}>{ended ? "已结束" : "练习中"}</span>
      </header>
      <section className="coding-instructions" aria-label="题目说明">
        <MessageResponse>{exercise.instructions}</MessageResponse>
      </section>
      <section className="coding-editor-shell" aria-label="代码编辑区">
        <header className="coding-editor-bar">
          <span>{exerciseFilename(exercise.languageName)}</span>
          <span>{exercise.languageName}</span>
        </header>
        <CodeEditor
          value={exercise.code}
          languageName={exercise.languageName}
          readOnly={ended || running}
          onChange={(code) => onChange({ code, stdin: exercise.stdin })}
        />
      </section>
      <section ref={outputRef} className="coding-output" aria-label="运行结果">
        <header>
          <span>输出</span>
          <span>
            {running
              ? "运行中"
              : result
                ? result.status.description
                : "等待运行"}
          </span>
        </header>
        <pre>
          {running
            ? rerunning
              ? "正在重新运行…"
              : "正在运行…"
            : result
              ? output || (result.graphics?.length ? "绘图完成，结果如下" : "程序没有产生输出")
              : "运行代码后，结果会显示在这里"}
        </pre>
        {!running && result?.graphics?.slice(0, 1).map((graphic, index) =>
          graphic.mimeType === "image/svg+xml" && graphic.data.length <= 1_333_336 && /^[A-Za-z0-9+/]+={0,2}$/.test(graphic.data) ? (
            <figure className="coding-graphic" key={index}>
              <figcaption>{result.status.description === "Completed" ? "绘图结果" : "执行中断前的绘图"}</figcaption>
              <img
                src={`data:image/svg+xml;base64,${graphic.data}`}
                alt="Python turtle 运行生成的图形"
              />
            </figure>
          ) : null,
        )}
      </section>
      <label ref={stdinLabelRef}>
        <span>标准输入（可选）</span>
        <textarea
          ref={stdinRef}
          aria-label="标准输入"
          className="coding-stdin"
          value={exercise.stdin}
          disabled={ended || running}
          onChange={(event) =>
            onChange({ code: exercise.code, stdin: event.target.value })
          }
        />
      </label>
      {actionError && (
        <p className="coding-action-feedback" role="alert">
          {actionError}
        </p>
      )}
      <footer className="coding-actions">
        <button
          type="button"
          aria-busy={running}
          aria-label={running ? "代码正在运行" : undefined}
          className="coding-run-button"
          disabled={ended || running}
          onClick={() => {
            revealResultRef.current = true;
            setRerunning(Boolean(result));
            setLocalResult(null);
            setActionError("");
            void onRun()
              .then((nextResult) => {
                setLocalResult(nextResult);
              })
              .catch((error) => {
                setActionError(
                  error instanceof Error ? error.message : "代码暂时无法运行",
                );
              });
          }}
        >
          {running ? (
            <>
              <Spinner aria-hidden="true" />
              <span>运行中…</span>
            </>
          ) : (
            "运行代码"
          )}
        </button>
        <button
          type="button"
          disabled={ended || running || ending}
          onClick={() => {
            setEnding(true);
            setActionError("");
            void onEnd()
              .catch((error) => {
                setActionError(
                  error instanceof Error ? error.message : "练习暂时无法结束",
                );
              })
              .finally(() => setEnding(false));
          }}
        >
          {ended ? "练习已结束" : ending ? "正在结束…" : "结束练习"}
        </button>
      </footer>
    </article>
  );
}
