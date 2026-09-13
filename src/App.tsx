import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  History,
  Keyboard,
  LoaderCircle,
  Mic2,
  MousePointer2,
  Play,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X
} from "lucide-react";
import {
  addHistory,
  apiKeyStatus,
  cancelDictation,
  clearHistory,
  copyAndMaybePaste,
  deleteApiKey,
  finishDictation,
  hideWindow,
  isStartupEnabled,
  isDesktop,
  loadHistory,
  loadSettings,
  onEvent,
  pastePrevious,
  removeHistory,
  requestDictation,
  saveApiKey,
  saveSettings,
  setCompactWindow,
  setStartup,
  testApiKey,
  transcribe,
  updateHotkey
} from "./lib/bridge";
import { DEFAULT_SETTINGS, type AppSettings, type HistoryItem, type RecorderPhase } from "./types";

type Page = "home" | "history" | "settings";

interface RecorderSession {
  recorder: MediaRecorder;
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  chunks: Blob[];
  startedAt: number;
  mimeType: string;
}

const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

const friendlyError = (value: unknown) => {
  const message = value instanceof Error ? value.message : String(value);
  if (message.includes("NotAllowedError") || message.toLowerCase().includes("permission"))
    return "Microphone access was denied. Allow microphone access in Windows Privacy settings and try again.";
  if (value instanceof DOMException && (value.name === "NotFoundError" || value.name === "OverconstrainedError"))
    return "The selected microphone was not found. Choose another one in Settings.";
  if (message.includes("API key has not")) return "Add your Gemini API key in Settings before starting dictation.";
  return message.replace(/^Error:\s*/, "") || "Something went wrong. Please try again.";
};

const displayHotkey = (value: string) => value.replace("Ctrl", "Ctrl").split("+");

const BAR_COUNT = 30;

// "main" is the Settings/History window; "overlay" is the transparent recorder pill window.
type AppMode = "main" | "overlay";

