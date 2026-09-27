import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  AudioWaveformIcon,
  FileUpIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
} from "lucide-react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "./ai-elements/attachments";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "./ai-elements/prompt-input";
import {
  VoiceInputController,
  type VoiceInputStatus,
} from "../features/voice/VoiceInputController";
import "./chat-composer.css";
import "./speech-controls.css";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useSpeechPreference } from "../features/voice/useSpeechPreference";

type AttachmentErrorCode = "max_files" | "max_file_size" | "accept";
export type ComposerInputMode = "text" | "dictation" | "dialogue";
export type ChatComposerAttachmentOptions = {
  accept: string;
  addLabel: string;
  dropHint: string;
  dropLabel: string;
  errorMessage: (code: AttachmentErrorCode) => string;
  maxFileSize?: number;
  maxFiles?: number;
  multiple?: boolean;
  removeLabel: (filename: string) => string;
};
export type ChatComposerMessage = {
  text: string;
  files: File[];
  automatic?: boolean;
  speakReplies?: boolean;
  inputMethod?: ComposerInputMode;
};
export type ChatComposerProps = {
  attachments: ChatComposerAttachmentOptions;
  className?: string;
  disabled?: boolean;
  error?: string;
  label: string;
  onError: (message: string) => void;
  onStop?: () => void;
  onSubmit: (message: ChatComposerMessage) => Promise<void>;
  onVoiceError?: (message: string) => void;
  onStartVoiceMode?: () => Promise<boolean>;
  voiceModeActive?: boolean;
  voiceModeStarting?: boolean;
  onEndVoiceMode?: () => void;
  running?: boolean;
  submitLabel: string;
  initialInputMode?: ComposerInputMode;
};
async function toFiles(parts: PromptInputMessage["files"]) {
  return Promise.all(
    parts.map(async (part) => {
      const blob = await (await fetch(part.url)).blob();
      return new File([blob], part.filename ?? "attachment", {
        type: part.mediaType,
      });
    }),
  );
}

