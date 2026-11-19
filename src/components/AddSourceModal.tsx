import React, { useState } from "react";
import {
  Plus,
  X,
  Volume2,
  Video,
  Monitor,
  Globe,
  Palette,
  Gamepad2,
  Image as ImageIcon,
  PlaySquare,
  Type,
  Folder,
  Layers,
  Sparkles,
} from "lucide-react";
import type { SourceType, SourceDefinition, SceneSourceItem } from "../types";

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSource: (source: SceneSourceItem) => void;
}

export const BROADCAST_SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    type: "video_capture_device",
    label: "Video Capture Device",
    category: "video",
    description: "Capture cards (Capture cards) or USB webcams.",
    defaultSettings: { device: "", resolution: "1920x1080", fps: 60 },
  },
  {
    type: "audio_input_capture",
    label: "Audio Input Capture",
    category: "audio",
    description: "Microphones, USB audio interfaces, or stage desk feeds.",
    defaultSettings: { device: "default" },
  },
  {
    type: "audio_output_capture",
    label: "Audio Output Capture",
    category: "audio",
    description: "Desktop system audio, Spotify, or PC application sound.",
    defaultSettings: { device: "default" },
  },
  {
    type: "app_audio_capture",
    label: "Application Audio Capture (BETA)",
    category: "audio",
    description: "Capture sound from a single specific running application.",
    defaultSettings: { window: "" },
  },
  {
    type: "display_capture",
    label: "Display Capture",
    category: "video",
    description: "Capture an entire physical computer monitor or projector output.",
    defaultSettings: { display: 0, captureCursor: true },
  },
  {
    type: "window_capture",
    label: "Window Capture",
    category: "video",
    description: "Capture a specific window (e.g. Presentation, browser, media player).",
    defaultSettings: { window: "", priority: 1 },
  },
  {
    type: "media",
    label: "Media Source",
    category: "video",
    description: "Video or audio files (MP4, MKV, MOV, MP3, WAV) with looping & scrubbing.",
    defaultSettings: { localFile: "", loop: false, restartOnActive: true },
  },
  {
    type: "browser",
    label: "Browser",
    category: "graphic",
    description: "Web URLs, HTML5 overlays, live donation alerts, or chat feeds.",
    defaultSettings: { url: "https://", width: 1920, height: 1080, fps: 60 },
  },
  {
    type: "image",
    label: "Image",
    category: "graphic",
    description: "Still images (PNG, JPG, SVG, WebP) for logos and lower-thirds.",
    defaultSettings: { file: "" },
  },
  {
    type: "image_slide_show",
    label: "Image Slide Show",
    category: "graphic",
    description: "Automated carousel of rotating announcement slides.",
    defaultSettings: { slideTimeMs: 8000, transitionTimeMs: 700, loop: true },
  },
  {
    type: "color",
    label: "Color Source",
    category: "graphic",
    description: "Solid color matte background or custom color wash.",
    defaultSettings: { color: 0xff000000, width: 1920, height: 1080 },
  },
  {
    type: "text",
    label: "Text (GDI+ / FreeType)",
    category: "graphic",
    description: "Dynamic text overlays, scripture references, or live clocks.",
    defaultSettings: { text: "", font: "Arial", size: 36, color: 0xffffffff },
  },
  {
    type: "game_capture",
    label: "Game Capture",
    category: "video",
    description: "Direct hook for high-performance DirectX/OpenGL/Vulkan games.",
    defaultSettings: { captureMode: "any_fullscreen" },
  },
  {
    type: "scene",
    label: "Scene",
    category: "utility",
    description: "Nest an existing scene inside another scene (PiP, reusable overlays).",
    defaultSettings: { sceneName: "" },
  },
  {
    type: "group",
    label: "Group",
    category: "utility",
    description: "Folder container to organize multiple sources together.",
    defaultSettings: {},
  },
];

const getSourceIcon = (type: SourceType) => {
  switch (type) {
    case "audio_input_capture":
    case "audio_output_capture":
    case "app_audio_capture":
      return <Volume2 size={18} color="#10B981" />;
    case "video_capture_device":
      return <Video size={18} color="#EF4444" />;
    case "display_capture":
    case "window_capture":
      return <Monitor size={18} color="#3B82F6" />;
    case "browser":
      return <Globe size={18} color="#60A5FA" />;
    case "color":
      return <Palette size={18} color="#F59E0B" />;
    case "game_capture":
      return <Gamepad2 size={18} color="#8B5CF6" />;
    case "image":
    case "image_slide_show":
      return <ImageIcon size={18} color="#EC4899" />;
    case "media":
      return <PlaySquare size={18} color="#14B8A6" />;
    case "text":
      return <Type size={18} color="#F97316" />;
    case "scene":
      return <Layers size={18} color="#6366F1" />;
    case "group":
      return <Folder size={18} color="#94A3B8" />;
  }
};

