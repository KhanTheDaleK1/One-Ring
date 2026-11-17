import React, { useEffect, useState } from "react";
import { Cpu, Lock, AlertOctagon, FlaskConical, Settings, Pencil } from "lucide-react";
import {
  applyCueProgress,
  applyHealthEvent,
  applyMeterEvent,
  applyStatePatch,
  bridge,
  subscribeEvents,
} from "./bridge";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppStateSnapshot, ViewMode } from "./types";
import { PreflightView } from "./components/PreflightView";
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
  const [dismissedPeers, setDismissedPeers] = useState<Set<string>>(new Set());
  const [showWelcomeTour, setShowWelcomeTour] = useState(() => {
    return localStorage.getItem("onering_tour_completed") !== "true";
  });

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    
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
            current_version: "0.1.14",
            latest_version: "v0.1.14-alpha",
            release_name: "One Ring — Church Production Suite",
            release_notes: "You are running One Ring v0.1.14-alpha. All systems up to date.",
            published_at: new Date().toISOString(),
            html_url: "https://github.com/KhanTheDaleK1/One-Ring",
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
        const unhandled = peers.find((p) => !dismissedPeers.has(p.instanceId));
        if (unhandled) {
          setDiscoveredPeer(unhandled);
        }
      }
    }, 2500);

    bridge.getAppState().then((snapshot) => {
      if (disposed) return;
      try {
        const savedRaw = localStorage.getItem("onering_workspace_autosave_v1");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          if (saved.slides && (!snapshot.slides.slides || snapshot.slides.slides.length === 0)) {
            snapshot.slides = { ...snapshot.slides, ...saved.slides };
          }
          if (Array.isArray(saved.sources) && saved.sources.length > 0 && (!snapshot.sources || snapshot.sources.length === 0)) {
            snapshot.sources = saved.sources;
          }
        }
      } catch {}
      setState(snapshot);

      // Live mode hydrates once, then only listens for pushed patches. The simulator keeps
      // its 1 Hz tick so the mock bitrate/timer still animates in the browser.
      if (!snapshot.mockMode) {
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
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
      unlistenMenu?.();
      clearInterval(peerTimer);
    };
  }, []);

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
  }, [state?.slides, isOutputWindow]);

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

      {/* SILENT PASTOR MIC BANNER (Dante Conmon UDP :8751 0xFE detector) */}
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
            Clear Simulated Beltpack Fault
          </button>
        </div>
      )}

      {mode === "mixing" && (
        <EngineerView
          state={state}
          onBroadcastToggle={(id, live) => bridge.setBroadcastState(id, live).then(setState)}
          onToggleDcaMute={(id) => bridge.toggleDcaMute(id).then(setState)}
          onToggleBeltpackFault={() => bridge.toggleBeltpackFault().then(setState)}
          onSwitchNdiReceiver={(rxId, src) => bridge.switchNdiReceiver(rxId, src).then(setState)}
          onAutoHealNdi={() => bridge.autoHealNdiReceivers().then(setState)}
          onFlashDanteIdentify={(routeId) => bridge.flashDanteIdentify(routeId).then(setState)}
        />
      )}

      {mode === "video" && (
        <VideoCanvasView
          state={state}
          onRecallCamera={(id) => bridge.recallCameraPreset(id).then(setState)}
          onSwitchNdiReceiver={(rxId, src) => bridge.switchNdiReceiver(rxId, src).then(setState)}
        />
      )}

      {mode === "slides" && (
        <SlidesCanvasView
          state={state}
          onSelectSlide={(slideNumber) => {
            setState((prev) => {
              if (!prev) return prev;
              const arr = prev.slides.slides || [];
              if (arr.length > 0) {
                const idx = Math.max(0, Math.min(arr.length - 1, slideNumber - 1));
                return {
                  ...prev,
                  slides: {
                    ...prev.slides,
                    currentSlide: idx + 1,
                    totalSlides: arr.length,
                    currentText: arr[idx]?.text || "",
                    nextText: arr[idx + 1]?.text || "",
                    cleared: false,
                  },
                };
              }
              bridge.goToSlide(slideNumber).then(setState);
              return prev;
            });
          }}
          onSlideAction={(act) => {
            setState((prev) => {
              if (!prev) return prev;
              const arr = prev.slides.slides || [];
              if (arr.length > 0) {
                if (act === "clear") {
                  return { ...prev, slides: { ...prev.slides, cleared: !prev.slides.cleared } };
                }
                const curr = prev.slides.currentSlide || 1;
                const nextNum =
                  act === "next"
                    ? Math.min(arr.length, curr + 1)
                    : Math.max(1, curr - 1);
                return {
                  ...prev,
                  slides: {
                    ...prev.slides,
                    currentSlide: nextNum,
                    totalSlides: arr.length,
                    currentText: arr[nextNum - 1]?.text || "",
                    nextText: arr[nextNum]?.text || "",
                    cleared: false,
                  },
                };
              }
              bridge.triggerSlideAction(act).then(setState);
              return prev;
            });
          }}
          onImportSong={(title, importedSlides) => {
            setState((prev) => {
              if (!prev) return prev;
              const songId = "song_" + Date.now();
              const existingSongs = prev.slides.songs || [];
              const newSong = { id: songId, title, slides: importedSlides };
              return {
                ...prev,
                slides: {
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
                },
              };
            });
          }}
          onSelectSong={(songId) => {
            setState((prev) => {
              if (!prev) return prev;
              const song = (prev.slides.songs || []).find((s) => s.id === songId);
              if (!song) return prev;
              return {
                ...prev,
                slides: {
                  ...prev.slides,
                  presentationName: song.title,
                  activeSongId: song.id,
                  currentSlide: 1,
                  totalSlides: song.slides.length,
                  currentText: song.slides[0]?.text || "",
                  nextText: song.slides[1]?.text || "",
                  cleared: false,
                  slides: song.slides,
                },
              };
            });
          }}
          onRemoveSong={(songId) => {
            setState((prev) => {
              if (!prev) return prev;
              const remaining = (prev.slides.songs || []).filter((s) => s.id !== songId);
              const nextActive =
                prev.slides.activeSongId === songId ? remaining[0] : remaining.find((s) => s.id === prev.slides.activeSongId);
              return {
                ...prev,
                slides: {
                  ...prev.slides,
                  songs: remaining,
                  activeSongId: nextActive?.id,
                  presentationName: nextActive?.title || "Untitled Presentation",
                  slides: nextActive?.slides || [],
                  currentSlide: 1,
                  totalSlides: nextActive?.slides.length || 0,
                  currentText: nextActive?.slides[0]?.text || "",
                  nextText: nextActive?.slides[1]?.text || "",
                },
              };
            });
          }}
          onUpdateTheme={(theme) => {
            setState((prev) =>
              prev ? { ...prev, slides: { ...prev.slides, theme } } : prev
            );
          }}
        />
      )}

      {mode === "broadcast" && (
        <BroadcastCanvasView
          state={state}
          onBroadcastToggle={(id, live) => bridge.setBroadcastState(id, live).then(setState)}
          onAddSource={(source) => {
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                sources: [...(prev.sources || []), source],
              };
            });
          }}
          onRemoveSource={(id) => {
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                sources: (prev.sources || []).filter((s) => s.id !== id),
              };
            });
          }}
          onToggleSourceVisibility={(id) => {
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                sources: (prev.sources || []).map((s) =>
                  s.id === id ? { ...s, enabled: !s.enabled } : s
                ),
              };
            });
          }}
          onToggleSourceLock={(id) => {
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                sources: (prev.sources || []).map((s) =>
                  s.id === id ? { ...s, locked: !s.locked } : s
                ),
              };
            });
          }}
          onSetAllSources={(updatedSources) => {
            setState((prev) => (prev ? { ...prev, sources: updatedSources } : prev));
          }}
          onUpdateSourceSettings={(id, newSettings, newName) => {
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                sources: (prev.sources || []).map((s) =>
                  s.id === id ? { ...s, settings: newSettings, name: newName } : s
                ),
              };
            });
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
          onBroadcastToggle={(id, live) => bridge.setBroadcastState(id, live).then(setState)}
        />
      )}

      <WelcomeTour
        isOpen={showWelcomeTour}
        onComplete={() => {
          localStorage.setItem("onering_tour_completed", "true");
          setShowWelcomeTour(false);
        }}
        onNavigateTab={(tabKey) => {
          if (["preflight", "show", "engineer", "settings"].includes(tabKey)) {
            setMode(tabKey as ViewMode);
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
            setDiscoveredPeer(null);
          }}
          onDismiss={() => {
            setDismissedPeers((prev) => new Set(prev).add(discoveredPeer.instanceId));
            setDiscoveredPeer(null);
          }}
        />
      )}

      <ShowNameModal
        currentName={state.serviceName || "Untitled Show"}
        isOpen={isEditingShowName}
        onSave={(name) => {
          setState((prev) => prev ? { ...prev, serviceName: name } : prev);
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
                current_version: "0.1.14",
                latest_version: "v0.1.14-alpha",
                release_name: "One Ring v0.1.14-alpha",
                release_notes: "You are running the latest version. All systems are up to date.",
                published_at: new Date().toISOString(),
                html_url: "https://github.com/KhanTheDaleK1/One-Ring/releases",
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
