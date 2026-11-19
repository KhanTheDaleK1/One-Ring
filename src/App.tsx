import React, { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Lock, AlertOctagon, FlaskConical, Settings, Pencil, ShieldCheck } from "lucide-react";
import {
  applyCueProgress,
  applyHealthEvent,
  applyMeterEvent,
  applyStatePatch,
  bridge,
  broadcastLanSyncEvent,
  subscribeEvents,
  UPDATE_REPO_URL,
} from "./bridge";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppStateSnapshot, ViewMode } from "./types";
import { PreflightView } from "./components/PreflightView";
import { ShowBuilderView, type BuilderIntent } from "./components/ShowBuilderView";
import { ShowModeView } from "./components/ShowModeView";
import { SlidesCanvasView } from "./components/SlidesCanvasView";
import { SecondaryOutputWindow } from "./components/SecondaryOutputWindow";
import { VideoCanvasView } from "./components/VideoCanvasView";
import { BroadcastCanvasView } from "./components/BroadcastCanvasView";
import type { SceneSourceItem } from "./types";
import { EngineerView } from "./components/EngineerView";
import { SettingsView } from "./components/SettingsView";
import { ShowNameModal } from "./components/ShowNameModal";
import { PairingPrompt, type DiscoveredPeerInfo } from "./components/PairingPrompt";
import { getDiscoveredPeers } from "./bridge";
import { WelcomeTour } from "./components/WelcomeTour";
import { UpdateModal } from "./components/UpdateModal";
import { BroadcastSettingsModal } from "./components/BroadcastSettingsModal";
import { checkForUpdate, probeHardwareEncoders, type EncoderCapability } from "./bridge";
import type { BroadcastProfileSettings, UpdateInfo } from "./types";

const BROADCAST_PROFILE_KEY = "onering_broadcast_profile";
const BROADCAST_STREAM_KEY = "onering_broadcast_stream_config";
const BROADCAST_HOTKEYS_KEY = "onering_broadcast_hotkeys";

function defaultBroadcastProfile(): BroadcastProfileSettings {
  const defaults: BroadcastProfileSettings = {
    name: "Production Broadcast (1080p60)",
    baseResolution: "1920x1080",
    outputResolution: "1920x1080",
    fps: 60,
    videoEncoder: "libx264",
    rateControl: "CBR",
    bitrateKbps: 6000,
    keyframeIntervalSec: 2,
    audioSampleRate: 48000,
    audioBitrateKbps: 192,
    recordingFormat: "mkv",
    autoRemuxToMp4: true,
  };
  try {
    const raw = localStorage.getItem(BROADCAST_PROFILE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // Ignore malformed locally saved profiles.
  }
  return defaults;
}

function loadBroadcastStream(): { rtmpUrl: string; streamKey: string } {
  try {
    const raw = localStorage.getItem(BROADCAST_STREAM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.rtmpUrl === "string" && typeof parsed?.streamKey === "string") {
        return { rtmpUrl: parsed.rtmpUrl, streamKey: parsed.streamKey };
      }
    }
  } catch {
    // Ignore malformed locally saved stream configuration.
  }
  return { rtmpUrl: "rtmps://ingest.example.com/live2", streamKey: "" };
}

function loadBroadcastHotkeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(BROADCAST_HOTKEYS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    // Ignore malformed locally saved hotkeys.
  }
  return {};
}

