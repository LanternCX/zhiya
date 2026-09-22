import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

import { buildFinishTask } from "../src/providers/qwen.mjs";
import { buildRunTask, buildTtsSession, mapQwenAsrEvent, mapQwenTtsEvent } from "./protocol.mjs";

const webRoot = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VOICE_DEMO_PORT || 4178);
const apiKey = process.env.DASHSCOPE_API_KEY;
const allowedFiles = new Set(["/", "/index.html", "/styles.css", "/client.mjs", "/audio.mjs", "/mic-processor.mjs"]);
const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };

if (!apiKey) throw new Error("DASHSCOPE_API_KEY is missing. Run with --env-file=.env.local.");

const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (!allowedFiles.has(pathname)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const filename = pathname === "/" ? "index.html" : pathname.slice(1);
  response.setHeader("Content-Type", mimeTypes[extname(filename)] || "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(join(webRoot, filename)).pipe(response);
});

const browserSockets = new WebSocketServer({ server, path: "/stream" });

browserSockets.on("connection", (browser) => {
  let upstream;
  let taskId;
  let ready = false;
  const pendingAudio = [];

  const sendBrowser = (message) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify(message));
  };

  const closeUpstream = () => {
    if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close();
  };

  browser.on("message", (data, isBinary) => {
    if (isBinary) {
      if (ready && upstream?.readyState === WebSocket.OPEN) upstream.send(data);
      else pendingAudio.push(data);
      return;
    }

    let command;
    try {
      command = JSON.parse(data.toString());
    } catch {
      sendBrowser({ type: "error", message: "Invalid local control message" });
      return;
    }

    if (command.type === "start" && !upstream) {
      taskId = crypto.randomUUID();
      upstream = new WebSocket("wss://dashscope.aliyuncs.com/api-ws/v1/inference", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      upstream.on("open", () => upstream.send(JSON.stringify(buildRunTask(taskId))));
      upstream.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        const mapped = mapQwenAsrEvent(event);
        if (!mapped) return;
        if (mapped.type === "ready") {
          ready = true;
          for (const chunk of pendingAudio.splice(0)) upstream.send(chunk);
        }
        sendBrowser(mapped);
        if (mapped.type === "error" || mapped.type === "complete") closeUpstream();
      });
      upstream.on("error", (error) => sendBrowser({ type: "error", message: `Qwen connection failed: ${error.message}` }));
      upstream.on("close", () => { ready = false; });
      return;
    }

    if (command.type === "tts-start" && !upstream) {
      if (typeof command.text !== "string" || !command.text.trim()) {
        sendBrowser({ type: "error", message: "请输入要合成的文本" });
        return;
      }
      upstream = new WebSocket("wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      upstream.on("open", () => upstream.send(JSON.stringify(buildTtsSession(command.voice || "Cherry"))));
      upstream.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event?.type === "session.created") {
          upstream.send(JSON.stringify({ type: "input_text_buffer.append", text: command.text }));
          upstream.send(JSON.stringify({ type: "input_text_buffer.commit" }));
          sendBrowser({ type: "tts-ready" });
          return;
        }
        const mapped = mapQwenTtsEvent(event);
        if (!mapped) return;
        sendBrowser(mapped);
        if (mapped.type === "complete" || mapped.type === "error") closeUpstream();
      });
      upstream.on("error", (error) => sendBrowser({ type: "error", message: `Qwen TTS connection failed: ${error.message}` }));
      return;
    }

    if (command.type === "tts-stop") {
      closeUpstream();
      sendBrowser({ type: "complete" });
      return;
    }

    if (command.type === "stop" && ready) {
      upstream.send(JSON.stringify(buildFinishTask(taskId)));
    }
  });

  browser.on("close", closeUpstream);
  browser.on("error", closeUpstream);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Zhiya voice stream demo: http://127.0.0.1:${port}`);
});

function shutdown() {
  browserSockets.close();
  server.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
