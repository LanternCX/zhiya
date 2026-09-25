# Text / Speech Unified Voice Mode 重构审计与实施计划

> 审计基线：`64e76a4 chore: save current voice workspace`（2026-09-25）。
> 本文只描述当前实现和后续计划；本阶段不修改业务代码。

## 1. 当前执行链路

### 1.1 Text Chat

1. `apps/client/src/features/course/CourseRoom.tsx` 渲染 `ChatComposer`，`onSubmit` 指向本组件的 `submit`。
2. `submit` 校验当前课程、上传附件，然后调用 `runPrompt`（课程尚未建立时也由它负责创建课程）。
3. `runPrompt` 最终调用 `CourseSession.prompt(text, materialNames)`。
4. `CourseSession.prompt` 向当前 `CourseSession` 的 teacher Agent 追加一条 user message，再调用 `teacher.prompt`。
5. `apps/client/src/pi/agent.ts` 的 `createAgent` 使用现有模型网关和 system prompt；课程教师 Agent 在 `apps/client/src/pi/agent/teacher.ts` 创建并复用课程历史。
6. Agent 的流式 assistant message 通过 `CourseSession` 回调回到 `CourseRoom`，更新 `messages`，再由课程保存逻辑持久化到课程 conversation state。
7. `CourseRoom` 的句子提取逻辑会把 assistant 流按句送进 `NarrationPlayer`（当前 `voiceEnabled` 固定为 `true`）。

### 1.2 当前“听写”入口

1. `ChatComposer.tsx` 的麦克风按钮在非实时语音模式下调用 `navigator.mediaDevices.getUserMedia`。
2. `SpeechStream`（`apps/client/src/transport/speech.ts`）连接 `/api/speech/stream`，发送 `start` 和二进制 PCM 音频。
3. `apps/server/cmd/api/speech.go` 将二进制音频转发到 Qwen ASR，上游事件转成 `transcript` / `complete` / `error`。
4. `ChatComposer` 只更新本地 `dictationDraft`；用户点击“使用听写内容”后，文本被放回输入框，仍需再次点击发送。
5. 该流程是可编辑听写，不是自动提交的 Voice Conversation。

### 1.3 当前实时 Voice Chat

1. `CourseRoom.startLiveVoice` 创建 `VoiceSessionController`，并将 final transcript 回调映射为 `submit({ text, files: [] })`。
2. `VoiceSessionController.start` 连接 `/api/voice/session`，启动 `MicrophoneCapture`，持续发送二进制 PCM，并按本地 VAD 发送 `commit-turn`。
3. `apps/server/cmd/api/voice_session.go` 为浏览器会话维护独立 ASR/TTS 上游 WebSocket；ASR partial/final 事件回传为 `transcript-delta` / `transcript-final`。
4. final transcript 回到 `CourseRoom.submit`，与文字输入走同一个 `runPrompt -> CourseSession.prompt -> teacher Agent` 链路，因此当前实时语音已经复用课程 Agent 和课程保存链路。
5. `CourseRoom` 观察 assistant message 的完整句子：实时语音时调用 `VoiceSessionController.speakText`，否则调用 `NarrationPlayer.speak`。
6. `VoiceSessionController` 收到 `tts-audio` 后使用 Web Audio API 排队播放；收到 `tts-complete` 后继续发送排队文本。
7. VAD 在 assistant 播放或思考期间检测到新的语音时调用 `interrupt`，停止本地播放、发送 `cancel-tts`，并调用 `CourseSession.stopCurrent()`。

## 2. 涉及文件与职责

### 客户端

