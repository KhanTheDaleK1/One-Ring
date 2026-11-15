import React, { useEffect, useState } from "react";
import { Cpu, Lock } from "lucide-react";
import { bridge } from "./bridge";
import type { AppStateSnapshot, ViewMode } from "./types";
import { PreflightView } from "./components/PreflightView";
import { ShowModeView } from "./components/ShowModeView";
import { EngineerView } from "./components/EngineerView";

export const App: React.FC = () => {
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [mode, setMode] = useState<ViewMode>("preflight");

  useEffect(() => {
    bridge.getAppState().then(setState);
    const timer = setInterval(() => {
      setState((prev) => (prev?.mockMode ? bridge.tickSimulator() : prev));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!state) {
    return <div style={{ padding: 32, color: "#9CA3AF" }}>Loading One Ring...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0B0D10", color: "#F3F4F6" }}>
      {/* TOP HEALTH STRIP */}
      <header
        style={{
          height: 64,
          padding: "0 16px",
          background: "#14181F",
          borderBottom: "1px solid #252C38",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {state.health.map((h) => (
            <span
              key={h.id}
              title={h.detail}
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

      {mode === "preflight" && (
        <PreflightView
          state={state}
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
          onBroadcastToggle={(id, live) => bridge.setBroadcastState(id, live).then(setState)}
        />
      )}

      {mode === "engineer" && (
        <EngineerView
          state={state}
          onBroadcastToggle={(id, live) => bridge.setBroadcastState(id, live).then(setState)}
          onToggleDcaMute={(id) => bridge.toggleDcaMute(id).then(setState)}
        />
      )}
    </div>
  );
};
