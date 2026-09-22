# Live Voice Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interruptible, continuous voice conversation mode that shares the existing course chat context.

**Architecture:** A browser-side VoiceSessionController coordinates AudioWorklet capture, local VAD, transcript turns, agent cancellation, and PCM playback. One authenticated Go WebSocket owns separate Qwen ASR and TTS upstream connections and emits turn-scoped events so cancelled output can be ignored safely.

**Tech Stack:** React 19, TypeScript, Web Audio API/AudioWorklet, Playwright, Go 1.26, coder/websocket, Qwen streaming ASR and realtime TTS.

**Spec:** `docs/superpowers/specs/2026-09-22-live-voice-mode-design.md`

## Global Constraints

- Preserve text chat and editable ASR dictation as separate modes.
- Keep ASR and TTS credentials server-side and independent.
- Do not persist raw audio in the first release.
- Every server and client event is scoped by `sessionId` and `turnId`.
- TTS errors, mute, cancellation, and exit must always release the CourseSession narration barrier.
- Do not commit unrelated existing working-tree changes.

---

### Task 1: Define and test the voice protocol

**Files:**
- Create: `apps/server/cmd/api/voice_protocol.go`
- Create: `apps/server/cmd/api/voice_protocol_test.go`
- Create: `apps/client/src/features/voice/protocol.ts`
- Test: `apps/client/tests/voice-mode.spec.ts`

**Interfaces:**
- Produces Go `voiceClientMessage` and `voiceServerEvent` types.
- Produces TypeScript `VoiceClientMessage`, `VoiceServerEvent`, and `isVoiceServerEvent`.

- [ ] Write Go table tests that accept valid start/commit/cancel/end messages and reject missing session IDs, invalid turn IDs, oversized text, and unsupported message types.
- [ ] Run `go test ./cmd/api -run VoiceProtocol` and confirm the tests fail because protocol types do not exist.
- [ ] Implement strict protocol decoding and error codes without exposing upstream errors or credentials.
- [ ] Run the focused Go test and confirm it passes.
- [ ] Add a Playwright browser test that feeds valid and invalid JSON to `isVoiceServerEvent` through a test page fixture.
- [ ] Run the focused Playwright test and confirm it fails before the TypeScript validator exists, then passes after implementation.
- [ ] Commit `feat: define realtime voice protocol`.

### Task 2: Split the Go speech relay into concurrent ASR and TTS sessions

**Files:**
- Modify: `apps/server/cmd/api/routes.go`
- Refactor: `apps/server/cmd/api/speech.go`
- Create: `apps/server/cmd/api/voice_session.go`
- Create: `apps/server/cmd/api/voice_session_test.go`
- Modify: `apps/server/internal/config/config.go`
- Modify: `apps/server/config.yaml`

**Interfaces:**
- Consumes `voiceClientMessage` and emits `voiceServerEvent`.
- Produces `newVoiceSession(config.Speech)`, `startASR`, `startTTS`, `cancelTTS`, and `close`.

- [ ] Write tests with local fake WebSocket upstreams proving ASR and TTS use different Authorization headers and remain connected concurrently.
- [ ] Add tests proving `cancel-tts` does not close ASR and `end-session` closes both upstreams.
- [ ] Run the focused tests and confirm failure against the single-upstream implementation.
- [ ] Implement `/api/voice/session`, per-user single-session enforcement, message-size limits, and separate upstream lifecycles.
- [ ] Preserve `/api/speech/stream` temporarily for editable dictation compatibility.
- [ ] Run `go test ./...` and the configuration validation tests.
- [ ] Commit `feat: add duplex voice session relay`.

### Task 3: Replace ScriptProcessor microphone capture with AudioWorklet and VAD

**Files:**
- Create: `apps/client/public/audio/voice-capture-processor.js`
- Create: `apps/client/src/features/voice/MicrophoneCapture.ts`
- Create: `apps/client/src/features/voice/vad.ts`
- Modify: `apps/client/src/transport/speech.ts`
- Test: `apps/client/tests/voice-mode.spec.ts`

**Interfaces:**
- Produces `MicrophoneCapture.start(onPcm, onVadEvent)`, `mute`, `unmute`, and `stop`.
- Produces deterministic `detectVoiceFrame(samples, config)` for tests.

- [ ] Write deterministic tests for silence, speech start, minimum speech duration, and end-of-turn silence.
- [ ] Confirm the tests fail before `vad.ts` exists.
- [ ] Implement 16 kHz mono PCM resampling and local energy-based VAD in an AudioWorklet.
- [ ] Ensure capture continues while TTS plays so barge-in is possible, while echo thresholds prevent immediate self-interruption.
- [ ] Test microphone permission denial and cleanup after navigation with Playwright browser stubs.
- [ ] Run `npm run check` and the focused voice tests.
- [ ] Commit `feat: add realtime microphone capture`.