- `apps/client/src/components/ChatComposer.tsx`：普通文本、附件、可编辑听写和实时语音入口目前混在同一组件。
- `apps/client/src/transport/speech.ts`：旧式 `/api/speech/stream` ASR/TTS 封装、PCM 转换、`NarrationPlayer`、句子提取。
- `apps/client/src/features/voice/MicrophoneCapture.ts`：AudioWorklet/PCM 捕获和 VAD 事件。
- `apps/client/src/features/voice/vad.ts`：本地能量 VAD。
- `apps/client/src/features/voice/VoiceSessionController.ts`：实时会话 WebSocket、ASR 转录、TTS 音频队列和打断。
- `apps/client/src/features/voice/voice-reducer.ts`、`types.ts`、`protocol.ts`：当前实时语音状态、动作和协议类型。
- `apps/client/src/features/course/CourseRoom.tsx`：课程会话、文字提交、语音控制器接线、assistant 文本和 TTS 触发点。
- `apps/client/src/pi/sessions/course.ts`：唯一的课程 Conversation/Agent 协调器、历史消息、取消和 narration barrier。
- `apps/client/src/pi/agent.ts`、`apps/client/src/pi/agent/teacher.ts`：Agent 构造、业务 system prompt、工具和流式输出。
- `apps/client/src/domain/learning.ts`、`apps/client/src/features/course/courses.ts`：课程 conversation state 和持久化 API。

### 服务端

- `apps/server/cmd/api/routes.go`：注册 `/api/speech/stream` 和 `/api/voice/session`。
- `apps/server/cmd/api/speech.go`：旧式单 WebSocket ASR/TTS relay。
- `apps/server/cmd/api/voice_protocol.go`：实时语音控制消息和服务端事件校验/序列化。
- `apps/server/cmd/api/voice_session.go`：实时会话生命周期、Qwen ASR/TTS 上游连接、音频/转录转发、取消和清理。
- `apps/server/internal/config/config.go`、`apps/server/config.yaml`：speech endpoint、独立 ASR/TTS key、模型和音色配置。
- `apps/server/cmd/api/realtime.go`、`model.go`、`learning.go`：现有 Agent 网关和课程请求通道。
- `apps/server/internal/data/learning.go`、`schema.sql`：Conversation、消息序列和 memory 的持久化。

## 3. 当前 ASR 实现

- Provider 为 Qwen，配置来自 `Speech.Endpoint`、`ASRAPIKey`、`ASRModel`。
- 实时模式已支持二进制 PCM chunk 流式转发，浏览器端目标采样率为 16 kHz；ASR 上游以 `streaming: duplex` 启动任务。
- 服务端将 sentence 文本和 `sentence_end` 映射为 partial/final 事件。
- 可编辑听写仍使用旧的 `/api/speech/stream` 入口；它与实时会话的 provider relay 代码路径重复。

## 4. 当前 TTS 实现

- Provider 同样为 Qwen，但使用独立 `TTSAPIKey`、`TTSModel`、`TTSVoice`。
- 实时模式通过 `/api/voice/session` 的 `speak-text` 建立/使用 Qwen realtime TTS，上游 PCM 事件转换为 `tts-audio`，结束时发送 `tts-complete`。
- `CourseRoom` 先按 `takeCompletedSentences` 分句，因此不是 token 级请求；`VoiceSessionController` 还维护串行 speech queue。
- 非实时路径使用 `NarrationPlayer`，它也自行创建 Web Audio 播放资源。当前存在两套播放控制器和两条 TTS relay 路径。

## 5. Conversation / Agent 入口

- 唯一业务入口是 `CourseSession.prompt`，由 `CourseRoom.runPrompt` 调用。
- `CourseSession` 持有唯一 teacher Agent、初始历史、课程工具和 narration barrier；`stopCurrent` 可中止当前 Agent。
- 课程消息通过 `CourseRoom` 的 `messages` 状态更新，并由 `saveCourseConversation` 保存。
- 服务端 `LearningModel` 保存数据库中的课程/学习 Conversation 和 message sequence；语音服务本身不保存独立 Conversation。

## 6. Text 和 Speech 是否共用上下文

当前实时 Voice Chat **基本共用**上下文：final transcript 被转成普通 `submit`，最终进入同一个 `CourseSession` 和同一个课程 conversation。

但数据模型仍不完整：

