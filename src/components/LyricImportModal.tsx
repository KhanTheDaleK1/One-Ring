import React, { useState } from "react";
import { FileText, X, Plus } from "lucide-react";
import type { SlideCue } from "../types";

interface LyricImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (songTitle: string, slides: SlideCue[]) => void;
}

export const LyricImportModal: React.FC<LyricImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [songTitle, setSongTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [linesPerSlide, setLinesPerSlide] = useState(2);
  const [sectionTag, setSectionTag] = useState("Verse 1");

  if (!isOpen) return null;

  // Process text into slides based on lines per slide and auto-detected section tags
  const generatePreview = (): SlideCue[] => {
    if (!rawText.trim()) return [];

    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const slides: SlideCue[] = [];
    let currentLines: string[] = [];
    let slideNumber = 1;
    let currentSection = sectionTag;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const sectionMatch =
        line.match(/^\[(.*)\]$/) ||
        line.match(/^(Verse\s*\d*|Chorus|Pre-Chorus|Bridge|Tag|Intro|Outro|Ending):?$/i);
      if (sectionMatch) {
        if (currentLines.length > 0) {
          slides.push({
            id: `slide-${slideNumber}`,
            number: slideNumber,
            section: currentSection,
            title: `${currentSection} - Slide ${slides.length + 1}`,
            text: currentLines.join("\n"),
            kind: "lyrics",
          });
          slideNumber++;
          currentLines = [];
        }
        currentSection = (sectionMatch[1] || sectionMatch[0]).replace(/[:\[\]]/g, "").trim();
        continue;
      }

      currentLines.push(line);

      if (currentLines.length >= linesPerSlide) {
        slides.push({
          id: `slide-${slideNumber}`,
          number: slideNumber,
          section: currentSection,
          title: `${currentSection} - Slide ${slides.length + 1}`,
          text: currentLines.join("\n"),
          kind: "lyrics",
        });
        slideNumber++;
        currentLines = [];
      }
    }

    if (currentLines.length > 0) {
      slides.push({
        id: `slide-${slideNumber}`,
        number: slideNumber,
        section: currentSection,
        title: `${currentSection} - Slide ${slides.length + 1}`,
        text: currentLines.join("\n"),
        kind: "lyrics",
      });
    }

    return slides;
  };

  const previewSlides = generatePreview();

  const handleApply = () => {
    if (previewSlides.length === 0) return;
    const title = songTitle.trim() || "Imported Worship Song";
    onImport(title, previewSlides);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(8, 11, 16, 0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10001,
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          maxHeight: "88vh",
          background: "#121721",
          border: "1px solid #2E3748",
          borderRadius: 14,
          padding: 24,
          color: "#E2E8F0",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 20px 50px rgba(0,0,0,0.65)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "rgba(59, 130, 246, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(59, 130, 246, 0.3)",
              }}
            >
              <FileText size={20} color="#60A5FA" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#FFFFFF" }}>
                Import Lyrics & Reflow Slides
              </h3>
              <p style={{ margin: "2px 0 0", color: "#94A3B8", fontSize: 12 }}>
                Paste lyrics directly from CCLI, Google Docs, or text files. Preview scrolls cleanly inside the box.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Title and Lines Per Slide Config */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12, flexShrink: 0 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 4 }}>
              Song / Presentation Title
            </label>
            <input
              type="text"
              value={songTitle}
              onChange={(e) => setSongTitle(e.target.value)}
              placeholder="e.g. Goodness of God"
              style={{
                width: "100%",
                height: 38,
                padding: "0 12px",
                background: "#0B0E14",
                border: "1px solid #2B3545",
                borderRadius: 6,
                color: "#FFFFFF",
                fontSize: 13,
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 4 }}>
              Lines Per Slide
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {[1, 2, 3, 4].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setLinesPerSlide(num)}
                  style={{
                    height: 38,
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    background: linesPerSlide === num ? "#2563EB" : "#1E2533",
                    border: `1px solid ${linesPerSlide === num ? "#60A5FA" : "#2E3748"}`,
                    color: linesPerSlide === num ? "#FFFFFF" : "#94A3B8",
                  }}
                >
                  {num}L
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Editor & Bounded Scroll Preview */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Raw Text Area */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8", flexShrink: 0 }}>
              Paste Lyrics Here (section tags like [Verse 1], [Chorus] auto-split):
            </span>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={"[Verse 1]\nI love You, Lord\nFor Your mercy never fails me\nAll my days, I've been held in Your hands\n\n[Chorus]\nAnd all my life You have been faithful\nAnd all my life You have been so, so good"}
              style={{
                flex: 1,
                minHeight: 220,
                padding: 12,
                background: "#0B0E14",
                border: "1px solid #2B3545",
                borderRadius: 8,
                color: "#E2E8F0",
                fontSize: 13,
                fontFamily: "monospace",
                lineHeight: 1.5,
                resize: "none",
                outline: "none",
                overflowY: "auto",
              }}
            />
          </div>

          {/* Bounded Live Reflowed Slide Preview */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8" }}>
                Reflowed Slides Preview ({previewSlides.length} slides):
              </span>
              <span style={{ fontSize: 11, color: "#60A5FA" }}>
                {linesPerSlide} lines/slide
              </span>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 220,
                overflowY: "auto",
                background: "#080B10",
                border: "1px solid #1E2533",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {previewSlides.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#64748B", fontSize: 13 }}>
                  Paste lyrics on the left to see your {linesPerSlide}-line slide layout.
                </div>
              ) : (
                previewSlides.map((slide, idx) => (
                  <div
                    key={slide.id}
                    style={{
                      background: "#161B24",
                      border: "1px solid #283344",
                      borderRadius: 6,
                      padding: "8px 12px",
                      flexShrink: 0,
                      wordBreak: "break-word",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#60A5FA",
                        textTransform: "uppercase",
                      }}
                    >
                      Slide {idx + 1} • {slide.section}
                    </span>
                    <div
                      style={{
                        whiteSpace: "pre-line",
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#FFFFFF",
                        marginTop: 3,
                        lineHeight: 1.4,
                      }}
                    >
                      {slide.text}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 16px",
              background: "#1E2533",
              border: "1px solid #2E3748",
              color: "#CBD5E1",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={previewSlides.length === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 20px",
              background: previewSlides.length > 0 ? "#2563EB" : "#1E293B",
              border: `1px solid ${previewSlides.length > 0 ? "#3B82F6" : "#334155"}`,
              color: previewSlides.length > 0 ? "#FFFFFF" : "#64748B",
              borderRadius: 6,
              cursor: previewSlides.length > 0 ? "pointer" : "not-allowed",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <Plus size={15} />
            Import {previewSlides.length} Slides ({linesPerSlide} lines/slide)
          </button>
        </div>
      </div>
    </div>
  );
};
