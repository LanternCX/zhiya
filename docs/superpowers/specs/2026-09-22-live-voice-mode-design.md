# 知芽实时语音对话模式设计

## 目标

在现有文字聊天、ASR 听写和 TTS 自动朗读之外，增加一种与当前课程聊天共享上下文的实时语音模式。用户可以连续说话，知芽以自然语音回答，并且用户可以在回答过程中直接开口打断。

## 产品模式

- 文字模式：编辑并发送文本，保留当前行为。
- 听写模式：语音转为可编辑文本，不自动发送。
- 实时语音模式：自动判断用户轮次、提交最终转录、播放回答并允许打断。

三种模式共享同一条课程会话和聊天记录。进入实时语音模式不会创建新课程或新对话。

## 界面

普通输入框继续使用自适应单行/多行布局。实时语音模式通过输入框右侧的 Voice 入口启动，启动后输入框切换为语音控制栏：

- 左侧保留附件入口和实时字幕开关。
- 中间显示“正在聆听 / 正在思考 / 知芽正在回答”等状态。
- 右侧提供麦克风静音、扬声器开关和结束语音按钮。
- 用户仍可输入文字或添加材料，提交内容进入同一上下文。

退出语音模式后恢复普通输入框，已完成轮次的用户转录和助手文字继续显示在聊天记录中。

## 状态模型

一次 VoiceSession 只有以下互斥主状态：

- `idle`：未启动。
- `connecting`：建立本地和上游连接。
- `listening`：采集语音并等待有效人声。
- `committing`：静音达到阈值，等待 ASR 最终文本。
- `thinking`：Agent 正在生成回复。
- `speaking`：播放 TTS，同时继续监听用户是否打断。
- `muted`：保留会话但不上传麦克风音频。
- `recovering`：连接短暂失败并重连。
- `ended`：会话已结束。

录音权限失败、上游鉴权失败和不可恢复网络错误进入 `ended`，但必须保留文字聊天能力。

## 轮次和打断

浏览器持续运行本地 VAD。检测到语音后进入 listening；持续静音达到阈值后发送 `commit-turn`，最终 ASR 文本作为一条用户消息交给现有 CourseSession。

助手文本按完整句子进入 TTS 队列。播放中检测到用户有效人声时：

1. 立即停止本地音频队列；
2. 向服务端发送 `cancel-tts`；
3. 中断当前 Agent 生成；
4. 保留已经展示的助手文本；
5. 开始新的用户语音轮次。

短促背景噪声不得触发打断。第一版采用能量阈值、最短发声时长和静音窗口组合；阈值通过配置集中管理。

## 技术架构

浏览器和 Go 服务端之间保持一个受认证的 `/api/voice/session` WebSocket。服务端为每个 VoiceSession 同时维护独立的 ASR 和 TTS 上游连接，并使用不同 API Key。Agent 仍通过现有课程模型接口执行，不把模型 Key 暴露给浏览器。

浏览器侧拆分为：

- `VoiceSessionController`：状态机、轮次和取消控制。
- `MicrophoneCapture`：AudioWorklet、16 kHz PCM 和 VAD。
- `RealtimeTranscriber`：partial/final 转录事件。
- `NarrationQueue`：24 kHz PCM 排队、停止和完成事件。
- `VoiceModePanel`：只渲染状态和派发用户动作。

Go 服务端拆分为：

- `voiceSessionHandler`：鉴权、生命周期和客户端协议。
- `qwenASRSession`：ASR 上游协议。
- `qwenTTSSession`：TTS 上游协议。
- `voiceProtocol`：客户端事件验证和错误映射。

## 客户端协议

客户端控制消息：`start-session`、`audio`、`commit-turn`、`cancel-tts`、`mute`、`unmute`、`end-session`。

服务端事件：`session-ready`、`speech-started`、`transcript-delta`、`transcript-final`、`tts-audio`、`tts-complete`、`session-error`、`session-ended`。

每条消息携带 `sessionId` 和单调递增的 `turnId`。客户端忽略已取消轮次的迟到事件，防止旧音频或旧转录污染当前对话。

## 数据和隐私

- API Key 只存在服务端环境变量。
- 第一版不持久化原始音频，只保存现有聊天文本。
- 页面隐藏、课程切换、退出语音和组件卸载时立即释放麦克风及 WebSocket。
- 服务端限制单用户并发语音会话、消息大小、采样率和会话时长。

## 成功标准

- 普通文字和听写模式没有回归。
- 用户停顿后能自动形成一个文本轮次并触发 Agent。
- 第一段 TTS 音频在首个完整句子生成后开始播放。
- 用户在播放期间开口，播放器可在 300 ms 内停止本地音频。
- 关闭扬声器、TTS 失败或退出模式都不会卡住课程流程。
- 每轮最终文本可在聊天历史中复查。
