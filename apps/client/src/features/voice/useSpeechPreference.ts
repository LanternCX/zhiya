import { useSyncExternalStore } from "react";

const key = "zhiya.speech-replies";
const changeEvent = "zhiya-speech-preference";
let sessionPreference = false;

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changeEvent, listener);
  };
}

function read() {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return sessionPreference;
  }
}

export function useSpeechPreference() {
  const enabled = useSyncExternalStore(subscribe, read);
  const setEnabled = (value: boolean) => {
    sessionPreference = value;
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // The preference still works for this page when storage is unavailable.
    }
    window.dispatchEvent(new Event(changeEvent));
  };
  return [enabled, setEnabled] as const;
}
