import { encodePcm16, resampleFloat32 } from "./audio.mjs";

const elements = {
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  clear: document.querySelector("#clear"),
  status: document.querySelector("#status"),
  live: document.querySelector("#live-transcript"),
  final: document.querySelector("#final-transcript"),
  firstLatency: document.querySelector("#first-latency"),
  finalLatency: document.querySelector("#final-latency"),
  packets: document.querySelector("#packets"),
  level: document.querySelector("#level"),
  error: document.querySelector("#error"),
  asrTab: document.querySelector("#asr-tab"),
  ttsTab: document.querySelector("#tts-tab"),
  asrPanel: document.querySelector("#asr-panel"),
  ttsPanel: document.querySelector("#tts-panel"),
  asrMetrics: document.querySelector("#asr-metrics"),
  ttsMetrics: document.querySelector("#tts-metrics"),
  ttsStart: document.querySelector("#tts-start"),
  ttsStop: document.querySelector("#tts-stop"),
  ttsClear: document.querySelector("#tts-clear"),
  ttsText: document.querySelector("#tts-text"),
  ttsVoice: document.querySelector("#tts-voice"),
  ttsMessage: document.querySelector("#tts-message"),
  ttsDownload: document.querySelector("#tts-download"),
  ttsFirstLatency: document.querySelector("#tts-first-latency"),
  ttsChunks: document.querySelector("#tts-chunks"),
  ttsDuration: document.querySelector("#tts-duration"),
  ttsStatus: document.querySelector("#tts-status"),
};

let socket;
let stream;
let context;
let source;
let processor;
let silentGain;
let startedAt;
let stoppedAt;
let firstTranscriptAt;
let packetCount = 0;
let ttsContext;
let ttsNextTime = 0;
let ttsStartedAt;
let ttsFirstAudioAt;
let ttsChunks = [];
let ttsAudioBytes = 0;

function switchMode(mode) {
  const asr = mode === "asr";
  elements.asrTab.classList.toggle("active", asr);
  elements.ttsTab.classList.toggle("active", !asr);
  elements.asrTab.setAttribute("aria-selected", String(asr));
  elements.ttsTab.setAttribute("aria-selected", String(!asr));
  elements.asrPanel.hidden = !asr;
  elements.ttsPanel.hidden = asr;
  elements.asrMetrics.hidden = !asr;
  elements.ttsMetrics.hidden = asr;
  setStatus("准备就绪", "idle");
}

function setStatus(text, state) {
  elements.status.textContent = text;
  elements.status.dataset.state = state;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
  setStatus("测试失败", "error");
}

function resetMetrics() {
  startedAt = performance.now();
  stoppedAt = null;
  firstTranscriptAt = null;
  packetCount = 0;
  elements.live.textContent = "等待语音…";
  elements.final.textContent = "尚无最终结果";
  elements.firstLatency.textContent = "—";
  elements.finalLatency.textContent = "—";
  elements.packets.textContent = "0";
  elements.error.hidden = true;
}

async function beginCapture() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  context = new AudioContext();
  await context.audioWorklet.addModule("./mic-processor.mjs");
  source = context.createMediaStreamSource(stream);
  processor = new AudioWorkletNode(context, "microphone-processor");
  silentGain = context.createGain();
  silentGain.gain.value = 0;
  processor.port.onmessage = ({ data }) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const samples = resampleFloat32(data, context.sampleRate, 16000);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    elements.level.style.transform = `scaleX(${Math.max(0.02, Math.min(1, peak * 2.5))})`;
    socket.send(encodePcm16(samples));
  };
  source.connect(processor).connect(silentGain).connect(context.destination);
}

async function stopCapture() {
  processor?.disconnect();
  source?.disconnect();
  silentGain?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());
  await context?.close();
  processor = null;
  source = null;
  silentGain = null;
  stream = null;
  context = null;
  elements.level.style.transform = "scaleX(0.02)";
}

