import {
  Reasoning,
  ReasoningContent,
  ReasoningLiveSummary,
  ReasoningTrigger,
} from "../../components/ai-elements/reasoning";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "../../components/ai-elements/message";
import { Shimmer } from "../../components/ai-elements/shimmer";
import { BrainIcon } from "lucide-react";
import type { AssistantOutput } from "../../domain/learning";
import { useElapsedSeconds } from "../../lib/use-elapsed-seconds";

export default function AssistantResponse({
  output,
  active,
  stopped = false,
  thinkingLabel,
}: {
  output: AssistantOutput;
  active: boolean;
  stopped?: boolean;
  thinkingLabel: string;
}) {
  const elapsed = useElapsedSeconds(active);

  return (
    <div className="ai-elements w-full">
      {output.reasoning ? (
        <Reasoning duration={elapsed} isStreaming={output.isReasoning}>
          <ReasoningTrigger
            className="assistant-thinking assistant-reasoning-trigger"
            getThinkingMessage={(streaming, seconds) =>
              streaming ? (
                <ReasoningLiveSummary
                  status={`${thinkingLabel} · ${seconds ?? 0} 秒`}
                  preview={output.reasoning}
                />
              ) : (
                <span>思路已整理</span>
              )
            }
          />
          <ReasoningContent className="assistant-reasoning-content">
            {output.reasoning}
          </ReasoningContent>
        </Reasoning>
      ) : (active || stopped) && !output.text ? (
        <div
          className="assistant-thinking assistant-waiting"
          data-stopped={stopped}
          role="status"
          aria-label={stopped ? "已停止" : "正在思考"}
        >
          <BrainIcon aria-hidden="true" />
          {stopped ? (
            <span>已停止</span>
          ) : (
            <Shimmer duration={1}>
              {`${thinkingLabel} · ${elapsed ?? 0} 秒`}
            </Shimmer>
          )}
        </div>
      ) : null}
      {output.text && (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse>{output.text}</MessageResponse>
          </MessageContent>
        </Message>
      )}
    </div>
  );
}
