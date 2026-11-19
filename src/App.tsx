import React, { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Lock, AlertOctagon, FlaskConical, Settings, Pencil, ShieldCheck } from "lucide-react";
import {
  applyCueProgress,
  applyHealthEvent,
  applyMeterEvent,
  applyStatePatch,
  bridge,
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
import { checkForUpdate } from "./bridge";
import type { UpdateInfo } from "./types";

export const App: React.FC = () => {
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [mode, setMode] = useState<ViewMode>("mixing");
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [isEditingShowName, setIsEditingShowName] = useState(false);
  const [discoveredPeer, setDiscoveredPeer] = useState<DiscoveredPeerInfo | null>(null);
  const [showPreflight, setShowPreflight] = useState(false);
  const [builderIntent, setBuilderIntent] = useState<BuilderIntent>(null);
  const dismissedPeersRef = useRef<Set<string>>(new Set());
  const stateRef = useRef<AppStateSnapshot | null>(null);
  const [showWelcomeTour, setShowWelcomeTour] = useState(() => {
    return localStorage.getItem("onering_tour_completed") !== "true";
  });

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
            current_version: "0.3.2",
            latest_version: "v0.3.2-alpha",
            release_name: "One Ring — Church Production Suite",
            release_notes: "You are running One Ring v0.3.2-alpha. All systems up to date.",
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
            bridge.goToSlide(slideNumber).then(setState);
          }}
          onSlideAction={(act) => {
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
          }}
          onUpdateTheme={(theme) => {
            const nextSlides = { ...state.slides, theme };
            setState((prev) => (prev ? { ...prev, slides: nextSlides } : prev));
            bridge.syncWorkspaceState({ slides: nextSlides }).catch(() => {});
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
          onTriggerCue={(idx) => bridge.triggerCue(idx).then(setState)}
          onUndoCue={() => bridge.undoLastCue().then(setState)}
          onToggleDcaMute={(id) => bridge.toggleDcaMute(id).then(setState)}
          onNudgeDca={(id, delta) => bridge.nudgeDcaLevel(id, delta).then(setState)}
          onRecallCamera={(id) => bridge.recallCameraPreset(id).then(setState)}
          onSlideAction={(act) => bridge.triggerSlideAction(act).then(setState)}
          onSelectSlide={(slideNumber) => bridge.goToSlide(slideNumber).then(setState)}
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

      {mode === "settings" && (
        <SettingsView
          state={state}
          onSave={(settings) => bridge.saveSettings(settings).then(setState)}
          onCheckUpdates={async () => {
            const info = await checkForUpdate();
            if (info) {
              setAvailableUpdate(info);
            } else {
              setAvailableUpdate({
                current_version: "0.3.2",
                latest_version: "v0.3.2-alpha",
                release_name: "One Ring v0.3.2-alpha",
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
