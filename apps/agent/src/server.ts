import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  open,
  remove,
  shutdown,
  type Dispatch,
  type State,
} from "./runtime/instances";

const secret = process.env.ZHIYA_AGENT_SECRET;
if (!secret) throw new Error("ZHIYA_AGENT_SECRET is required");

const server = createServer(async (request, response) => {
  const send = (status: number, value: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  const actual = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    send(401, { error: "Unauthorized" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/commands") {
    send(404, { error: "Not found" });
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) {
        send(413, { error: "请求过大" });
        return;
      }
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString()) as Dispatch;
    const { session, grant, command } = input;
    if (
      !session?.id ||
      !input.userId ||
      !grant ||
      !command?.requestId ||
      !Array.isArray(command.args)
    )
      throw new Error("执行请求无效");
    const entry = await open(input);
    const state = entry.host.state as State;
    state.commands ??= {};
    if (state.commands[command.requestId]) {
      await entry.accepting.get(command.requestId);
      send(202, { ok: true });
      return;
    }
    state.commands[command.requestId] = { status: "running" };
    entry.pending++;
    entry.lastUsed = Date.now();
    // Persist acceptance before responding; never tie execution to the HTTP request.
    const acceptance = entry.host.flush();
    entry.accepting.set(command.requestId, acceptance);
    try {
      await acceptance;
    } catch (error) {
      entry.pending--;
      remove(session.id, entry);
      throw error;
    } finally {
      entry.accepting.delete(command.requestId);
    }
    const current = entry;
    void current.host
      .command(command.action, command.args)
      .then(
        () => {
          state.commands![command.requestId] = { status: "complete" };
        },
        (error) => {
          state.error = error instanceof Error ? error.message : "执行失败";
          state.commands![command.requestId] = {
            status: "failed",
            error: state.error,
          };
        },
      )
      .finally(async () => {
        current.pending--;
        current.lastUsed = Date.now();
        try {
          await current.host.flush();
        } catch (error) {
          console.error("Agent state persistence failed", error);
          remove(session.id, current);
        }
      });
    send(202, { ok: true });
  } catch (error) {
    send(500, {
      error: error instanceof Error ? error.message : "执行暂时不可用",
    });
  }
});
const address = process.env.ZHIYA_AGENT_LISTEN ?? "127.0.0.1:8082";
const separator = address.lastIndexOf(":");
server.listen(
  Number(address.slice(separator + 1)),
  address.slice(0, separator),
  () => {
    const bound = server.address();
    console.log(
      `Agent service listening on ${typeof bound === "object" && bound ? `${bound.address}:${bound.port}` : address}`,
    );
  },
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    const stopped = shutdown();
    server.close(() => { void stopped.then(() => process.exit(0)); });
  });
