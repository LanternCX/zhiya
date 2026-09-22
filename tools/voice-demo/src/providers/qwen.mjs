import WebSocket from "ws";

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

export function receiveUntil(ws, onMessage) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ws.off("message", handle);
      ws.off("error", fail);
      ws.off("close", close);
    };
    const succeed = (value) => { cleanup(); resolve(value); };
    const fail = (error) => { cleanup(); reject(error); };
    const close = (code, reason) => fail(new Error(`Qwen WebSocket closed before completion (${code}: ${reason?.toString() || "no reason"})`));
    const handle = (raw) => {
      try {
        const value = JSON.parse(raw.toString());
        if (value?.header?.event === "task-failed") {
          fail(new Error(`${value.header.error_code || "Qwen task failed"}: ${value.header.error_message || "unknown error"}`));
          return;
        }
        onMessage(value, succeed);
      } catch (error) {
        fail(error);
      }
    };
    ws.on("message", handle);
    ws.once("error", fail);
    ws.once("close", close);
  });
}

function waitForEvent(ws, predicate) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      const value = JSON.parse(raw.toString());
      if (predicate(value)) {
        ws.off("message", onMessage);
        resolve(value);
      }
    };
    ws.on("message", onMessage);
    ws.once("error", reject);
  });
}

export function buildFinishTask(taskId) {
  return {
    header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
    payload: { input: {} },
  };
}

export function createQwenProvider({ apiKey, asrModel = "qwen-audio-3.0-asr-flash-streaming", ttsModel = "qwen3-tts-flash-realtime" }) {
  if (!apiKey) throw new Error("Qwen requires DASHSCOPE_API_KEY or VOICE_API_KEY");
  return {
    async transcribe(audio, { sampleRate = 16000 } = {}) {
      const ws = new WebSocket("wss://dashscope.aliyuncs.com/api-ws/v1/inference", { headers: { Authorization: `Bearer ${apiKey}` } });
      await waitForOpen(ws);
      const taskId = crypto.randomUUID();
      ws.send(JSON.stringify({ header: { action: "run-task", task_id: taskId, streaming: "duplex" }, payload: { task_group: "audio", task: "asr", function: "recognition", model: asrModel, parameters: { format: "pcm", sample_rate: sampleRate }, input: {} } }));
      await waitForEvent(ws, (event) => event?.header?.event === "task-started");
      const packets = [];
      let text = "";
      for (let offset = 0; offset < audio.length; offset += 1280) ws.send(audio.subarray(offset, offset + 1280));
      ws.send(JSON.stringify(buildFinishTask(taskId)));
      await receiveUntil(ws, (event, done) => {
        const output = event?.payload?.output;
        const next = output?.sentence?.text || output?.text || event?.text;
        if (next) { text = next; packets.push({ text }); }
        if (event?.header?.event === "task-finished" || event?.type === "session.finished") done();
      });
      ws.close();
      return { text, packets };
    },
    async synthesize(text) {
      const ws = new WebSocket(`wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(ttsModel)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
      await waitForOpen(ws);
      ws.send(JSON.stringify({ type: "session.update", session: { voice: "Cherry", response_format: "pcm", sample_rate: 24000, mode: "server_commit" } }));
      ws.send(JSON.stringify({ type: "input_text_buffer.append", text }));
      ws.send(JSON.stringify({ type: "input_text_buffer.commit" }));
      const chunks = [];
      await receiveUntil(ws, (event, done) => {
        if (event?.type === "response.audio.delta") chunks.push(Buffer.from(event.delta, "base64"));
        if (event?.type === "response.audio.done") done();
      });
      ws.send(JSON.stringify({ type: "session.finish" }));
      ws.close();
      return { audio: Buffer.concat(chunks), sampleRate: 24000 };
    },
  };
}
