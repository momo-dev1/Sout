export type WindowPlacement = "bottom" | "top" | "center";
export type AppTheme = "dark" | "light";

export interface AppSettings {
  theme: AppTheme;
  hotkey: string;
  microphoneId: string;
  maximumDurationSeconds: number;
  placement: WindowPlacement;
  autoCopy: boolean;
  autoPaste: boolean;
  autoClose: boolean;
  historyEnabled: boolean;
  launchAtStartup: boolean;
}

export interface HistoryItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface ApiKeyStatus {
  configured: boolean;
  maskedHint: string | null;
}

export type RecorderPhase = "idle" | "recording" | "transcribing" | "done" | "error";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  hotkey: "Ctrl+Shift+Space",
  microphoneId: "default",
  maximumDurationSeconds: 300,
  placement: "bottom",
  autoCopy: true,
  autoPaste: true,
  autoClose: true,
  historyEnabled: true,
  launchAtStartup: false
};
