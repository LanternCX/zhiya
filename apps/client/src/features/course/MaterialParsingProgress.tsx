import type { MaterialPreparationProgress } from "../../../../../packages/learning/src/domain/learning";
import { Spinner } from "../../components/ui/spinner";
import "./material-parsing-progress.css";

export default function MaterialParsingProgress({
  progress,
}: {
  progress: MaterialPreparationProgress;
}) {
  const { total, completed, fileName, phase } = progress;
  const title =
    phase === "failed"
      ? `解析失败：${fileName}`
      : phase === "complete"
        ? `已解析全部 ${total} 份材料`
        : `${phase === "uploading" ? "正在上传" : "正在解析"}第 ${Math.min(completed + 1, total)} / ${total} 份：${fileName}`;
  return (
    <div
      className="material-parsing-progress"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="material-parsing-heading">
        {(phase === "uploading" || phase === "parsing") && <Spinner />}
        <span>{title}</span>
      </div>
      <div
        className="material-parsing-track"
        role="progressbar"
        aria-label="材料解析进度"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-valuetext={`已解析 ${completed} / ${total} 份`}
      >
        <div
          className="material-parsing-fill"
          style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
        />
      </div>
      <div className="material-parsing-summary">
        <span>
          已解析 {completed} / {total} 份
        </span>
        <span>
          {phase === "failed"
            ? "请处理失败的材料后重试"
            : phase === "complete"
              ? "材料已就绪"
              : "全部解析完成后继续回答"}
        </span>
      </div>
    </div>
  );
}