export const AddSourceModal: React.FC<AddSourceModalProps> = ({
  isOpen,
  onClose,
  onAddSource,
}) => {
  const [selectedType, setSelectedType] = useState<SourceType>("video_capture_device");
  const [sourceName, setSourceName] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  if (!isOpen) return null;

  const currentDef = BROADCAST_SOURCE_DEFINITIONS.find((d) => d.type === selectedType)!;

  const filtered = categoryFilter === "all"
    ? BROADCAST_SOURCE_DEFINITIONS
    : BROADCAST_SOURCE_DEFINITIONS.filter((d) => d.category === categoryFilter);

  const handleAdd = () => {
    const name = sourceName.trim() || currentDef.label;
    const newSource: SceneSourceItem = {
      id: `source-${Date.now()}`,
      name,
      type: selectedType,
      enabled: true,
      locked: false,
      volumeDb: currentDef.category === "audio" ? 0.0 : undefined,
      muted: currentDef.category === "audio" ? false : undefined,
      settings: { ...currentDef.defaultSettings },
    };
    onAddSource(newSource);
    setSourceName("");
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
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
          maxWidth: 820,
          maxHeight: "88vh",
          overflow: "hidden",
          background: "#121721",
          border: "1px solid #2E3748",
          borderRadius: 14,
          padding: 24,
          color: "#E2E8F0",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "rgba(37, 99, 235, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(37, 99, 235, 0.3)",
              }}
            >
              <Plus size={20} color="#60A5FA" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#FFFFFF" }}>
                Add Broadcast Source
              </h3>
              <p style={{ margin: "2px 0 0", color: "#94A3B8", fontSize: 12 }}>
                Select from all 15 native Broadcast source types to add to your active canvas.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Category Filter Pills */}
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { id: "all", label: "All Sources (15)" },
            { id: "video", label: "Video & Cameras" },
            { id: "audio", label: "Audio Capture" },
            { id: "graphic", label: "Graphics & Text" },
            { id: "utility", label: "Scenes & Groups" },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 6,
                border: categoryFilter === cat.id ? "1px solid #3B82F6" : "1px solid #2B3545",
                background: categoryFilter === cat.id ? "#2563EB" : "#161C26",
                color: categoryFilter === cat.id ? "#FFFFFF" : "#94A3B8",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Source Grid & Details View */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Source List */}
          <div
            style={{
              minHeight: 0,
              overflowY: "auto",
              background: "#0B0E14",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: 8,
              display: "grid",
              gap: 6,
              alignContent: "start",
            }}
          >
            {filtered.map((def) => {
              const isSelected = def.type === selectedType;
              return (
                <div
                  key={def.type}
                  onClick={() => {
                    setSelectedType(def.type);
                    if (!sourceName) setSourceName(def.label);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: 6,
                    background: isSelected ? "#1E293B" : "transparent",
                    border: isSelected ? "1px solid #3B82F6" : "1px solid transparent",
                    cursor: "pointer",
                    transition: "all 0.1s ease",
                  }}
                >
                  {getSourceIcon(def.type)}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "#FFFFFF" : "#E2E8F0" }}>
                      {def.label}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                      {def.description}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Source Naming & Config Pane */}
          <div
            style={{
              background: "#0B0E14",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#CBD5E1", marginBottom: 6 }}>
                  Source Name
                </label>
                <input
                  type="text"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder={currentDef.label}
                  autoFocus
                  style={{
                    width: "100%",
                    height: 38,
                    padding: "0 10px",
                    background: "#161B24",
                    border: "1px solid #3B82F6",
                    borderRadius: 6,
                    color: "#FFFFFF",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div
                style={{
                  background: "#121721",
                  border: "1px solid #232D3F",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#60A5FA", marginBottom: 4 }}>
                  {currentDef.label} Specifications:
                </div>
                <div style={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.5 }}>
                  {currentDef.description}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "#64748B" }}>
                  Category: <strong style={{ color: "#CBD5E1", textTransform: "capitalize" }}>{currentDef.category}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "8px 14px",
                  background: "#1E2533",
                  border: "1px solid #2E3748",
                  color: "#CBD5E1",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 18px",
                  background: "#2563EB",
                  border: "1px solid #3B82F6",
                  color: "#FFFFFF",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                <Plus size={14} /> Add Source
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