export const App: React.FC = () => {
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [mode, setMode] = useState<ViewMode>("mixing");
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [isEditingShowName, setIsEditingShowName] = useState(false);
  const [discoveredPeer, setDiscoveredPeer] = useState<DiscoveredPeerInfo | null>(null);
  const [showPreflight, setShowPreflight] = useState(false);
  const [builderIntent, setBuilderIntent] = useState<BuilderIntent>(null);
  const [lanSyncConnected, setLanSyncConnected] = useState(false);
  const dismissedPeersRef = useRef<Set<string>>(new Set());
  const stateRef = useRef<AppStateSnapshot | null>(null);
  const applyingRemoteSyncRef = useRef(false);
  const lanSyncSocketRef = useRef<WebSocket | null>(null);
  const lanSyncReconnectTimerRef = useRef<number | null>(null);
  const [showWelcomeTour, setShowWelcomeTour] = useState(() => {
    return localStorage.getItem("onering_tour_completed") !== "true";
  });
  const [showBroadcastSettings, setShowBroadcastSettings] = useState(false);
  const [broadcastProfile, setBroadcastProfile] = useState<BroadcastProfileSettings>(() =>
    defaultBroadcastProfile()
  );
  const [broadcastStream, setBroadcastStream] = useState(loadBroadcastStream);
  const [broadcastHotkeys, setBroadcastHotkeys] = useState<Record<string, string>>(
    loadBroadcastHotkeys
  );
  const [hardwareEncoders, setHardwareEncoders] = useState<EncoderCapability[]>([]);
  const [encodersLoading, setEncodersLoading] = useState(false);

  // Booth display preferences are authored in Settings and applied to the document root.
  useEffect(() => {
    const root = document.documentElement;
    const rawScale = state?.settings.general.uiScale ?? 100;
    const scale = rawScale <= 2 ? Math.round(rawScale * 100) : rawScale;
    root.style.setProperty("zoom", `${scale}%`);
    if (state?.settings.general.highContrast) {
      root.setAttribute("data-contrast", "high");
    } else {
      root.removeAttribute("data-contrast");
    }
    return () => {
      root.style.removeProperty("zoom");
      root.removeAttribute("data-contrast");
    };
  }, [state?.settings.general.uiScale, state?.settings.general.highContrast]);

  useEffect(() => {
    if (!state?.settings.general.highContrast) return;
    const style = document.createElement("style");
    style.dataset.oneringContrast = "high";
    style.textContent = [
      '[data-contrast="high"] body { background: #000000 !important; color: #FFFFFF !important; }',
      '[data-contrast="high"] .card { background: #000000 !important; border-color: #FFFFFF !important; }',
      '[data-contrast="high"] .btn { border-color: #FFFFFF !important; color: #FFFFFF !important; }',
    ].join("\n");
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [state?.settings.general.highContrast]);

  useEffect(() => {
    if (!showBroadcastSettings) return;
    let cancelled = false;
    setEncodersLoading(true);
    probeHardwareEncoders()
      .then((encoders) => {
        if (!cancelled) setHardwareEncoders(Array.isArray(encoders) ? encoders : []);
      })
      .catch(() => {
        if (!cancelled) setHardwareEncoders([]);
      })
      .finally(() => {
        if (!cancelled) setEncodersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showBroadcastSettings]);

  useEffect(() => {
    let disposed = false;

    
    // Check for updates on startup
    checkForUpdate().then((info) => {
      if (!disposed && info && info.update_available) {
        setAvailableUpdate(info);
      }
    });

    
    // Listen for macOS menu items: "About One Ring" or "Check for Updates..."
    let unlistenMenu: (() => void) | undefined;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      listen("show_update_modal", async () => {
        const info = await checkForUpdate();
        if (info) {
          setAvailableUpdate(info);
        } else {
          // Provide fallback about info even if offline
          setAvailableUpdate({
            current_version: "0.3.3",
            latest_version: "v0.3.3-alpha",
            release_name: "One Ring — Church Production Suite",
            release_notes: "You are running One Ring v0.3.3-alpha. All systems up to date.",
            published_at: new Date().toISOString(),
            html_url: UPDATE_REPO_URL,
            download_url: null,
            update_available: false,
            assets: [],
          });
        }
      }).then((unsub: UnlistenFn) => {
        if (disposed) unsub();
        else unlistenMenu = unsub;
      });
    }

    
    // Poll for nearby One Ring instances on the local network (UDP broadcast)
    const peerTimer = setInterval(async () => {
      const peers = await getDiscoveredPeers();
      if (!disposed && peers && peers.length > 0) {
        const unhandled = peers.find((p) => !dismissedPeersRef.current.has(p.instanceId));
        if (unhandled) {
          setDiscoveredPeer(unhandled);
        }
      }
    }, 2500);

    bridge.getAppState().then((snapshot) => {
      if (disposed) return;
      let hydratedFromLocal = false;
      try {
        const savedRaw = localStorage.getItem("onering_workspace_autosave_v1");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          if (saved.slides && (!snapshot.slides.slides || snapshot.slides.slides.length === 0)) {
            snapshot.slides = { ...snapshot.slides, ...saved.slides };
            hydratedFromLocal = true;
          }
          if (Array.isArray(saved.sources) && saved.sources.length > 0 && (!snapshot.sources || snapshot.sources.length === 0)) {
            snapshot.sources = saved.sources;
            hydratedFromLocal = true;
          }
        }
      } catch {}
      setState(snapshot);
      if (hydratedFromLocal) {
        bridge
          .syncWorkspaceState({ slides: snapshot.slides, sources: snapshot.sources })
          .catch(() => {});
      }

    });

    return () => {
      disposed = true;
      unlistenMenu?.();
      clearInterval(peerTimer);
    };
  }, []);

  // Live mode hydrates once, then only listens for pushed patches. This lives in
  // its own effect keyed on mockMode so saving Settings (which flips mockMode
  // from true to false) immediately subscribes to native events instead of
  // leaving the UI on stale simulator snapshots.
  useEffect(() => {
    if (!state || state.mockMode) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    subscribeEvents({
      onHealth: (event) =>
        setState((prev) => (prev ? applyHealthEvent(prev, event) : prev)),
      onMeter: (event) =>
        setState((prev) => (prev ? applyMeterEvent(prev, event) : prev)),
      onStatePatch: (event) =>
        setState((prev) => (prev ? applyStatePatch(prev, event) : prev)),
      onCueProgress: (event) =>
        setState((prev) => (prev ? applyCueProgress(prev, event) : prev)),
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.mockMode]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const executeMidiAction = useCallback((action: string, value: number) => {
    const snapshot = stateRef.current;
    if (!snapshot) return;
    const apply = (task: Promise<AppStateSnapshot>) => {
      task.then(setState).catch(() => {});
    };

    switch (action) {
      case "cue_next": {
        if (snapshot.cues.length === 0) break;
        const nextIndex = Math.min(snapshot.activeCueIndex + 1, snapshot.cues.length - 1);
        apply(bridge.triggerCue(nextIndex));
        break;
      }
      case "cue_undo":
        apply(bridge.undoLastCue());
        break;
      case "slide_next":
        apply(bridge.triggerSlideAction("next"));
        break;
      case "slide_prev":
        apply(bridge.triggerSlideAction("prev"));
        break;
      case "slide_clear":
        apply(bridge.triggerSlideAction("clear"));
        break;
      case "toggle_pastor_mute": {
        const dca =
          snapshot.dcas.find((entry) => /pastor|speaker|preach/i.test(entry.name)) ??
          snapshot.dcas[0];
        if (dca) apply(bridge.toggleDcaMute(dca.id));
        break;
      }
      case "set_dca_1_level": {
        const dca = snapshot.dcas[0];
        if (!dca) break;
        const targetDb = -60 + (value / 127) * 70;
        const delta = targetDb - dca.levelDb;
        if (Math.abs(delta) > 0.25) apply(bridge.nudgeDcaLevel(dca.id, delta));
        break;
      }
      case "cam_preset_1": {
        const camera = snapshot.cameras[0];
        if (camera) apply(bridge.recallCameraPreset(camera.id));
        break;
      }
      case "cam_preset_2": {
        const camera = snapshot.cameras[1];
        if (camera) apply(bridge.recallCameraPreset(camera.id));
        break;
      }
      default:
        break;
    }
  }, []);

  // Global Web MIDI runtime: honour user bindings from Settings → MIDI Triggers
  // even when the settings/mapping modal is closed.
  useEffect(() => {
    const STORAGE_KEY = "onering_midi_bindings_v1";
    type Binding = {
      id: string;
      name?: string;
      channel: number;
      messageType: "NoteOn" | "ControlChange" | "ProgramChange";
      controlOrNote: number;
      action: string;
    };

    const readBindings = (): Binding[] => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as Binding[]) : [];
      } catch {
        return [];
      }
    };

    let bindings = readBindings();
    const refreshBindings = () => {
      bindings = readBindings();
    };
    window.addEventListener("storage", refreshBindings);
    window.addEventListener("onering-midi-updated", refreshBindings);

    const nav = navigator as Navigator & {
      requestMIDIAccess?: () => Promise<any>;
    };
    let midiAccess: any = null;
    let disposed = false;
    const attachedInputs = new Set<any>();

    const onMidiMessage = (event: any) => {
      const data: Uint8Array | undefined = event?.data;
      if (!data || data.length < 2) return;
      const status = data[0];
      const kind = status & 0xf0;
      const channel = (status & 0x0f) + 1;
      const control = data[1] & 0x7f;
      const value = data.length > 2 ? data[2] & 0x7f : 0;

      let messageType: Binding["messageType"] | null = null;
      if (kind === 0x90 && value > 0) messageType = "NoteOn";
      else if (kind === 0xb0) messageType = "ControlChange";
      else if (kind === 0xc0) messageType = "ProgramChange";
      if (!messageType) return;

      const binding = bindings.find(
        (entry) =>
          entry.channel === channel &&
          entry.messageType === messageType &&
          entry.controlOrNote === control
      );
      if (binding) executeMidiAction(binding.action, value);
    };

    const attachInputs = () => {
      if (!midiAccess) return;
      for (const input of Array.from(midiAccess.inputs.values()) as any[]) {
        if (attachedInputs.has(input)) continue;
        input.addEventListener?.("midimessage", onMidiMessage);
        attachedInputs.add(input);
      }
    };

    if (nav && typeof nav.requestMIDIAccess === "function") {
      nav
        .requestMIDIAccess()
        .then((access: any) => {
          if (disposed) return;
          midiAccess = access;
          attachInputs();
          midiAccess.onstatechange = attachInputs;
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      window.removeEventListener("storage", refreshBindings);
      window.removeEventListener("onering-midi-updated", refreshBindings);
      if (midiAccess) {
        midiAccess.onstatechange = null;
        for (const input of attachedInputs) {
          input.removeEventListener?.("midimessage", onMidiMessage);
        }
      }
      attachedInputs.clear();
    };
  }, [executeMidiAction]);

  const emitLanSync = useCallback((kind: string, payload: unknown) => {
    if (applyingRemoteSyncRef.current) return;
    void broadcastLanSyncEvent(kind, payload);
  }, []);

  useEffect(() => {
    const sync = state?.settings.sync;
    const enabled = !!sync?.lanDiscoveryEnabled;
    let target: string | null = null;
    if (enabled) {
      try {
        const url = new URL((sync?.hubAddress || "").trim());
        if (
          url.protocol === "ws:" &&
          url.hostname &&
          url.hostname !== "0.0.0.0" &&
          url.port === "47800"
        ) {
          target = `ws://${url.hostname}:47800`;
        }
      } catch {}
    }

    const cleanupSocket = () => {
      if (lanSyncReconnectTimerRef.current !== null) {
        window.clearTimeout(lanSyncReconnectTimerRef.current);
        lanSyncReconnectTimerRef.current = null;
      }
      const ws = lanSyncSocketRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        try {
          ws.close();
        } catch {}
        lanSyncSocketRef.current = null;
      }
    };

    if (!target) {
      cleanupSocket();
      setLanSyncConnected(false);
      return;
    }

    let disposed = false;

    const applyRemote = (fn: () => void) => {
      applyingRemoteSyncRef.current = true;
      try {
        fn();
      } finally {
        queueMicrotask(() => {
          applyingRemoteSyncRef.current = false;
        });
      }
    };

    const applySlideNumber = (slideNumber: number) => {
      setState((prev) => {
        if (!prev) return prev;
        const slidesArr = prev.slides.slides ?? [];
        const total = Math.max(1, slidesArr.length || prev.slides.totalSlides || 1);
        const targetNum = Math.max(1, Math.min(total, slideNumber));
        return {
          ...prev,
          slides: {
            ...prev.slides,
            currentSlide: targetNum,
            totalSlides: total,
            cleared: false,
            currentText: slidesArr[targetNum - 1]?.text ?? prev.slides.currentText,
            nextText: slidesArr[targetNum]?.text ?? "",
          },
        };
      });
    };

    const connect = () => {
      if (disposed) return;
      cleanupSocket();
      try {
        const ws = new WebSocket(target!);
        lanSyncSocketRef.current = ws;
        ws.onopen = () => {
          if (!disposed) setLanSyncConnected(true);
        };
        ws.onclose = () => {
          if (disposed) return;
          setLanSyncConnected(false);
          lanSyncSocketRef.current = null;
          lanSyncReconnectTimerRef.current = window.setTimeout(connect, 2000);
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {}
        };
        ws.onmessage = (event) => {
          let msg: any;
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (!msg || typeof msg.kind !== "string") return;
          const payload = msg.payload ?? {};
          if (msg.kind === "cue_triggered") {
            const cueIndex =
              typeof payload.cueIndex === "number"
                ? payload.cueIndex
                : typeof payload.index === "number"
                  ? payload.index
                  : null;
            if (cueIndex !== null) {
              applyRemote(() => {
                setState((prev) => (prev ? { ...prev, activeCueIndex: cueIndex } : prev));
              });
            }
          } else if (msg.kind === "slide_changed") {
            applyRemote(() => {
              if (payload && typeof payload === "object" && payload.slides && typeof payload.slides === "object") {
                setState((prev) => (prev ? { ...prev, slides: payload.slides as any } : prev));
                return;
              }
              if (typeof payload.slideNumber === "number") {
                applySlideNumber(payload.slideNumber);
                return;
              }
              if (typeof payload.action === "string") {
                if (payload.action === "next" || payload.action === "prev") {
                  setState((prev) => {
                    if (!prev) return prev;
                    const delta = payload.action === "next" ? 1 : -1;
                    const slidesArr = prev.slides.slides ?? [];
                    const total = Math.max(1, slidesArr.length || prev.slides.totalSlides || 1);
                    const targetNum = Math.max(1, Math.min(total, (prev.slides.currentSlide || 1) + delta));
                    return {
                      ...prev,
                      slides: {
                        ...prev.slides,
                        currentSlide: targetNum,
                        totalSlides: total,
                        cleared: false,
                        currentText: slidesArr[targetNum - 1]?.text ?? prev.slides.currentText,
                        nextText: slidesArr[targetNum]?.text ?? "",
                      },
                    };
                  });
                } else if (payload.action === "clear") {
                  setState((prev) =>
                    prev ? { ...prev, slides: { ...prev.slides, cleared: !prev.slides.cleared } } : prev
                  );
                }
              }
            });
          } else if (msg.kind === "stage_alert") {
            applyRemote(() => {
              setState((prev) => {
                if (!prev) return prev;
                const slides = { ...prev.slides };
                if (typeof payload.message === "string" || payload.message === null) {
                  const text = payload.message ?? "";
                  slides.stageMessage = text;
                  if (typeof payload.visible === "boolean") {
                    slides.stageMessageVisible = payload.visible;
                  } else if (typeof payload.stageMessageVisible !== "boolean") {
                    slides.stageMessageVisible = text.trim().length > 0;
                  }
                } else if (typeof payload.stageMessage === "string") {
                  slides.stageMessage = payload.stageMessage;
                }
                if (typeof payload.visible === "boolean") slides.stageMessageVisible = payload.visible;
                if (typeof payload.stageMessageVisible === "boolean") slides.stageMessageVisible = payload.stageMessageVisible;
                if (typeof payload.flash === "boolean") slides.stageMessageFlash = payload.flash;
                if (typeof payload.stageMessageFlash === "boolean") slides.stageMessageFlash = payload.stageMessageFlash;
                return { ...prev, slides };
              });
            });
          }
        };
      } catch {
        setLanSyncConnected(false);
        lanSyncReconnectTimerRef.current = window.setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      disposed = true;
      cleanupSocket();
      setLanSyncConnected(false);
    };
  }, [state?.settings.sync.lanDiscoveryEnabled, state?.settings.sync.hubAddress]);

  const isOutputWindow = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("output");

  useEffect(() => {
    if (isOutputWindow || !state?.slides) return;
    try {
      localStorage.setItem("onering_live_slides_state", JSON.stringify(state.slides));
      localStorage.setItem(
        "onering_workspace_autosave_v1",
        JSON.stringify({ slides: state.slides, sources: state.sources })
      );
      const ch = new BroadcastChannel("onering_display_sync");
      ch.postMessage({ type: "SLIDES_UPDATE", slides: state.slides });
      ch.close();
    } catch {}
  }, [state?.slides, state?.sources, isOutputWindow]);

  if (isOutputWindow) {
    return <SecondaryOutputWindow />;
  }

  if (!state) {
    return <div style={{ padding: 32, color: "#9CA3AF" }}>Loading One Ring...</div>;
  }

  const anyLive = state.broadcasts.some((b) => b.live);

  return (
    <div style={{ minHeight: "100vh", background: "#0B0D10", color: "#F3F4F6" }}>
      {/* TOP HEALTH STRIP */}
      <header
        style={{
          height: 64,
          padding: "0 16px",
          background: anyLive ? "#1F1215" : "#14181F",
          borderBottom: `1px solid ${anyLive ? "#DC2626" : "#252C38"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 16, letterSpacing: "-0.01em" }}>ONE RING</strong>
          <button
            type="button"
            onClick={() => setIsEditingShowName(true)}
            title="Click to rename this service / show"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px dashed #3B82F6",
              borderRadius: 6,
              padding: "3px 8px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              color: "#93C5FD",
              fontSize: 12,
            }}
          >
            <span className="mono" style={{ fontWeight: 600 }}>{state.serviceName || "Untitled Show"}</span>
            <Pencil size={11} color="#60A5FA" />
          </button>
          <span
            style={{
              fontSize: 11,
              color: "#64748B",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "2px 8px",
              background: "#12161F",
              borderRadius: 4,
              border: "1px solid #1E2533",
            }}
          >
            {state.settings.general.canvasTitle || "Main Sanctuary"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {state.health.map((h) => (
            <span
              key={h.id}
              title={`${h.protocol} — ${h.detail} (${h.latencyMs}ms)`}
              className="mono"
              style={{
                fontSize: 11,
                padding: "4px 9px",
                borderRadius: 999,
                background: "#1C222D",
                border: "1px solid #2A3241",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: h.status === "ok" ? "#10B981" : h.status === "warn" ? "#F59E0B" : "#EF4444",
                }}
              />
              {h.label}
              <span style={{ color: "#6B7280", fontSize: 10 }}>{h.latencyMs}ms</span>
            </span>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {lanSyncConnected && (
            <span
              className="mono"
              title="Connected to paired station sync"
              style={{
                fontSize: 11,
                padding: "4px 9px",
                borderRadius: 999,
                background: "#052E2B",
                border: "1px solid #0F766E",
                color: "#99F6E4",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#14B8A6",
                }}
              />
              Synced
            </span>
          )}
          {(state.settings.general.canvasTabs || [
            { id: "mixing", label: "Mixing", enabled: true },
            { id: "video", label: "Video", enabled: true },
            { id: "slides", label: "Slides", enabled: true },
            { id: "broadcast", label: "Broadcast", enabled: true },
            { id: "master", label: "Master", enabled: true },
          ])
            .filter((t) => t.enabled)
            .map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="btn"
                onClick={() => setMode(tab.id as ViewMode)}
                style={{
                  height: 36,
                  padding: "0 14px",
                  fontSize: 13,
                  fontWeight: mode === tab.id ? 700 : 500,
                  background: mode === tab.id ? "#2563EB" : "#1C222D",
                  borderColor: mode === tab.id ? "#60A5FA" : "#2E3746",
                  color: mode === tab.id ? "#FFFFFF" : "#CBD5E1",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {tab.label}
              </button>
            ))}

          <button
            type="button"
            className="btn"
            onClick={() => setShowPreflight(true)}
            title="Preflight readiness and show builder"
            style={{
              height: 36,
              padding: "0 12px",
              fontSize: 13,
              background: showPreflight ? "#2563EB" : "#1C222D",
              borderColor: showPreflight ? "#60A5FA" : "#2E3746",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ShieldCheck size={14} />
            Preflight
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => setMode("settings")}
            style={{
              height: 36,
              padding: "0 12px",
              fontSize: 13,
              background: mode === "settings" ? "#2563EB" : "#1C222D",
              borderColor: mode === "settings" ? "#60A5FA" : "#2E3746",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Settings size={14} />
            Settings
          </button>
        </div>
      </header>

      {/* SILENT PASTOR MIC BANNER (Aoip Conmon UDP :8751 0xFE detector) */}
      {state.silentMicAlert && (
        <div
          style={{
            background: "rgba(220,38,38,0.22)",
            borderBottom: "1px solid #EF4444",
            padding: "10px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#FCA5A5", fontWeight: 700, fontSize: 14 }}>
            <AlertOctagon size={18} color="#EF4444" />
            <span>{state.silentMicAlert}</span>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => bridge.toggleBeltpackFault().then(setState)}
            style={{ height: 32, padding: "0 12px", fontSize: 12, background: "#7F1D1D", borderColor: "#EF4444" }}
          >
            Dismiss Mic Alert
          </button>
        </div>
      )}

      {mode === "mixing" && (
        <EngineerView
          state={state}
          onBroadcastToggle={(id, live) => bridge.setBroadcastState(id, live).then(setState)}
          onToggleDcaMute={(id) => bridge.toggleDcaMute(id).then(setState)}
          onToggleBeltpackFault={() => bridge.toggleBeltpackFault().then(setState)}
          onSwitchIpVideoReceiver={(rxId, src) => bridge.switchIpVideoReceiver(rxId, src).then(setState)}
          onAutoHealIpVideo={() => bridge.autoHealIpVideoReceivers().then(setState)}
          onFlashAoipIdentify={(routeId) => bridge.flashAoipIdentify(routeId).then(setState)}
        />
      )}

      {mode === "video" && (
        <VideoCanvasView
          state={state}
          onRecallCamera={(id) => bridge.recallCameraPreset(id).then(setState)}
          onSwitchIpVideoReceiver={(rxId, src) => bridge.switchIpVideoReceiver(rxId, src).then(setState)}
        />
      )}

      {mode === "slides" && (
        <SlidesCanvasView
          state={state}
          onSelectSlide={(slideNumber) => {
            emitLanSync("slide_changed", { slideNumber });
            bridge.goToSlide(slideNumber).then(setState);
          }}
          onSlideAction={(act) => {
            emitLanSync("slide_changed", { action: act });
            bridge.triggerSlideAction(act).then(setState);
          }}
          onImportSong={(title, importedSlides) => {
            const songId = `song_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            setState((prev) => {
              if (!prev) return prev;
              const existingSongs = prev.slides.songs || [];
              const newSong = { id: songId, title, slides: importedSlides };
              const nextSlides = {
                ...prev.slides,
                presentationName: title,
                activeSongId: songId,
                songs: [...existingSongs, newSong],
                currentSlide: 1,
                totalSlides: importedSlides.length,
                currentText: importedSlides[0]?.text || "",
                nextText: importedSlides[1]?.text || "",
                cleared: false,
                slides: importedSlides,
              };
              bridge.syncWorkspaceState({ slides: nextSlides }).catch(() => {});
              emitLanSync("slide_changed", { slides: nextSlides });
              return { ...prev, slides: nextSlides };
            });
          }}
          onSelectSong={(songId) => {
            const song = (state.slides.songs || []).find((s) => s.id === songId);
            if (!song) return;
            const nextSlides = {
              ...state.slides,
              presentationName: song.title,
              activeSongId: song.id,
              currentSlide: 1,
              totalSlides: song.slides.length,
              currentText: song.slides[0]?.text || "",
              nextText: song.slides[1]?.text || "",
              cleared: false,
              slides: song.slides,
            };
            setState((prev) => (prev ? { ...prev, slides: nextSlides } : prev));
            bridge.syncWorkspaceState({ slides: nextSlides }).catch(() => {});
            emitLanSync("slide_changed", { slides: nextSlides });
          }}
          onRemoveSong={(songId) => {
            const remaining = (state.slides.songs || []).filter((s) => s.id !== songId);
            const nextActive =
              state.slides.activeSongId === songId
                ? remaining[0]
                : remaining.find((s) => s.id === state.slides.activeSongId);
            const nextSlides = {
              ...state.slides,
              songs: remaining,
              activeSongId: nextActive?.id,
              presentationName: nextActive?.title || "Untitled Presentation",
              slides: nextActive?.slides || [],
              currentSlide: 1,
              totalSlides: nextActive?.slides.length || 0,
              currentText: nextActive?.slides[0]?.text || "",
              nextText: nextActive?.slides[1]?.text || "",
            };
            setState((prev) => (prev ? { ...prev, slides: nextSlides } : prev));
            bridge.syncWorkspaceState({ slides: nextSlides }).catch(() => {});
            emitLanSync("slide_changed", { slides: nextSlides });
          }}
          onUpdateTheme={(theme) => {
            const nextSlides = { ...state.slides, theme };
            setState((prev) => (prev ? { ...prev, slides: nextSlides } : prev));
            bridge.syncWorkspaceState({ slides: nextSlides }).catch(() => {});
            emitLanSync("slide_changed", { slides: nextSlides });
          }}
        />
      )}

      {mode === "broadcast" && (
        <BroadcastCanvasView
          state={state}
          onBroadcastToggle={(id, live) => bridge.setBroadcastState(id, live).then(setState)}
          onAddSource={(source) => {
            const nextSources = [...(state.sources || []), source];
            setState((prev) => (prev ? { ...prev, sources: nextSources } : prev));
            bridge.syncWorkspaceState({ sources: nextSources }).catch(() => {});
          }}
          onRemoveSource={(id) => {
            const nextSources = (state.sources || []).filter((s) => s.id !== id);
            setState((prev) => (prev ? { ...prev, sources: nextSources } : prev));
            bridge.syncWorkspaceState({ sources: nextSources }).catch(() => {});
          }}
          onToggleSourceVisibility={(id) => {
            const nextSources = (state.sources || []).map((s) =>
              s.id === id ? { ...s, enabled: !s.enabled } : s
            );
            setState((prev) => (prev ? { ...prev, sources: nextSources } : prev));
            bridge.syncWorkspaceState({ sources: nextSources }).catch(() => {});
          }}
          onToggleSourceLock={(id) => {
            const nextSources = (state.sources || []).map((s) =>
              s.id === id ? { ...s, locked: !s.locked } : s
            );
            setState((prev) => (prev ? { ...prev, sources: nextSources } : prev));
            bridge.syncWorkspaceState({ sources: nextSources }).catch(() => {});
          }}
          onSetAllSources={(updatedSources) => {
            setState((prev) => (prev ? { ...prev, sources: updatedSources } : prev));
            bridge.syncWorkspaceState({ sources: updatedSources }).catch(() => {});
          }}
          onUpdateSourceSettings={(id, newSettings, newName) => {
            const nextSources = (state.sources || []).map((s) =>
              s.id === id ? { ...s, settings: newSettings, name: newName } : s
            );
            setState((prev) => (prev ? { ...prev, sources: nextSources } : prev));
            bridge.syncWorkspaceState({ sources: nextSources }).catch(() => {});
          }}
        />
      )}

      {mode === "master" && (
        <ShowModeView
          state={state}
          onTriggerCue={(idx) => {
            emitLanSync("cue_triggered", { cueIndex: idx });
            return bridge.triggerCue(idx).then(setState);
          }}
          onUndoCue={() => bridge.undoLastCue().then(setState)}
          onToggleDcaMute={(id) => bridge.toggleDcaMute(id).then(setState)}
          onNudgeDca={(id, delta) => bridge.nudgeDcaLevel(id, delta).then(setState)}
          onRecallCamera={(id) => bridge.recallCameraPreset(id).then(setState)}
          onSlideAction={(act) => {
            emitLanSync("slide_changed", { action: act });
            return bridge.triggerSlideAction(act).then(setState);
          }}
          onSelectSlide={(slideNumber) => {
            emitLanSync("slide_changed", { slideNumber });
            return bridge.goToSlide(slideNumber).then(setState);
          }}
          onTimerControl={(operation) => bridge.controlPresentationTimer(operation).then(setState)}
          onStageMessage={(message) => bridge.setStageMessage(message).then(setState)}
          onStageMessageFlag={(field, value) => bridge.setStageMessageFlag(field, value).then(setState)}
          onBroadcastToggle={(id, live) => bridge.setBroadcastState(id, live).then(setState)}
          onPlaylistControl={(kind, direction) =>
            bridge.controlSlideHttpPlaylist(kind, direction).then(setState)
          }
          onTransportControl={(layer, operation) =>
            bridge.controlSlideHttpTransport(layer, operation).then(setState)
          }
          onTransportSeek={(layer, seconds) =>
            bridge.seekSlideHttpTransport(layer, seconds).then(setState)
          }
          onClearGroup={(id) => bridge.triggerSlideHttpClearGroup(id).then(setState)}
          onRefreshSlideHttpCatalog={(kind) =>
            bridge.refreshSlideHttpCatalog(kind).then(setState)
          }
          onSlideHttpResource={(action, id) =>
            bridge.triggerSlideHttpResource(action, id).then(setState)
          }
          onSlideTcpControl={(action) =>
            bridge.controlSlideTcp(action).then(setState)
          }
          onSlideTcpScreenFlag={(field, value) =>
            bridge.setSlideTcpScreenFlag(field, value).then(setState)
          }
          onSlideTcpImage={(key) => bridge.getSlideTcpImage(key)}
        />
      )}

      {showPreflight && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 900,
            overflowY: "auto",
            background: "rgba(6,8,12,0.97)",
          }}
        >
          <div style={{ maxWidth: 1120, margin: "0 auto", padding: "14px 20px 40px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "8px 0 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <ShieldCheck size={20} color="#10B981" />
                <strong style={{ fontSize: 16 }}>Preflight & Show Builder</strong>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setShowPreflight(false)}
                style={{ height: 34, padding: "0 14px", fontSize: 12 }}
              >
                Close
              </button>
            </div>
            <PreflightView
              state={state}
              onRunProbes={() => bridge.runPreflightProbes().then(setState)}
              onEnterShowMode={() => {
                setShowPreflight(false);
                setMode("master");
              }}
              onOpenEngineer={() => {
                setShowPreflight(false);
                setMode("mixing");
              }}
            />
            <ShowBuilderView
              state={state}
              intent={builderIntent}
              onIntentHandled={() => setBuilderIntent(null)}
              onApplyShowFile={(show) => {
                bridge.applyShowFile(show).then(setState);
              }}
              onOpenSettings={() => {
                setShowPreflight(false);
                setMode("settings");
              }}
            />
          </div>
        </div>
      )}

      <WelcomeTour
        isOpen={showWelcomeTour}
        onComplete={() => {
          localStorage.setItem("onering_tour_completed", "true");
          setShowWelcomeTour(false);
        }}
        onNavigateTab={(tabKey) => {
          const map: Record<string, ViewMode> = {
            preflight: "master",
            show: "master",
            engineer: "mixing",
            mixing: "mixing",
            video: "video",
            slides: "slides",
            broadcast: "broadcast",
            master: "master",
            settings: "settings",
          };
          if (tabKey in map) {
            setMode(map[tabKey]);
          }
        }}
      />

      {discoveredPeer && (
        <PairingPrompt
          peer={discoveredPeer}
          onPair={(p) => {
            // Pair stations: set hub address to peer's IP
            if (state) {
              const updated = {
                ...state.settings,
                sync: {
                  ...state.settings.sync,
                  hubAddress: `ws://${p.ipAddress}:${p.wsSyncPort}`,
                  lanDiscoveryEnabled: true,
                },
              };
              bridge.saveSettings(updated).then(setState);
            }
            dismissedPeersRef.current.add(p.instanceId);
            setDiscoveredPeer(null);
          }}
          onDismiss={() => {
            dismissedPeersRef.current.add(discoveredPeer.instanceId);
            setDiscoveredPeer(null);
          }}
        />
      )}

      <ShowNameModal
        currentName={state.serviceName || "Untitled Show"}
        isOpen={isEditingShowName}
        onSave={(name) => {
          setState((prev) => (prev ? { ...prev, serviceName: name } : prev));
          bridge.syncWorkspaceState({ serviceName: name }).catch(() => {});
        }}
        onClose={() => setIsEditingShowName(false)}
      />

      {availableUpdate && (
        <UpdateModal update={availableUpdate} onDismiss={() => setAvailableUpdate(null)} />
      )}

      <BroadcastSettingsModal
        isOpen={showBroadcastSettings}
        onClose={() => setShowBroadcastSettings(false)}
        profile={broadcastProfile}
        onSaveProfile={(profile) => {
          setBroadcastProfile(profile);
          try {
            localStorage.setItem(BROADCAST_PROFILE_KEY, JSON.stringify(profile));
          } catch {
            // Local persistence is best-effort.
          }
        }}
        streamKey={broadcastStream.streamKey}
        rtmpUrl={broadcastStream.rtmpUrl}
        onSaveStreamConfig={(rtmpUrl, streamKey) => {
          setBroadcastStream({ rtmpUrl, streamKey });
          try {
            localStorage.setItem(BROADCAST_STREAM_KEY, JSON.stringify({ rtmpUrl, streamKey }));
          } catch {
            // Local persistence is best-effort.
          }
          if (state) {
            const settings = structuredClone(state.settings);
            const existing = settings.broadcast.destinations[0];
            if (existing) {
              existing.rtmpUrl = rtmpUrl;
              existing.streamKey = streamKey;
            } else {
              settings.broadcast.destinations.push({
                id: `destination-${Date.now().toString(36)}`,
                platform: "Primary",
                rtmpUrl,
                streamKey,
                enabled: true,
              });
            }
            bridge.saveSettings(settings).then(setState).catch(() => undefined);
          }
        }}
        hotkeys={broadcastHotkeys}
        onSaveHotkeys={(hotkeys) => {
          setBroadcastHotkeys(hotkeys);
          try {
            localStorage.setItem(BROADCAST_HOTKEYS_KEY, JSON.stringify(hotkeys));
          } catch {
            // Local persistence is best-effort.
          }
        }}
        hardwareEncoders={hardwareEncoders}
        encodersLoading={encodersLoading}
      />

      {mode === "settings" && (
        <SettingsView
          state={state}
          onSave={(settings) => bridge.saveSettings(settings).then(setState)}
          onOpenBroadcastSettings={() => setShowBroadcastSettings(true)}
          onCheckUpdates={async () => {
            const info = await checkForUpdate();
            if (info) {
              setAvailableUpdate(info);
            } else {
              setAvailableUpdate({
                current_version: "0.3.3",
                latest_version: "v0.3.3-alpha",
                release_name: "One Ring v0.3.3-alpha",
                release_notes: "You are running the latest version. All systems are up to date.",
                published_at: new Date().toISOString(),
                html_url: `${UPDATE_REPO_URL}/releases`,
                download_url: null,
                update_available: false,
                assets: [],
              });
            }
          }}
        />
      )}
    </div>
  );
};
