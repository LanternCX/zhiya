import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import {
  JsonlSessionRepo,
  type Branch,
  type Session,
} from "@earendil-works/pi-agent-core/harness/session";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";

export { BACKGROUND_CONTEXT };
export type { Session };

/** Each user owns a workspace; Pi owns the session format and branch history. */
export async function openSession(userId: string, conversationId: string) {
  const root = resolve(process.env.ZHIYA_AGENT_WORKSPACES ?? ".workspaces");
  const cwd = join(root, createHash("sha256").update(userId).digest("hex"));
  const repo = new JsonlSessionRepo({
    fileSystem: new NodeExecutionEnv({ cwd }),
    sessionsRoot: join(cwd, "sessions"),
  });
  const sessions = new Map<string, Session>();
  const open = async (id: string) => {
    const opened = sessions.get(id);
    if (opened) return opened;
    const existing = (await repo.list({ cwd }, BACKGROUND_CONTEXT))
      .find((session) => session.id === id);
    const session = existing
      ? await repo.open(existing, BACKGROUND_CONTEXT)
      : await repo.create({ id, cwd }, BACKGROUND_CONTEXT);
    sessions.set(id, session);
    return session;
  };
  try {
    return { session: await open(conversationId), open, close: () => repo.close(BACKGROUND_CONTEXT) };
  } catch (error) {
    await repo.close(BACKGROUND_CONTEXT);
    throw error;
  }
}

export async function agentBranch(session: Session, name: string) {
  return (
    (await session.branch(name, BACKGROUND_CONTEXT)) ??
    (await session.createBranch(name, null, BACKGROUND_CONTEXT))
  );
}

export async function branchMessages(branch: Branch): Promise<AgentMessage[]> {
  const entries = await branch.findEntries(
    { type: "message", order: "oldestFirst" },
    BACKGROUND_CONTEXT,
  );
  return entries.flatMap((entry) =>
    entry.type === "message" ? [entry.message] : [],
  );
}

/** Await Pi's durable append before tools run; streamed fragments belong to the UI projection. */
export function persistAgent(
  agent: Agent,
  branch: Branch | (() => Promise<Branch>),
) {
  let opened: Promise<Branch> | undefined;
  return agent.subscribe(async (event) => {
    if (event.type !== "message_end") return;
    if (
      event.message.role === "assistant" &&
      ["error", "aborted"].includes(event.message.stopReason)
    ) return;
    opened ??= typeof branch === "function" ? branch() : Promise.resolve(branch);
    await (await opened).appendMessage(event.message, BACKGROUND_CONTEXT);
  });
}
