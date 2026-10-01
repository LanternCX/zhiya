import { createServer } from "node:http";
import { once } from "node:events";

type Reply = {
  status?: number;
  contentType?: string;
  body?: string;
  json?: unknown;
};

/** Real server-side model boundary for browser tests that use PostgreSQL. */
export async function modelServer(
  handler: (request: {
    request: () => { method: () => string; postDataJSON: () => any };
    fulfill: (reply: Reply) => Promise<void>;
  }) => Promise<void>,
) {
  let notifyStarted = () => {};
  let notifyCancelled = () => {};
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    notifyStarted();
    response.on("close", () => {
      if (!response.writableEnded) notifyCancelled();
    });
    try {
      await handler({
        request: () => ({
          method: () => request.method!,
          postDataJSON: () => ({ payload: body }),
        }),
        fulfill: async (reply) => {
          if (response.destroyed) return;
          response.writeHead(reply.status ?? 200, {
            "Content-Type": reply.contentType ?? "application/json",
          });
          response.end(
            reply.json === undefined ? reply.body : JSON.stringify(reply.json),
          );
        },
      });
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  server.listen(18083, "127.0.0.1");
  await once(server, "listening");
  return {
    started: () =>
      new Promise<void>((resolve) => {
        notifyStarted = resolve;
      }),
    cancelled: () =>
      new Promise<void>((resolve) => {
        notifyCancelled = resolve;
      }),
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
