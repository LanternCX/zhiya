import assert from "node:assert/strict";
import { createServer, loadConfigFromFile } from "vite";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";

test("the client dev proxy forwards the voice WebSocket upgrade", async (t) => {
  const upstream = createHttpServer();
  upstream.on("upgrade", (request, socket) => {
    if (request.url !== "/api/voice/session") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"));
    socket.end();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => upstream.close());

  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "test" },
    fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  );
  const configuredProxy = loaded.config.server?.proxy?.["/api"];
  const proxy = typeof configuredProxy === "string"
    ? { target: configuredProxy }
    : { ...configuredProxy };
  proxy.target = `http://127.0.0.1:${upstream.address().port}`;

  const client = await createServer({
    configFile: false,
    plugins: loaded.config.plugins,
    resolve: loaded.config.resolve,
    define: loaded.config.define,
    server: { host: "127.0.0.1", port: 0, proxy: { "/api": proxy } },
  });
  await client.listen();
  t.after(() => client.close());

  const port = client.httpServer.address().port;
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/voice/session`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("voice WebSocket upgrade timed out"));
    }, 1500);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      socket.close();
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("voice WebSocket upgrade failed"));
    }, { once: true });
  });
});
