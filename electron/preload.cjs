const { contextBridge, ipcRenderer } = require("electron");

const allowedEvents = new Set(["dictation-start", "dictation-stop", "navigate"]);

contextBridge.exposeInMainWorld("sout", {
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  updateHotkey: (hotkey) => ipcRenderer.invoke("hotkey:update", hotkey),
  apiKeyStatus: () => ipcRenderer.invoke("api-key:status"),
  saveApiKey: (apiKey) => ipcRenderer.invoke("api-key:save", apiKey),
  deleteApiKey: () => ipcRenderer.invoke("api-key:delete"),
  testApiKey: (apiKey) => ipcRenderer.invoke("api-key:test", apiKey),
  transcribeAudio: (audio, mimeType) => ipcRenderer.invoke("audio:transcribe", audio, mimeType),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:write", text),
  pasteToPrevious: (keepOpen) => ipcRenderer.invoke("clipboard:paste-previous", keepOpen),
  finishDictation: () => ipcRenderer.invoke("dictation:finish"),
  cancelDictation: () => ipcRenderer.invoke("dictation:cancel"),
  requestDictation: () => ipcRenderer.invoke("dictation:start"),
  loadHistory: () => ipcRenderer.invoke("history:load"),
  addHistory: (text) => ipcRenderer.invoke("history:add", text),
  deleteHistoryItem: (id) => ipcRenderer.invoke("history:delete", id),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  setStartup: (enabled) => ipcRenderer.invoke("startup:set", enabled),
  isStartupEnabled: () => ipcRenderer.invoke("startup:get"),
  setCompactWindow: (compact) => ipcRenderer.invoke("window:compact", compact),
  hideWindow: () => ipcRenderer.invoke("window:hide"),
  on: (event, callback) => {
    if (!allowedEvents.has(event)) throw new Error("Unsupported desktop event.");
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  }
});
