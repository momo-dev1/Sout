import type { ApiKeyStatus, AppSettings, HistoryItem } from "./types";

declare global {
  interface Window {
    sout?: {
      loadSettings(): Promise<AppSettings>;
      saveSettings(settings: AppSettings): Promise<void>;
      updateHotkey(hotkey: string): Promise<void>;
      apiKeyStatus(): Promise<ApiKeyStatus>;
      saveApiKey(apiKey: string): Promise<void>;
      deleteApiKey(): Promise<void>;
      testApiKey(apiKey: string | null): Promise<string>;
      transcribeAudio(audio: Uint8Array, mimeType: string): Promise<string>;
      writeClipboard(text: string): Promise<void>;
      pasteToPrevious(keepOpen: boolean): Promise<void>;
      finishDictation(): Promise<void>;
      cancelDictation(): Promise<void>;
      requestDictation(): Promise<void>;
      loadHistory(): Promise<HistoryItem[]>;
      addHistory(text: string): Promise<HistoryItem>;
      deleteHistoryItem(id: string): Promise<void>;
      clearHistory(): Promise<void>;
      setStartup(enabled: boolean): Promise<void>;
      isStartupEnabled(): Promise<boolean>;
      setCompactWindow(compact: boolean): Promise<void>;
      hideWindow(): Promise<void>;
      on(event: "dictation-start" | "dictation-stop" | "navigate", callback: (payload: unknown) => void): () => void;
    };
  }
}

export {};
