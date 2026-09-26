export type VoicePlaybackText = Record<number, string>;

export function appendVoicePlaybackText(
  current: VoicePlaybackText,
  messageId: number,
  text: string,
): VoicePlaybackText {
  return {
    ...current,
    [messageId]: `${current[messageId] ?? ""}${text}`,
  };
}
