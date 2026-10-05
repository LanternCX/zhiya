import { AgentConnection, type SyncStatus } from "../../transport/agent";
import type { CourseProjection } from "../../domain/agent";
import type {
  InputMode,
  CodingExercise,
  QuestionPage,
  AnimationPlaybackState,
} from "../../domain/learning";

export function createCourseSession(
  input: { courseId?: string; conversationId?: string },
  receive: (state: CourseProjection) => void,
  failure: (message: string) => void,
  sync?: (status: SyncStatus) => void,
) {
  let busy = false;
  let latest: CourseProjection | undefined;
  let mutations = Promise.resolve();
  const drafts = new Map<string, object>();
  const render = () => {
    if (!latest) return;
    receive({
      ...latest,
      lesson: {
        ...latest.lesson,
        pages: latest.lesson.pages.map((page) =>
          drafts.has(page.id) ? { ...page, ...drafts.get(page.id) } : page,
        ),
      },
    });
  };
  const connection = new AgentConnection<CourseProjection>(
    { kind: "course", ...input },
    (state) => {
      busy = state.busy;
      state.lesson.pages = state.lesson.pages.map((page) => {
        const previous = latest?.lesson.pages.find(
          (item) => item.id === page.id,
        );
        return previous && JSON.stringify(previous) === JSON.stringify(page)
          ? previous
          : page;
      });
      latest = state;
      render();
    },
    failure,
    sync,
    true,
  );
  const command = async (action: string, args: unknown[] = []) => {
    try {
      await connection.command(action, args);
    } catch (error) {
      failure(error instanceof Error ? error.message : "操作失败");
    }
  };
  const edit = (action: string, id: string, changes: object) => {
    const draft = { ...drafts.get(id), ...changes };
    drafts.set(id, draft);
    render();
    const payload = Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [
        key,
        value === undefined ? null : value,
      ]),
    );
    mutations = mutations
      .then(() => command(action, [id, payload]))
      .finally(() => {
        if (drafts.get(id) === draft) {
          drafts.delete(id);
          render();
        }
      });
  };
  if (input.conversationId) void command("attach");
  return {
    get busy() {
      return busy;
    },
    prompt: (
      text: string,
      materials: string[] = [],
      mode: InputMode = "text",
    ) => mutations.then(() => command("prompt", [text, materials, mode])),
    materials: async (files: File[]) =>
      command("materials", [
        await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            base64: await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result).split(",")[1]);
              reader.onerror = () => reject(new Error("无法读取教学材料，请重新选择文件"));
              reader.readAsDataURL(file);
            }),
          })),
        ),
      ]),
    stop: () => connection.close(),
    stopCurrent: () => {
      void command("stop");
    },
    finishNarration: (_id: number) => {},
    animationPlayback: (state: AnimationPlaybackState) => {
      void command("animationPlayback", [state.pageId, state]);
    },
    beginFromHandoff: (mode: InputMode) => command("beginFromHandoff", [mode]),
    selectPresentation: (id: string) => {
      void command("selectPresentation", [id]);
    },
    selectDeliverable: (id: string, blockId = "") => {
      mutations = mutations.catch(() => {}).then(() => connection.command("selectDeliverable", [id, blockId]));
      return mutations;
    },
    updateCodingExercise: (
      ...args: [string, Partial<Pick<CodingExercise, "code" | "stdin" | "result">>]
    ) => {
      edit("updateCodingExercise", args[0], args[1]);
    },
    updateQuestion: (...args: [string, Pick<QuestionPage, "selected" | "answerText">]) => {
      edit("updateQuestion", args[0], args[1]);
    },
    submitQuestion: (id: string) =>
      mutations.then(() => command("submitQuestion", [id])),
    deferQuestion: (id: string) =>
      mutations.then(() => command("deferQuestion", [id])),
    requestExerciseReview: () =>
      mutations.then(() => command("requestExerciseReview")),
  };
}
