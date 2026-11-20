import React, { useState, useEffect, useCallback } from "react";
import {
  listHostMediaDevices,
  listCapturableWindows,
  listCapturableDisplays,
  type HostMediaDevice,
} from "../bridge";
import type { CapturableDisplay, CapturableWindow, SceneSourceItem } from "../types";
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
  const [capturableWindows, setCapturableWindows] = useState<CapturableWindow[]>([]);
  const [capturableDisplays, setCapturableDisplays] = useState<CapturableDisplay[]>([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [loadingDisplays, setLoadingDisplays] = useState(false);
  const [hardwareDevices, setHardwareDevices] = useState<HostMediaDevice[]>([]);

  useEffect(() => {
    if (isOpen) {
      listHostMediaDevices().then(setHardwareDevices).catch(() => {});
    }
  }, [isOpen]);

  const refreshWindows = useCallback(async () => {
    setLoadingWindows(true);
    try {
      setCapturableWindows(await listCapturableWindows());
    } catch {
      setCapturableWindows([]);
    } finally {
      setLoadingWindows(false);
    }
  }, []);

  const refreshDisplays = useCallback(async () => {
    setLoadingDisplays(true);
    try {
      setCapturableDisplays(await listCapturableDisplays());
    } catch {
      setCapturableDisplays([]);
    } finally {
      setLoadingDisplays(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && source?.type === "window_capture") void refreshWindows();
  }, [isOpen, source?.type, refreshWindows]);

  useEffect(() => {
    if (isOpen && source?.type === "display_capture") void refreshDisplays();
  }, [isOpen, source?.type, refreshDisplays]);

  const [settings, setSettings] = useState<Record<string, any>>(() => ({
    ...(source.type === "window_capture" || source.type === "display_capture"
      ? { captureMethod: "native", fps: 5 }
      : {}),
    ...source.settings,
  }));

  const patchSetting = (key: string, val: any) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const renderCaptureMethod = () => (
    <div>
      <label style={labelStyle}>Capture Method</label>
      <select
        style={inputStyle}
        value={settings.captureMethod || "native"}
        onChange={(e) => patchSetting("captureMethod", e.target.value)}
      >
        <option value="native">Native — Zero-Popup (recommended)</option>
        <option value="browser">Browser picker (explicit fallback)</option>
      </select>
    </div>
  );

  const renderFpsSelector = () => (
    <div>
      <label style={labelStyle}>Capture Frame Rate (FPS)</label>
      <select
        style={inputStyle}
        value={Number(settings.fps ?? 5)}
        onChange={(e) => patchSetting("fps", Number(e.target.value))}
      >
        <option value={2}>2 fps — low bandwidth</option>
        <option value={5}>5 fps — recommended for slides</option>
        <option value={10}>10 fps</option>
        <option value={15}>15 fps — smooth motion</option>
      </select>
    </div>
  );

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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Display / Monitor</label>
                <span style={badgeStyle}>Zero-Popup Native Capture</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  style={inputStyle}
                  value={settings.nativeDisplayId === undefined || settings.nativeDisplayId === null ? "" : String(settings.nativeDisplayId)}
                  onChange={(e) => {
                    const picked = capturableDisplays.find((d) => String(d.id) === e.target.value);
                    if (!picked) {
                      patchSetting("nativeDisplayId", null);
                      return;
                    }
                    setSettings((prev) => ({
                      ...prev,
                      nativeDisplayId: picked.id,
                      displayName: picked.name,
                      captureMethod: "native",
                      display: picked.id,
                    }));
                  }}
                >
                  <option value="">-- Choose an OS Display --</option>
                  {capturableDisplays.map((d) => (
                    <option key={d.id} value={d.id}>{`${d.name}${d.isPrimary ? " (Primary)" : ""} — ${d.width}×${d.height}`}</option>
                  ))}
                </select>
                <button type="button" onClick={refreshDisplays} style={refreshButtonStyle}>
                  {loadingDisplays ? "Scanning..." : "Refresh Displays"}
                </button>
              </div>
              {capturableDisplays.length === 0 && !loadingDisplays && (
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>
                  No OS displays detected. Use Refresh Displays, or choose the browser fallback below.
                </div>
              )}
            </div>
            {renderCaptureMethod()}
            {renderFpsSelector()}
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Select Window to Display</label>
                <span style={badgeStyle}>Zero-Popup Native Capture</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  style={inputStyle}
                  value={settings.nativeWindowId === undefined || settings.nativeWindowId === null ? "" : String(settings.nativeWindowId)}
                  onChange={(e) => {
                    const picked = capturableWindows.find((w) => String(w.id) === e.target.value);
                    if (!picked) {
                      patchSetting("nativeWindowId", null);
                      return;
                    }
                    setSettings((prev) => ({
                      ...prev,
                      nativeWindowId: picked.id,
                      windowTitle: picked.title,
                      appName: picked.appName,
                      captureMethod: "native",
                      window: picked.title,
                    }));
                  }}
                >
                  <option value="">-- Choose an OS Window --</option>
                  {capturableWindows.map((w) => (
                    <option key={w.id} value={w.id}>{`${w.appName} — ${w.title} (${w.width}×${w.height})`}</option>
                  ))}
                </select>
                <button type="button" onClick={refreshWindows} style={refreshButtonStyle}>
                  {loadingWindows ? "Scanning..." : "Refresh Windows"}
                </button>
              </div>
              {capturableWindows.length === 0 && !loadingWindows && (
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>
                  No OS windows detected. Use Refresh Windows, or choose the browser fallback below.
                </div>
              )}
            </div>
            {renderCaptureMethod()}
            {renderFpsSelector()}
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

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flexShrink: 0,
  padding: "2px 7px",
  borderRadius: 4,
  background: "rgba(16, 185, 129, 0.14)",
  border: "1px solid rgba(16, 185, 129, 0.45)",
  color: "#6EE7B7",
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const refreshButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "0 10px",
  height: 38,
  background: "#1E293B",
  border: "1px solid #334155",
  borderRadius: 6,
  color: "#93C5FD",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
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
