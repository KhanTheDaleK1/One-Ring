import React, { useEffect } from "react";
import { Play, Undo2, Volume2, VolumeX, Video, Radio, ChevronLeft, ChevronRight, Eraser } from "lucide-react";
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
      if (tag === "INPUT" || tag === "TEXTAREA") return;
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
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1.2fr", gap: 16, padding: 16, height: "calc(100vh - 64px)" }}>
      {/* LEFT: SERVICE CUE STACK */}
      <div className="card" style={{ display: "flex", flexDirection: "column", padding: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
            SERVICE CUE STACK
          </div>
          <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
            Cue {state.activeCueIndex + 1} / {state.cues.length}
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
                  padding: "12px 14px",
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
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

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            type="button"
            className="btn"
            disabled={!state.canUndo}
            onClick={onUndoCue}
            style={{ height: 64, padding: "0 16px", display: "flex", alignItems: "center", gap: 8 }}
          >
            <Undo2 size={18} />
            Undo
          </button>
          <button
            type="button"
            className="btn"
            disabled={state.activeCueIndex >= state.cues.length - 1}
            onClick={() => onTriggerCue(nextCueIndex)}
            style={{
              flex: 1,
              height: 64,
              background: "#2563EB",
              borderColor: "#3B82F6",
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
              : `GO NEXT: ${nextCue.title} (Space)`}
          </button>
        </div>
      </div>

      {/* RIGHT: SAFE VOLUNTEER CONTROLS */}
      <div style={{ display: "grid", gridTemplateRows: "auto auto auto 1fr", gap: 12, overflowY: "auto" }}>
        {/* FOH SLIDES */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
              FOH SLIDES ({state.slides.app.toUpperCase()})
            </span>
            <span className="mono" style={{ fontSize: 12, color: state.slides.cleared ? "#FBBF24" : "#34D399" }}>
              {state.slides.cleared ? "CLEARED" : `Slide ${state.slides.currentSlide}/${state.slides.totalSlides}`}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
            {state.slides.presentationName}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
            <button type="button" className="btn" onClick={() => onSlideAction("prev")} style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <ChevronLeft size={18} /> Prev Slide
            </button>
            <button type="button" className="btn" onClick={() => onSlideAction("next")} style={{ height: 48, background: "#1E3A8A", borderColor: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              Next Slide <ChevronRight size={18} />
            </button>
            <button type="button" className="btn" onClick={() => onSlideAction("clear")} style={{ height: 48, padding: "0 14px", display: "flex", alignItems: "center", gap: 6 }}>
              <Eraser size={16} /> {state.slides.cleared ? "Restore" : "Clear"}
            </button>
          </div>
        </div>

        {/* AUDIO DCAS */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF", marginBottom: 10 }}>
            AUDIO DCAs (SAFE MUTES & ±3 dB TRIM)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {state.dcas.map((dca) => (
              <div
                key={dca.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "#1C222D",
                  border: `1px solid ${dca.muted ? "#7F1D1D" : "#252C38"}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (dca.guardMute && !dca.muted) return;
                    onToggleDcaMute(dca.id);
                  }}
                  title={dca.guardMute && !dca.muted ? "Main LR Mute locked in Show Mode (use Engineer Mode)" : "Toggle Mute"}
                  className="btn"
                  style={{
                    height: 40,
                    padding: "0 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: dca.muted ? "#7F1D1D" : "#065F46",
                    borderColor: dca.muted ? "#EF4444" : "#10B981",
                  }}
                >
                  {dca.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  <span>{dca.name}</span>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button type="button" className="btn" onClick={() => onNudgeDca(dca.id, -1)} style={{ height: 34, width: 32 }}>-</button>
                  <span className="mono" style={{ width: 46, textAlign: "center", fontSize: 12 }}>
                    {dca.levelDb > 0 ? `+${dca.levelDb}` : dca.levelDb}dB
                  </span>
                  <button type="button" className="btn" onClick={() => onNudgeDca(dca.id, 1)} style={{ height: 34, width: 32 }}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CAMERA PRESETS */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
              CAMERA PRESETS (TAP TO SWITCH)
            </span>
            <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
              OBS Scene: {state.obsScene}
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
                    height: 46,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: active ? "#2563EB" : "#1C222D",
                    borderColor: active ? "#60A5FA" : "#2E3746",
                  }}
                >
                  <Video size={16} />
                  {cam.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* MULTI-BROADCAST (YOUTUBE + FACEBOOK + RECORD) */}
        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#9CA3AF" }}>
                MULTI-BROADCAST (YOUTUBE + FACEBOOK + RECORD)
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
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: b.live ? "rgba(239,68,68,0.14)" : "#1C222D",
                    border: `1px solid ${b.live ? "#EF4444" : "#2A3241"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{b.platform}</span>
                    <Radio size={14} color={b.live ? "#EF4444" : "#6B7280"} />
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: b.live ? "#FCA5A5" : "#9CA3AF" }}>
                    {b.live ? `LIVE ${fmtDuration(b.elapsedSec)} • ${(b.bitrateKbps / 1000).toFixed(1)}M` : "Offline"}
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
                height: 48,
                background: anyLive ? "#1C222D" : "#059669",
                borderColor: anyLive ? "#2E3746" : "#10B981",
              }}
            >
              {anyLive ? "All Targets Live" : "Go Live (YT + FB + Rec)"}
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
