import React, { useEffect, useState, useRef, useCallback } from "react";
import { Play, RadioTower, Music, Search, BookOpen, Zap, Settings, Phone, Sliders, Camera, ArrowLeft, ArrowRight, Trash2, Eye, EyeOff, Minus, Layout, Plus, LogOut, X, Shield, MicOff, AlarmClock, Music2 } from "lucide-react";

import "../styles/mobile.css";
import type { AppStateSnapshot, SlideCue } from "../types";

interface MobileAppShellProps {
  state: AppStateSnapshot | null;
  onSelectSlide: (slideNumber: number) => void;
  onSlideAction: (action: "prev" | "next" | "clear") => void;
  onSelectSong: (songId: string) => void;
  onImportSong: (title: string, importedSlides: SlideCue[]) => void;
  onOpenSongSearch: () => void;
  onOpenBible: () => void;
  onOpenAi: () => void;
  onOpenSettings: () => void;
  onTriggerPtz: (cameraIndex: number) => void;
  onToggleMute: (dcaId: string) => void;
  onSetPhase: (phase: "pre-service" | "worship" | "welcome" | "sermon" | "closing") => void;
  onSetStageMessage: (message: string) => void;
  onToggleStageMessageVisible: () => void;
}

/**
 * Mobile-feeling one-handed shell for One Ring.
 * - Single-row top bar with wordmark + status pill + AI + Settings buttons
 * - Fixed bottom nav with 4 icon+label tabs: Live | Slides | Booth | Remote
 */