function ChatComposerInput({
  attachments: options,
  className,
  disabled = false,
  error,
  label,
  onError,
  onStop,
  onSubmit,
  running = false,
  submitLabel,
  onVoiceError,
  onStartVoiceMode,
  voiceModeActive,
  voiceModeStarting = false,
  onEndVoiceMode,
  initialInputMode = "text",
}: ChatComposerProps) {
  const attachments = usePromptInputAttachments();
  const controller = usePromptInputController();
  const [mode, setMode] = useState<ComposerInputMode>(initialInputMode);
  const [speechReplies] = useSpeechPreference();
  const dialogue = mode === "dialogue";
  const speaker = dialogue || speechReplies;
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [dragging, setDragging] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const capture = useRef<VoiceInputController | null>(null);
  const baseDraft = useRef("");
  const recognized = useRef("");
  const currentMode = useRef(mode);
  const latest = useRef({ onSubmit, onVoiceError, onError, speaker });
  latest.current = { onSubmit, onVoiceError, onError, speaker };
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const dragDepth = useRef(0);
  const capturing =
    status === "connecting" || status === "listening" || status === "finishing";
  const canSubmit = Boolean(
    controller.textInput.value.trim() || attachments.files.length,
  );
  const updateLayout = (element: HTMLTextAreaElement) => {
    const style = getComputedStyle(element);
    const padding =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    setMultiline(
      Boolean(element.value) &&
        (element.value.includes("\n") ||
          element.scrollHeight - padding >
            (parseFloat(style.lineHeight) || 24) * 1.5),
    );
  };
  const preserveCapture = () => {
    if (capture.current && recognized.current)
      controller.textInput.setInput(
        `${baseDraft.current}${recognized.current}`,
      );
    const input = capture.current;
    capture.current = null;
    input?.end();
    recognized.current = "";
    setTranscript("");
    setStatus("idle");
  };
  const startCapture = async (selectedMode: ComposerInputMode) => {
    if (selectedMode === "text" || capture.current) return;
    baseDraft.current = controller.textInput.value;
    recognized.current = "";
    const input = new VoiceInputController(
      (text) => {
        if (capture.current !== input) return;
        recognized.current = "";
        setTranscript("");
        if (currentMode.current === "dialogue") {
          // Send only the new utterance; never submit an existing typed draft.
          if (text)
            void latest.current
              .onSubmit({
                text,
                files: [],
                automatic: true,
                speakReplies: latest.current.speaker,
                inputMethod: "dialogue",
              })
              .catch((reason) => {
                latest.current.onError(
                  reason instanceof Error ? reason.message : "发送失败",
                );
                controller.textInput.setInput(`${baseDraft.current}${text}`);
                preserveCapture();
              });
          void input.start();
        } else {
          controller.textInput.setInput(`${baseDraft.current}${text}`);
          capture.current = null;
          input.end();
          setStatus("idle");
          textarea.current?.focus();
        }
      },
      (nextStatus, text) => {
        if (capture.current !== input) return;
        if (text || nextStatus !== "paused") recognized.current = text;
        setStatus(nextStatus);
        setTranscript(text);
      },
      (message) => {
        if (capture.current !== input) return;
        preserveCapture();
        latest.current.onVoiceError?.(message);
      },
      { autoSegment: selectedMode === "dialogue" },
    );
    capture.current = input;
    await input.start();
  };
  const toggleCapture = () => {
    if (capturing) {
      if (!dialogue && status === "listening") capture.current?.stop();
      else preserveCapture();
    } else {
      const next = dialogue ? "dialogue" : "dictation";
      currentMode.current = next;
      setMode(next);
      void startCapture(next);
    }
  };
  const toggleVoiceMode = () => {
    preserveCapture();
    const next = dialogue ? "text" : "dialogue";
    currentMode.current = next;
    setMode(next);
    if (next === "dialogue") void startCapture(next);
  };
  const playbackCallbacks = useRef({ onStartVoiceMode, onEndVoiceMode });
  playbackCallbacks.current = { onStartVoiceMode, onEndVoiceMode };
  useEffect(() => {
    let cancelled = false;
    if (speaker) {
      void playbackCallbacks.current.onStartVoiceMode?.().then((ready) => {
        if (!ready && !cancelled && currentMode.current === "dialogue") {
          preserveCapture();
          currentMode.current = "text";
          setMode("text");
        }
      });
    } else playbackCallbacks.current.onEndVoiceMode?.();
    return () => {
      cancelled = true;
    };
  }, [speaker, dialogue]);
  const wasPlaying = useRef(voiceModeActive);
  useEffect(() => {
    if (wasPlaying.current && voiceModeActive === false && dialogue) {
      preserveCapture();
      currentMode.current = "text";
      setMode("text");
    }
    wasPlaying.current = voiceModeActive;
  }, [voiceModeActive]);
  useEffect(() => {
    if (initialInputMode === "dialogue") void startCapture("dialogue");
    const hide = () => {
      if (document.visibilityState === "hidden") preserveCapture();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      const input = capture.current;
      capture.current = null;
      input?.end();
    };
  }, []);
  useEffect(() => {
    if (textarea.current) updateLayout(textarea.current);
  }, [controller.textInput.value]);
  const hasFiles = (event: DragEvent<HTMLFormElement>) =>
    event.dataTransfer.types.includes("Files");

  return (
    <PromptInput
      accept={options.accept}
      maxFiles={options.maxFiles}
      maxFileSize={options.maxFileSize}
      multiple={options.multiple}
      className={[
        "chat-composer",
        "chat-composer-input-modes",
        dialogue && "chat-composer-dialogue",
        multiline && "chat-composer-multiline",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onDragEnter={(event) => {
        if (!disabled && hasFiles(event)) {
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (hasFiles(event)) {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }
      }}
      onDragOver={(event) => {
        if (!disabled && hasFiles(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (!disabled && hasFiles(event)) {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onError={({ code }) => onError(options.errorMessage(code))}
      onSubmit={async ({ text, files }) => {
        if (dialogue || capturing) return;
        await onSubmit({
          text,
          files: await toFiles(files),
          speakReplies: speaker,
          inputMethod: mode,
        });
        setMultiline(false);
      }}
    >
      {dragging && (
        <div className="chat-composer-dropzone" role="status">
          <span className="chat-composer-dropzone-icon">
            <FileUpIcon />
          </span>
          <strong>{options.dropLabel}</strong>
          <small>{options.dropHint}</small>
        </div>
      )}
      {error && (
        <PromptInputHeader className="chat-composer-error">
          <p role="alert">{error}</p>
        </PromptInputHeader>
      )}
      {attachments.files.length > 0 && (
        <PromptInputHeader className="chat-composer-attachments">
          <Attachments variant="inline">
            {attachments.files.map((file) => (
              <Attachment
                data={file}
                key={file.id}
                onRemove={() => attachments.remove(file.id)}
              >
                <AttachmentPreview />
                <AttachmentInfo />
                <AttachmentRemove
                  className="chat-composer-attachment-remove"
                  label={options.removeLabel(file.filename ?? "attachment")}
                />
              </Attachment>
            ))}
          </Attachments>
        </PromptInputHeader>
      )}
      <PromptInputBody>
        {(capturing || dialogue) && (
          <div
            className="chat-composer-capture"
            role="status"
            aria-label="实时听写内容"
          >
            {transcript ||
              (status === "connecting" || (dialogue && voiceModeStarting)
                ? "连接中…"
                : status === "finishing"
                  ? "识别中…"
                  : capturing
                    ? "正在听取…"
                    : "麦克风已暂停")}
          </div>
        )}
        <PromptInputTextarea
          hidden={dialogue}
          aria-label={label}
          disabled={disabled}
          readOnly={capturing}
          onInput={(event) => updateLayout(event.currentTarget)}
          placeholder="给知芽发消息…"
          ref={textarea}
        />
      </PromptInputBody>
      <PromptInputFooter className="chat-composer-footer">
        <PromptInputTools>
          <PromptInputButton
            aria-label={options.addLabel}
            className="chat-composer-attachment-button"
            disabled={disabled || running || dialogue}
            onClick={() => attachments.openFileDialog()}
            tooltip={options.addLabel}
          >
            <PlusIcon />
          </PromptInputButton>
        </PromptInputTools>
        <PromptInputTools className="chat-composer-submit-tools">
          <PromptInputButton
            aria-label={
              capturing
                ? dialogue
                  ? "暂停麦克风"
                  : "停止听写"
                : dialogue
                  ? "继续语音对话"
                  : "开始听写"
            }
            aria-pressed={capturing}
            className="chat-composer-input-mode"
            disabled={disabled}
            onClick={toggleCapture}
            tooltip={
              capturing
                ? dialogue
                  ? "暂停麦克风"
                  : "停止听写"
                : dialogue
                  ? "继续语音对话"
                  : "开始听写"
            }
          >
            {dialogue && !capturing ? <MicOffIcon /> : <MicIcon />}
          </PromptInputButton>
          <PromptInputButton
            aria-label={dialogue ? "退出语音对话" : "进入语音对话"}
            aria-pressed={dialogue}
            className="chat-composer-voice"
            disabled={disabled}
            onClick={toggleVoiceMode}
            tooltip={dialogue ? "退出语音对话" : "进入语音对话"}
          >
            <AudioWaveformIcon />
          </PromptInputButton>
          <Tooltip>
            <TooltipTrigger asChild>
              <PromptInputSubmit
                aria-label={running || dialogue ? "打断" : submitLabel}
                className="chat-composer-submit"
                disabled={
                  disabled ||
                  (!running && (dialogue || capturing || !canSubmit))
                }
                onStop={onStop}
                status={running || dialogue ? "streaming" : "ready"}
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              {running || dialogue ? "打断" : submitLabel}
            </TooltipContent>
          </Tooltip>
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  );
}
export default function ChatComposer(props: ChatComposerProps) {
  return (
    <PromptInputProvider>
      <ChatComposerInput {...props} />
    </PromptInputProvider>
  );
}
