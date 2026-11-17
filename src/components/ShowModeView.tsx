import React, { useEffect, useMemo, useRef, useState } from "react";
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
  AlertTriangle,
  Lock,
  ShieldCheck,
  Timer,
  Pause,
  RotateCcw,
  Monitor,
  Wifi,
  Presentation,
} from "lucide-react";
import type { AppStateSnapshot, DcaChannel, SlideCue, SlideKind } from "../types";
import { HoldConfirmButton } from "./HoldConfirmButton";

interface ShowModeViewProps {
  state: AppStateSnapshot;
  onTriggerCue: (index: number) => void;
  onUndoCue: () => void;
  onToggleDcaMute: (dcaId: string) => void;
  onNudgeDca: (dcaId: string, deltaDb: number) => void;
  onRecallCamera: (presetId: string) => void;
  onSlideAction: (action: "prev" | "next" | "clear") => void;
  onSelectSlide: (slideNumber: number) => void;
  onBroadcastToggle: (targetId: string, live: boolean) => void;
}

const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const fmtDb = (db: number) => (db > 0 ? `+${db}` : `${db}`);

const isPastorDca = (dca: DcaChannel) =>
  dca.id === "dca-1" || /pastor/i.test(dca.name);

const slideKindTone = (kind: SlideKind) => {
  switch (kind) {
    case "title":
      return "#60A5FA";
    case "scripture":
      return "#FBBF24";
    case "media":
      return "#A78BFA";
    default:
      return "#34D399";
  }
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: "#9CA3AF",
};

