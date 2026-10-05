import { conversationView } from "./view";
import type {
  Answer,
  AssistantOutput,
  ConversationView,
  ModelInfo,
  ModelRetryListener,
} from "../../domain/learning";
import type { ProfileProjection } from "../../domain/agent";
import { ConversationChannel } from "./channel";
import { AgentConnection } from "../../transport/agent";

export class ProfileConnection {
  private channel = new ConversationChannel();
  private agent?: AgentConnection<ProfileProjection>;
  private observer?: (state: ProfileProjection) => void;
  private latest?: ProfileProjection;
  private detachWaiting?: () => void;
  private attached?: Promise<void>;
  get running() {
    return Boolean(this.latest?.busy);
  }
  subscribe(listener: (state: ConversationView) => void) {
    return this.channel.subscribe((state) => listener(conversationView(state)));
  }
  async open() {
    this.agent ??= new AgentConnection<ProfileProjection>(
      { kind: "profile" },
      (state) => {
        this.latest = state;
        this.observer?.(state);
      },
      () => {},
    );
    this.attached ??= this.agent.ready.then(() =>
      this.agent!.command("attach"),
    );
    await this.attached;
    return conversationView(await this.channel.open());
  }
  async answer(questionId: string, answer: Answer) {
    return conversationView(await this.channel.answer(questionId, answer));
  }
  async endCorrection() {
    await this.agent?.command("endCorrection");
    return conversationView(await this.channel.open());
  }
  createSession(
    _info: ModelInfo,
    update: (state: ConversationView) => void,
    output: (state: AssistantOutput) => void,
    onRetry: ModelRetryListener,
  ) {
    let stopped = false;
    const observe = (state: ProfileProjection) => {
      if (stopped) return;
      update(conversationView(state.conversation));
      if (state.output) output(state.output);
      onRetry(state.retry ?? null);
    };
    this.observer = observe;
    if (this.latest) observe(this.latest);
    return {
      get isStopped() {
        return stopped;
      },
      run: async (text?: string) => {
        await this.open();
        // A returning view attaches to the existing run instead of claiming another one.
        if (this.latest?.busy && !text) {
          await new Promise<void>((resolve, reject) => {
            this.detachWaiting = resolve;
            this.observer = (state) => {
              observe(state);
              if (!state.busy) {
                this.observer = observe;
                if (state.error) reject(new Error(state.error));
                else resolve();
              }
            };
          });
        } else await this.agent!.command("run", [text]);
      },
      stop: () => {
        stopped = true;
        void this.agent?.command("stop").catch(() => {});
      },
      detach: () => {
        stopped = true;
        this.detachWaiting?.();
        this.observer = undefined;
      },
    };
  }
  close() {
    this.detachWaiting?.();
    this.observer = undefined;
    this.agent?.close();
    this.channel.close();
  }
}