- `CourseMessage` 没有 `input_mode`，无法区分 text/speech 来源。
- Voice Mode 没有向 Agent 或 Presenter 传递“当前回答应口语化”的明确模式信息。
- 可编辑听写和实时语音使用不同入口，前端仍保留两套 ASR lifecycle。
- assistant 的显示文本和语音文本没有显式分离，只是先按句截取后直接朗读。

因此“共享 Agent/Conversation”已经存在，但“统一 UserMessage、输出风格和 provider 抽象”尚未建立。

## 7. 当前最大架构问题

1. **模式信息丢失**：语音 final transcript 调用普通 `submit`，没有 `input_mode`，Agent 无法可靠启用 Voice Style Prompt。
2. **职责集中在 `CourseRoom`**：它同时协调课程状态、提交、语音会话、句子分割、两种播放器和错误展示，UI 与音频/会话耦合。
3. **播放实现重复**：`NarrationPlayer` 和 `VoiceSessionController` 各自管理 AudioContext、队列、停止和完成回调，存在重复播放、资源释放和 narration barrier 不一致风险。
4. **Provider 调用分散**：旧 speech relay 与 voice session relay 都直接处理 Qwen 协议，ASR/TTS 接口没有稳定的 provider abstraction。
5. **状态定义不统一**：实时 reducer 已有一组状态，组件还用 `liveVoice`、`voiceMuted`、`busy`、录音状态等独立布尔值拼装 UI，未形成计划要求的单一 Voice State。
6. **错误降级不完整**：实时语音启动失败能回到文字聊天，但 TTS/播放错误、ASR final 丢失、队列完成和 narration barrier 的边界缺少统一错误类型和恢复策略。
7. **流式输出与语音样式未分离**：完整 assistant Markdown、代码和表格会被句子截取后朗读，没有 `display_text` / `speech_text` 或 `ResponsePresenter`。
8. **服务端生命周期仍需加强**：TTS 每次 `speak-text` 可能创建新的上游连接；session 单用户并发、超时、重连、二进制帧校验和指标尚未形成独立策略。

## 8. 可直接复用的代码

- `CourseSession` 的 Agent、历史、工具、取消和保存机制应保留，不能创建 Voice Agent 或 VoiceConversation。
- `VoiceSessionController` 的 sessionId/turnId 过滤、ASR/TTS WebSocket 协议、播放中打断思路可保留并拆分。
- `MicrophoneCapture`、`vad.ts`、`float32ToPcm16` 可作为流式音频采集基础，继续使用 Qwen ASR。
- `voice_protocol.go` / `protocol.ts` 的事件命名和 turn-scoped 消息可扩展。
- `takeCompletedSentences` 可演化为独立 `TextChunker`，补充最小长度、最大长度和超时 flush。
- `NarrationPlayer` 的 PCM 解码逻辑可迁移到统一 `PlaybackController`。
- `CourseRoom` 的课程保存、消息渲染和最终 transcript 提交位置可作为 adapter 接口，不应继续承载底层音频实现。
- 旧 `/api/speech/stream` 暂时保留，保证可编辑听写在实时 Voice 重构期间继续可用。

## 9. 建议新增模块

按当前目录调整后的逻辑边界：

```text
apps/client/src/conversation/
  ConversationManager.ts       # 统一 text/speech UserMessage 提交适配
  ResponsePresenter.ts         # display_text / speech_text 和 Voice Style
apps/client/src/features/voice/
  VoiceController.ts            # 协调 capture、ASR、conversation、TTS、状态
  TextChunker.ts                # 流式文本按语义分句
  PlaybackController.ts         # 唯一 enqueue/play/stop/clear 播放器
apps/client/src/providers/
  asr/                           # 客户端协议适配（不放 API key）
  tts/
apps/server/cmd/api/providers/
  asr/base.go, asr/qwen.go
  tts/base.go, tts/qwen.go
```

第一版可在现有 `features/voice` 和 `transport` 下增量落地，不要求一次移动所有文件；边界必须先通过接口固定。