export const ShowModeView: React.FC<ShowModeViewProps> = ({
  state,
  onTriggerCue,
  onUndoCue,
  onToggleDcaMute,
  onNudgeDca,
  onRecallCamera,
  onSlideAction,
  onSelectSlide,
  onBroadcastToggle,
}) => {
  const nextCueIndex = Math.min(state.cues.length - 1, state.activeCueIndex + 1);
  const nextCue = state.cues[nextCueIndex];
  const anyLive = state.broadcasts.some((b) => b.live);
  const lastGoRef = useRef(0);
  const [pendingMute, setPendingMute] = useState<DcaChannel | null>(null);
  const [stageSeconds, setStageSeconds] = useState(0);
  const [stageRunning, setStageRunning] = useState(false);

  const slideItems: SlideCue[] = useMemo(() => {
    if (state.slides.slides && state.slides.slides.length > 0) {
      return state.slides.slides;
    }
    const total = Math.max(1, state.slides.totalSlides);
    const current = state.slides.currentSlide;
    return Array.from({ length: total }, (_, index) => {
      const number = index + 1;
      return {
        id: `fallback-slide-${number}`,
        number,
        section: number === current ? "LIVE" : number === current + 1 ? "NEXT" : "SLIDE",
        title: `Slide ${number}`,
        text:
          number === current
            ? state.slides.currentText
            : number === current + 1
            ? state.slides.nextText
            : `Slide ${number} is ready.`,
        kind: "media" as const,
      };
    });
  }, [state.slides]);

  const currentSlide =
    slideItems[Math.max(0, Math.min(slideItems.length - 1, state.slides.currentSlide - 1))] ??
    slideItems[0];
  const nextSlide = slideItems[state.slides.currentSlide] ?? null;
  const activeProgram = state.broadcasts.find((b) => b.live);
  const programElapsed = Math.max(0, ...state.broadcasts.map((b) => b.elapsedSec));

  useEffect(() => {
    if (!stageRunning) return;
    const id = window.setInterval(() => setStageSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(id);
  }, [stageRunning]);

  const goNextCue = () => {
    const now = performance.now();
    if (now - lastGoRef.current < 400) return;
    lastGoRef.current = now;
    if (state.activeCueIndex < state.cues.length - 1) {
      onTriggerCue(state.activeCueIndex + 1);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }

      if (pendingMute) {
        if (e.key === "Escape") {
          e.preventDefault();
          setPendingMute(null);
        }
        return;
      }

      if (e.code === "Space" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        goNextCue();
      } else if (e.code === "ArrowRight" || e.code === "PageDown") {
        e.preventDefault();
        onSlideAction("next");
      } else if (e.code === "ArrowLeft" || e.code === "PageUp") {
        e.preventDefault();
        onSlideAction("prev");
      } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        if (state.canUndo) onUndoCue();
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const digit = /^Digit([1-8])$/.exec(e.code);
        if (digit) {
          const camera = state.cameras[Number(digit[1]) - 1];
          if (camera) onRecallCamera(camera.id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    pendingMute,
    state.activeCueIndex,
    state.cues.length,
    state.canUndo,
    state.cameras,
    onTriggerCue,
    onUndoCue,
    onSlideAction,
    onRecallCamera,
  ]);

  const requestDcaToggle = (dca: DcaChannel) => {
    if (dca.guardMute && !dca.muted) return;
    if (isPastorDca(dca) && !dca.muted) {
      setPendingMute(dca);
      return;
    }
    onToggleDcaMute(dca.id);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr) minmax(0, 0.92fr)",
        gap: 16,
        padding: 16,
        minHeight: "calc(100vh - 64px)",
        alignItems: "stretch",
      }}
    >
      {/* LEFT: SERVICE CUE STACK + TRANSACTIONAL VERIFICATION */}
      <div
        className="card"
        style={{ display: "flex", flexDirection: "column", padding: 16, overflow: "hidden", minHeight: 0 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={sectionLabelStyle}>
            SERVICE CUE STACK {state.rehearsalMode ? "(REHEARSAL / DRY-RUN)" : ""}
          </div>
          <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
            Cue {state.activeCueIndex + 1} / {state.cues.length} • Undo {state.undoDepth}
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "grid", gap: 8, paddingRight: 4 }}>
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
                  background: isActive
                    ? "rgba(59,130,246,0.14)"
                    : isNext
                    ? "rgba(16,185,129,0.08)"
                    : "#1C222D",
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
              <span
                className="mono"
                style={{ fontSize: 11, fontWeight: 700, color: "#34D399", display: "flex", alignItems: "center", gap: 6 }}
              >
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
            title={state.lastUndoLabel ? `Revert ${state.lastUndoLabel}` : "Nothing to undo (Cmd/Ctrl+Z)"}
            style={{ height: 72, padding: "0 16px", display: "flex", alignItems: "center", gap: 8 }}
          >
            <Undo2 size={18} />
            <span>Undo ({state.undoDepth})</span>
          </button>
          <button
            type="button"
            className="btn"
            disabled={state.activeCueIndex >= state.cues.length - 1}
            onClick={goNextCue}
            style={{
              flex: 1,
              height: 72,
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

      {/* CENTER: SAFE VOLUNTEER CONTROLS */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflowY: "auto", paddingRight: 2 }}>
        {/* LIVE WORSHIP SLIDE GRID */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={sectionLabelStyle}>LIVE WORSHIP SLIDES</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  borderRadius: 999,
                  color: "#93C5FD",
                  background: "rgba(59,130,246,0.12)",
                  border: "1px solid #1D4ED8",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Presentation size={11} /> {state.slides.app.toUpperCase()}
              </span>
              <span className="mono" style={{ fontSize: 11, color: state.slides.cleared ? "#FBBF24" : "#34D399" }}>
                {state.slides.cleared
                  ? "CLEARED"
                  : `${state.slides.currentSlide} / ${state.slides.totalSlides}`}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {state.slides.presentationName}
              </div>
              <div className="mono" style={{ fontSize: 10, color: "#9CA3AF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {state.slides.playlistName} • {state.slides.stageMessage}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 7px",
                borderRadius: 8,
                border: "1px solid #2A3241",
                background: "#0F141C",
                flexShrink: 0,
              }}
            >
              <Timer size={13} color="#9CA3AF" />
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, minWidth: 44, textAlign: "center" }}>
                {fmtDuration(stageSeconds)}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setStageRunning((running) => !running)}
                title={stageRunning ? "Pause stage timer" : "Start stage timer"}
                aria-label={stageRunning ? "Pause stage timer" : "Start stage timer"}
                style={{ height: 30, width: 30, padding: 0, display: "grid", placeItems: "center" }}
              >
                {stageRunning ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStageRunning(false);
                  setStageSeconds(0);
                }}
                title="Reset stage timer"
                aria-label="Reset stage timer"
                style={{ height: 30, width: 30, padding: 0, display: "grid", placeItems: "center" }}
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 7,
              maxHeight: 236,
              overflowY: "auto",
              padding: 2,
              opacity: state.slides.cleared ? 0.48 : 1,
              transition: "opacity 0.15s ease",
            }}
          >
            {slideItems.map((slide, index) => {
              const isCurrent = slide.number === state.slides.currentSlide;
              const isNext = slide.number === state.slides.currentSlide + 1;
              const isPast = slide.number < state.slides.currentSlide;
              const tone = slideKindTone(slide.kind);
              return (
                <button
                  key={slide.id}
                  type="button"
                  className="slide-tile"
                  onClick={() => onSelectSlide(slide.number)}
                  title={`Go to slide ${slide.number}: ${slide.section} — ${slide.text}`}
                  aria-current={isCurrent ? "true" : undefined}
                  style={{
                    minHeight: 66,
                    textAlign: "left",
                    padding: "6px 7px",
                    borderRadius: 8,
                    cursor: "pointer",
                    border: isCurrent
                      ? "1px solid #3B82F6"
                      : isNext
                      ? "1px solid #10B981"
                      : "1px solid #2A3241",
                    background: isCurrent
                      ? "rgba(59,130,246,0.18)"
                      : isNext
                      ? "rgba(16,185,129,0.10)"
                      : "#171D27",
                    color: "#F3F4F6",
                    opacity: isPast && !isCurrent ? 0.55 : 1,
                    boxShadow: isCurrent ? "0 0 0 1px rgba(59,130,246,0.35)" : "none",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      bottom: 0,
                      width: 3,
                      background: tone,
                      opacity: isCurrent || isNext ? 1 : 0.45,
                    }}
                  />
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, paddingLeft: 3 }}>
                    <span className="mono" style={{ fontSize: 9, color: tone, fontWeight: 700, letterSpacing: "0.04em" }}>
                      {slide.section.toUpperCase()}
                    </span>
                    <span className="mono" style={{ fontSize: 9, color: isCurrent ? "#93C5FD" : "#6B7280" }}>
                      {isCurrent ? "LIVE" : isNext ? "NEXT" : String(index + 1).padStart(2, "0")}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: 1.25,
                      paddingLeft: 3,
                      marginTop: 5,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {slide.text}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn"
              disabled={state.slides.currentSlide <= 1}
              onClick={() => onSlideAction("prev")}
              style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <ChevronLeft size={18} /> Prev
            </button>
            <button
              type="button"
              className="btn"
              disabled={state.slides.currentSlide >= state.slides.totalSlides}
              onClick={() => onSlideAction("next")}
              style={{
                height: 48,
                background: "#1E3A8A",
                borderColor: "#2563EB",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              Next <ChevronRight size={18} />
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onSlideAction("clear")}
              style={{
                height: 48,
                padding: "0 13px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                borderColor: state.slides.cleared ? "#F59E0B" : "#2E3746",
                background: state.slides.cleared ? "rgba(245,158,11,0.16)" : "#1C222D",
              }}
            >
              <Eraser size={16} /> {state.slides.cleared ? "Restore" : "Blank"}
            </button>
          </div>

          <div
            className="mono"
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 8,
              fontSize: 10,
              color: "#9CA3AF",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <strong style={{ color: "#60A5FA" }}>NOW:</strong> {currentSlide?.text ?? "No live slide"}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
              <strong style={{ color: "#34D399" }}>NEXT:</strong> {nextSlide?.text ?? "End of presentation"}
            </span>
          </div>
        </div>

        {/* AUDIO DCAS: SAFE MUTES + CLAMPED TRIM */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={sectionLabelStyle}>AUDIO DCAs · SAFE MUTES &amp; ±3 dB TRIM</span>
            <span className="mono" style={{ fontSize: 10, color: "#34D399", display: "flex", alignItems: "center", gap: 4 }}>
              <ShieldCheck size={13} /> CLAMPED
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {state.dcas.map((dca) => {
              const noSignalFault = !dca.muted && !dca.signalPresent;
              const locked = dca.guardMute && !dca.muted;
              const pastorLive = isPastorDca(dca) && !dca.muted;
              return (
                <div
                  key={dca.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "8px 9px",
                    borderRadius: 10,
                    background: "#1C222D",
                    border: `1px solid ${noSignalFault ? "#EF4444" : dca.muted ? "#7F1D1D" : "#252C38"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => requestDcaToggle(dca)}
                      disabled={locked}
                      aria-disabled={locked}
                      aria-pressed={dca.muted}
                      title={
                        locked
                          ? "Main LR is locked in Show Mode — use Engineer Mode"
                          : pastorLive
                          ? "Pastor mic is live — two-step confirmation required to mute"
                          : dca.muted
                          ? "Unmute"
                          : "Mute"
                      }
                      className="btn"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: 40,
                        padding: "0 8px",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: locked
                          ? "#111720"
                          : dca.muted
                          ? "#7F1D1D"
                          : noSignalFault
                          ? "#991B1B"
                          : "#065F46",
                        borderColor: locked
                          ? "#374151"
                          : dca.muted
                          ? "#EF4444"
                          : noSignalFault
                          ? "#EF4444"
                          : "#10B981",
                        color: locked ? "#6B7280" : "#F3F4F6",
                      }}
                    >
                      {locked ? (
                        <Lock size={14} />
                      ) : dca.muted ? (
                        <VolumeX size={15} />
                      ) : (
                        <Volume2 size={15} />
                      )}
                      <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {dca.name}
                      </span>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={dca.levelDb <= dca.minDb}
                        onClick={() => onNudgeDca(dca.id, -3)}
                        title={`Trim down 3 dB (safe min ${fmtDb(dca.minDb)} dB)`}
                        aria-label={`${dca.name} trim down 3 decibels`}
                        style={{ height: 36, width: 36, padding: 0, fontSize: 11 }}
                      >
                        −3
                      </button>
                      <span
                        className="mono"
                        style={{ width: 43, textAlign: "center", fontSize: 11, color: dca.levelDb !== 0 ? "#FBBF24" : "#D1D5DB" }}
                      >
                        {fmtDb(dca.levelDb)}dB
                      </span>
                      <button
                        type="button"
                        className="btn"
                        disabled={dca.levelDb >= dca.maxDb}
                        onClick={() => onNudgeDca(dca.id, 3)}
                        title={`Trim up 3 dB (safe max ${fmtDb(dca.maxDb)} dB)`}
                        aria-label={`${dca.name} trim up 3 decibels`}
                        style={{ height: 36, width: 36, padding: 0, fontSize: 11 }}
                      >
                        +3
                      </button>
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 4,
                      fontSize: 9,
                      color: noSignalFault ? "#FCA5A5" : "#9CA3AF",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {dca.danteTxChannel}
                    </span>
                    <span
                      style={{
                        color: noSignalFault ? "#EF4444" : dca.signalPresent ? "#34D399" : "#6B7280",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {locked
                        ? "ENGINEER LOCK"
                        : pastorLive
                        ? "2-STEP MUTE"
                        : noSignalFault
                        ? "NO SIGNAL!"
                        : dca.signalPresent
                        ? `${dca.signalDb} dBFS`
                        : "MUTED"}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: "#636E7E" }}>
                    Safe range {fmtDb(dca.minDb)} to {fmtDb(dca.maxDb)} dB
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ONE-TAP CAMERA PRESETS */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={sectionLabelStyle}>CAMERA PRESETS · TAP TO CUT</span>
            <span className="mono" style={{ fontSize: 10, color: "#60A5FA" }}>
              16:9 {state.obsScene} • 9:16 {state.verticalScene}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {state.cameras.map((cam, index) => {
              const active = cam.id === state.activeCameraPresetId;
              const preview = cam.tally === "preview";
              return (
                <button
                  key={cam.id}
                  type="button"
                  className="btn"
                  onClick={() => onRecallCamera(cam.id)}
                  aria-pressed={active}
                  title={`Recall ${cam.name} (keyboard ${index + 1})`}
                  style={{
                    height: 50,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    padding: "0 10px",
                    background: active
                      ? "rgba(239,68,68,0.16)"
                      : preview
                      ? "rgba(16,185,129,0.12)"
                      : "#1C222D",
                    borderColor: active ? "#EF4444" : preview ? "#10B981" : "#2E3746",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <span
                      className="mono"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                        background: active ? "#EF4444" : "#0B0D10",
                        color: active ? "#FFF" : "#9CA3AF",
                        border: `1px solid ${active ? "#FCA5A5" : "#2A3241"}`,
                      }}
                    >
                      {index + 1}
                    </span>
                    <Video size={14} color={active ? "#FCA5A5" : "#9CA3AF"} />
                    <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {cam.name.replace(/^\d+:\s*/, "")}
                    </span>
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      flexShrink: 0,
                      color: active ? "#FCA5A5" : preview ? "#6EE7B7" : "#6B7280",
                    }}
                  >
                    {active ? "PGM" : preview ? "PVW" : "READY"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT: BROADCAST MONITOR + GUARDED STREAM CONTROLS */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
            <span style={sectionLabelStyle}>LIVE PROGRAM MONITOR</span>
            <span
              className="mono"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 999,
                color: anyLive ? "#FCA5A5" : "#9CA3AF",
                background: anyLive ? "rgba(239,68,68,0.18)" : "#1C222D",
                border: `1px solid ${anyLive ? "#EF4444" : "#2A3241"}`,
              }}
            >
              {anyLive ? `ON AIR ${fmtDuration(programElapsed)}` : "STANDBY"}
            </span>
          </div>

          <div
            style={{
              position: "relative",
              aspectRatio: "16 / 9",
              borderRadius: 10,
              overflow: "hidden",
              border: `1px solid ${anyLive ? "#7F1D1D" : "#2A3241"}`,
              background:
                "radial-gradient(circle at 35% 38%, rgba(59,130,246,0.30), transparent 30%), radial-gradient(circle at 72% 65%, rgba(16,185,129,0.18), transparent 34%), linear-gradient(135deg, #101722 0%, #0B0D10 70%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0.2,
                backgroundImage:
                  "linear-gradient(rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.16) 1px, transparent 1px)",
                backgroundSize: "32px 32px",
                pointerEvents: "none",
              }}
            />
            <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 5 }}>
              <span
                className="mono"
                style={{
                  fontSize: 9,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: anyLive ? "#DC2626" : "#1C222D",
                  color: anyLive ? "#FFF" : "#9CA3AF",
                  fontWeight: 700,
                }}
              >
                {anyLive ? "● LIVE" : "PROGRAM"}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 9,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(11,13,16,0.78)",
                  border: "1px solid #2A3241",
                  color: "#9CA3AF",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <Wifi size={9} /> NDI 120ms
              </span>
            </div>
            <div style={{ textAlign: "center", padding: 18, zIndex: 1 }}>
              <Monitor size={26} color={anyLive ? "#FCA5A5" : "#60A5FA"} style={{ marginBottom: 6 }} />
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#F3F5F8",
                  maxWidth: 230,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {state.obsScene}
              </div>
              <div className="mono" style={{ fontSize: 10, color: "#9AA5B4", marginTop: 3 }}>
                {activeProgram
                  ? `${activeProgram.platform.split(" (")[0]} • ${(activeProgram.bitrateKbps / 1000).toFixed(1)} Mbps`
                  : "OBS 33 • 1920×1080 @ 60fps"}
              </div>
            </div>
            <div
              className="mono"
              style={{
                position: "absolute",
                left: 8,
                right: 8,
                bottom: 7,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 9,
                color: "#9AA5B4",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                16:9 {state.obsScene}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                9:16 {state.verticalScene}
              </span>
            </div>
          </div>
        </div>

        <div
          className="card"
          style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0, overflowY: "auto" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={sectionLabelStyle}>MULTI-BROADCAST · YT + FB + REC</span>
            <span className="mono" style={{ fontSize: 10, color: anyLive ? "#F87171" : "#9CA3AF" }}>
              {anyLive ? "ON AIR" : "STANDBY"}
            </span>
          </div>

          <div style={{ display: "grid", gap: 7 }}>
            {state.broadcasts.map((b) => (
              <div
                key={b.id}
                style={{
                  padding: "9px 11px",
                  borderRadius: 9,
                  background: b.live ? "rgba(239,68,68,0.14)" : "#1C222D",
                  border: `1px solid ${b.live ? "#EF4444" : "#2A3241"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <Radio size={14} color={b.live ? "#EF4444" : "#6B7280"} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {b.platform.replace(/ \(.+\)$/, "")}
                    </span>
                    <span className="mono" style={{ fontSize: 9, color: "#6B7280" }}>
                      {b.canvas}
                    </span>
                  </span>
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 10, fontWeight: 700, color: b.live ? "#FCA5A5" : "#6B7280", flexShrink: 0 }}
                >
                  {b.live ? `LIVE ${fmtDuration(b.elapsedSec)} • ${(b.bitrateKbps / 1000).toFixed(1)}M` : "OFFLINE"}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto", display: "grid", gap: 9 }}>
            <button
              type="button"
              className="btn"
              onClick={() => onBroadcastToggle("all", true)}
              disabled={anyLive}
              style={{
                height: 48,
                background: anyLive ? "#1C222D" : "#059669",
                borderColor: anyLive ? "#2E3746" : "#10B981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
              }}
            >
              <Radio size={16} />
              {anyLive ? "All Targets Live" : "Go Live (YT + FB + MKV)"}
            </button>
            <HoldConfirmButton
              label="Hold 1.5s to Stop All Streams"
              disabled={!anyLive}
              onConfirm={() => onBroadcastToggle("all", false)}
            />
            <div
              className="mono"
              style={{ fontSize: 9, color: "#636E7E", display: "flex", alignItems: "center", gap: 4 }}
            >
              <AlertTriangle size={10} /> Tier 3 action: release early to cancel safely.
            </div>
          </div>
        </div>
      </div>

      {/* TIER 2: TWO-STEP CONFIRMATION FOR MUTING AN ACTIVE PASTOR MIC */}
      {pendingMute && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(2,4,8,0.72)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-mute-title"
            className="card"
            style={{ width: "min(540px, 100%)", padding: 20, borderColor: "#7F1D1D", background: "#14181F" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
              <AlertTriangle size={21} color="#F59E0B" />
              <h2 id="confirm-mute-title" style={{ margin: 0, fontSize: 18 }}>
                Confirm high-impact mute
              </h2>
            </div>
            <p style={{ margin: "0 0 10px", color: "#D1D5DB", fontSize: 13, lineHeight: 1.5 }}>
              <strong>{pendingMute.name}</strong> is currently live and may be carrying the sermon feed.
              Muting it removes the pastor from FOH and every broadcast mix.
            </p>
            <div
              className="mono"
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #7F1D1D",
                background: "rgba(239,68,68,0.08)",
                color: "#FCA5A5",
                fontSize: 11,
                marginBottom: 16,
              }}
            >
              TARGET: DCA {pendingMute.number} · {pendingMute.name} · {pendingMute.danteTxChannel}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setPendingMute(null)}
                style={{ height: 44, padding: "0 16px" }}
              >
                Cancel (Esc)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onToggleDcaMute(pendingMute.id);
                  setPendingMute(null);
                }}
                style={{
                  height: 44,
                  padding: "0 16px",
                  background: "#B91C1C",
                  borderColor: "#EF4444",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <VolumeX size={16} /> Mute Pastor Mic
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
