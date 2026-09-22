# Speech Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-proxied streaming Qwen ASR input and automatic Qwen TTS narration to the course room.

**Architecture:** The browser connects to an authenticated Go WebSocket relay. The relay owns DashScope credentials and forwards duplex ASR audio/events or realtime TTS audio/events. The course composer owns recording controls; the course room owns narration playback and resolves the existing session narration barrier when playback finishes or is muted.

**Tech Stack:** Go `coder/websocket`, React 19, Web Audio API, MediaRecorder, TypeScript.

**Spec:** Confirmed speech integration design in the conversation.

## Global Constraints

- API keys are read from `ZHIYA_SERVER_SPEECH_*` environment variables and never committed.
- ASR final text is inserted into the composer and is not auto-submitted.
- TTS starts automatically for completed sentence chunks and can be muted immediately.
- Keep unrelated existing working-tree changes out of both commits.

### Task 1: ASR relay and composer

Files: `apps/server/internal/config/config.go`, `apps/server/cmd/api/routes.go`, new `apps/server/cmd/api/speech.go`, new `apps/server/cmd/api/speech_test.go`, `apps/client/src/transport/speech.ts`, `apps/client/src/components/ChatComposer.tsx`, `apps/client/src/components/chat-composer.css`.

- Add speech configuration and validation.
- Add authenticated `/api/speech/stream` relay with `start`, binary PCM, `stop`, and `tts-start` commands.
- Add typed browser client and microphone control; partial/final transcripts update the existing prompt input.
- Test protocol mapping/config validation, then run Go and client checks.
- Commit `feat: add streaming speech input`.

### Task 2: TTS narration

Files: `apps/client/src/transport/speech.ts`, `apps/client/src/features/course/CourseRoom.tsx`, `apps/client/src/features/course/course.css`, `apps/client/src/pi/sessions/course.ts`, tests for sentence buffering/audio queue.

- Add sentence buffering, Web Audio PCM queue, automatic narration, and mute/stop controls.
- Connect playback completion/mute to `CourseSession.finishNarration`.
- Run full checks and commit `feat: add automatic voice narration`.