### Task 4: Implement the browser voice state machine

**Files:**
- Create: `apps/client/src/features/voice/VoiceSessionController.ts`
- Create: `apps/client/src/features/voice/voice-reducer.ts`
- Create: `apps/client/src/features/voice/types.ts`
- Test: `apps/client/tests/voice-mode.spec.ts`

**Interfaces:**
- Produces `VoiceState` with idle, connecting, listening, committing, thinking, speaking, muted, recovering, and ended states.
- Produces controller methods `start`, `commitTurn`, `onAgentSentence`, `interrupt`, `setMuted`, and `end`.

- [ ] Write reducer tests for normal turn-taking, mute/unmute, stale turn events, network recovery, and exit from every state.
- [ ] Confirm tests fail before the reducer exists.
- [ ] Implement the pure reducer first, then the effectful controller around it.
- [ ] Use an AbortController per Agent turn; interruption aborts generation, cancels TTS, and increments `turnId`.
- [ ] Verify that late ASR/TTS events from older turns are ignored.
- [ ] Run type checking and focused tests.
- [ ] Commit `feat: coordinate live voice turns`.

### Task 5: Build the ChatGPT-style voice UI

**Files:**
- Create: `apps/client/src/features/voice/VoiceModePanel.tsx`
- Create: `apps/client/src/features/voice/voice-mode.css`
- Modify: `apps/client/src/components/ChatComposer.tsx`
- Modify: `apps/client/src/components/speech-controls.css`
- Test: `apps/client/tests/voice-mode.spec.ts`

**Interfaces:**
- Consumes `VoiceState` and callbacks for mute, speaker, captions, attach, and exit.
- Emits no network operations directly.

- [ ] Write Playwright assertions for entering voice mode from the composer, listening/thinking/speaking labels, keyboard focus, accessible button names, and returning to the unchanged composer after exit.
- [ ] Confirm the focused UI test fails before the panel exists.
- [ ] Implement an in-chat control panel rather than a separate route or conversation.
- [ ] Keep text input and attachments available during voice mode; place microphone mute, speaker, captions, and exit in one stable control row.
- [ ] Add reduced-motion behavior and minimum 44 px touch targets.
- [ ] Run focused Playwright tests at desktop and narrow mobile widths.
- [ ] Commit `feat: add live voice conversation UI`.

### Task 6: Connect voice turns to CourseSession and chat history

**Files:**
- Modify: `apps/client/src/features/course/CourseRoom.tsx`
- Modify: `apps/client/src/pi/sessions/course.ts`
- Modify: `apps/client/src/domain/learning.ts`
- Test: `apps/client/tests/course.spec.ts`
- Test: `apps/client/tests/voice-mode.spec.ts`

**Interfaces:**
- Consumes final transcript strings as ordinary user turns.
- Produces assistant sentence events for TTS without changing persisted message text.

- [ ] Add a test proving a final transcript becomes exactly one user message and uses the same conversation ID.
- [ ] Add a test proving interruption aborts the active Agent turn while preserving already-rendered assistant text.
- [ ] Add tests proving TTS completion, mute, failure, and exit all release `waitForNarrationPlayback`.
- [ ] Implement the adapter between VoiceSessionController and CourseSession without adding browser audio concerns to CourseSession.
- [ ] Persist final transcripts and assistant text through the existing course save flow; do not persist partial ASR text or audio.
- [ ] Run course and voice integration tests.
- [ ] Commit `feat: integrate live voice with courses`.

### Task 7: Reliability, metrics, and end-to-end acceptance

**Files:**
- Modify: `apps/server/cmd/api/voice_session.go`
- Modify: `apps/client/src/features/voice/VoiceSessionController.ts`
- Modify: `apps/client/tests/voice-mode.spec.ts`
- Modify: `docs/quick-start.md`

**Interfaces:**
- Produces structured timings for connection, ASR finalization, first agent token, first TTS audio, and interruption stop.

- [ ] Add deterministic reconnect tests with capped exponential backoff and a maximum of one retry during an active turn.
- [ ] Add server tests for session duration, concurrent-session rejection, malformed binary frames, and client disconnect cleanup.
- [ ] Document the two speech API Key environment variables and browser microphone requirements.
- [ ] Run `go test ./...`, `npm run check`, focused Playwright voice tests, and the existing course suite.
- [ ] Manually verify a real Qwen session: two spoken turns, one interruption, mute/unmute, typed input during voice mode, and clean exit.
- [ ] Record measured ASR-final, first-audio, and interruption latencies in the implementation handoff.
- [ ] Commit `test: verify realtime voice conversations`.