## 10. 建议修改文件

### Phase 1 重点文件

- `apps/client/src/domain/learning.ts`：为课程消息/统一 user message 增加 `input_mode`，保持旧消息默认 `text`。
- `apps/client/src/pi/sessions/course.ts`：让 `prompt` 接收统一 UserMessage 或等价参数，并保证历史、取消和保存不分叉。
- `apps/client/src/features/course/CourseRoom.tsx`：文字和 final transcript 都调用统一 submit adapter；移除语音专属上下文判断。
- 新增 `apps/client/src/conversation/ConversationManager.ts`（或当前目录等价位置）。
- `apps/client/src/features/voice/types.ts`、`voice-reducer.ts`：收敛主状态和错误类型。

### Phase 2～6 重点文件

- Phase 2：`MicrophoneCapture.ts`、`vad.ts`、`VoiceSessionController.ts`、`transport/speech.ts`、`voice_session.go`、ASR tests。
- Phase 3：新增 `ResponsePresenter.ts`，修改 `agent/teacher.ts` 或 Agent prompt 构造入口，修改 `CourseRoom.tsx` 显示/朗读分离。
- Phase 4：新增 `TextChunker.ts`、`PlaybackController.ts`，替换 `NarrationPlayer` 和 controller 内重复播放逻辑。
- Phase 5：`VoiceController.ts`、`VoiceSessionController.ts`、`CourseSession.stopCurrent`、语音 UI 接线。
- Phase 6：`voice_protocol.go`、`voice_session.go`、配置、指标/清理测试及文档。

## 11. Phase 1～Phase 6 文件级实施计划

### Phase 1：统一消息、Conversation 和状态

**修改/新增**：`domain/learning.ts`、`ConversationManager.ts`、`CourseSession`、`CourseRoom`、voice types/reducer、相关类型测试。

**行为**：

- text 和 speech 都生成 `{ role: "user", text, input_mode }`。
- `CourseSession`、历史、memory、tools、session 仍只有一套。
- voice 状态由 reducer 的单一主状态表达，UI 只订阅 controller 状态。
- 旧持久化消息缺省为 `text`，不破坏已有课程。

**测试**：纯文字连续对话、Speech→Text 上下文、Text→Speech 上下文、同一 conversation id、状态转移和 stale turn 事件。

### Phase 2：流式 ASR 和 final transcript

**修改/新增**：`VoiceController`/`VoiceSessionController`、`MicrophoneCapture`、`transport/speech.ts`、服务端 ASR provider/relay、partial/final UI。

**行为**：

- 音频 chunk 持续推送，partial 只更新 UI。
- 只有 final transcript 调用 ConversationManager.submit。
- ASR 不可用时显示明确 ASR 错误，文字输入继续可用。
- 保留旧 `/api/speech/stream` 作为听写兼容路径，直到新路径验证完成。

**测试**：partial 刷新不产生 user message、final 只提交一次、ASR 失败不影响 text chat、麦克风清理。

### Phase 3：ResponsePresenter 和 Voice Style

**修改/新增**：`conversation/ResponsePresenter.ts`、Agent prompt 入口、`CourseSession` 输出 adapter、`CourseRoom`。

**行为**：

- 保留核心业务 system prompt，Voice Mode 追加 mode prompt。
- 同一 Agent 根据 `input_mode`/当前 mode 生成完整 display text 和简洁 speech text。
- 代码、表格、URL 不逐字朗读；必要时提示查看屏幕。
- display text 继续完整保存和渲染。

**测试**：同一问题 text/voice 风格明显不同；display text 完整；speech text 不朗读代码块/复杂表格；历史只保存一次 assistant 消息。

### Phase 4：流式 TTS、TextChunker、PlaybackController

**修改/新增**：`TextChunker.ts`、`PlaybackController.ts`、`VoiceSessionController.ts`、`transport/speech.ts`、服务端 TTS provider。

**行为**：

