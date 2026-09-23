import { useEffect, useRef, useState, type DragEvent } from "react";
import { AudioWaveformIcon, FileUpIcon, MicIcon, MicOffIcon, PhoneOffIcon, PlusIcon } from "lucide-react";
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
import { float32ToPcm16, SpeechStream } from "../transport/speech";
import "./chat-composer.css";
import "./speech-controls.css";

type AttachmentErrorCode = "max_files" | "max_file_size" | "accept";

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
  onVoiceTranscript?: (text: string, final: boolean) => void;
  onVoiceError?: (message: string) => void;
  onStartVoiceMode?: () => void;
  voiceModeActive?: boolean;
  voiceMuted?: boolean;
  onToggleVoiceMute?: () => void;
  onEndVoiceMode?: () => void;
  running?: boolean;
  submitLabel: string;
};

async function toFiles(parts: PromptInputMessage["files"]) {
  return Promise.all(
    parts.map(async (part) => {
      const response = await fetch(part.url);
      const blob = await response.blob();
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
  onVoiceTranscript,
  onVoiceError,
  onStartVoiceMode,
  voiceModeActive = false,
  voiceMuted = false,
  onToggleVoiceMute,
  onEndVoiceMode,
}: ChatComposerProps) {
  const attachments = usePromptInputAttachments();
  const controller = usePromptInputController();
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const speech = useRef<SpeechStream | null>(null);
  const voiceText = useRef("");
  const audio = useRef<{ context: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode } | null>(null);
  const dragDepth = useRef(0);
  const canSubmit = Boolean(
    controller.textInput.value.trim() || attachments.files.length,
  );
  const hasFiles = (event: DragEvent<HTMLFormElement>) =>
    event.dataTransfer.types.includes("Files");
  const updateMultiline = (element: HTMLTextAreaElement) => {
    if (!element.value) {
      setMultiline(false);
      return;
    }
    const style = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const padding =
      Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    setMultiline(
      element.value.includes("\n") || element.scrollHeight - padding > lineHeight * 1.5,
    );
  };
  const stopRecording = () => {
    audio.current?.processor.disconnect();
    audio.current?.source.disconnect();
    audio.current?.stream.getTracks().forEach((track) => track.stop());
    void audio.current?.context.close();
    audio.current = null;
    speech.current?.stop();
    speech.current?.close();
    speech.current = null;
    setRecording(false);
  };
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const voice = new SpeechStream((event) => {
        if (event.type === "transcript") {
          onVoiceTranscript?.(event.text, event.final);
          const current = controller.textInput.value;
          const base = voiceText.current && current.endsWith(voiceText.current)
            ? current.slice(0, -voiceText.current.length)
            : current;
          voiceText.current = event.text;
          controller.textInput.setInput(`${base}${event.text}`);
        }
        if (event.type === "error") { onVoiceError?.(event.message); stopRecording(); }
      });
      await voice.startAsr();
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => voice.sendAudio(float32ToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate));
      source.connect(processor); processor.connect(context.destination);
      speech.current = voice; audio.current = { context, stream, source, processor }; setRecording(true);
    } catch (error) {
      onVoiceError?.(error instanceof Error ? error.message : "无法访问麦克风");
      stopRecording();
    }
  };
  useEffect(() => stopRecording, []);

  return (
    <PromptInput
      accept={options.accept}
      className={[
        "chat-composer",
        multiline && "chat-composer-multiline",
        className,
      ].filter(Boolean).join(" ")}
      maxFiles={options.maxFiles}
      maxFileSize={options.maxFileSize}
      multiple={options.multiple}
      onDragEnter={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
      }}
      onError={({ code }) => onError(options.errorMessage(code))}
      onSubmit={async ({ text, files }) => {
        await onSubmit({ text, files: await toFiles(files) });
        setMultiline(false);
      }}
    >
      {dragging && (
        <div className="chat-composer-dropzone" role="status">
          <span className="chat-composer-dropzone-icon" aria-hidden="true">
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
        <PromptInputTextarea
          aria-label={label}
          disabled={disabled}
          onInput={(event) => updateMultiline(event.currentTarget)}
          placeholder="给知芽发消息…"
        />
      </PromptInputBody>
      <PromptInputFooter className="chat-composer-footer">
        <PromptInputTools>
          <PromptInputButton
            aria-label={options.addLabel}
            className="chat-composer-attachment-button"
            disabled={disabled || running}
            onClick={() => attachments.openFileDialog()}
            tooltip={options.addLabel}
          >
            <PlusIcon />
          </PromptInputButton>
        </PromptInputTools>
        <PromptInputTools className="chat-composer-submit-tools">
          <PromptInputButton
            aria-label={voiceModeActive ? (voiceMuted ? "打开麦克风" : "静音麦克风") : (recording ? "停止录音" : "语音输入")}
            className={recording || (voiceModeActive && voiceMuted) ? "chat-composer-voice recording" : "chat-composer-voice"}
            disabled={disabled || running}
            onClick={() => voiceModeActive ? onToggleVoiceMute?.() : (recording ? stopRecording() : void startRecording())}
            tooltip={voiceModeActive ? (voiceMuted ? "打开麦克风" : "静音麦克风") : (recording ? "停止录音" : "语音输入")}
          >
            {voiceModeActive ? (voiceMuted ? <MicOffIcon /> : <MicIcon />) : (recording ? <MicOffIcon /> : <MicIcon />)}
          </PromptInputButton>
          {!canSubmit && !running && !voiceModeActive && (
            <PromptInputButton
              aria-label="开始语音对话"
              className="chat-composer-submit chat-composer-voice-mode"
              disabled={disabled}
              onClick={onStartVoiceMode}
              tooltip="开始语音对话"
            >
              <AudioWaveformIcon />
            </PromptInputButton>
          )}
          {(canSubmit || running) && <PromptInputSubmit
            aria-label={running ? "打断" : submitLabel}
            className="chat-composer-submit"
            disabled={!running && (disabled || !canSubmit)}
            onStop={onStop}
            status={running ? "streaming" : "ready"}
            title={running ? "打断" : submitLabel}
          />}
          {voiceModeActive && !canSubmit && !running && <PromptInputButton
            aria-label="结束语音对话"
            className="chat-composer-submit chat-composer-voice-end"
            onClick={onEndVoiceMode}
            tooltip="结束语音对话"
          >
            <PhoneOffIcon />
          </PromptInputButton>}
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
