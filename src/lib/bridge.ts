import type { ApiKeyStatus, AppSettings, HistoryItem } from "../types";

type UnlistenFn = () => void;

const desktop = () => {
  if (!window.sout) throw new Error("This feature is available in the Sout desktop application.");
  return window.sout;
};

// Kept as a compatibility name so the UI can distinguish browser previews from the desktop runtime.
export const isDesktop = () => Boolean(window.sout);

export async function loadSettings(): Promise<AppSettings> {
  return desktop().loadSettings();
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await desktop().saveSettings(settings);
}

export async function updateHotkey(hotkey: string): Promise<void> {
  await desktop().updateHotkey(hotkey);
}

export async function apiKeyStatus(): Promise<ApiKeyStatus> {
  return desktop().apiKeyStatus();
}

export async function saveApiKey(apiKey: string): Promise<void> {
  await desktop().saveApiKey(apiKey);
}

export async function deleteApiKey(): Promise<void> {
  await desktop().deleteApiKey();
}

export async function testApiKey(apiKey?: string): Promise<string> {
  return desktop().testApiKey(apiKey || null);
}

export async function transcribe(audio: Uint8Array, mimeType: string): Promise<string> {
  return desktop().transcribeAudio(audio, mimeType);
}

export async function copyAndMaybePaste(text: string, paste: boolean): Promise<void> {
  await desktop().writeClipboard(text);
  if (paste) await desktop().pasteToPrevious(false);
}

export async function pastePrevious(keepOpen = false): Promise<void> {
  await desktop().pasteToPrevious(keepOpen);
}

export async function finishDictation(): Promise<void> {
  await desktop().finishDictation();
}

export async function cancelDictation(): Promise<void> {
  await desktop().cancelDictation();
}

export async function requestDictation(): Promise<void> {
  await desktop().requestDictation();
}

export async function loadHistory(): Promise<HistoryItem[]> {
  return desktop().loadHistory();
}

export async function addHistory(text: string): Promise<HistoryItem> {
  return desktop().addHistory(text);
}

export async function removeHistory(id: string): Promise<void> {
  await desktop().deleteHistoryItem(id);
}

export async function clearHistory(): Promise<void> {
  await desktop().clearHistory();
}

export async function setStartup(enabled: boolean): Promise<void> {
  await desktop().setStartup(enabled);
}

export async function isStartupEnabled(): Promise<boolean> {
  return desktop().isStartupEnabled();
}

export async function setCompactWindow(compact: boolean): Promise<void> {
  await desktop().setCompactWindow(compact);
}

export async function hideWindow(): Promise<void> {
  await desktop().hideWindow();
}

export function onEvent<T>(event: "dictation-start" | "dictation-stop" | "navigate", handler: (payload: T) => void): Promise<UnlistenFn> {
  return Promise.resolve(desktop().on(event, (payload) => handler(payload as T)));
}
