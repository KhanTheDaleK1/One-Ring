import React, { useState, useEffect } from "react";
import {
  Plus,
  Tv,
  Eraser,
  ChevronLeft,
  ChevronRight,
  Palette,
  Type,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import type { AppStateSnapshot, SlideCue, SlideTheme } from "../types";
import { LyricImportModal } from "./LyricImportModal";

interface SlidesCanvasViewProps {
  state: AppStateSnapshot;
  onSelectSlide: (slideNumber: number) => void;
  onSlideAction: (action: "prev" | "next" | "clear") => void;
  onImportSong: (songTitle: string, slides: SlideCue[]) => void;
  onUpdateTheme: (theme: SlideTheme) => void;
}

const DEFAULT_THEME: SlideTheme = {
  backgroundType: "gradient",
  backgroundColor: "#0F172A",
  gradientTo: "#1E1B4B",
  backgroundImage: "",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 18,
  textColor: "#FFFFFF",
  lowerThirdBg: "rgba(10, 14, 23, 0.88)",
  lowerThirdAccent: "#3B82F6",
  lowerThirdPosition: "bottom",
};

const FONT_CHOICES = [
  { label: "Inter / Clean Modern", value: "Inter, system-ui, sans-serif" },
  { label: "Montserrat / Worship Bold", value: "'Montserrat', 'Helvetica Neue', sans-serif" },
  { label: "Georgia / Classic Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Courier / Monospace", value: "'JetBrains Mono', monospace" },
  { label: "Impact / Heavy Broadcast", value: "Impact, 'Arial Black', sans-serif" },
];

export const SlidesCanvasView: React.FC<SlidesCanvasViewProps> = ({
  state,
  onSelectSlide,
  onSlideAction,
  onImportSong,
  onUpdateTheme,
}) => {
  const [showImportModal, setShowImportModal] = useState(false);
  const [showThemeEditor, setShowThemeEditor] = useState(false);

  const slides = state.slides.slides || [];
  const currentSlide = slides.find((s) => s.number === state.slides.currentSlide) || slides[0];
  const theme: SlideTheme = { ...DEFAULT_THEME, ...(state.slides.theme || {}) };

  const patchTheme = <K extends keyof SlideTheme>(key: K, val: SlideTheme[K]) => {
    onUpdateTheme({ ...theme, [key]: val });
  };

  // Keyboard arrow navigation when in Slides view (Left/Right or Up/Down)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        onSlideAction("next");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        onSlideAction("prev");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSlideAction]);

  const fohBackgroundStyle =
    theme.backgroundType === "image" && theme.backgroundImage
      ? `url(${theme.backgroundImage}) center/cover no-repeat`
      : theme.backgroundType === "gradient"
      ? `linear-gradient(135deg, ${theme.backgroundColor} 0%, ${theme.gradientTo || "#000000"} 100%)`
      : theme.backgroundColor;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "calc(100vh - 64px)",
        background: "#080B10",
        color: "#F3F4F6",
        padding: 16,
        gap: 14,
        boxSizing: "border-box",
      }}
    >
      {/* Top Controls Strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          padding: "10px 16px",
          background: "#12161F",
          border: "1px solid #1E2533",
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Tv size={18} color="#3B82F6" />
            <strong style={{ fontSize: 16 }}>Presentation & Slides Canvas</strong>
          </div>
          <span style={{ fontSize: 12, color: "#64748B" }}>•</span>
          <span style={{ fontSize: 13, color: "#93C5FD", fontWeight: 600 }}>
            {state.slides.presentationName || "Untitled Presentation"}
          </span>
          <span style={{ fontSize: 11, background: "#1E2533", padding: "2px 8px", borderRadius: 10, color: "#94A3B8" }}>
            {slides.length} slides loaded
          </span>
        </div>

        {/* Look/Theme + Clear + Import */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => window.open(window.location.origin + "/?output=foh", "onering_foh", "popup,width=1280,height=720")}
            title="Open dedicated fullscreen/second-monitor FOH output window"
            style={{
              height: 34,
              padding: "0 10px",
              background: "#0F766E",
              border: "1px solid #14B8A6",
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <ExternalLink size={13} /> FOH Screen
          </button>
          <button
            type="button"
            onClick={() => window.open(window.location.origin + "/?output=lower_third", "onering_lower", "popup,width=1280,height=720")}
            title="Open Lower Thirds Overlay Window"
            style={{
              height: 34,
              padding: "0 10px",
              background: "#4C1D95",
              border: "1px solid #8B5CF6",
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <ExternalLink size={13} /> Lower 3rds
          </button>
          <button
            type="button"
            onClick={() => window.open(window.location.origin + "/?output=stage", "onering_stage", "popup,width=1024,height=600")}
            title="Open Stage Confidence Window"
            style={{
              height: 34,
              padding: "0 10px",
              background: "#92400E",
              border: "1px solid #F59E0B",
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <ExternalLink size={13} /> Stage Screen
          </button>
          <button
            type="button"
            onClick={() => setShowThemeEditor(!showThemeEditor)}
            style={{
              height: 34,
              padding: "0 12px",
              background: showThemeEditor ? "#2563EB" : "#1C222D",
              border: `1px solid ${showThemeEditor ? "#60A5FA" : "#2E3746"}`,
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Palette size={13} /> Edit Background & Font
          </button>

          <button
            type="button"
            onClick={() => onSlideAction("clear")}
            style={{
              height: 34,
              padding: "0 12px",
              background: state.slides.cleared ? "#7F1D1D" : "#1C222D",
              border: `1px solid ${state.slides.cleared ? "#DC2626" : "#2E3746"}`,
              color: state.slides.cleared ? "#FCA5A5" : "#E2E8F0",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Eraser size={13} /> Clear Text
          </button>

          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            style={{
              height: 34,
              padding: "0 14px",
              background: "#2563EB",
              border: "1px solid #3B82F6",
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <Plus size={14} /> Paste & Reflow Lyrics (2 Lines/Slide)
          </button>
        </div>
      </div>

      {/* Collapsible Background & Font Theme Drawer */}
      {showThemeEditor && (
        <div
          style={{
            background: "#111622",
            border: "1px solid #3B82F6",
            borderRadius: 10,
            padding: 16,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <label style={labelStyle}>Background Style</label>
            <select
              style={inputStyle}
              value={theme.backgroundType}
              onChange={(e) => patchTheme("backgroundType", e.target.value as SlideTheme["backgroundType"])}
            >
              <option value="solid">Solid Color</option>
              <option value="gradient">Studio Gradient</option>
              <option value="image">Image / Motion URL</option>
            </select>
          </div>

          {theme.backgroundType === "image" ? (
            <div>
              <label style={labelStyle}>Background Image URL / Path</label>
              <input
                type="text"
                style={inputStyle}
                value={theme.backgroundImage || ""}
                onChange={(e) => patchTheme("backgroundImage", e.target.value)}
                placeholder="https://... or /assets/worship-bg.jpg"
              />
            </div>
          ) : (
            <>
              <div>
                <label style={labelStyle}>Primary Background Color</label>
                <input
                  type="color"
                  style={{ ...inputStyle, padding: 2 }}
                  value={theme.backgroundColor}
                  onChange={(e) => patchTheme("backgroundColor", e.target.value)}
                />
              </div>
              {theme.backgroundType === "gradient" && (
                <div>
                  <label style={labelStyle}>Gradient Accent Color</label>
                  <input
                    type="color"
                    style={{ ...inputStyle, padding: 2 }}
                    value={theme.gradientTo || "#1E1B4B"}
                    onChange={(e) => patchTheme("gradientTo", e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          <div>
            <label style={labelStyle}>Typography / Font</label>
            <select
              style={inputStyle}
              value={theme.fontFamily}
              onChange={(e) => patchTheme("fontFamily", e.target.value)}
            >
              {FONT_CHOICES.map((f) => (
                <option key={f.label} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Text Color & Size ({theme.fontSize}px)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="color"
                style={{ width: 46, height: 34, padding: 2, background: "#0B0E14", border: "1px solid #2B3545", borderRadius: 6 }}
                value={theme.textColor}
                onChange={(e) => patchTheme("textColor", e.target.value)}
              />
              <input
                type="range"
                min={12}
                max={32}
                value={theme.fontSize}
                onChange={(e) => patchTheme("fontSize", Number(e.target.value))}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Lower Thirds Accent Color</label>
            <input
              type="color"
              style={{ ...inputStyle, padding: 2 }}
              value={theme.lowerThirdAccent}
              onChange={(e) => patchTheme("lowerThirdAccent", e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Main Presentation Surface */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 14, flex: 1 }}>
        {/* Left: Slide Grid / Deck */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Active Slide Deck (Click any slide or use ← / → keys)
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => onSlideAction("prev")}
                style={navBtnStyle}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                type="button"
                onClick={() => onSlideAction("next")}
                style={navBtnStyle}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {slides.length === 0 ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#64748B", padding: 40, textAlign: "center" }}>
              <Sparkles size={40} color="#3B82F6" style={{ marginBottom: 12, opacity: 0.7 }} />
              <h4 style={{ margin: 0, color: "#CBD5E1" }}>No Song Slides Loaded Yet</h4>
              <p style={{ fontSize: 13, maxWidth: 420, marginTop: 6 }}>
                Click &quot;Paste & Reflow Lyrics&quot; above to import lyrics and automatically break them into 2 lines per slide.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 10,
                alignContent: "start",
              }}
            >
              {slides.map((s) => {
                const isSelected = s.number === state.slides.currentSlide;
                return (
                  <div
                    key={s.id}
                    onClick={() => onSelectSlide(s.number)}
                    style={{
                      background: isSelected ? "#1E3A8A" : fohBackgroundStyle,
                      border: isSelected ? "2px solid #60A5FA" : "1px solid #283344",
                      borderRadius: 8,
                      padding: 12,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      minHeight: 112,
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: isSelected ? "#3B82F6" : "rgba(15, 23, 42, 0.75)",
                          color: "#FFFFFF",
                          textTransform: "uppercase",
                        }}
                      >
                        {s.section}
                      </span>
                      <span style={{ fontSize: 10, color: "#CBD5E1" }}>#{s.number}</span>
                    </div>

                    <div
                      style={{
                        fontFamily: theme.fontFamily,
                        fontSize: 13,
                        fontWeight: 600,
                        color: theme.textColor,
                        lineHeight: 1.4,
                        whiteSpace: "pre-line",
                        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                      }}
                    >
                      {s.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: 3-Screen Outputs Column (FOH Audience, Broadcast Lower Thirds, Stage Confidence) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 1. FOH Audience Screen Preview */}
          <div style={previewCardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={previewTitleStyle}>1. Audience Screen (FOH)</span>
              <span style={{ fontSize: 10, color: "#10B981", fontWeight: 700 }}>1920×1080 Full</span>
            </div>

            <div
              style={{
                aspectRatio: "16 / 9",
                background: fohBackgroundStyle,
                border: "1px solid #283344",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                textAlign: "center",
              }}
            >
              {state.slides.cleared ? (
                <span style={{ color: "#94A3B8", fontStyle: "italic", fontSize: 12 }}>
                  [Text Cleared — Background Active]
                </span>
              ) : currentSlide ? (
                <div
                  style={{
                    fontFamily: theme.fontFamily,
                    fontSize: theme.fontSize,
                    fontWeight: 700,
                    color: theme.textColor,
                    lineHeight: 1.35,
                    whiteSpace: "pre-line",
                    textShadow: "0 2px 10px rgba(0,0,0,0.85)",
                  }}
                >
                  {currentSlide.text}
                </div>
              ) : (
                <span style={{ color: "#64748B", fontSize: 12 }}>No Active Slide</span>
              )}
            </div>
          </div>

          {/* 2. Broadcast Lower Thirds Overlay Preview */}
          <div style={previewCardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={previewTitleStyle}>2. Livestream Lower Thirds (Alpha / NDI)</span>
              <span style={{ fontSize: 10, color: "#A855F7", fontWeight: 700 }}>Transparent Key</span>
            </div>

            <div
              style={{
                aspectRatio: "16 / 9",
                background:
                  "repeating-conic-gradient(#1a202c 0% 25%, #0f141d 0% 50%) 50% / 16px 16px",
                border: "1px solid #283344",
                borderRadius: 6,
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
              }}
            >
              {!state.slides.cleared && currentSlide ? (
                <div
                  style={{
                    background: theme.lowerThirdBg,
                    borderTop: `3px solid ${theme.lowerThirdAccent}`,
                    padding: "10px 14px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontFamily: theme.fontFamily,
                      fontSize: Math.max(12, Math.round(theme.fontSize * 0.72)),
                      fontWeight: 700,
                      color: theme.textColor,
                      lineHeight: 1.3,
                      whiteSpace: "pre-line",
                    }}
                  >
                    {currentSlide.text}
                  </div>
                </div>
              ) : (
                <div style={{ margin: "auto", fontSize: 11, color: "#64748B", background: "rgba(0,0,0,0.6)", padding: "4px 8px", borderRadius: 4 }}>
                  Lower Thirds Cleared (Live Camera Full)
                </div>
              )}
            </div>
          </div>

          {/* 3. Stage Confidence Display Preview */}
          <div style={previewCardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={previewTitleStyle}>3. Stage Confidence Monitor</span>
              <span style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700 }}>High-Contrast</span>
            </div>

            <div
              style={{
                background: "#000000",
                border: "1px solid #283344",
                borderRadius: 6,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 8,
                minHeight: 118,
              }}
            >
              <div>
                <span style={{ fontSize: 9, color: "#EAB308", fontWeight: 700, textTransform: "uppercase" }}>
                  Current Words:
                </span>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: "#FFFFFF", marginTop: 2, whiteSpace: "pre-line" }}>
                  {state.slides.cleared ? "[CLEARED]" : currentSlide?.text || "—"}
                </div>
              </div>

              <div style={{ borderTop: "1px solid #262626", paddingTop: 6 }}>
                <span style={{ fontSize: 9, color: "#38BDF8", fontWeight: 700, textTransform: "uppercase" }}>
                  Next Words:
                </span>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8", marginTop: 2, whiteSpace: "pre-line" }}>
                  {state.slides.nextText || "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lyric Import Modal */}
      <LyricImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={onImportSong}
      />
    </div>
  );
};

const navBtnStyle: React.CSSProperties = {
  height: 30,
  padding: "0 10px",
  background: "#1C222D",
  border: "1px solid #2E3746",
  color: "#E2E8F0",
  borderRadius: 6,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
};

const previewCardStyle: React.CSSProperties = {
  background: "#0D1117",
  border: "1px solid #1E2533",
  borderRadius: 10,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const previewTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#94A3B8",
  textTransform: "uppercase",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: "#94A3B8",
  marginBottom: 4,
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 34,
  padding: "0 10px",
  background: "#0B0E14",
  border: "1px solid #2B3545",
  borderRadius: 6,
  color: "#FFFFFF",
  fontSize: 12.5,
  boxSizing: "border-box",
};
