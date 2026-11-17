import React, { useState } from "react";
import {
  FileText,
  Plus,
  Tv,
  Eraser,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  Sliders,
  Sparkles,
} from "lucide-react";
import type { AppStateSnapshot, SlideCue } from "../types";
import { LyricImportModal } from "./LyricImportModal";

interface SlidesCanvasViewProps {
  state: AppStateSnapshot;
  onSelectSlide: (slideNumber: number) => void;
  onSlideAction: (action: "prev" | "next" | "clear") => void;
  onImportSong: (songTitle: string, slides: SlideCue[]) => void;
}

export const SlidesCanvasView: React.FC<SlidesCanvasViewProps> = ({
  state,
  onSelectSlide,
  onSlideAction,
  onImportSong,
}) => {
  const [showImportModal, setShowImportModal] = useState(false);

  const slides = state.slides.slides || [];
  const currentSlide = slides.find((s) => s.number === state.slides.currentSlide) || slides[0];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 64px)",
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

        {/* Clear Group Buttons (ProPresenter style) & Import Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

      {/* Main Presentation Surface */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, flex: 1, minHeight: 0 }}>
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
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Active Slide Deck
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => onSlideAction("prev")}
                style={{
                  height: 30,
                  padding: "0 10px",
                  background: "#161B24",
                  border: "1px solid #283344",
                  borderRadius: 6,
                  color: "#E2E8F0",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                }}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                type="button"
                onClick={() => onSlideAction("next")}
                style={{
                  height: 30,
                  padding: "0 10px",
                  background: "#161B24",
                  border: "1px solid #283344",
                  borderRadius: 6,
                  color: "#E2E8F0",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                }}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {slides.length === 0 ? (
            <div
              style={{
                flex: 1,
                border: "2px dashed #222C3D",
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 32,
                textAlign: "center",
                gap: 12,
              }}
            >
              <FileText size={40} color="#475569" />
              <div>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>No Slides Loaded</h4>
                <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: 13, maxWidth: 360 }}>
                  Start by pasting worship song lyrics or importing sermon scriptures. We'll automatically break them into 2 lines per slide.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                style={{
                  marginTop: 6,
                  height: 38,
                  padding: "0 16px",
                  background: "#2563EB",
                  border: "1px solid #3B82F6",
                  color: "#FFFFFF",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Plus size={15} /> Paste Lyrics Now
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
                alignContent: "start",
              }}
            >
              {slides.map((s, idx) => {
                const isSelected = s.number === state.slides.currentSlide;
                return (
                  <div
                    key={s.id}
                    onClick={() => onSelectSlide(s.number)}
                    style={{
                      aspectRatio: "16 / 9",
                      background: isSelected ? "#0F2137" : "#131822",
                      border: isSelected ? "2px solid #3B82F6" : "1px solid #232D3F",
                      borderRadius: 8,
                      padding: 10,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      position: "relative",
                      transition: "all 0.15s ease",
                      boxShadow: isSelected ? "0 0 14px rgba(59, 130, 246, 0.3)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: isSelected ? "#60A5FA" : "#64748B",
                          textTransform: "uppercase",
                        }}
                      >
                        #{idx + 1} • {s.section}
                      </span>
                      {isSelected && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            background: "#2563EB",
                            color: "#FFFFFF",
                            padding: "1px 5px",
                            borderRadius: 4,
                          }}
                        >
                          LIVE
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: 12,
                        fontWeight: 600,
                        color: isSelected ? "#FFFFFF" : "#CBD5E1",
                        lineHeight: 1.4,
                        whiteSpace: "pre-line",
                      }}
                    >
                      {s.text}
                    </div>
                    <div style={{ fontSize: 9, color: "#475569" }}>
                      FOH / Stage Sync
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Live Output & Confidence Monitor Preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* FOH Audience Screen Preview */}
          <div
            style={{
              background: "#0D1117",
              border: "1px solid #1E2533",
              borderRadius: 10,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
                Audience Screen (FOH)
              </span>
              <span style={{ fontSize: 10, color: "#10B981", fontWeight: 700 }}>
                1920×1080 60Hz
              </span>
            </div>

            <div
              style={{
                aspectRatio: "16 / 9",
                background: "#05070B",
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
                <span style={{ color: "#475569", fontStyle: "italic", fontSize: 13 }}>
                  [Text Cleared / Background Only]
                </span>
              ) : currentSlide ? (
                <div style={{ fontSize: 16, fontWeight: 700, color: "#FFFFFF", lineHeight: 1.4, whiteSpace: "pre-line" }}>
                  {currentSlide.text}
                </div>
              ) : (
                <span style={{ color: "#475569", fontSize: 12 }}>No Active Slide</span>
              )}
            </div>
          </div>

          {/* Stage Confidence Display Preview */}
          <div
            style={{
              background: "#0D1117",
              border: "1px solid #1E2533",
              borderRadius: 10,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              flex: 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
                Stage Confidence Monitor
              </span>
              <span style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700 }}>
                High-Contrast
              </span>
            </div>

            <div
              style={{
                flex: 1,
                background: "#000000",
                border: "1px solid #283344",
                borderRadius: 6,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              {/* Top: Current Lyric */}
              <div>
                <span style={{ fontSize: 9, color: "#EAB308", fontWeight: 700, textTransform: "uppercase" }}>
                  Current Words:
                </span>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#FFFFFF", marginTop: 2, whiteSpace: "pre-line" }}>
                  {state.slides.cleared ? "[CLEARED]" : currentSlide?.text || "—"}
                </div>
              </div>

              {/* Bottom: Next Lyric Preview */}
              <div style={{ borderTop: "1px solid #262626", paddingTop: 8 }}>
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
