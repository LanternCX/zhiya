import { openSession } from "../pi/session";
import { CourseHost, type CourseProjection } from "./course";
import { ProfileHost, type ProfileProjection } from "./profile";
import { ToolAPI } from "../adapters/api";
import type { ModelInfo } from "../domain/learning";

type Receipt = { status: "running" | "complete" | "failed"; error?: string };
export type State = (CourseProjection | ProfileProjection) & {
  commands?: Record<string, Receipt>;
};
export type Dispatch = {
  userId: string;
  session: { id: string; kind: string; conversationId: string; state: State };
  grant: string;
  memory: string;
  model: ModelInfo;
  command: { requestId: string; action: string; args: unknown[] };
};
type Entry = {
  host: CourseHost | ProfileHost;
  grant: string;
  heartbeat: ReturnType<typeof setInterval>;
  lastUsed: number;
  pending: number;
  accepting: Map<string, Promise<void>>;
  close: () => Promise<void>;
};
const entries = new Map<string, Entry>();
const opening = new Map<string, Promise<Entry>>();
const closing = new Map<string, Promise<void>>();
const internalOrigin = process.env.ZHIYA_AGENT_API ?? "http://127.0.0.1:8081";
export const remove = (id: string, entry: Entry) => {
  const pending = closing.get(id);
  if (pending) return pending;
  clearInterval(entry.heartbeat);
  if (entries.get(id) === entry) entries.delete(id);
  const done = entry.host.shutdown()
    .finally(entry.close)
    .catch((error) => console.error("Pi session close failed", error))
    .finally(() => {
      if (closing.get(id) === done) closing.delete(id);
    });
  closing.set(id, done);
  return done;
};

export async function open(input: Dispatch): Promise<Entry> {
  const { session, grant } = input;
  await closing.get(session.id);
  const pending = opening.get(session.id);
  if (pending) {
    await pending;
    return open(input);
  }
  const previous = entries.get(session.id);
  if (previous?.grant === grant) return previous;
  const promise = (async () => {
    const api = new ToolAPI(
      internalOrigin,
      process.env.ZHIYA_AGENT_SECRET!,
      session.id,
      grant,
    );
    await api.json(`/sessions/${session.id}/heartbeat`, "POST", {});
    if (previous) await remove(session.id, previous);
    session.state.busy = false;
    if (session.kind === "course") {
      Object.assign(session.state, { running: false, generating: false, activity: null, retry: null });
    }
    for (const receipt of Object.values(session.state.commands ?? {})) {
      if (receipt.status === "running") {
        receipt.status = "failed";
        receipt.error = "执行服务已重启，请重试";
      }
    }
    const durable = await openSession(
      input.userId,
      session.conversationId || (session.state as CourseProjection).conversationId,
    );
    const host =
      session.kind === "course"
        ? new CourseHost(
            api,
            input.model,
            input.memory,
            session.state as CourseProjection,
            durable,
          )
        : new ProfileHost(
            api,
            input.model,
            session.state as ProfileProjection,
            durable.session,
          );
    const entry: Entry = {
      host,
      close: durable.close,
      grant,
      lastUsed: Date.now(),
      pending: 0,
      accepting: new Map(),
      heartbeat: setInterval(() => {
        if (entries.get(session.id) !== entry) return;
        if (
          !entry.pending &&
          !host.running &&
          Date.now() - entry.lastUsed > 60000
        ) {
          remove(session.id, entry);
          return;
        }
        void api
          .json(`/sessions/${session.id}/heartbeat`, "POST", {})
          .catch(() => remove(session.id, entry));
      }, 10000),
    };
    entries.set(session.id, entry);
    return entry;
  })();
  opening.set(session.id, promise);
  try {
    return await promise;
  } finally {
    opening.delete(session.id);
  }
}

export async function shutdown() {
  await Promise.all(
    [...opening.values()].map((pending) => pending.catch(() => undefined)),
  );
  await Promise.all([...entries].map(([id, entry]) => remove(id, entry)));
  await Promise.all(closing.values());
}
