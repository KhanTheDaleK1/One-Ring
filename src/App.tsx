import React, { useEffect, useState } from "react";
import { Cpu, Lock, AlertOctagon, FlaskConical } from "lucide-react";
import {
  applyCueProgress,
  applyHealthEvent,
  applyMeterEvent,
  applyStatePatch,
  bridge,
  subscribeEvents,
} from "./bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AppStateSnapshot, ViewMode } from "./types";
import { PreflightView } from "./components/PreflightView";
import { ShowModeView } from "./components/ShowModeView";
import { EngineerView } from "./components/EngineerView";

export const App: React.FC = () => {
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [mode, setMode] = useState<ViewMode>("preflight");

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

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

    const timer = setInterval(() => {
      setState((prev) => (prev?.mockMode ? bridge.tickSimulator() : prev));
    }, 1000);

    return () => {
      disposed = true;
      clearInterval(timer);
      unlisten?.();
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
          <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
            {state.serviceName}
          </span>
          {state.mockMode && (
            <span
              className="mono"
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(59,130,246,0.16)",
                color: "#60A5FA",
                border: "1px solid #1D4ED8",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Cpu size={12} /> SIMULATOR
            </span>
          )}
          <button
            type="button"
            onClick={() => bridge.toggleRehearsalMode().then(setState)}
            className="mono"
            title="Toggle Ghost / Dry-Run Rehearsal Mode (verifies cue plans without touching live outputs)"
            style={{
              fontSize: 11,
              padding: "4px 9px",
              borderRadius: 6,
              cursor: "pointer",
              background: state.rehearsalMode ? "rgba(245,158,11,0.2)" : "#1C222D",
              color: state.rehearsalMode ? "#FBBF24" : "#9CA3AF",
              border: `1px solid ${state.rehearsalMode ? "#F59E0B" : "#2E3746"}`,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <FlaskConical size={12} />
            {state.rehearsalMode ? "REHEARSAL (DRY-RUN)" : "LIVE EXEC"}
          </button>
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
          {(["preflight", "show", "engineer"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className="btn"
              onClick={() => setMode(m)}
              style={{
                height: 36,
                padding: "0 12px",
                fontSize: 13,
                background: mode === m ? "#2563EB" : "#1C222D",
                borderColor: mode === m ? "#60A5FA" : "#2E3746",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {m === "engineer" && <Lock size={13} />}
              {m === "preflight" ? "Preflight" : m === "show" ? "Show Mode" : "Engineer"}
            </button>
          ))}
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

      {mode === "preflight" && (
        <PreflightView
          state={state}
          onRunProbes={() => bridge.runPreflightProbes().then(setState)}
          onEnterShowMode={() => setMode("show")}
          onOpenEngineer={() => setMode("engineer")}
        />
      )}

      {mode === "show" && (
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

      {mode === "engineer" && (
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
    </div>
  );
};