function App({ mode }: { mode: AppMode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [page, setPage] = useState<Page>("home");
  const [overlay, setOverlay] = useState(false);
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(Array(BAR_COUNT).fill(0.12));
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyHint, setKeyHint] = useState("");
  const sessionRef = useRef<RecorderSession | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const finishingRef = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useLayoutEffect(() => {
    const theme = settings.theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f4f5f1" : "#0b0c10");
  }, [settings.theme]);

  const refreshHistory = useCallback(async () => {
    if (!isDesktop() || mode !== "main") return;
    setHistory(await loadHistory());
  }, [mode]);

  useEffect(() => {
    if (!isDesktop()) return;
    if (mode === "overlay") {
      loadSettings().then(setSettings).catch(() => {});
      return;
    }
    Promise.all([loadSettings(), apiKeyStatus(), loadHistory(), isStartupEnabled()])
      .then(([stored, key, items, startup]) => {
        setSettings({ ...stored, launchAtStartup: startup });
        setKeyConfigured(key.configured);
        setKeyHint(key.maskedHint || "");
        setHistory(items);
        if (!key.configured) setPage("settings");
      })
      .catch((e) => setError(friendlyError(e)));
  }, [mode]);

  // Dictations happen in the other window, so the list is re-read whenever History is opened.
  useEffect(() => {
    if (page === "history") void refreshHistory();
  }, [page, refreshHistory]);


  const stopMeter = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }, []);

  const cleanupSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.stream.getTracks().forEach((track) => track.stop());
    void session.context.close();
    sessionRef.current = null;
    stopMeter();
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, [stopMeter]);

  const hideOverlay = useCallback(async () => {
    setOverlay(false);
    setPhase("idle");
    setError("");
    if (isDesktop()) await hideWindow();
  }, []);

  // The pill shows a brief check when done and a short error line when something failed; both
  // dismiss themselves so nothing is left floating on screen.
  useEffect(() => {
    if (!overlay) return;
    const delay = phase === "error" ? 6000 : phase === "done" && settingsRef.current.autoClose ? 900 : 0;
    if (!delay) return;
    const timer = window.setTimeout(() => void hideOverlay(), delay);
    return () => window.clearTimeout(timer);
  }, [overlay, phase, hideOverlay]);

  const completeTranscription = useCallback(async (text: string) => {
    const current = settingsRef.current;
    if (current.historyEnabled) {
      try {
        await addHistory(text);
        await refreshHistory();
      } catch {
        // A local history write should never discard a successful transcription.
      }
    }
    // Pasting goes through the clipboard, so auto-paste implies copy; otherwise the toggle decides.
    if (current.autoPaste || current.autoCopy) await copyAndMaybePaste(text, false);

    if (current.autoPaste) {
      await pastePrevious(!current.autoClose);
      if (current.autoClose) {
        setOverlay(false);
        setPhase("idle");
      } else {
        setPhase("done");
      }
      return;
    }

    setPhase("done");
    await finishDictation();
  }, [refreshHistory]);

  const processRecording = useCallback(async (session: RecorderSession) => {
    cleanupSession();
    if (cancelledRef.current) {
      cancelledRef.current = false;
      await cancelDictation();
      await hideOverlay();
      return;
    }

    const blob = new Blob(session.chunks, { type: session.mimeType });
    if (blob.size < 512) {
      setPhase("error");
      setError("No audio was captured. Check your microphone and try again.");
      await finishDictation();
      return;
    }

    setPhase("transcribing");
    try {
      const text = await transcribe(new Uint8Array(await blob.arrayBuffer()), session.mimeType);
      await completeTranscription(text.trim());
    } catch (e) {
      setPhase("error");
      setError(friendlyError(e));
      await finishDictation();
    }
  }, [cleanupSession, completeTranscription, hideOverlay]);

  const stopRecording = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.recorder.state === "inactive" || finishingRef.current) return;
    finishingRef.current = true;
    session.recorder.stop();
  }, []);

  const startMeter = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
      setLevels(Array.from({ length: BAR_COUNT }, (_, i) => Math.max(0.08, data[i * step] / 255)));
      animationRef.current = requestAnimationFrame(draw);
    };
    draw();
  }, []);

  const startRecording = useCallback(async () => {
    if (sessionRef.current) return;
    cancelledRef.current = false;
    finishingRef.current = false;
    setError("");
    setOverlay(true);
    setPhase("idle");
    // Settings are edited in the other window; pick up the current microphone/output choices first.
    if (isDesktop()) {
      try {
        const stored = await loadSettings();
        settingsRef.current = stored;
        setSettings(stored);
      } catch {
        // Fall back to whatever was loaded at startup.
      }
    }
    try {
      const device = settingsRef.current.microphoneId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: device && device !== "default" ? { exact: device } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        .find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      context.createMediaStreamSource(stream).connect(analyser);
      const session: RecorderSession = {
        recorder,
        stream,
        context,
        analyser,
        chunks: [],
        startedAt: Date.now(),
        mimeType: recorder.mimeType || preferred || "audio/webm"
      };
      sessionRef.current = session;
      recorder.ondataavailable = (event) => event.data.size && session.chunks.push(event.data);
      recorder.onstop = () => {
        finishingRef.current = false;
        void processRecording(session);
      };
      recorder.start(250);
      setSeconds(0);
      setPhase("recording");
      startMeter(analyser);
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= settingsRef.current.maximumDurationSeconds) stopRecording();
      }, 250);
    } catch (e) {
      cleanupSession();
      setPhase("error");
      setError(friendlyError(e));
      if (isDesktop()) await finishDictation();
    }
  }, [cleanupSession, processRecording, startMeter, stopRecording]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (sessionRef.current?.recorder.state !== "inactive") stopRecording();
    else void hideOverlay();
  }, [hideOverlay, stopRecording]);

  useEffect(() => {
    if (!isDesktop()) return;
    const unlisteners: Array<Promise<() => void>> = mode === "overlay"
      ? [
        onEvent("dictation-start", () => void startRecording()),
        onEvent("dictation-stop", () => stopRecording())
      ]
      : [
        onEvent<Page>("navigate", (destination) => {
          setPage(destination);
          void refreshHistory();
        })
      ];
    return () => void Promise.all(unlisteners).then((items) => items.forEach((fn) => fn()));
  }, [mode, refreshHistory, startRecording, stopRecording]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && overlay) cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, overlay]);

  if (mode === "overlay") {
    if (!overlay) return null;
    return (
      <div className="overlay-root">
        <RecorderOverlay phase={phase} seconds={seconds} levels={levels} error={error} onStop={stopRecording} onCancel={cancel} onDismiss={hideOverlay} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" data-drag-region>
          <div className="brand-mark"><AudioLines size={19} /></div>
          <div><strong>Sout</strong><span>Egyptian Dictation</span></div>
        </div>
        <nav>
          <NavButton active={page === "home"} icon={<Sparkles size={18} />} label="Dictation" onClick={() => setPage("home")} />
          <NavButton active={page === "history"} icon={<History size={18} />} label="History" onClick={() => setPage("history")} />
          <NavButton active={page === "settings"} icon={<SettingsIcon size={18} />} label="Settings" onClick={() => setPage("settings")} />
        </nav>
        <div className="sidebar-foot">
          <div className={`status-dot ${keyConfigured ? "ready" : ""}`} />
          {keyConfigured ? "Ready to dictate" : "API key needed"}
        </div>
      </aside>
      <main className="content">
        <div className="titlebar" data-drag-region>
          <span>{page === "home" ? "Dictation" : page === "history" ? "History" : "Settings"}</span>
          <button className="window-close" onClick={() => isDesktop() && void hideWindow()} aria-label="Close"><X size={17} /></button>
        </div>
        {page === "home" && <Home settings={settings} configured={keyConfigured} onStart={() => void requestDictation()} onSettings={() => setPage("settings")} />}
        {page === "history" && <HistoryPage items={history} enabled={settings.historyEnabled} onCopy={(text) => copyAndMaybePaste(text, false)} onDelete={async (id) => { await removeHistory(id); await refreshHistory(); }} onClear={async () => { await clearHistory(); await refreshHistory(); }} />}
        {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} configured={keyConfigured} keyHint={keyHint} onKeyStatus={(configured, hint) => { setKeyConfigured(configured); setKeyHint(hint); }} />}
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Home({ settings, configured, onStart, onSettings }: { settings: AppSettings; configured: boolean; onStart: () => void; onSettings: () => void }) {
  return (
    <section className="page home-page">
      <div className="hero-card">
        <div className="hero-glow" />
        <div className="hero-icon"><Mic2 size={32} strokeWidth={1.8} /></div>
        <h1>Say it naturally.<br /><em>Sout</em> handles the rest.</h1>
        <button className="primary-button hero-button" onClick={configured ? onStart : onSettings}>
          {configured ? <><Play size={17} fill="currentColor" /> Start dictation</> : <>Add Gemini API key <ChevronRight size={17} /></>}
        </button>
        <div className="shortcut-row">
          <span>or press</span>
          <HotkeyKeys hotkey={settings.hotkey} />
          <span>anywhere</span>
        </div>
      </div>
      <div className="flow-card"><span className="flow-title">Your flow</span><div className="flow"><b>Press</b><i /><b>Speak</b><i /><b>Press again</b><i /><b>Text appears</b></div></div>
    </section>
  );
}

function HotkeyKeys({ hotkey }: { hotkey: string }) {
  return <div className="hotkey-keys">{displayHotkey(hotkey).map((part) => <kbd key={part}>{part}</kbd>)}</div>;
}

function RecorderOverlay({ phase, seconds, levels, error, onStop, onCancel, onDismiss }: {
  phase: RecorderPhase; seconds: number; levels: number[]; error: string;
  onStop: () => void; onCancel: () => void; onDismiss: () => Promise<void>;
}) {
  // One pill for every state: orb (stop while recording), waveform, timer, close. No text except an error.
  const live = phase === "recording";
  const waveState = live ? "live" : phase === "transcribing" ? "thinking" : "idle";
  const orbIcon = phase === "transcribing" ? <Sparkles size={16} />
    : phase === "done" ? <Check size={17} strokeWidth={2.5} />
    : phase === "error" ? <span className="orb-glyph">!</span>
    : <><Mic2 size={16} className="orb-mic" /><Square size={10} fill="currentColor" className="orb-stop" /></>;
  const orbLabel = live ? "Stop and transcribe" : phase === "transcribing" ? "Transcribing" : phase === "done" ? "Done" : phase === "error" ? "Error" : "Starting microphone";
  return (
    <div className={`recorder-window pill phase-${phase}`} data-drag-region>
      <button className="mic-orb" onClick={onStop} disabled={!live} aria-label={orbLabel} title={live ? "Stop (or press your hotkey again)" : undefined}>{orbIcon}</button>
      {phase === "error"
        ? <p className="pill-error" title={error}>{error}</p>
        : <div className={`waveform ${waveState}`} aria-label="Microphone level">
          {levels.map((level, i) => (
            <i key={i} style={live ? { height: `${Math.max(4, level * 36)}px` } : ({ "--i": i } as React.CSSProperties)} />
          ))}
        </div>}
      {live && <time>{formatDuration(seconds)}</time>}
      {phase !== "transcribing" && (
        <button className="overlay-close" onClick={() => (live || phase === "idle" ? onCancel() : void onDismiss())} aria-label={live || phase === "idle" ? "Cancel" : "Close"}><X size={14} /></button>
      )}
    </div>
  );
}

function HistoryPage({ items, enabled, onCopy, onDelete, onClear }: { items: HistoryItem[]; enabled: boolean; onCopy: (text: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onClear: () => Promise<void> }) {
  return <section className="page">
    <div className="page-heading"><div><h1>Transcription history</h1><p>Your recent dictations, stored only on this device.</p></div>{items.length > 0 && <button className="danger-ghost" onClick={() => confirm("Clear all transcription history?") && void onClear()}><Trash2 size={15} /> Clear all</button>}</div>
    {!enabled ? <EmptyState icon={<ShieldCheck size={28} />} title="History is disabled" text="Enable it in Settings if you want to keep previous transcriptions." /> : items.length === 0 ? <EmptyState icon={<History size={28} />} title="Nothing here yet" text="Your completed dictations will appear here." /> :
      <div className="history-list">{items.map((item) => <article className="history-item" key={item.id}>
        <div className="history-meta"><Clock3 size={14} /><time>{new Date(item.createdAt).toLocaleString()}</time></div>
        <p dir={/[\u0600-\u06FF]/.test(item.text) ? "rtl" : "ltr"}>{item.text}</p>
        <div className="history-actions"><button onClick={() => void onCopy(item.text)}><Copy size={14} /> Copy</button><button className="delete" onClick={() => void onDelete(item.id)}><Trash2 size={14} /></button></div>
      </article>)}</div>}
  </section>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty-state"><div>{icon}</div><h2>{title}</h2><p>{text}</p></div>;
}

function SettingsPage({ settings, setSettings, configured, keyHint, onKeyStatus }: {
  settings: AppSettings; setSettings: React.Dispatch<React.SetStateAction<AppSettings>>; configured: boolean; keyHint: string;
  onKeyStatus: (configured: boolean, hint: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [apiMessage, setApiMessage] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hotkeyError, setHotkeyError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testLevel, setTestLevel] = useState(0);
  const [testingMic, setTestingMic] = useState(false);
  const micCleanupRef = useRef<null | (() => void)>(null);

  const persist = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (isDesktop()) await saveSettings(next);
  };

  const refreshDevices = useCallback(async (requestPermission = false) => {
    try {
      let permissionStream: MediaStream | null = null;
      if (requestPermission) permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((device) => device.kind === "audioinput"));
      permissionStream?.getTracks().forEach((track) => track.stop());
    } catch { setDevices([]); }
  }, []);

  useEffect(() => { void refreshDevices(false); return () => micCleanupRef.current?.(); }, [refreshDevices]);

  const testMicrophone = async () => {
    micCleanupRef.current?.();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: settings.microphoneId !== "default" ? { deviceId: { exact: settings.microphoneId } } : true });
      await refreshDevices(false);
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let frame = 0;
      const draw = () => {
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, value) => sum + Math.pow((value - 128) / 128, 2), 0) / data.length);
        setTestLevel(Math.min(1, rms * 4.5));
        frame = requestAnimationFrame(draw);
      };
      const cleanup = () => { cancelAnimationFrame(frame); stream.getTracks().forEach((t) => t.stop()); void context.close(); setTestingMic(false); setTestLevel(0); };
      micCleanupRef.current = cleanup;
      setTestingMic(true);
      draw();
      window.setTimeout(cleanup, 8000);
    } catch (e) { setApiMessage(friendlyError(e)); }
  };

  const captureHotkey = async (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!capturing) return;
    event.preventDefault();
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    if (event.key === "Escape") { setCapturing(false); return; }
    const mods = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean);
    if (!mods.length) { setHotkeyError("Include Ctrl, Alt, Shift, or the Windows key."); return; }
    const raw = event.code.startsWith("Key") ? event.code.slice(3) : event.code.startsWith("Digit") ? event.code.slice(5) : event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const value = [...mods, raw].join("+");
    try {
      if (isDesktop()) await updateHotkey(value);
      await persist({ hotkey: value });
      setCapturing(false);
      setHotkeyError("");
    } catch (e) { setHotkeyError(`That shortcut is unavailable. ${friendlyError(e)}`); }
  };

  return <section className="page settings-page">
    <div className="page-heading"><div><h1>Settings</h1><p>Make Sout work exactly the way you want.</p></div></div>
    <SettingCard icon={<Sparkles size={19} />} title="Gemini API">
      <div className="field-label"><label htmlFor="api-key">API key</label>{configured && <span className="saved-badge"><Check size={12} /> Saved securely {keyHint}</span>}</div>
      <div className="input-with-button"><input id="api-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} type={showKey ? "text" : "password"} placeholder={configured ? "Enter a new key to replace the saved key" : "Paste your Gemini API key"} autoComplete="off" /><button onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
      <div className="button-row"><button className="secondary-button" disabled={apiBusy || (!apiKey && !configured)} onClick={async () => { setApiBusy(true); setApiMessage(""); try { setApiMessage(await testApiKey(apiKey)); } catch (e) { setApiMessage(friendlyError(e)); } finally { setApiBusy(false); } }}>{apiBusy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Test key</button><button className="primary-button small" disabled={!apiKey || apiBusy} onClick={async () => { setApiBusy(true); setApiMessage(""); try { await saveApiKey(apiKey); const hint = `••••${apiKey.slice(-4)}`; onKeyStatus(true, hint); setApiKey(""); setApiMessage("API key saved with Windows secure storage."); } catch (e) { setApiMessage(friendlyError(e)); } finally { setApiBusy(false); } }}>Save key</button>{configured && <button className="text-button danger" onClick={async () => { await deleteApiKey(); onKeyStatus(false, ""); }}>Remove</button>}</div>
      {apiMessage && <p className="field-message">{apiMessage}</p>}
      <p className="privacy-note"><ShieldCheck size={14} /> The key is encrypted with Windows secure storage, never kept in app settings or logs.</p>
    </SettingCard>

    <SettingCard icon={<Keyboard size={19} />} title="Global hotkey">
      <div className="setting-line"><div><strong>Start or stop dictation</strong><span>Works while another application is active</span></div><div className="hotkey-control"><HotkeyKeys hotkey={settings.hotkey} /><button className={capturing ? "capturing" : ""} autoFocus={capturing} onClick={() => { setCapturing(true); setHotkeyError(""); }} onKeyDown={captureHotkey}>{capturing ? "Press keys…" : "Set hotkey"}</button><button className="icon-button" title="Reset to default" onClick={async () => { await updateHotkey(DEFAULT_SETTINGS.hotkey); await persist({ hotkey: DEFAULT_SETTINGS.hotkey }); }}><RotateCcw size={15} /></button></div></div>
      {hotkeyError && <p className="error-copy">{hotkeyError}</p>}
    </SettingCard>

    <SettingCard icon={<Mic2 size={19} />} title="Recording">
      <div className="setting-line"><div><strong>Microphone</strong><span>Select the input Sout should listen to</span></div><select value={settings.microphoneId} onFocus={() => void refreshDevices(true)} onChange={(e) => void persist({ microphoneId: e.target.value })}><option value="default">System default</option>{devices.filter((d) => d.deviceId !== "default").map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}</select></div>
      <div className="setting-line"><div><strong>Input level</strong><span>{testingMic ? "Listening for 8 seconds…" : "Check your microphone before dictating"}</span></div><div className="mic-test"><div className="level-track"><i style={{ width: `${testLevel * 100}%` }} /></div><button className="secondary-button" onClick={() => void testMicrophone()}>{testingMic ? "Restart" : "Test mic"}</button></div></div>
      <div className="setting-line"><div><strong>Maximum duration</strong><span>Recording stops automatically at this limit</span></div><select value={settings.maximumDurationSeconds} onChange={(e) => void persist({ maximumDurationSeconds: Number(e.target.value) })}><option value={60}>1 minute</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option></select></div>
    </SettingCard>

    <SettingCard icon={<MousePointer2 size={19} />} title="Floating recorder">
      <div className="segmented"><button className={settings.placement === "bottom" ? "active" : ""} onClick={() => void persist({ placement: "bottom" })}>Bottom center</button><button className={settings.placement === "top" ? "active" : ""} onClick={() => void persist({ placement: "top" })}>Top center</button><button className={settings.placement === "center" ? "active" : ""} onClick={() => void persist({ placement: "center" })}>Center</button></div>
      <Toggle label="Auto-close after completion" description="Hide the recorder once text is inserted" checked={settings.autoClose} onChange={(v) => void persist({ autoClose: v })} />
    </SettingCard>

    <SettingCard icon={<Clipboard size={19} />} title="Output">
      <Toggle label="Copy to clipboard" description="Place the finished text on the clipboard (always on while auto-paste is on)" checked={settings.autoCopy} onChange={(v) => void persist({ autoCopy: v })} />
      <Toggle label="Paste into the previous app" description="Return focus and insert the text automatically" checked={settings.autoPaste} onChange={(v) => void persist({ autoPaste: v })} />
    </SettingCard>

    <SettingCard icon={<Sun size={19} />} title="Appearance & app preferences">
      <Toggle label="Light theme" description="Switch between Sout's dark and light appearance" checked={settings.theme === "light"} onChange={(v) => void persist({ theme: v ? "light" : "dark" })} />
      <Toggle label="Save transcription history" description="Store text and time locally; audio is never stored" checked={settings.historyEnabled} onChange={async (v) => { await persist({ historyEnabled: v }); if (!v) { await clearHistory(); } }} />
      <Toggle label="Launch when Windows starts" description="Keep the global hotkey ready after sign-in" checked={settings.launchAtStartup} onChange={async (v) => { await setStartup(v); await persist({ launchAtStartup: v }); }} />
    </SettingCard>
  </section>;
}

function SettingCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className="settings-card"><div className="settings-card-title"><span>{icon}</span><h2>{title}</h2></div><div className="settings-card-body">{children}</div></div>;
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="setting-line toggle-line"><div><strong>{label}</strong><span>{description}</span></div><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i /></label>;
}

export default App;
