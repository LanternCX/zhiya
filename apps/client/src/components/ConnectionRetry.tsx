import type { ModelRetryStatus } from "../domain/learning";
import "./connection-retry.css";

export default function ConnectionRetry({
  status,
}: {
  status: ModelRetryStatus | null;
}) {
  if (!status) return null;
  return (
    <div className="connection-retry" role="status" aria-live="polite">
      <span className="connection-retry-pulse" aria-hidden="true">
        <span />
      </span>
      <span>
        连接不稳定，正在重新连接（{status.attempt}/{status.maxRetries}）
      </span>
    </div>
  );
}
