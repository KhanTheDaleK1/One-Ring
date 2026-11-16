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
import { EngineerView } from "./components/EngineerView";
import { SettingsView } from "./components/SettingsView";
import { ShowNameModal } from "./components/ShowNameModal";
import { WelcomeTour } from "./components/WelcomeTour";
import { UpdateModal } from "./components/UpdateModal";
import { checkForUpdate } from "./bridge";
import type { UpdateInfo } from "./types";

export const App: React.FC = () => {
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [mode, setMode] = useState<ViewMode>("mixing");
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [isEditingShowName, setIsEditingShowName] = useState(false);
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
            current_version: "0.1.0",
            latest_version: "v0.1.0-alpha.2",
            release_name: "One Ring — Church Production Suite",
            release_notes: "You are running One Ring v0.1.0. All systems up to date.",
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

    bridge.getAppState().then((snapshot) => {
      if (disposed) return;
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
    };
  }, []);

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

      {mode === "slides" && (
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

      {mode === "broadcast" && (
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
        />
      )}
    </div>
  );
};
