import React, { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FileVideo,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { SlideCue, SlideKind, SlideTheme } from "../types";

export type SlideTransition = "Cut" | "Fade" | "Dissolve" | "Push";
export type SlideAlignment = "left" | "center" | "right";

/** Per-slide presentation overrides. Extra fields survive the JSON workspace sync at runtime. */
export interface SlideExtras {
  transition: SlideTransition;
  alignment: SlideAlignment;
  offsetX: number;
  offsetY: number;
  fontSize?: number;
  fontWeight: number;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadowBlur: number;
  shadowColor: string;
  motionBackground: string;
}

export type EditableSlide = SlideCue & SlideExtras;

export const DEFAULT_SLIDE_EXTRAS: SlideExtras = {
  transition: "Fade",
  alignment: "center",
  offsetX: 0,
  offsetY: 0,
  fontWeight: 700,
  textColor: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidth: 2,
  shadowBlur: 18,
  shadowColor: "rgba(0, 0, 0, 0.85)",
  motionBackground: "",
};

export const SLIDE_TRANSITIONS: SlideTransition[] = ["Cut", "Fade", "Dissolve", "Push"];

/** Fill in missing override fields when reading slides produced by older import paths. */
export function toEditableSlide(source: Partial<EditableSlide> & Partial<SlideCue>): EditableSlide {
  return {
    ...DEFAULT_SLIDE_EXTRAS,
    id: source.id || `slide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    number: source.number || 1,
    section: source.section || "Song",
    title: source.title || "Untitled Slide",
    text: source.text || "",
    kind: source.kind || "lyrics",
    ...source,
  };
}

export function toEditableSlides(slides: Array<Partial<EditableSlide> | SlideCue>): EditableSlide[] {
  return slides.map((slide, index) =>
    toEditableSlide({ ...slide, number: slide.number || index + 1 })
  );
}

/** True when a theme background points at a looping motion source rather than a still image. */
export function isVideoBackground(source?: string): boolean {
  const value = (source || "").trim().toLowerCase().split(/[?#]/)[0];
  return (
    value.startsWith("data:video/") ||
    value.endsWith(".mp4") ||
    value.endsWith(".webm") ||
    value.endsWith(".mov")
  );
}

/** Text styling shared by the editor canvas and the full-screen output. */
export function editableSlideTextStyle(
  slide: Partial<EditableSlide> | undefined,
  theme: Pick<SlideTheme, "fontFamily" | "fontSize" | "textColor">,
  scale = 1
): React.CSSProperties {
  const fontSize = Math.round((slide?.fontSize ?? Math.max(14, theme.fontSize * 2.4)) * scale);
  const outlineWidth = slide?.outlineWidth ?? 0;
  const shadowBlur = slide?.shadowBlur ?? 0;
  return {
    fontFamily: theme.fontFamily,
    fontSize,
    fontWeight: slide?.fontWeight ?? 700,
    color: slide?.textColor || theme.textColor,
    textAlign: slide?.alignment || "center",
    lineHeight: 1.28,
    whiteSpace: "pre-line",
    WebkitTextStroke: outlineWidth > 0 ? `${outlineWidth}px ${slide?.outlineColor || "#000000"}` : undefined,
    paintOrder: "stroke fill",
    textShadow: shadowBlur > 0 ? `0 ${Math.round(shadowBlur / 3)}px ${shadowBlur}px ${slide?.shadowColor || "rgba(0,0,0,0.85)"}` : undefined,
  } as React.CSSProperties;
}

export function slideTransitionMs(slide: Partial<EditableSlide> | undefined): number {
  switch (slide?.transition) {
    case "Cut":
      return 0;
    case "Dissolve":
      return 900;
    case "Push":
      return 520;
    case "Fade":
    default:
      return 420;
  }
}

interface SlideEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  songTitle: string;
  slides: Array<SlideCue | EditableSlide>;
  theme: SlideTheme;
  initialIndex?: number;
  onApply: (title: string, slides: EditableSlide[], theme: SlideTheme) => void;
}

const sectionStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 800,
  color: "#94A3B8",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 5,
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0B1018",
  border: "1px solid #2A3546",
  borderRadius: 6,
  color: "#F1F5F9",
  fontSize: 12,
  padding: "7px 9px",
};

const toolButtonStyle: React.CSSProperties = {
  background: "#18202C",
  border: "1px solid #2A3546",
  borderRadius: 6,
  color: "#CBD5E1",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  fontSize: 11,
  fontWeight: 700,
  height: 29,
  padding: "0 8px",
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const SlideEditorModal: React.FC<SlideEditorModalProps> = ({
  isOpen,
  onClose,
  songTitle,
  slides,
  theme,
  initialIndex = 0,
  onApply,
}) => {
  const [draftTitle, setDraftTitle] = useState(songTitle);
  const [draftSlides, setDraftSlides] = useState<EditableSlide[]>(() => toEditableSlides(slides));
  const [draftTheme, setDraftTheme] = useState<SlideTheme>(theme);
  const [selectedId, setSelectedId] = useState<string>(slides[initialIndex]?.id || "");
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const motionFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const normalized = toEditableSlides(slides);
    setDraftTitle(songTitle);
    setDraftSlides(normalized);
    setDraftTheme(theme);
    setSelectedId(normalized[clamp(initialIndex, 0, Math.max(0, normalized.length - 1))]?.id || "");
  }, [isOpen, songTitle, initialIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selectedIndex = Math.max(
    0,
    draftSlides.findIndex((slide) => slide.id === selectedId)
  );
  const selected = draftSlides[selectedIndex];

  const updateSelected = (patch: Partial<EditableSlide>) => {
    if (!selected) return;
    setDraftSlides((prev) =>
      prev.map((slide) => (slide.id === selected.id ? { ...slide, ...patch } : slide))
    );
  };

  const renumber = (list: EditableSlide[]): EditableSlide[] =>
    list.map((slide, index) => ({ ...slide, number: index + 1 }));

  const addSlide = () => {
    const base = selected || draftSlides[draftSlides.length - 1];
    const created = toEditableSlide({
      ...DEFAULT_SLIDE_EXTRAS,
      ...(base || {}),
      id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      number: draftSlides.length + 1,
      section: "Slide",
      title: `${draftTitle || "Song"} - ${draftSlides.length + 1}`,
      text: "",
      motionBackground: base?.motionBackground || "",
    });
    setDraftSlides((prev) => {
      const next = [...prev];
      next.splice(selectedIndex + 1, 0, created);
      return renumber(next);
    });
    setSelectedId(created.id);
  };

  const duplicateSlide = () => {
    if (!selected) return;
    const copy = toEditableSlide({
      ...selected,
      id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      number: selected.number + 1,
      title: `${selected.title} (copy)`,
    });
    setDraftSlides((prev) => {
      const next = [...prev];
      next.splice(selectedIndex + 1, 0, copy);
      return renumber(next);
    });
    setSelectedId(copy.id);
  };

  const moveSelected = (direction: -1 | 1) => {
    setDraftSlides((prev) => {
      const target = selectedIndex + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(selectedIndex, 1);
      next.splice(target, 0, item);
      return renumber(next);
    });
  };

  const deleteSelected = () => {
    if (!selected) return;
    const next = draftSlides.filter((slide) => slide.id !== selected.id);
    setDraftSlides(renumber(next));
    setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id || "");
  };

  const setMotionBackground = (source: string) => {
    updateSelected({ motionBackground: source });
    setDraftTheme((prev) =>
      source
        ? { ...prev, backgroundType: "image", backgroundImage: source }
        : { ...prev, backgroundImage: "" }
    );
  };

  const loadMotionFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setMotionBackground(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selected || event.button !== 0) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: selected.offsetX,
      offsetY: selected.offsetY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    updateSelected({
      offsetX: clamp(Math.round(drag.offsetX + ((event.clientX - drag.x) / rect.width) * 100), -45, 45),
      offsetY: clamp(Math.round(drag.offsetY + ((event.clientY - drag.y) / rect.height) * 100), -40, 40),
    });
  };

  const onCanvasPointerUp = () => {
    dragRef.current = null;
  };

  const canvasBackground = draftTheme.backgroundImage
    ? `url(${draftTheme.backgroundImage}) center/cover no-repeat`
    : draftTheme.backgroundType === "gradient"
    ? `linear-gradient(135deg, ${draftTheme.backgroundColor} 0%, ${draftTheme.gradientTo || "#1E1B4B"} 100%)`
    : draftTheme.backgroundColor;
  const canvasVideo = isVideoBackground(selected?.motionBackground)
    ? selected?.motionBackground
    : isVideoBackground(draftTheme.backgroundImage)
    ? draftTheme.backgroundImage
    : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Slide and Theme Editor"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(3, 6, 12, 0.86)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "min(1480px, 100%)",
          height: "min(940px, 100%)",
          background: "#0D121B",
          border: "1px solid #334155",
          borderRadius: 12,
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid #1E293B",
            background: "#121927",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <strong style={{ fontSize: 14, color: "#E2E8F0" }}>Slide &amp; Theme Editor</strong>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Deck / song title"
              style={{ ...fieldStyle, width: "min(260px, 100%)" }}
            />
            <span style={{ fontSize: 11, color: "#64748B" }}>
              {draftSlides.length} slide{draftSlides.length === 1 ? "" : "s"}
            </span>
          </div>
          <button type="button" onClick={onClose} style={toolButtonStyle} title="Close without applying">
            <X size={14} /> Close
          </button>
        </div>

        {/* Work area */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "minmax(160px, 210px) minmax(0, 1fr) minmax(220px, 300px)",
            gap: 12,
            padding: 14,
          }}
        >
          {/* Slide strip */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <button type="button" onClick={addSlide} style={toolButtonStyle} title="Add slide">
                <Plus size={13} /> Add
              </button>
              <button type="button" onClick={duplicateSlide} style={toolButtonStyle} title="Duplicate slide" disabled={!selected}>
                <Copy size={12} /> Copy
              </button>
              <button type="button" onClick={() => moveSelected(-1)} style={toolButtonStyle} title="Move slide up" disabled={selectedIndex <= 0}>
                <ArrowUp size={12} />
              </button>
              <button type="button" onClick={() => moveSelected(1)} style={toolButtonStyle} title="Move slide down" disabled={selectedIndex >= draftSlides.length - 1}>
                <ArrowDown size={12} />
              </button>
              <button type="button" onClick={deleteSelected} style={toolButtonStyle} title="Delete slide" disabled={!selected}>
                <Trash2 size={12} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {draftSlides.map((slide, index) => (
                <button
                  type="button"
                  key={slide.id}
                  onClick={() => setSelectedId(slide.id)}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    background: slide.id === selected?.id ? "#1E3A8A" : "#111827",
                    border: `1px solid ${slide.id === selected?.id ? "#60A5FA" : "#263244"}`,
                    borderRadius: 7,
                    padding: "7px 9px",
                    color: "#E2E8F0",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#93C5FD", fontWeight: 800 }}>
                    <span>{slide.section}</span>
                    <span>#{index + 1}</span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {slide.text.replace(/\s+/g, " ").trim() || "(empty slide)"}
                  </div>
                </button>
              ))}
              {draftSlides.length === 0 && (
                <div style={{ fontSize: 12, color: "#64748B", border: "1px dashed #334155", borderRadius: 7, padding: 14, textAlign: "center" }}>
                  No slides yet. Use <strong>Add</strong> to build a new deck.
                </div>
              )}
            </div>
          </div>

          {/* 16:9 WYSIWYG canvas */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>
              Drag the text on the canvas to position it. Double-click to center it again.
            </div>
            <div
              ref={canvasRef}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              onDoubleClick={() => updateSelected({ offsetX: 0, offsetY: 0 })}
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 9",
                maxHeight: "calc(100% - 30px)",
                background: canvasBackground,
                border: "1px solid #3B4A60",
                borderRadius: 10,
                overflow: "hidden",
                cursor: selected ? "grab" : "default",
                touchAction: "none",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
              }}
            >
              {canvasVideo && (
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  src={canvasVideo}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
                  backgroundSize: "10% 10%",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: `calc(50% + ${selected?.offsetX ?? 0}%)`,
                  top: `calc(50% + ${selected?.offsetY ?? 0}%)`,
                  width: "86%",
                  transform: "translate(-50%, -50%)",
                  ...editableSlideTextStyle(selected, draftTheme),
                  pointerEvents: "none",
                }}
              >
                {selected ? selected.text || "Type slide text on the right" : "Add or select a slide"}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  bottom: 10,
                  fontSize: 10,
                  fontWeight: 800,
                  color: "#E2E8F0",
                  background: "rgba(2,6,23,0.7)",
                  borderRadius: 4,
                  padding: "3px 7px",
                }}
              >
                {selected?.section || "—"} · {selected?.transition || "Fade"} · {selected?.alignment || "center"}
              </div>
            </div>
          </div>

          {/* Property panel */}
          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 2, minWidth: 0 }}>
            <div style={{ background: "#111827", border: "1px solid #263244", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={sectionStyle}>Slide Section</label>
                <input style={fieldStyle} value={selected?.section || ""} onChange={(e) => updateSelected({ section: e.target.value })} />
              </div>
              <div>
                <label style={sectionStyle}>Slide Title</label>
                <input style={fieldStyle} value={selected?.title || ""} onChange={(e) => updateSelected({ title: e.target.value })} />
              </div>
              <div>
                <label style={sectionStyle}>Slide Text</label>
                <textarea
                  style={{ ...fieldStyle, minHeight: 92, resize: "vertical", lineHeight: 1.4 }}
                  value={selected?.text || ""}
                  onChange={(e) => updateSelected({ text: e.target.value })}
                  placeholder="Line one&#10;Line two"
                />
              </div>
              <div>
                <label style={sectionStyle}>Transition</label>
                <select
                  style={fieldStyle}
                  value={selected?.transition || "Fade"}
                  onChange={(e) => updateSelected({ transition: e.target.value as SlideTransition })}
                >
                  {SLIDE_TRANSITIONS.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ background: "#111827", border: "1px solid #263244", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={sectionStyle}>Alignment</label>
                <div style={{ display: "flex", gap: 5 }}>
                  {([
                    ["left", AlignLeft],
                    ["center", AlignCenter],
                    ["right", AlignRight],
                  ] as const).map(([value, Icon]) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => updateSelected({ alignment: value })}
                      style={{
                        ...toolButtonStyle,
                        flex: 1,
                        background: (selected?.alignment || "center") === value ? "#2563EB" : "#18202C",
                        borderColor: (selected?.alignment || "center") === value ? "#60A5FA" : "#2A3546",
                      }}
                    >
                      <Icon size={13} /> {value}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={sectionStyle}>Position Offset (X {selected?.offsetX ?? 0}% / Y {selected?.offsetY ?? 0}%)</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="range" min={-45} max={45} value={selected?.offsetX ?? 0} onChange={(e) => updateSelected({ offsetX: Number(e.target.value) })} style={{ flex: 1 }} />
                  <input type="range" min={-40} max={40} value={selected?.offsetY ?? 0} onChange={(e) => updateSelected({ offsetY: Number(e.target.value) })} style={{ flex: 1 }} />
                </div>
              </div>
              <div>
                <label style={sectionStyle}>Font Size ({Math.round(selected?.fontSize ?? draftTheme.fontSize * 2.4)}px)</label>
                <input
                  type="range"
                  min={24}
                  max={160}
                  value={Math.round(selected?.fontSize ?? draftTheme.fontSize * 2.4)}
                  onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={sectionStyle}>Font Weight ({selected?.fontWeight ?? 700})</label>
                <select
                  style={fieldStyle}
                  value={selected?.fontWeight ?? 700}
                  onChange={(e) => updateSelected({ fontWeight: Number(e.target.value) })}
                >
                  <option value={400}>Regular</option>
                  <option value={600}>Semibold</option>
                  <option value={700}>Bold</option>
                  <option value={900}>Heavy</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={sectionStyle}>Text Color</label>
                  <input type="color" style={{ ...fieldStyle, height: 32, padding: 2 }} value={selected?.textColor || "#FFFFFF"} onChange={(e) => updateSelected({ textColor: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={sectionStyle}>Outline</label>
                  <input type="color" style={{ ...fieldStyle, height: 32, padding: 2 }} value={selected?.outlineColor || "#000000"} onChange={(e) => updateSelected({ outlineColor: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={sectionStyle}>Outline Width ({selected?.outlineWidth ?? 0}px)</label>
                <input type="range" min={0} max={8} value={selected?.outlineWidth ?? 0} onChange={(e) => updateSelected({ outlineWidth: Number(e.target.value) })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={sectionStyle}>Drop Shadow ({selected?.shadowBlur ?? 0}px)</label>
                <input type="range" min={0} max={60} value={selected?.shadowBlur ?? 0} onChange={(e) => updateSelected({ shadowBlur: Number(e.target.value) })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={sectionStyle}>Shadow Color</label>
                <input
                  type="text"
                  style={fieldStyle}
                  value={selected?.shadowColor || ""}
                  onChange={(e) => updateSelected({ shadowColor: e.target.value })}
                  placeholder="rgba(0, 0, 0, 0.85)"
                />
              </div>
            </div>

            <div style={{ background: "#111827", border: "1px solid #263244", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={sectionStyle}>Looping Motion Background (URL / Data URL)</label>
              <input
                style={fieldStyle}
                value={selected?.motionBackground || ""}
                onChange={(e) => setMotionBackground(e.target.value)}
                placeholder="https://.../background.webm or data:video/..."
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={toolButtonStyle} onClick={() => motionFileRef.current?.click()}>
                  <FileVideo size={13} /> Attach Video
                </button>
                <button type="button" style={toolButtonStyle} onClick={() => setMotionBackground("")}>
                  Remove
                </button>
              </div>
              <input
                ref={motionFileRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  loadMotionFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderTop: "1px solid #1E293B",
            background: "#121927",
          }}
        >
          <span style={{ fontSize: 11, color: "#64748B" }}>
            Changes are published as a new deck in the service and pushed to the presentation theme.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={toolButtonStyle}>Cancel</button>
            <button
              type="button"
              onClick={() => {
                const nextSlides = draftSlides.map((slide, index) => ({ ...slide, number: index + 1 }));
                onApply(draftTitle.trim() || songTitle, nextSlides, draftTheme);
                onClose();
              }}
              style={{ ...toolButtonStyle, height: 34, padding: "0 16px", background: "#2563EB", borderColor: "#60A5FA", color: "#FFFFFF" }}
            >
              <Check size={14} /> Apply to Deck
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Keep the kind type referenced so future slide kinds stay type-checked against our editor.
export type EditorSlideKind = SlideKind;
