import { Type } from "typebox";
import { bindPersistedTool, type PersistedToolExecutor } from "../tool";

export function completeOnboardingTool(execute: PersistedToolExecutor) {
  return bindPersistedTool(
    {
      name: "complete_onboarding",
      label: "complete_onboarding",
      description:
        "Mark initial onboarding complete when you judge there is enough context. This does not extract or save memory.",
      parameters: Type.Object({}),
    },
    execute,
  );
}