export const MobileAppShell: React.FC<MobileAppShellProps> = ({
  state,
  onSelectSlide,
  onSlideAction,
  onSelectSong,
  onImportSong,
  onOpenSongSearch,
  onOpenBible,
  onOpenAi,
  onOpenSettings,
  onTriggerPtz,
  onToggleMute,
  onSetPhase,
  onSetStageMessage,
  onToggleStageMessageVisible,
}) => {
  const [mode, setMode] = useState<"live" | "slides" | "booth" | "remote">("live");
  const [phase, setPhase] = useState<
    | "pre-service"
    | "worship"
    | "welcome"
    | "sermon"
    | "closing"
    | "none"
  >("none");
  const [stageMessage, setStageMessage] = useState<string>("");
  const [stageMessageVisible, setStageMessageVisible] = useState<boolean>(false);

  // Service phase pills bar
  const phases = [
    { key: "pre-service", label: "Pre-Service", icon: Play },
    { key: "worship", label: "Worship", icon: Music },
    { key: "welcome", label: "Welcome", icon: AlarmClock },
    { key: "sermon", label: "Sermon", icon: X }, // using X as placeholder for sermon
    { key: "closing", label: "Closing", icon: Plus },
  ];

  // Determine current phase label
  const currentPhaseLabel = phases.find((p) => p.key === phase)?.label ?? "none";

  // Phase color helpers
  const phaseColor = (p: string) => {
    switch (p) {
      case "pre-service":
        return "#94A3B8";
      case "worship":
        return "#60A5FA";
      case "welcome":
        return "#F59E0B";
      case "sermon":
        return "#3B82F6";
      case "closing":
        return "#10B981";
      default:
        return "#94A3B8";
    }
  };
  const phaseBackground = (p: string) => {
    switch (p) {
      case "pre-service":
        return "rgba(96, 165, 250, 0.08)";
      case "worship":
        return "rgba(96, 165, 250, 0.14)";
      case "welcome":
        return "rgba(245, 158, 11, 0.08)";
      case "sermon":
        return "rgba(37, 99, 235, 0.08)";
      case "closing":
        return "rgba(16, 185, 129, 0.08)";
      default:
        return "rgba(96, 165, 250, 0.08)";
    }
  };
  const phaseBorder = (p: string) => {
    switch (p) {
      case "pre-service":
        return "rgba(96, 165, 250, 0.2)";
      case "worship":
        return "rgba(96, 165, 250, 0.2)";
      case "welcome":
        return "rgba(245, 158, 11, 0.2)";
      case "sermon":
        return "rgba(37, 99, 235, 0.2)";
      case "closing":
        return "rgba(16, 185, 129, 0.2)";
      default:
        return "rgba(96, 165, 250, 0.2)";
    }
  };

  // Bottom nav tab handlers
  const handleLive = useCallback(() => setMode("live"), []);
  const handleSlides = useCallback(() => setMode("slides"), []);
  const handleBooth = useCallback(() => setMode("booth"), []);
  const handleRemote = useCallback(() => setMode("remote"), []);

  // Live mode content
  if (mode === "live") {
    return (
      <div style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* Mobile Top Bar */}
        <header
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            padding: "0 max(env(safe-area-inset-left, 0px), 0px)",
            paddingTop: "max(env(safe-area-inset-top, 0px), 36px)",
            background: "#090C12",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            zIndex: 100,
            minHeight: 64,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="wordmark-mobile">One Ring</div>
            <span
              className={`pill-mobile ${isPaired() ? "pill-paired" : "pill-local"}`}
            >
              {isPaired() ? "PAIRED" : "LOCAL"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className="btn btn-primary-mobile"
              onClick={onOpenAi}
              title="Open AI Assistant"
            >
              <Zap size={20} />
            </button>
            <button
              type="button"
              className="btn btn-secondary-mobile"
              onClick={onOpenSettings}
              title="Open Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* Live content area */}
        <main
          style={{
            marginTop: 64,
            marginBottom: "calc(92px + env(safe-area-inset-bottom, 0px))",
            padding: "0 16px",
            boxSizing: "border-box",
          }}
        >
          {/* Service Phase Pills */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {phases.map((p) => (
              <span
                key={p.key}
                className="phase-pill-mobile"
                style={{
                  color: phaseColor(p.key),
                  background: phaseBackground(p.key),
                  borderColor: phaseBorder(p.key),
                }}
              >
                {p.label}
              </span>
            ))}
          </div>

          {/* Now/Next live slide stage monitor */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 12,
              marginBottom: 16,
              padding: 12,
              background: "#111622",
              borderRadius: 12,
              border: "1px solid #2A3241",
            }}
          >
            <div style={{ textAlign: "center", minWidth: 56 }}>
              <strong>Now</strong>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                {state?.slides.currentSlide || 1}
              </div>
            </div>
            <div>
              <strong>{state?.slides.presentationName || "Service"}</strong>
              <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>
                {state?.slides.currentText?.slice(0, 30) || "—"}
              </div>
            </div>
            <div style={{ textAlign: "right", minWidth: 56 }}>
              <strong>Next</strong>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                {state?.slides.nextText ? state.slides.nextText.slice(0, 30) : "—"}
              </div>
            </div>
          </div>

          {/* Prev & Next thumb transport buttons (56px) */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className="btn btn-danger-mobile"
              onClick={() => onSlideAction("prev")}
              style={{
                width: 56,
                height: 56,
                padding: 0,
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn-primary-mobile"
              onClick={() => onSlideAction("next")}
              style={{
                width: 56,
                height: 56,
                padding: 0,
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              Next
            </button>
          </div>

          {/* Clear Text + Blackout row */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className="btn btn-clear-mobile"
              onClick={() => onSlideAction("clear")}
              style={{
                flex: 1,
                height: 48,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Clear Text
            </button>
            <button
              type="button"
              className="btn btn-blackout-mobile"
              onClick={() => onSetStageMessage("")}
              style={{
                flex: 1,
                height: 48,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {state?.slides.screen.black ? "Unblackout" : "Blackout Stage"}
            </button>
          </div>

          {/* Compact Stage Alert bar */}
          {stageMessageVisible && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 10px",
                borderRadius: 8,
                background: "rgba(251, 191, 38, 0.12)",
                border: "1px solid rgba(251, 191, 38, 0.3)",
                color: "#FBBF24",
                fontSize: 12,
                fontWeight: 500,
                marginBottom: 16,
                minHeight: 24,
              }}
            >
              <span>{stageMessage}</span>
              <button
                type="button"
                style={{
                  marginLeft: 8,
                  background: "transparent",
                  border: "none",
                  color: "#FBBF24",
                  fontSize: 12,
                  padding: 0,
                  cursor: "pointer",
                }}
                onClick={onToggleStageMessageVisible}
              >
                ✕
              </button>
            </div>
          )}
        </main>
      </div>
    );
  }

  // Slides mode content
  if (mode === "slides") {
    // Song grid items from state
    const songs = state?.slides.songs || [];
    const activeSongId = state?.slides.activeSongId;
    const activeSong = songs.find((s) => s.id === activeSongId);

    return (
      <div style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* Mobile Top Bar */}
        <header
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            padding: "0 max(env(safe-area-inset-left, 0px), 0px)",
            paddingTop: "max(env(safe-area-inset-top, 0px), 36px)",
            background: "#090C12",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            zIndex: 100,
            minHeight: 64,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="wordmark-mobile">One Ring</div>
            <span
              className={`pill-mobile ${isPaired() ? "pill-paired" : "pill-local"}`}
            >
              {isPaired() ? "PAIRED" : "LOCAL"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className="btn btn-primary-mobile"
              onClick={onOpenAi}
              title="Open AI Assistant"
            >
              <Zap size={20} />
            </button>
            <button
              type="button"
              className="btn btn-secondary-mobile"
              onClick={onOpenSettings}
              title="Open Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <main
          style={{
            marginTop: 64,
            marginBottom: "calc(92px + env(safe-area-inset-bottom, 0px))",
            padding: "0 16px",
            boxSizing: "border-box",
          }}
        >
          {/* Top action row: Search Songs + Bible Lookup */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn btn-secondary-mobile"
              onClick={onOpenSongSearch}
              style={{
                height: 40,
                padding: "0 12px",
                fontSize: 12,
              }}
            >
              <Search size={16} /> Search Songs
            </button>
            <button
              type="button"
              className="btn btn-secondary-mobile"
              onClick={onOpenBible}
              style={{
                height: 40,
                padding: "0 12px",
                fontSize: 12,
              }}
            >
              <BookOpen size={16} /> Bible Lookup
            </button>
          </div>

          {/* Vertical Service Set List */}
          <div style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 12, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Service Set
            </strong>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {phases.map((p) => (
                <span
                  key={p.key}
                  className="phase-pill-mobile"
                  style={{
                    color: phaseColor(p.key),
                    background: phaseBackground(p.key),
                    borderColor: phaseBorder(p.key),
                  }}
                >
                  {p.label}
                </span>
              ))}
            </div>
          </div>

          {/* 2-column touch slide grid for active song */}
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 12, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {activeSong ? `${activeSong.title} — Song Slides` : "No Song Selected"}
            </strong>
            <div
              className="slide-grid-mobile"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
                gap: 8,
                marginTop: 6,
              }}
            >
              {/* Home row: Now slide */}
              <div
                className={`slide-tile-mobile ${state?.slides.currentSlide === 1 ? "selected" : ""}`}
                onClick={() => onSelectSlide(1)}
                style={{
                  borderColor: state?.slides.currentSlide === 1 ? "#60A5FA" : "#2A3241",
                  background: state?.slides.currentSlide === 1 ? "rgba(96, 165, 250, 0.18)" : "#1A2233",
                }}
              >
                <strong>1</strong>
                <div>{state?.slides.currentText?.slice(0, 20) || "—"}</div>
              </div>

              {/* Other song slides */}
              {activeSong?.slides.map((slideText, i) => {
                const slideNum = i + 2; // starting from 2 after "now"
                return (
                  <div
                    key={slideNum}
                    className="slide-tile-mobile"
                    onClick={() => onSelectSlide(slideNum)}
                    style={{
                      borderColor: activeSongId && activeSong.slides[i] ? "#60A5FA" : "#2A3241",
                      background:
                        activeSongId && activeSong.slides[i]
                          ? "rgba(96, 165, 250, 0.18)"
                          : "#1A2233",
                    }}
                  >
                    <strong>{slideNum}</strong>
                    <div>{(typeof slideText === "string" ? slideText : (slideText as SlideCue)?.text || "").slice(0, 15) || "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Booth mode content
  if (mode === "booth") {
    return (
      <div style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* Mobile Top Bar */}
        <header
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            padding: "0 max(env(safe-area-inset-left, 0px), 0px)",
            paddingTop: "max(env(safe-area-inset-top, 0px), 36px)",
            background: "#090C12",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            zIndex: 100,
            minHeight: 64,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="wordmark-mobile">One Ring</div>
            <span
              className={`pill-mobile ${isPaired() ? "pill-paired" : "pill-local"}`}
            >
              {isPaired() ? "PAIRED" : "LOCAL"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className="btn btn-primary-mobile"
              onClick={onOpenAi}
              title="Open AI Assistant"
            >
              <Zap size={20} />
            </button>
            <button
              type="button"
              className="btn btn-secondary-mobile"
              onClick={onOpenSettings}
              title="Open Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <main
          style={{
            marginTop: 64,
            marginBottom: "calc(92px + env(safe-area-inset-bottom, 0px))",
            padding: "0 16px",
            boxSizing: "border-box",
          }}
        >
          {/* 3-way segmented control */}
          <div style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 12, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Booth Controls
            </strong>
            <div style={{ display: "flex", gap: 8, marginTop: 8, borderRadius: 8, overflow: "hidden" }}>
              {/* Audio segment */}
              <button
                type="button"
                className="tab-mobile"
                onClick={() => {}}
                style={{
                  background: "#1A2233",
                  borderColor: "#2A3241",
                  color: "#94A3B8",
                  flex: 1,
                  padding: "10px 8px",
                }}
              >
                <Sliders size={16} /> Audio
              </button>

              {/* PTZ segment */}
              <button
                type="button"
                className="tab-mobile"
                onClick={() => {}}
                style={{
                  background: "#1A2233",
                  borderColor: "#2A3241",
                  color: "#94A3B8",
                  flex: 1,
                  padding: "10px 8px",
                }}
              >
                <Camera size={16} /> PTZ
              </button>

              {/* Switcher segment */}
              <button
                type="button"
                className="tab-mobile"
                onClick={() => {}}
                style={{
                  background: "#1A2233",
                  borderColor: "#2A3241",
                  color: "#94A3B8",
                  flex: 1,
                  padding: "10px 8px",
                }}
              >
                <Layout size={16} /> Switcher
              </button>
            </div>
          </div>

          {/* Audio controls (channel mute & fader controls) */}
          <div style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 12, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Audio Mix
            </strong>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {/* Mock channel mutes */}
              {[1, 2, 3, 4].map((ch) => (
                <div key={ch} style={{ display: "flex", gap: 8 }}>
                  <span style={{ width: 32, fontSize: 12, color: "#94A3B8" }}>Ch {ch}</span>
                  <button
                    type="button"
                    className="btn btn-secondary-mobile"
                    style={{ flex: 1, height: 32, padding: "0 6px", fontSize: 11 }}
                    onClick={() => onToggleMute(`dca_${ch}`)}
                  >
                    Mute
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* PTZ controls: large camera preset pads + Preview-Only badge */}
          <div style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 12, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Camera Presets
            </strong>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="ptz-preset-mobile"
                  onClick={() => onTriggerPtz(i - 1)}
                  style={{
                    borderColor: state?.cameras?.[i - 1] ? "#60A5FA" : "#2A3241",
                    background:
                      state?.cameras?.[i - 1]
                        ? "rgba(96, 165, 250, 0.18)"
                        : "#1A2233",
                  }}
                >
                  <strong>Preset {i}</strong>
                  <span
                    className="badge-preview-mobile"
                    style={{ fontSize: 10, marginLeft: 4 }}
                  >
                    Preview-Only
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Switcher: Program/Preview input pads + CUT/AUTO */}
          <div style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 12, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Video Switcher
            </strong>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="switcher-pad-mobile"
                  style={{ flex: 1 }}
                >
                  Program
                </button>
                <button
                  type="button"
                  className="switcher-pad-mobile active"
                  style={{ flex: 1 }}
                >
                  Preview
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary-mobile"
                  style={{ flex: 1, height: 40, padding: "0 12px", fontSize: 13 }}
                >
                  CUT
                </button>
                <button
                  type="button"
                  className="btn btn-secondary-mobile"
                  style={{ flex: 1, height: 40, padding: "0 12px", fontSize: 13 }}
                >
                  AUTO
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Remote mode content
  if (mode === "remote") {
    return (
      <div style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* Mobile Top Bar */}
        <header
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            padding: "0 max(env(safe-area-inset-left, 0px), 0px)",
            paddingTop: "max(env(safe-area-inset-top, 0px), 36px)",
            background: "#090C12",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            zIndex: 100,
            minHeight: 64,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="wordmark-mobile">One Ring</div>
            <span
              className={`pill-mobile ${isPaired() ? "pill-paired" : "pill-local"}`}
            >
              {isPaired() ? "PAIRED" : "LOCAL"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className="btn btn-primary-mobile"
              onClick={onOpenAi}
              title="Open AI Assistant"
            >
              <Zap size={20} />
            </button>
            <button
              type="button"
              className="btn btn-secondary-mobile"
              onClick={onOpenSettings}
              title="Open Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <main
          style={{
            marginTop: 64,
            marginBottom: "calc(92px + env(safe-area-inset-bottom, 0px))",
            padding: "0 16px",
            boxSizing: "border-box",
          }}
        >
          {/* Remote control view - phone pairs with desktop booth PC */}
          <RemoteControlViewStateful
            state={state}
            onSelectSlide={onSelectSlide}
            onSlideAction={onSlideAction}
            onSelectSong={onSelectSong}
            onImportSong={onImportSong}
          />
        </main>
      </div>
    );
  }

  return null;
};

/**
 * Helper: check if paired with desktop booth
 */
const isPaired = (): boolean => {
  try {
    const savedIp = localStorage.getItem("onering_remote_ip");
    const savedToken = localStorage.getItem("onering_remote_token");
    return !!(savedIp && savedToken);
  } catch {
    return false;
  }
};

/** -------------------------------------------------------------------------
 * RemoteControlViewStateful - wraps RemoteControlView with proper prop wiring
 * ------------------------------------------------------------------------- */
interface RemoteControlViewStatefulProps {
  state: any;
  onSelectSlide: (slideNumber: number) => void;
  onSlideAction: (action: "prev" | "next" | "clear") => void;
  onSelectSong: (songId: string) => void;
  onImportSong: (title: string, importedSlides: SlideCue[]) => void;
}
const RemoteControlViewStateful: React.FC<RemoteControlViewStatefulProps> = ({
  state,
  onSelectSlide,
  onSlideAction,
  onSelectSong,
  onImportSong,
}) => {
  // We render a simplified remote that wires up the key actions
  const [mode, setMode] = useState<"pairing" | "remote">("pairing");

  useEffect(() => {
    try {
      const savedIp = localStorage.getItem("onering_remote_ip");
      const savedToken = localStorage.getItem("onering_remote_token");
      if (savedIp && savedToken) {
        setMode("remote");
      }
    } catch {
      setMode("pairing");
    }
  }, []);

  const connectToDesktop = async () => {
    // Would need IP and code from user - simplified for now
    window.alert("Pairing functionality would connect to desktop booth PC");
  };

  if (mode === "pairing") {
    return (
      <div
        style={{
          padding: 24,
          maxWidth: 400,
          margin: "0 auto",
          border: "1px solid #2A3241",
          borderRadius: 12,
          background: "#0B0D10",
          color: "#F3F4F6",
        }}
      >
        <h2 style={{ margin: "-8px 0 16px", fontSize: 20, color: "#FBBF24" }}>
          Connect to Booth
        </h2>
        <p style={{ marginBottom: 16, color: "#6B7280", fontSize: 13 }}>
          Enter the desktop booth IP address and your 6-digit pairing code to connect.
        </p>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 6, color: "#D1D5DB", fontSize: 12 }}>
            Desktop IP Address
          </label>
          <input
            style={{
              width: "100%",
              height: 34,
              padding: "0 10px",
              borderRadius: 6,
              background: "#0E1320",
              color: "#F3F4F6",
              border: "1px solid #2E3746",
              fontSize: 13,
            }}
            placeholder="192.168.1.50"
            aria-label="Desktop IP address"
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 6, color: "#D1D5DB", fontSize: 12 }}>
            6-Digit Pairing Code
          </label>
          <input
            style={{
              width: "100%",
              height: 34,
              padding: "0 10px",
              borderRadius: 6,
              background: "#0E1320",
              color: "#F3F4F6",
              border: "1px solid #2E3746",
              fontSize: 13,
            }}
            maxLength={6}
            aria-label="6-digit pairing code"
            placeholder="123456"
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 6, color: "#D1D5DB", fontSize: 12 }}>
            Device Name
          </label>
          <input
            style={{
              width: "100%",
              height: 34,
              padding: "0 10px",
              borderRadius: 6,
              background: "#0E1320",
              color: "#F3F4F6",
              border: "1px solid #2E3746",
              fontSize: 13,
            }}
            aria-label="Device name"
            placeholder="My Phone"
          />
        </div>

        <button
          type="button"
          style={{
            width: "100%",
            height: 40,
            padding: "0 16px",
            fontSize: 13,
            background: "#3B82F6",
            borderColor: "#60A5FA",
            color: "white",
          }}
          onClick={connectToDesktop}
        >
          Connect to Desktop Booth
        </button>
      </div>
    );
  }

  // Full remote mode - simplified controls
  return (
    <div
      style={{
        padding: 24,
        maxWidth: 800,
        margin: "0 auto",
        border: "1px solid #2A3241",
        borderRadius: 12,
        background: "#0B0D10",
        color: "#F3F4F6",
      }}
    >
      <h2 style={{ margin: "-8px 0 16px", fontSize: 20, color: "#FBBF24" }}>
        Remote Control
      </h2>
      <p style={{ marginBottom: 12, color: "#6B7280", fontSize: 13 }}>
        Connected to booth display — use the controls below to manage the presentation.
      </p>

      <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
        {/* Slide Navigation */}
        <div>
          <button
            type="button"
            onClick={() => onSlideAction("prev")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: "#3B82F6",
              borderColor: "#60A5FA",
              color: "white",
            }}
            disabled={state?.slides.currentSlide <= 1}
          >
            <ArrowLeft size={18} /> Prev Slide
          </button>
          <button
            type="button"
            onClick={() => onSlideAction("next")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: "#3B82F6",
              borderColor: "#60A5FA",
              color: "white",
            }}
          >
            Next Slide <ArrowRight size={18} />
          </button>
        </div>

        {/* Slide Actions */}
        <div>
          <button
            type="button"
            onClick={() => onSlideAction("clear")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: "#7F1D1D",
              borderColor: "#EF4444",
              color: "#F87171",
            }}
          >
            <X size={14} /> Clear Text
          </button>
          <button
            type="button"
            onClick={() => ((_m: string) => {})("")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: state?.slides?.screen?.black ? "#7F1D1D" : "#3A0F0F",
              borderColor: state?.slides?.screen?.black ? "#EF4444" : "#9F7AFF",
              color: state?.slides?.screen?.black ? "#F87171" : "#F472B6",
            }}
          >
            {state?.slides?.screen?.black ? "Unblackout" : "Blackout Stage"}
          </button>
        </div>

        {/* Streaming Controls */}
        <div>
          <button
            type="button"
            onClick={() => ((_m: string) => {})("stream_start")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: "#0F2F1F",
              borderColor: "#10B981",
              color: "#D1F2EB",
            }}
          >
            <Eye size={14} /> Stream Start
          </button>
          <button
            type="button"
            onClick={() => ((_m: string) => {})("stream_stop")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: "#7F1D1D",
              borderColor: "#EF4444",
              color: "#F87171",
            }}
          >
            <EyeOff size={14} /> Stream Stop
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
        <button
          type="button"
          onClick={() => setMode("pairing")}
          style={{
            flex: 1,
            height: 40,
            padding: "0 12px",
            fontSize: 12,
            background: "#7F1D1D",
            borderColor: "#EF4444",
            color: "#F87171",
          }}
        >
          <Zap size={14} /> Disconnect
        </button>
      </div>
    </div>
  );
};