async function start() {
  resetMetrics();
  elements.start.disabled = true;
  elements.stop.disabled = true;
  setStatus("正在连接…", "connecting");
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/stream`);
  socket.binaryType = "arraybuffer";
  socket.onopen = () => socket.send(JSON.stringify({ type: "start" }));
  socket.onmessage = async ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === "ready") {
      try {
        await beginCapture();
        startedAt = performance.now();
        elements.stop.disabled = false;
        setStatus("正在聆听", "recording");
      } catch (error) {
        showError(error.name === "NotAllowedError" ? "麦克风权限被拒绝，请在浏览器地址栏中允许访问。" : error.message);
        socket.close();
        elements.start.disabled = false;
      }
    } else if (message.type === "transcript") {
      const now = performance.now();
      if (firstTranscriptAt == null) {
        firstTranscriptAt = now;
        elements.firstLatency.textContent = `${Math.round(now - startedAt)} ms`;
      }
      packetCount += 1;
      elements.packets.textContent = String(packetCount);
      elements.live.textContent = message.text;
      if (message.final) elements.final.textContent = message.text;
    } else if (message.type === "complete") {
      if (stoppedAt != null) elements.finalLatency.textContent = `${Math.round(performance.now() - stoppedAt)} ms`;
      setStatus("识别完成", "complete");
      elements.start.disabled = false;
      elements.stop.disabled = true;
      socket.close();
    } else if (message.type === "error") {
      showError(message.message);
      await stopCapture();
      elements.start.disabled = false;
      elements.stop.disabled = true;
    }
  };
  socket.onerror = () => {
    showError("无法连接本地语音服务，请确认服务仍在运行。");
    elements.start.disabled = false;
  };
}

async function stop() {
  elements.stop.disabled = true;
  setStatus("正在完成识别…", "stopping");
  stoppedAt = performance.now();
  await stopCapture();
  socket?.send(JSON.stringify({ type: "stop" }));
}

function clear() {
  elements.live.textContent = "等待语音…";
  elements.final.textContent = "尚无最终结果";
  elements.firstLatency.textContent = "—";
  elements.finalLatency.textContent = "—";
  elements.packets.textContent = "0";
  elements.error.hidden = true;
}

function decodeAndSchedule(base64, sampleRate) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  ttsChunks.push(bytes);
  ttsAudioBytes += bytes.byteLength;
  elements.ttsChunks.textContent = String(ttsChunks.length);
  elements.ttsDuration.textContent = `${Math.round(ttsAudioBytes / 2 / sampleRate * 1000)} ms`;
  if (ttsFirstAudioAt == null) {
    ttsFirstAudioAt = performance.now();
    elements.ttsFirstLatency.textContent = `${Math.round(ttsFirstAudioAt - ttsStartedAt)} ms`;
  }
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const audio = ttsContext.createBuffer(1, pcm.length, sampleRate);
  const channel = audio.getChannelData(0);
  for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32768;
  const sourceNode = ttsContext.createBufferSource();
  sourceNode.buffer = audio;
  sourceNode.connect(ttsContext.destination);
  ttsNextTime = Math.max(ttsNextTime, ttsContext.currentTime + 0.04);
  sourceNode.start(ttsNextTime);
  ttsNextTime += audio.duration;
}

function buildWav(chunks, sampleRate) {
  const pcm = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
  const buffer = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buffer);
  const text = (value, at) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text("RIFF", 0); view.setUint32(4, 36 + pcm.length, true); text("WAVE", 8); text("fmt ", 12); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text("data", 36); view.setUint32(40, pcm.length, true); new Uint8Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: "audio/wav" });
}

function resetTts() {
  ttsContext?.close();
  ttsContext = null;
  ttsNextTime = 0;
  ttsStartedAt = null;
  ttsFirstAudioAt = null;
  ttsChunks = [];
  ttsAudioBytes = 0;
  elements.ttsMessage.textContent = "等待文本…";
  elements.ttsFirstLatency.textContent = "—";
  elements.ttsChunks.textContent = "0";
  elements.ttsDuration.textContent = "0 ms";
  elements.ttsStatus.textContent = "待开始";
  elements.ttsDownload.hidden = true;
  if (elements.ttsDownload.href) URL.revokeObjectURL(elements.ttsDownload.href);
}

async function startTts() {
  const text = elements.ttsText.value.trim();
  if (!text) { elements.ttsMessage.textContent = "请先输入要合成的文本。"; return; }
  resetTts();
  ttsStartedAt = performance.now();
  ttsContext = new AudioContext();
  elements.ttsStart.disabled = true;
  elements.ttsStop.disabled = false;
  elements.ttsStatus.textContent = "连接中";
  setStatus("正在合成", "recording");
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/stream`);
  socket.onopen = () => socket.send(JSON.stringify({ type: "tts-start", text, voice: elements.ttsVoice.value }));
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === "tts-ready") {
      elements.ttsStatus.textContent = "流式输出";
      elements.ttsMessage.textContent = "正在边生成边播放…";
    } else if (message.type === "audio") {
      decodeAndSchedule(message.data, message.sampleRate);
    } else if (message.type === "complete") {
      elements.ttsStatus.textContent = "完成";
      elements.ttsMessage.textContent = "合成完成，音频已播放。";
      elements.ttsDownload.href = URL.createObjectURL(buildWav(ttsChunks, 24000));
      elements.ttsDownload.hidden = false;
      elements.ttsStart.disabled = false;
      elements.ttsStop.disabled = true;
      setStatus("合成完成", "complete");
      socket.close();
    } else if (message.type === "error") {
      elements.ttsStatus.textContent = "失败";
      elements.ttsMessage.textContent = message.message;
      elements.ttsStart.disabled = false;
      elements.ttsStop.disabled = true;
      setStatus("测试失败", "error");
    }
  };
  socket.onerror = () => { elements.ttsMessage.textContent = "无法连接本地语音服务。"; elements.ttsStart.disabled = false; };
}

function stopTts() {
  socket?.send(JSON.stringify({ type: "tts-stop" }));
  ttsContext?.close();
  elements.ttsStop.disabled = true;
  elements.ttsStatus.textContent = "已停止";
  elements.ttsMessage.textContent = "播放已停止。";
}

elements.start.addEventListener("click", start);
elements.stop.addEventListener("click", stop);
elements.clear.addEventListener("click", clear);
elements.asrTab.addEventListener("click", () => switchMode("asr"));
elements.ttsTab.addEventListener("click", () => switchMode("tts"));
elements.ttsStart.addEventListener("click", startTts);
elements.ttsStop.addEventListener("click", stopTts);
elements.ttsClear.addEventListener("click", resetTts);