- Agent 流式文本进入 TextChunker，按中英文句末、min/max chars、flush timeout 生成 chunk。
- 第一完整句生成后即开始 TTS；后续生成与播放并行。
- 全局每个 Voice session 只有一个 PlaybackController，统一 enqueue/play/stop/clear。
- TTS 失败只影响语音输出，assistant display text 和 narration barrier 正常完成。

**测试**：首句先于整段回答播放、短 chunk 合并、超时 flush、队列顺序、TTS 失败后文字仍显示、AudioContext 清理。

### Phase 5：简单打断

**修改/新增**：`VoiceController.ts`、`VoiceSessionController.ts`、`CourseSession.stopCurrent`、`PlaybackController.ts`、voice UI。

**行为**：

- SPEAKING 时用户开始新语音，300ms 内停止当前音频、清空队列、取消当前 TTS 和 Agent turn。
- 增加 turnId/AbortController，迟到的 ASR/TTS 事件不能污染新轮次。
- 已显示 assistant 文本保留；新 final transcript 继续进入同一 conversation。

**测试**：播放中点击麦克风立即停止；旧音频不再播放；旧 Agent 取消；新轮次可正常提交；退出/切换课程从任何状态清理资源。

### Phase 6：错误、重连、指标和资源清理

**修改/新增**：`voice_session.go`、provider interfaces、配置、客户端 controller、metrics/error tests、快速开始文档。

**行为**：

- 区分 Microphone、ASR、Agent、TTS、Playback 错误。
- 语音失败不阻塞文字聊天；TTS 失败不丢 assistant 文本；ASR 失败可继续文字输入。
- 页面隐藏、卸载、课程切换和结束会话释放麦克风、WebSocket、AudioContext、队列。
- 记录连接、ASR final、Agent 首 token、首个 TTS audio、打断延迟。
- 仅有限重连，不引入 Full Duplex/VAD 自动复杂打断/独立 Voice Agent。

**测试**：网络断开/有限重连、并发 session 拒绝、超时、畸形帧、页面卸载清理、指标采集和全量回归。

## 12. 风险点与回归防护

- `CourseSession.prompt` 签名变化可能影响课程入口、entry request 和工具调用；先加兼容 adapter，再逐步收紧类型。
- 现有课程数据没有 `input_mode`；读取时必须默认 `text`，保存时不能重写无关历史。
- `CourseRoom` 当前用 assistant 最后一条消息驱动 narration barrier；拆分 presenter/player 时必须保证每个完成、失败、取消路径都释放 barrier，避免 Agent 永久 busy。
- 实时 ASR 与可编辑听写共享麦克风/PCM 工具，不能让一个 WebSocket 的关闭影响另一个入口。
- 当前 `voiceEnabled` 固定为 `true`，改为按 Voice Mode 控制时需覆盖普通文字回答的既有朗读行为，避免静默或重复播放。
- 音频播放从两个实现合并为一个时，需验证浏览器 autoplay、AudioContext resume、队列顺序和取消竞态。
- Qwen ASR/TTS 上游协议和鉴权必须继续由服务端处理；不能把 key 或 provider 细节带到浏览器。
- 语音自动提交可能与文字 submit/Agent busy 竞争；ConversationManager 需要明确排队、拒绝或取消策略，确保同一轮只产生一条 user message。
- 首版不做 Native Speech-to-Speech、Full Duplex、Backchannel、Semantic Turn Taking、Sideband、Delegation、复杂 VAD interruption 或独立 Voice Agent。

## 13. 审计结论

当前项目已经具备可用的“Speech → final transcript → 现有 CourseSession/Agent → 文字和 TTS”最小闭环，且实时语音与文字在课程层共享上下文。后续重构的核心不是再造 Agent，而是把现有能力收敛为统一 UserMessage、单一 Voice 状态机、ResponsePresenter、统一流式 TTS 播放器和 provider 边界，并用降级和测试保护文字聊天。

本阶段到此停止。下一步应先评审本计划，再开始 Phase 1；在获得确认前不进行业务代码重构。
