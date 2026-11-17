import React, { useState, useEffect } from "react";
import { listOpenWindows, listHostMediaDevices, type HostMediaDevice } from "../bridge";
import {
  Settings,
  X,
  Check,
  Video,
  Monitor,
  Volume2,
  Globe,
  Palette,
  PlaySquare,
  Type,
  Image as ImageIcon,
  Sliders,
  FolderOpen,
} from "lucide-react";
import type { SceneSourceItem } from "../types";

interface SourceSettingsModalProps {
  source: SceneSourceItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updatedSettings: Record<string, unknown>, newName: string) => void;
}

export const SourceSettingsModal: React.FC<SourceSettingsModalProps> = ({
  source,
  isOpen,
  onClose,
  onSave,
}) => {
  if (!isOpen || !source) return null;

  const [name, setName] = useState(source.name);
  const [openWindows, setOpenWindows] = useState<string[]>([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [hardwareDevices, setHardwareDevices] = useState<HostMediaDevice[]>([]);

  useEffect(() => {
    if (isOpen) {
      listHostMediaDevices().then(setHardwareDevices).catch(() => {});
    }
  }, [isOpen]);

  const refreshWindows = () => {
    setLoadingWindows(true);
    listOpenWindows().then((wins) => {
      setOpenWindows(wins);
      setLoadingWindows(false);
    });
  };

  useEffect(() => {
    if (isOpen && source?.type === "window_capture") {
      refreshWindows();
    }
  }, [isOpen, source?.type]);
  const [settings, setSettings] = useState<Record<string, any>>({ ...source.settings });

  const patchSetting = (key: string, val: any) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const renderFields = () => {
    switch (source.type) {
      case "video_capture_device":
        return (
          <>
            <div>
              <label style={labelStyle}>Capture Device (Detected OS Cameras)</label>
              <select
                style={inputStyle}
                value={settings.device || ""}
                onChange={(e) => patchSetting("device", e.target.value)}
              >
                <option value="">Default System Camera</option>
                {hardwareDevices.filter((d) => d.kind === "video_input").map((d) => (
                  <option key={d.name} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Resolution</label>
                <select
                  style={inputStyle}
                  value={settings.resolution || "1920x1080"}
                  onChange={(e) => patchSetting("resolution", e.target.value)}
                >
                  <option value="1920x1080">1920x1080 (1080p FHD)</option>
                  <option value="3840x2160">3840x2160 (4K UHD)</option>
                  <option value="1280x720">1280x720 (720p HD)</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Frame Rate (FPS)</label>
                <select
                  style={inputStyle}
                  value={settings.fps || 60}
                  onChange={(e) => patchSetting("fps", Number(e.target.value))}
                >
                  <option value={60}>60 fps (Smooth Live Video)</option>
                  <option value={30}>30 fps (Broadcast Standard)</option>
                  <option value={24}>24 fps (Cinematic)</option>
                </select>
              </div>
            </div>
          </>
        );

      case "browser":
        return (
          <>
            <div>
              <label style={labelStyle}>URL</label>
              <input
                type="text"
                style={inputStyle}
                value={settings.url || "https://"}
                onChange={(e) => patchSetting("url", e.target.value)}
                placeholder="https://your-worship-overlay-or-chat.com"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Width</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={settings.width || 1920}
                  onChange={(e) => patchSetting("width", Number(e.target.value))}
                />
              </div>
              <div>
                <label style={labelStyle}>Height</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={settings.height || 1080}
                  onChange={(e) => patchSetting("height", Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Custom CSS</label>
              <textarea
                style={{ ...inputStyle, height: 60, fontFamily: "monospace", resize: "none" }}
                value={settings.css || "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }"}
                onChange={(e) => patchSetting("css", e.target.value)}
              />
            </div>
          </>
        );

      case "display_capture":
        return (
          <>
            <div>
              <label style={labelStyle}>Display / Monitor</label>
              <select
                style={inputStyle}
                value={settings.display || 0}
                onChange={(e) => patchSetting("display", Number(e.target.value))}
              >
                <option value={0}>Display 1: Main Desktop (1920x1080)</option>
                <option value={1}>Display 2: Projector / FOH Screen</option>
                <option value={2}>Display 3: Stage Confidence Display</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <input
                type="checkbox"
                id="capCur"
                checked={settings.captureCursor !== false}
                onChange={(e) => patchSetting("captureCursor", e.target.checked)}
              />
              <label htmlFor="capCur" style={{ fontSize: 13, color: "#E2E8F0", cursor: "pointer" }}>
                Capture Mouse Cursor
              </label>
            </div>
          </>
        );

      case "window_capture":
        return (
          <>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Select Window to Display</label>
                <button
                  type="button"
                  onClick={refreshWindows}
                  style={{ background: "transparent", border: "none", color: "#60A5FA", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                >
                  {loadingWindows ? "Scanning..." : "↻ Refresh Windows"}
                </button>
              </div>
              <select
                style={inputStyle}
                value={settings.window || ""}
                onChange={(e) => patchSetting("window", e.target.value)}
              >
                <option value="">-- Choose an Open Window --</option>
                {openWindows.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Window Match Priority</label>
              <select
                style={inputStyle}
                value={settings.priority || 1}
                onChange={(e) => patchSetting("priority", Number(e.target.value))}
              >
                <option value={1}>Match title, otherwise find window of same executable</option>
                <option value={2}>Match title, otherwise find window of same type</option>
                <option value={3}>Exact title match only</option>
              </select>
            </div>
          </>
        );

      case "media":
        return (
          <>
            <div>
              <label style={labelStyle}>Local Media File Path</label>
              <input
                type="text"
                style={inputStyle}
                value={settings.localFile || ""}
                onChange={(e) => patchSetting("localFile", e.target.value)}
                placeholder="/path/to/video.mp4 or praise_pad.wav"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#E2E8F0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.loop === true}
                  onChange={(e) => patchSetting("loop", e.target.checked)}
                />
                Loop Video / Audio
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#E2E8F0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.restartOnActive !== false}
                  onChange={(e) => patchSetting("restartOnActive", e.target.checked)}
                />
                Restart Playback on Active
              </label>
            </div>
          </>
        );

      case "image":
        return (
          <>
            <div>
              <label style={labelStyle}>Image File (PNG, JPG, SVG)</label>
              <input
                type="text"
                style={inputStyle}
                value={settings.file || ""}
                onChange={(e) => patchSetting("file", e.target.value)}
                placeholder="/path/to/church_logo.png or lower_third.png"
              />
            </div>
          </>
        );

      case "text":
        return (
          <>
            <div>
              <label style={labelStyle}>Text Content</label>
              <textarea
                style={{ ...inputStyle, height: 70, resize: "none" }}
                value={settings.text || ""}
                onChange={(e) => patchSetting("text", e.target.value)}
                placeholder="Enter sermon title, scripture reference, or announcement"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Font Family</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={settings.font || "Arial"}
                  onChange={(e) => patchSetting("font", e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>Font Size (pt)</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={settings.size || 36}
                  onChange={(e) => patchSetting("size", Number(e.target.value))}
                />
              </div>
            </div>
          </>
        );

      case "color":
        return (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Color Hex</label>
                <input
                  type="text"
                  style={inputStyle}
                  value={settings.colorHex || "#000000"}
                  onChange={(e) => patchSetting("colorHex", e.target.value)}
                  placeholder="#000000"
                />
              </div>
              <div>
                <label style={labelStyle}>Opacity (%)</label>
                <input
                  type="number"
                  style={inputStyle}
                  value={settings.opacity || 100}
                  onChange={(e) => patchSetting("opacity", Number(e.target.value))}
                />
              </div>
            </div>
          </>
        );

      case "audio_input_capture":
      case "audio_output_capture":
      case "app_audio_capture":
        return (
          <>
            <div>
              <label style={labelStyle}>
                {source.type === "audio_output_capture" ? "PC / Mac Output Loopback Device" : "Audio Input Device (Mic / Interface)"}
              </label>
              <select
                style={inputStyle}
                value={settings.device || "default"}
                onChange={(e) => patchSetting("device", e.target.value)}
              >
                <option value="default">Default System Audio Device</option>
                {hardwareDevices
                  .filter((d) =>
                    source.type === "audio_output_capture"
                      ? d.kind === "audio_output"
                      : d.kind === "audio_input"
                  )
                  .map((d) => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
              </select>
            </div>
          </>
        );

      default:
        return (
          <div style={{ color: "#94A3B8", fontSize: 13 }}>
            Standard properties configured for this {source.type.replace(/_/g, " ")}.
          </div>
        );
    }
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
        zIndex: 10002,
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#121721",
          border: "1px solid #3B82F6",
          borderRadius: 12,
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
                background: "rgba(59, 130, 246, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(59, 130, 246, 0.3)",
              }}
            >
              <Settings size={20} color="#60A5FA" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#FFFFFF" }}>
                Source Properties: {source.name}
              </h3>
              <span style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase" }}>
                Type: {source.type.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Source Name Field */}
        <div>
          <label style={labelStyle}>Source Label Name</label>
          <input
            type="text"
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Dynamic Type Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {renderFields()}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
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
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(source.id, settings, name.trim() || source.name);
              onClose();
            }}
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
              fontSize: 13,
            }}
          >
            <Check size={16} /> Save Properties
          </button>
        </div>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: "#94A3B8",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 10px",
  background: "#0B0E14",
  border: "1px solid #2B3545",
  borderRadius: 6,
  color: "#FFFFFF",
  fontSize: 13,
  boxSizing: "border-box",
};
