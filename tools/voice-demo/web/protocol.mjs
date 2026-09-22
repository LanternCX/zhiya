export function buildRunTask(taskId) {
  return {
    header: { action: "run-task", task_id: taskId, streaming: "duplex" },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model: "qwen-audio-3.0-asr-flash-streaming",
      parameters: { format: "pcm", sample_rate: 16000 },
      input: {},
    },
  };
}

export function mapQwenAsrEvent(event) {
  if (event?.header?.event === "task-failed") {
    return {
      type: "error",
      message: `${event.header.error_code || "Qwen task failed"}: ${event.header.error_message || "unknown error"}`,
    };
  }
  const sentence = event?.payload?.output?.sentence;
  if (sentence?.text) {
    return { type: "transcript", text: sentence.text, final: Boolean(sentence.sentence_end) };
  }
  if (event?.header?.event === "task-started") return { type: "ready" };
  if (event?.header?.event === "task-finished") return { type: "complete" };
  return null;
}

export function buildTtsSession(voice = "Cherry") {
  return {
    type: "session.update",
    session: { voice, response_format: "pcm", sample_rate: 24000, mode: "server_commit" },
  };
}

export function mapQwenTtsEvent(event) {
  if (event?.type === "response.audio.delta" && event.delta) {
    return { type: "audio", data: event.delta, sampleRate: 24000 };
  }
  if (event?.type === "response.audio.done") return { type: "complete" };
  if (event?.type === "error") return { type: "error", message: event.error?.message || "TTS request failed" };
  return null;
}
