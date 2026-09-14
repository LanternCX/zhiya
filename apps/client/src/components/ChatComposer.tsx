import { useRef, useState, type DragEvent } from "react";
import { FileUpIcon, PaperclipIcon } from "lucide-react";
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
import "./chat-composer.css";

type AttachmentErrorCode = "max_files" | "max_file_size" | "accept";

export type ChatComposerAttachmentOptions = {
  accept: string;
  addLabel: string;
  dropHint: string;
  dropLabel: string;
  errorMessage: (code: AttachmentErrorCode) => string;
  hint: string;
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
  placeholder: string;
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
  placeholder,
  running = false,
  submitLabel,
}: ChatComposerProps) {
  const attachments = usePromptInputAttachments();
  const controller = usePromptInputController();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const canSubmit = Boolean(
    controller.textInput.value.trim() || attachments.files.length,
  );
  const hasFiles = (event: DragEvent<HTMLFormElement>) =>
    event.dataTransfer.types.includes("Files");

  return (
    <PromptInput
      accept={options.accept}
      className={["chat-composer", className].filter(Boolean).join(" ")}
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
      onSubmit={async ({ text, files }) =>
        onSubmit({ text, files: await toFiles(files) })
      }
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
          placeholder={placeholder}
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
            <PaperclipIcon />
          </PromptInputButton>
          <span>{options.hint}</span>
        </PromptInputTools>
        <PromptInputSubmit
          aria-label={running ? "打断" : submitLabel}
          className="chat-composer-submit"
          disabled={!running && (disabled || !canSubmit)}
          onStop={onStop}
          status={running ? "streaming" : "ready"}
          title={running ? "打断" : submitLabel}
        />
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
