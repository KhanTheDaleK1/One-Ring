import React, { useEffect } from "react";
import {
  Play,
  Undo2,
  Volume2,
  VolumeX,
  Video,
  Radio,
  ChevronLeft,
  ChevronRight,
  Eraser,
  CheckCircle2,
  Activity,
} from "lucide-react";
import type { AppStateSnapshot } from "../types";
import { HoldConfirmButton } from "./HoldConfirmButton";

interface ShowModeViewProps {
  state: AppStateSnapshot;
  onTriggerCue: (index: number) => void;
  onUndoCue: () => void;
  onToggleDcaMute: (dcaId: string) => void;
  onNudgeDca: (dcaId: string, deltaDb: number) => void;
  onRecallCamera: (presetId: string) => void;
  onSlideAction: (action: "prev" | "next" | "clear") => void;
  onBroadcastToggle: (targetId: string, live: boolean) => void;
}

const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

export const ShowModeView: React.FC<ShowModeViewProps> = ({
  state,
  onTriggerCue,
  onUndoCue,
  onToggleDcaMute,
  onNudgeDca,
  onRecallCamera,
  onSlideAction,
  onBroadcastToggle,
}) => {
  const nextCueIndex = Math.min(state.cues.length - 1, state.activeCueIndex + 1);
  const nextCue = state.cues[nextCueIndex];
  const anyLive = state.broadcasts.some((b) => b.live);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        if (state.activeCueIndex < state.cues.length - 1) {
          onTriggerCue(state.activeCueIndex + 1);
        }
      } else if (e.code === "ArrowRight") {
        onSlideAction("next");
      } else if (e.code === "ArrowLeft") {
        onSlideAction("prev");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.activeCueIndex, state.cues.length, onTriggerCue, onSlideAction]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1.25fr", gap: 16, padding: 16, height: "calc(100vh - 64px)" }}>
      {/* LEFT: SERVICE CUE STACK + TRANSACTIONAL VERIFICATION */}
      <div className="card" style={{ display: "flex", flexDirection: "column", padding: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
            SERVICE CUE STACK {state.rehearsalMode ? "(REHEARSAL / DRY-RUN)" : ""}
          </div>
          <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
            Cue {state.activeCueIndex + 1} / {state.cues.length} • Undo Stack: {state.undoDepth}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 8, paddingRight: 4 }}>
          {state.cues.map((cue, idx) => {
            const isActive = idx === state.activeCueIndex;
            const isNext = idx === state.activeCueIndex + 1;
            return (
              <button
                key={cue.id}
                type="button"
                onClick={() => onTriggerCue(idx)}
                style={{
                  textAlign: "left",
                  padding: "11px 14px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: isActive
                    ? "1px solid #3B82F6"
                    : isNext
                    ? "1px solid #10B981"
                    : "1px solid #252C38",
                  background: isActive ? "rgba(59,130,246,0.14)" : isNext ? "rgba(16,185,129,0.08)" : "#1C222D",
                  color: "#F3F4F6",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {cue.index}. {cue.title}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {cue.riskTier >= 2 && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "rgba(245,158,11,0.18)",
                          color: "#FBBF24",
                        }}
                      >
                        ON-AIR TRANSITION
                      </span>
                    )}
                    {isActive && (
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "#60A5FA" }}>
                        ACTIVE
                      </span>
                    )}
                    {isNext && (
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "#34D399" }}>
                        UP NEXT
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                  {cue.actions.map((act) => (
                    <span
                      key={act}
                      className="mono"
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: "#0B0D10",
                        border: "1px solid #2A3241",
                        color: "#D1D5DB",
                      }}
                    >
                      {act}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* POST-CONDITION VERIFICATION REPORT */}
        {state.lastVerification && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 8,
              background: "#121721",
              border: "1px solid #263142",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "#34D399", display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={13} />
                VERIFIED: {state.lastVerification.cueTitle}
              </span>
              <span className="mono" style={{ fontSize: 10, color: "#9CA3AF" }}>
                {state.lastVerification.rehearsal ? "REHEARSAL DRY-RUN" : "4/4 POST-CONDITIONS APPLIED"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {state.lastVerification.steps.map((s) => (
                <div key={s.domain} className="mono" style={{ fontSize: 10, color: "#9CA3AF" }}>
                  <strong style={{ color: "#E5E7EB" }}>{s.domain}:</strong> {s.observed} ({s.latencyMs}ms)
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button
            type="button"
            className="btn"
            disabled={!state.canUndo}
            onClick={onUndoCue}
            title={state.lastUndoLabel ? `Revert ${state.lastUndoLabel}` : "Nothing to undo"}
            style={{ height: 64, padding: "0 16px", display: "flex", alignItems: "center", gap: 8 }}
          >
            <Undo2 size={18} />
            <span>Undo ({state.undoDepth})</span>
          </button>
          <button
            type="button"
            className="btn"
            disabled={state.activeCueIndex >= state.cues.length - 1}
            onClick={() => onTriggerCue(nextCueIndex)}
            style={{
              flex: 1,
              height: 64,
              background: state.rehearsalMode ? "#D97706" : "#2563EB",
              borderColor: state.rehearsalMode ? "#F59E0B" : "#3B82F6",
              fontSize: 17,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <Play size={20} fill="currentColor" />
            {state.activeCueIndex >= state.cues.length - 1
              ? "END OF SERVICE"
              : `${state.rehearsalMode ? "DRY-RUN NEXT" : "GO NEXT"}: ${nextCue.title} (Space)`}
          </button>
        </div>
      </div>

      {/* RIGHT: SAFE VOLUNTEER CONTROLS */}
      <div style={{ display: "grid", gridTemplateRows: "auto auto auto 1fr", gap: 12, overflowY: "auto" }}>
        {/* FOH SLIDES (PROPRESENTER 22.0.1 CHUNKED STREAM) */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
              FOH SLIDES ({state.slides.app.toUpperCase()} • /V1/STATUS/UPDATES)
            </span>
            <span className="mono" style={{ fontSize: 12, color: state.slides.cleared ? "#FBBF24" : "#34D399" }}>
              {state.slides.cleared ? "CLEARED" : `Slide ${state.slides.currentSlide}/${state.slides.totalSlides}`}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{state.slides.presentationName}</div>
            <div className="mono" style={{ fontSize: 11, color: "#9CA3AF" }}>
              Stage Msg: {state.slides.stageMessage}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
            <button type="button" className="btn" onClick={() => onSlideAction("prev")} style={{ height: 46, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <ChevronLeft size={18} /> Prev Slide
            </button>
            <button type="button" className="btn" onClick={() => onSlideAction("next")} style={{ height: 46, background: "#1E3A8A", borderColor: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              Next Slide <ChevronRight size={18} />
            </button>
            <button type="button" className="btn" onClick={() => onSlideAction("clear")} style={{ height: 46, padding: "0 14px", display: "flex", alignItems: "center", gap: 6 }}>
              <Eraser size={16} /> {state.slides.cleared ? "Restore" : "Clear"}
            </button>
          </div>
        </div>

        {/* AUDIO DCAS WITH LIVE DANTE UDP :8751 SIGNAL PRESENCE */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
              AUDIO DCAs (X32 OSC + DANTE UDP :8751 SIGNAL TRUTH)
            </span>
            <span className="mono" style={{ fontSize: 11, color: "#34D399", display: "flex", alignItems: "center", gap: 4 }}>
              <Activity size={13} /> Conmon dBFS Active
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {state.dcas.map((dca) => {
              const noSignalFault = !dca.muted && !dca.signalPresent;
              return (
                <div
                  key={dca.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "#1C222D",
                    border: `1px solid ${noSignalFault ? "#EF4444" : dca.muted ? "#7F1D1D" : "#252C38"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (dca.guardMute && !dca.muted) return;
                        onToggleDcaMute(dca.id);
                      }}
                      title={dca.guardMute && !dca.muted ? "Main LR Mute locked in Show Mode (use Engineer Mode)" : "Toggle Mute"}
                      className="btn"
                      style={{
                        height: 38,
                        padding: "0 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        background: dca.muted ? "#7F1D1D" : noSignalFault ? "#991B1B" : "#065F46",
                        borderColor: dca.muted ? "#EF4444" : "#10B981",
                      }}
                    >
                      {dca.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                      <span style={{ fontSize: 13 }}>{dca.name}</span>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button type="button" className="btn" onClick={() => onNudgeDca(dca.id, -1)} style={{ height: 32, width: 28 }}>-</button>
                      <span className="mono" style={{ width: 42, textAlign: "center", fontSize: 12 }}>
                        {dca.levelDb > 0 ? `+${dca.levelDb}` : dca.levelDb}dB
                      </span>
                      <button type="button" className="btn" onClick={() => onNudgeDca(dca.id, 1)} style={{ height: 32, width: 28 }}>+</button>
                    </div>
                  </div>
                  <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: noSignalFault ? "#FCA5A5" : "#9CA3AF" }}>
                    <span>{dca.danteTxChannel}</span>
                    <span style={{ color: noSignalFault ? "#EF4444" : dca.signalPresent ? "#34D399" : "#6B7280", fontWeight: 700 }}>
                      {noSignalFault ? "0xFE NO SIGNAL!" : dca.signalPresent ? `SIGNAL ${dca.signalDb} dBFS` : `MUTED (${dca.signalDb} dBFS)`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CAMERA PRESETS + DUAL CANVAS SCENES */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
              PTZ CAMERAS & DUAL-CANVAS (16:9 + 9:16)
            </span>
            <span className="mono" style={{ fontSize: 11, color: "#60A5FA" }}>
              16:9: {state.obsScene} • 9:16: {state.verticalScene}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {state.cameras.map((cam) => {
              const active = cam.id === state.activeCameraPresetId;
              return (
                <button
                  key={cam.id}
                  type="button"
                  className="btn"
                  onClick={() => onRecallCamera(cam.id)}
                  style={{
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 12px",
                    background: active ? "#2563EB" : "#1C222D",
                    borderColor: active ? "#60A5FA" : "#2E3746",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Video size={15} />
                    {cam.name}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: active ? "#DBEAFE" : "#9CA3AF" }}>
                    {active ? "PGM" : cam.protocol.split(" ")[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* MULTI-BROADCAST (YOUTUBE + FACEBOOK + MULTI-CHAPTER RECORD) */}
        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
                MULTI-BROADCAST & OBS 33 AUTO-CHAPTERS ({state.recordChapters.length})
              </span>
              <span className="mono" style={{ fontSize: 12, color: anyLive ? "#F87171" : "#9CA3AF" }}>
                {anyLive ? "ON AIR" : "STANDBY"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
              {state.broadcasts.map((b) => (
                <div
                  key={b.id}
                  style={{
                    padding: "9px 11px",
                    borderRadius: 10,
                    background: b.live ? "rgba(239,68,68,0.14)" : "#1C222D",
                    border: `1px solid ${b.live ? "#EF4444" : "#2A3241"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{b.platform}</span>
                    <Radio size={14} color={b.live ? "#EF4444" : "#6B7280"} />
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: b.live ? "#FCA5A5" : "#9CA3AF" }}>
                    {b.live ? `LIVE ${fmtDuration(b.elapsedSec)} • ${(b.bitrateKbps / 1000).toFixed(1)}M` : b.canvas}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={() => onBroadcastToggle("all", true)}
              style={{
                height: 46,
                background: anyLive ? "#1C222D" : "#059669",
                borderColor: anyLive ? "#2E3746" : "#10B981",
              }}
            >
              {anyLive ? "All Targets Live" : "Go Live (YT + FB + MKV)"}
            </button>
            <HoldConfirmButton
              label="Hold 1.5s to Stop All Streams"
              disabled={!anyLive}
              onConfirm={() => onBroadcastToggle("all", false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
