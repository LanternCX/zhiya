import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { ArrowUpIcon, AudioWaveformIcon, FileUpIcon, MicIcon, MicOffIcon, PhoneOffIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
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
  voiceTranscript?: string;
  onVoiceError?: (message: string) => void;
  onStartVoiceMode?: () => void;
  voiceModeActive?: boolean;
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
  voiceTranscript = "",
  onVoiceError,
  onStartVoiceMode,
  voiceModeActive = false,
  onEndVoiceMode,
}: ChatComposerProps) {
  const attachments = usePromptInputAttachments();
  const controller = usePromptInputController();
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [dictationDraft, setDictationDraft] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [multiline, setMultiline] = useState(false);
  const speech = useRef<SpeechStream | null>(null);
  const dictationBase = useRef("");
  const audio = useRef<{ context: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; analyser: AnalyserNode } | null>(null);
  const levelFrame = useRef<number | null>(null);
  const recordingAttempt = useRef(0);
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
  const cleanupCapture = (closeSpeech = true) => {
    if (levelFrame.current !== null) cancelAnimationFrame(levelFrame.current);
    levelFrame.current = null;
    audio.current?.processor.disconnect();
    audio.current?.source.disconnect();
    audio.current?.analyser.disconnect();
    audio.current?.stream.getTracks().forEach((track) => track.stop());
    void audio.current?.context.close();
    audio.current = null;
    speech.current?.stop();
    if (closeSpeech) {
      speech.current?.close();
      speech.current = null;
    }
    setAudioLevel(0);
    audio.current = null;
  };
  const cancelDictation = () => {
    recordingAttempt.current += 1;
    cleanupCapture();
    setRecording(false);
    setDictationDraft(null);
    dictationBase.current = "";
  };
  const stopRecording = () => {
    recordingAttempt.current += 1;
    cleanupCapture(false);
    setRecording(false);
    setDictationDraft((value) => value ?? "");
    window.setTimeout(() => {
      speech.current?.close();
      speech.current = null;
    }, 1500);
  };
  const confirmDictation = () => {
    const draft = dictationDraft ?? "";
    if (draft) controller.textInput.setInput(`${dictationBase.current}${draft}`);
    setDictationDraft(null);
    dictationBase.current = "";
  };
  const startRecording = async () => {
    const attempt = ++recordingAttempt.current;
    setRecording(true);
    try {
      dictationBase.current = controller.textInput.value;
      setDictationDraft("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt !== recordingAttempt.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const voice = new SpeechStream((event) => {
        if (event.type === "transcript") {
          onVoiceTranscript?.(event.text, event.final);
          setDictationDraft(event.text);
        }
        if (event.type === "complete") {
          speech.current?.close();
          speech.current = null;
        }
        if (event.type === "error") { onVoiceError?.(event.message); cancelDictation(); }
      });
      await voice.startAsr();
      if (attempt !== recordingAttempt.current) {
        voice.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      const levelData = new Uint8Array(analyser.fftSize);
      processor.onaudioprocess = (event) => voice.sendAudio(float32ToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate));
      source.connect(analyser); analyser.connect(processor); processor.connect(context.destination);
      const updateLevel = () => {
        analyser.getByteTimeDomainData(levelData);
        let energy = 0;
        for (const value of levelData) {
          const sample = (value - 128) / 128;
          energy += sample * sample;
        }
        const rms = Math.sqrt(energy / levelData.length);
        setAudioLevel(Math.min(1, rms * 5.5));
        levelFrame.current = requestAnimationFrame(updateLevel);
      };
      speech.current = voice; audio.current = { context, stream, source, processor, analyser }; updateLevel();
    } catch (error) {
      if (attempt !== recordingAttempt.current) return;
      onVoiceError?.(error instanceof Error ? error.message : "无法访问麦克风");
      cancelDictation();
    }
  };
  useEffect(() => cancelDictation, []);
  useEffect(() => {
    if (!voiceModeActive || !voiceTranscript.trim()) return;
    controller.textInput.setInput(voiceTranscript);
  }, [controller, voiceModeActive, voiceTranscript]);

  return (
    <PromptInput
      accept={options.accept}
      className={[
        "chat-composer",
        multiline && "chat-composer-multiline",
        dictationDraft !== null && "chat-composer-dictating",
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
        {recording || dictationDraft !== null ? (
          <div className="chat-dictation-bar" role="status" aria-live="polite">
            <PromptInputButton aria-label="取消听写" className="chat-dictation-action" disabled={disabled} onClick={cancelDictation} tooltip="取消听写"><XIcon /></PromptInputButton>
            <div className="chat-dictation-wave" aria-label={recording ? "正在听写" : "听写已暂停"}>
              {Array.from({ length: 18 }, (_, index) => {
                const scale = Math.max(0.18, Math.min(1, audioLevel * (0.7 + ((index * 17) % 9) / 10)));
                return <i key={index} style={{ "--dictation-scale": String(scale) } as CSSProperties} />;
              })}
            </div>
            <PromptInputButton aria-label={recording ? "停止听写" : "继续听写"} className="chat-dictation-action" disabled={disabled || !recording} onClick={stopRecording} tooltip={recording ? "停止听写" : "听写已暂停"}><SquareIcon /></PromptInputButton>
            <PromptInputButton aria-label="使用听写内容" className="chat-dictation-confirm" disabled={disabled || recording || !dictationDraft} onClick={confirmDictation} tooltip="使用听写内容"><ArrowUpIcon /></PromptInputButton>
          </div>
        ) : <PromptInputTextarea
          aria-label={label}
          disabled={disabled}
          onInput={(event) => updateMultiline(event.currentTarget)}
          placeholder="给知芽发消息…"
        />}
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
            aria-label={recording ? "停止语音输入" : "开始语音输入"}
            className={recording ? "chat-composer-voice recording" : "chat-composer-voice"}
            disabled={disabled || (running && !voiceModeActive)}
            onClick={() => recording ? stopRecording() : void startRecording()}
            tooltip={recording ? "停止语音输入" : "开始语音输入"}
          >
            {recording ? <MicOffIcon /> : <MicIcon />}
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
