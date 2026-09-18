"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useElapsedSeconds } from "@/lib/use-elapsed-seconds";
import { cjk } from "@streamdown/cjk";
import { code } from "./code-theme";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import { Shimmer } from "./shimmer";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: defaultOpen ?? false,
      onChange: onOpenChange,
      prop: open,
    });
    const measuredDuration = useElapsedSeconds(isStreaming);
    const duration = durationProp ?? measuredDuration;

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        setIsOpen(newOpen);
      },
      [setIsOpen],
    );

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const REASONING_LINE_LENGTH = 36;
const REASONING_FIRST_BATCH_LENGTH = 12;
const REASONING_LINE_INTERVAL = 350;
const REASONING_BOUNDARIES = new Set([
  "。",
  "！",
  "？",
  "；",
  ".",
  "!",
  "?",
  ";",
  "\n",
]);

function reasoningLine(value: string) {
  const plainText = value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|[-+*>])\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  const characters = Array.from(plainText);
  const completed: string[] = [];
  let start = 0;
  for (let index = 0; index < characters.length; index += 1) {
    if (!REASONING_BOUNDARIES.has(characters[index])) continue;
    const line = characters.slice(start, index + 1).join("").trim();
    if (line) completed.push(line);
    start = index + 1;
  }
  const trailing = characters.slice(start);
  const completeBatches = Math.floor(trailing.length / REASONING_LINE_LENGTH);
  if (completeBatches > 0) {
    const batchStart = (completeBatches - 1) * REASONING_LINE_LENGTH;
    return trailing
      .slice(batchStart, batchStart + REASONING_LINE_LENGTH)
      .join("")
      .trim();
  }
  if (completed.length > 0) return completed.at(-1) ?? "";
  if (trailing.length >= REASONING_FIRST_BATCH_LENGTH)
    return `${trailing.slice(0, REASONING_FIRST_BATCH_LENGTH).join("")}…`;
  return "";
}

export const ReasoningLiveSummary = memo(
  ({ status, preview }: { status: string; preview?: string }) => {
    const { isOpen } = useReasoning();
    const reducedMotion = useReducedMotion();
    const candidate = useMemo(() => reasoningLine(preview ?? ""), [preview]);
    const [displayedLine, setDisplayedLine] = useState(candidate);
    const lastUpdate = useRef(candidate ? Date.now() : 0);

    useEffect(() => {
      if (!candidate || candidate === displayedLine) return;
      const remaining = Math.max(
        0,
        REASONING_LINE_INTERVAL - (Date.now() - lastUpdate.current),
      );
      const timer = window.setTimeout(() => {
        setDisplayedLine(candidate);
        lastUpdate.current = Date.now();
      }, remaining);
      return () => window.clearTimeout(timer);
    }, [candidate, displayedLine]);

    return (
      <span className="reasoning-live-summary">
        <Shimmer as="span" className="reasoning-live-status" duration={1}>
          {status}
        </Shimmer>
        {displayedLine && !isOpen ? (
          <>
            <span className="reasoning-live-separator" aria-hidden="true">
              ｜
            </span>
            <span className="reasoning-live-preview" aria-hidden="true">
              <AnimatePresence initial={false} mode="sync">
                <motion.span
                  key={displayedLine}
                  className="reasoning-live-line"
                  initial={
                    reducedMotion ? false : { opacity: 0, y: "100%" }
                  }
                  animate={{ opacity: 1, y: "0%" }}
                  exit={
                    reducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: "-100%" }
                  }
                  transition={{ duration: reducedMotion ? 0 : 0.18 }}
                >
                  {displayedLine}
                </motion.span>
              </AnimatePresence>
            </span>
          </>
        ) : null}
      </span>
    );
  },
);

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming) {
    return (
      <Shimmer duration={1}>
        {`Thinking · ${duration ?? 0}s`}
      </Shimmer>
    );
  }
  return <p>Thought completed</p>;
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground",
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="size-4" />
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};

const streamdownPlugins = { cjk, code, math, mermaid };

export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-4 text-sm",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      <Streamdown plugins={streamdownPlugins}>{children}</Streamdown>
    </CollapsibleContent>
  )
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
ReasoningLiveSummary.displayName = "ReasoningLiveSummary";
