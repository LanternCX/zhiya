# Voice Demo

独立的 ASR/TTS 本地验证工具，不接入知芽现有产品链路。

## 运行 mock

在仓库根目录执行：

```powershell
node tools/voice-demo/src/index.mjs
$env:VOICE_MODE = "tts"; node tools/voice-demo/src/index.mjs
```

## 运行 Qwen

先在本目录安装唯一的 WebSocket 依赖：

```powershell
npm install --prefix tools/voice-demo
```

Windows 可运行以下脚本，将 API Key 安全写入被 Git 忽略的 `.env.local`：

```powershell
powershell -ExecutionPolicy Bypass -File tools/voice-demo/scripts/setup-key.ps1
```

然后设置百炼 API Key。密钥只放在当前终端环境变量中，不要写入文件：

```powershell
$env:VOICE_PROVIDER = "qwen"
$env:VOICE_MODE = "asr"
$env:DASHSCOPE_API_KEY = "你的API_KEY"
$env:VOICE_AUDIO = "绝对路径\audio.pcm"
$env:VOICE_REFERENCE = "音频对应的人工校准文本"
node tools/voice-demo/src/index.mjs
```

TTS：

```powershell
$env:VOICE_MODE = "tts"
$env:VOICE_TEXT = "请解释一下什么是变量。"
node tools/voice-demo/src/index.mjs
```

默认会把 PCM 音频封装成可直接播放的 WAV 文件 `tools/voice-demo/output.wav`；可用 `VOICE_OUTPUT` 指定其他路径。

输出 JSON 包含转写文本、CER、首个结果延迟、最终延迟、TTS 首包/合成时间等指标。当前火山和腾讯适配器先保留为显式错误，避免在没有账号级 endpoint/resource 配置时误发请求；拿到具体账号配置后再补齐协议适配。

## TTS 回环测试 ASR

使用刚生成的 `output.wav` 测试 ASR。工具会自动读取 WAV、转换到 16 kHz PCM，并比较识别文本：

```powershell
$env:VOICE_PROVIDER = "qwen"
$env:VOICE_MODE = "roundtrip"
$env:VOICE_REFERENCE = "你好，我是知芽。今天我们来学习什么是变量。"
node tools/voice-demo/src/index.mjs
```

结果中的 `exactMatch` 表示规范化后是否完全一致，`metrics.cer` 为字符错误率。

## 浏览器实时麦克风测试

```powershell
npm --prefix tools/voice-demo run web
```

打开 <http://127.0.0.1:4178>，允许麦克风访问，点击“开始录音”。页面会实时显示中间识别结果；说完后点击“停止并完成”查看最终文本和句末延迟。API Key 只由本地 Node 服务读取，不会发送给浏览器。
