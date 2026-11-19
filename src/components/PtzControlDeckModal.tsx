import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Video,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Save,
  Play,
  X,
  Sliders,
  Plus,
  Trash2,
  Home,
  Focus,
  Sun,
  Crosshair,
} from "lucide-react";

export interface PtzPreset {
  id: string;
  name: string;
  presetNumber: number;
}

/** One editable camera in the local roster. Each camera owns its own preset bank. */
export interface PtzRosterCamera {
  id: string;
  name: string;
  ip: string;
  port: number;
  previewUrl?: string;
  presets: PtzPreset[];
}

interface PtzControlDeckModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraId?: string;
  cameraName?: string;
  defaultIp?: string;
  defaultPort?: number;
  onDrive?: (pan: number, tilt: number, zoom: number, ip: string, port: number) => void;
  onRecallPreset?: (presetNum: number, ip: string, port: number) => void;
  onSavePreset?: (presetNum: number, name: string, ip: string, port: number) => void;
  onOptics?: (
    ip: string,
    port: number,
    action:
      | "home"
      | "focus_auto"
      | "focus_manual"
      | "focus_near"
      | "focus_far"
      | "focus_stop"
      | "iris_up"
      | "iris_down"
      | "iris_reset"
      | "wb_mode"
      | "exposure_mode",
    value?: number
  ) => void | Promise<unknown>;
  // Optics / home hooks are optional so existing callers keep working unchanged.
  onFocusMode?: (mode: "auto" | "manual", ip: string, port: number) => void;
  onFocusDrive?: (dir: -1 | 0 | 1, ip: string, port: number) => void;
  onIrisStep?: (dir: -1 | 0 | 1, ip: string, port: number) => void;
  onWhiteBalance?: (mode: number, ip: string, port: number) => void;
  onExposureMode?: (mode: number, ip: string, port: number) => void;
  onHome?: (ip: string, port: number) => void;
}

export const PTZ_CAMERAS_STORAGE_KEY = "onering_ptz_cameras_v1";
const CAMERAS_STORAGE_KEY = PTZ_CAMERAS_STORAGE_KEY;
const PRESETS_STORAGE_KEY = "onering_ptz_presets_v1";

const DEFAULT_PRESETS: PtzPreset[] = [
  { id: "p1", name: "Pulpit Center", presetNumber: 1 },
  { id: "p2", name: "Stage Wide", presetNumber: 2 },
  { id: "p3", name: "Baptistry / Altar", presetNumber: 3 },
  { id: "p4", name: "Worship Leader Close", presetNumber: 4 },
  { id: "p5", name: "Band / Keys", presetNumber: 5 },
  { id: "p6", name: "Choir / Crowd", presetNumber: 6 },
];

const WHITE_BALANCE_MODES = [
  { mode: 0, label: "Auto" },
  { mode: 1, label: "Indoor" },
  { mode: 2, label: "Outdoor" },
  { mode: 3, label: "One-Push" },
];

const EXPOSURE_MODES = [
  { mode: 0, label: "Auto" },
  { mode: 1, label: "Manual" },
  { mode: 2, label: "Shutter" },
  { mode: 3, label: "Iris" },
];

const cloneDefaultPresets = (): PtzPreset[] => DEFAULT_PRESETS.map((p) => ({ ...p }));

function normalizeCamera(raw: unknown, index: number): PtzRosterCamera | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<PtzRosterCamera>;
  const presets = Array.isArray(c.presets)
    ? c.presets
        .filter((p): p is PtzPreset => !!p && typeof p.presetNumber === "number")
        .map((p) => ({
          id: typeof p.id === "string" ? p.id : `p${p.presetNumber}`,
          name: typeof p.name === "string" && p.name ? p.name : `Preset ${p.presetNumber}`,
          presetNumber: p.presetNumber,
        }))
    : [];
  return {
    id: typeof c.id === "string" && c.id ? c.id : `cam-${index + 1}`,
    name: typeof c.name === "string" && c.name ? c.name : `Camera ${index + 1}`,
    ip: typeof c.ip === "string" ? c.ip : "",
    port: Number.isFinite(c.port) ? Number(c.port) : 52381,
    previewUrl: typeof c.previewUrl === "string" ? c.previewUrl : "",
    presets: presets.length > 0 ? presets : cloneDefaultPresets(),
  };
}

function loadRoster(defaultIp: string, defaultPort: number, fallbackName: string): PtzRosterCamera[] {
  try {
    const raw = localStorage.getItem(CAMERAS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cameras = parsed
          .map((entry, i) => normalizeCamera(entry, i))
          .filter((c): c is PtzRosterCamera => c !== null);
        if (cameras.length > 0) return cameras;
      }
    }
  } catch {
    // Fall through to a freshly seeded roster.
  }

  // Legacy single-camera preset key is migrated into the first camera's bank.
  let presets = cloneDefaultPresets();
  try {
    const legacy = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const migrated = parsed
          .filter((p) => p && typeof p.presetNumber === "number")
          .map((p) => ({
            id: typeof p.id === "string" ? p.id : `p${p.presetNumber}`,
            name: typeof p.name === "string" && p.name ? p.name : `Preset ${p.presetNumber}`,
            presetNumber: p.presetNumber as number,
          }));
        if (migrated.length > 0) presets = migrated;
      }
    }
  } catch {
    // Ignore malformed legacy data.
  }

  return [
    {
      id: "cam-1",
      name: fallbackName || "Camera 1",
      ip: defaultIp,
      port: defaultPort || 52381,
      previewUrl: "",
      presets,
    },
  ];
}

type PreviewMode = "auto" | "video" | "failed";

/** Renders an MJPEG/HLS/WebRTC-style image or video feed supplied by the operator. */
export const CameraPreview: React.FC<{ url: string; name: string }> = ({ url, name }) => {
  const [mode, setMode] = useState<PreviewMode>("auto");
  const trimmed = url.trim();

  useEffect(() => setMode("auto"), [trimmed]);

  const shell: React.CSSProperties = {
    position: "relative",
    aspectRatio: "16 / 9",
    background: "#000000",
    border: "1px solid #283344",
    borderRadius: 8,
    overflow: "hidden",
  };

  if (!trimmed) {
    return (
      <div style={{ ...shell, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#64748B", fontSize: 12, padding: 16 }}>
          <Video size={30} color="#475569" style={{ marginBottom: 8 }} />
          <div>No preview feed configured</div>
          <div style={{ fontSize: 10.5, marginTop: 4 }}>
            Add an image / video URL in the camera details above.
          </div>
        </div>
      </div>
    );
  }

  const looksLikeVideo = /\.(m3u8|mp4|webm|ogv|ogg|mov|ts)(?:[?#]|$)/i.test(trimmed);
  const showVideo = mode === "video" || (mode === "auto" && looksLikeVideo);

  return (
    <div style={shell}>
      {mode === "failed" ? (
        <div
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#F87171",
            fontSize: 12,
            textAlign: "center",
            padding: 12,
          }}
        >
          Preview feed unavailable — check the URL and camera network access.
        </div>
      ) : showVideo ? (
        <video
          src={trimmed}
          autoPlay
          muted
          playsInline
          controls
          onError={() => setMode("failed")}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <img
          src={trimmed}
          alt={`Live preview — ${name}`}
          onError={() => setMode("video")}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      )}
      <span
        className="mono"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          fontSize: 9.5,
          fontWeight: 800,
          letterSpacing: "0.06em",
          padding: "3px 7px",
          borderRadius: 4,
          background: "rgba(8, 11, 16, 0.82)",
          border: "1px solid #EF4444",
          color: "#FCA5A5",
        }}
      >
        ● LIVE PREVIEW • {name}
      </span>
    </div>
  );
};

export const PtzControlDeckModal: React.FC<PtzControlDeckModalProps> = ({
  isOpen,
  onClose,
  cameraId = "cam1",
  cameraName = "Pastor Pulpit Cam (PTZ 1)",
  defaultIp = "192.168.1.50",
  defaultPort = 52381,
  onDrive,
  onRecallPreset,
  onSavePreset,
  onOptics,
  onFocusMode,
  onFocusDrive,
  onIrisStep,
  onWhiteBalance,
  onExposureMode,
  onHome,
}) => {
  const initialRosterRef = useRef<PtzRosterCamera[] | null>(null);
  if (initialRosterRef.current === null) {
    initialRosterRef.current = loadRoster(defaultIp, defaultPort, cameraName);
  }
  const [cameras, setCameras] = useState<PtzRosterCamera[]>(initialRosterRef.current);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(
    initialRosterRef.current[0]?.id || "cam-1"
  );
  const [speed, setSpeed] = useState<number>(12);
  const [activeDirection, setActiveDirection] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [editingPreset, setEditingPreset] = useState<number | null>(null);
  const [presetNameInput, setPresetNameInput] = useState<string>("");
  const [focusMode, setFocusMode] = useState<"auto" | "manual">("auto");
  const [whiteBalanceMode, setWhiteBalanceMode] = useState<number>(0);
  const [exposureMode, setExposureMode] = useState<number>(0);
  const activeDirRef = useRef<string | null>(null);

  const selectedCamera =
    cameras.find((c) => c.id === selectedCameraId) ||
    cameras[0] || {
      id: "cam-1",
      name: cameraName,
      ip: defaultIp,
      port: defaultPort,
      presets: cloneDefaultPresets(),
    };
  const presets = selectedCamera.presets;
  const target = `${selectedCamera.ip || "—"}:${selectedCamera.port}`;

  const persist = useCallback((next: PtzRosterCamera[]) => {
    setCameras(next);
    try {
      localStorage.setItem(CAMERAS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be blocked; the in-memory roster still works for this session.
    }
  }, []);

  const updateSelected = useCallback(
    (patch: Partial<PtzRosterCamera>) => {
      persist(cameras.map((c) => (c.id === selectedCamera.id ? { ...c, ...patch } : c)));
    },
    [cameras, persist, selectedCamera.id]
  );

  // Safety guarantee: releasing anywhere or losing focus ALWAYS halts motors and drives.
  const stopAll = useCallback(() => {
    const active = activeDirRef.current;
    if (active === null) return;
    activeDirRef.current = null;
    setActiveDirection(null);
    const ip = selectedCamera.ip.trim();
    const port = selectedCamera.port;
    if (active === "FOCUS_NEAR" || active === "FOCUS_FAR") {
      onOptics?.(ip, port, "focus_stop");
      onFocusDrive?.(0, ip, port);
    } else if (active === "IRIS_OPEN" || active === "IRIS_CLOSE") {
      onIrisStep?.(0, ip, port);
    } else {
      onDrive?.(0, 0, 0, ip, port);
    }
  }, [onDrive, onFocusDrive, onIrisStep, onOptics, selectedCamera.ip, selectedCamera.port]);

  useEffect(() => {
    if (!isOpen) return;
    const onGlobalRelease = () => stopAll();
    window.addEventListener("pointerup", onGlobalRelease);
    window.addEventListener("pointercancel", onGlobalRelease);
    window.addEventListener("blur", onGlobalRelease);
    return () => {
      window.removeEventListener("pointerup", onGlobalRelease);
      window.removeEventListener("pointercancel", onGlobalRelease);
      window.removeEventListener("blur", onGlobalRelease);
      stopAll();
    };
  }, [isOpen, stopAll]);

  if (!isOpen) return null;

  const addCamera = () => {
    const id = `cam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const next: PtzRosterCamera = {
      id,
      name: `Camera ${cameras.length + 1}`,
      ip: "",
      port: 52381,
      previewUrl: "",
      presets: cloneDefaultPresets(),
    };
    persist([...cameras, next]);
    setSelectedCameraId(id);
    setStatusNote(`Added ${next.name} — edit its address and preview URL above`);
  };

  const removeCamera = () => {
    if (cameras.length <= 1) return;
    const remaining = cameras.filter((c) => c.id !== selectedCamera.id);
    persist(remaining);
    setSelectedCameraId(remaining[0].id);
    setStatusNote(`Removed ${selectedCamera.name} from the roster`);
  };

  const holdProps = (dir: string, start: () => void) => ({
    type: "button" as const,
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      activeDirRef.current = dir;
      setActiveDirection(dir);
      start();
    },
    onPointerUp: stopAll,
    onPointerLeave: stopAll,
    onPointerCancel: stopAll,
  });

  const motionButtonProps = (dir: string, pan: number, tilt: number, zoom: number) =>
    holdProps(dir, () => {
      const ptSpeed = Math.max(1, Math.min(24, speed));
      const zoomSpeed = Math.max(1, Math.min(7, Math.round((speed / 24) * 7)));
      onDrive?.(
        pan * ptSpeed,
        tilt * Math.min(20, ptSpeed),
        zoom * zoomSpeed,
        selectedCamera.ip.trim(),
        selectedCamera.port
      );
      setStatusNote(`Driving ${dir} -> ${target}`);
    });

  const driveFocus = (dir: -1 | 0 | 1, key: string) => {
    const ip = selectedCamera.ip.trim();
    const port = selectedCamera.port;
    if (dir === 1) onOptics?.(ip, port, "focus_far");
    else if (dir === -1) onOptics?.(ip, port, "focus_near");
    else onOptics?.(ip, port, "focus_stop");
    onFocusDrive?.(dir, ip, port);
    setStatusNote(
      dir === 0
        ? `Focus drive stopped on ${selectedCamera.name}`
        : `Focus ${dir > 0 ? "FAR" : "NEAR"} hold on ${selectedCamera.name} -> ${target}`
    );
    if (dir !== 0) {
      activeDirRef.current = key;
      setActiveDirection(key);
    }
  };

  const driveIris = (dir: -1 | 0 | 1, key: string) => {
    const ip = selectedCamera.ip.trim();
    const port = selectedCamera.port;
    if (dir === 1) onOptics?.(ip, port, "iris_up");
    else if (dir === -1) onOptics?.(ip, port, "iris_down");
    else onOptics?.(ip, port, "iris_reset");
    onIrisStep?.(dir, ip, port);
    setStatusNote(
      dir === 0
        ? `Iris reset on ${selectedCamera.name}`
        : `Iris ${dir > 0 ? "OPEN" : "CLOSE"} -> ${target}`
    );
    if (dir !== 0) {
      activeDirRef.current = key;
      setActiveDirection(key);
    }
  };

  const handleSaveClick = (presetNum: number) => {
    setEditingPreset(presetNum);
    const existing = presets.find((p) => p.presetNumber === presetNum);
    setPresetNameInput(existing ? existing.name : `Preset ${presetNum}`);
  };

  const handleConfirmSave = (presetNum: number) => {
    const cleanName = presetNameInput.trim() || `Preset ${presetNum}`;
    onSavePreset?.(presetNum, cleanName, selectedCamera.ip.trim(), selectedCamera.port);
    const updated = presets.map((p) =>
      p.presetNumber === presetNum ? { ...p, name: cleanName } : p
    );
    updateSelected({ presets: updated });
    setStatusNote(
      `Stored Preset #${presetNum} ("${cleanName}") on ${selectedCamera.name} (${target})`
    );
    setEditingPreset(null);
  };

  const handleRecall = (presetNum: number, name: string) => {
    onRecallPreset?.(presetNum, selectedCamera.ip.trim(), selectedCamera.port);
    setStatusNote(`Recalled Preset #${presetNum} ("${name}") on ${selectedCamera.name} (${target})`);
  };

  const fieldStyle: React.CSSProperties = {
    height: 32,
    backgroundColor: "#0B0D10",
    border: "1px solid #374151",
    borderRadius: 6,
    padding: "0 8px",
    color: "#E5E7EB",
    fontSize: 12,
  };

  const sectionLabel: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: "#9CA3AF",
    marginBottom: 10,
    letterSpacing: "0.03em",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(5px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="card"
        style={{
          width: 1080,
          maxWidth: "96vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid #374151",
          background: "#111827",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 22px",
            borderBottom: "1px solid #1F2937",
            backgroundColor: "#182234",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Video size={22} color="#38BDF8" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#F9FAFB" }}>
                PTZ Control Deck & Preset Programmer
              </h2>
              <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                Active: {selectedCamera.name} ({cameraId}) • PTZ-IP-over-IP UDP
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="mono"
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 9px",
                borderRadius: 6,
                background: "rgba(16, 185, 129, 0.14)",
                border: "1px solid #10B981",
                color: "#34D399",
              }}
            >
              {cameras.length} CAMERA{cameras.length === 1 ? "" : "S"} IN ROSTER
            </span>
            <button
              onClick={onClose}
              className="btn"
              style={{ padding: "6px 8px", background: "transparent", border: "none" }}
            >
              <X size={20} color="#9CA3AF" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Multi-camera roster switcher */}
          <div
            style={{
              background: "#161F30",
              border: "1px solid #233044",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={sectionLabel}>CAMERA ROSTER — SELECT ACTIVE CAMERA</span>
              <button
                type="button"
                onClick={addCamera}
                className="btn"
                style={{ height: 28, padding: "0 10px", fontSize: 11.5, display: "flex", alignItems: "center", gap: 5 }}
              >
                <Plus size={13} /> Add Camera
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {cameras.map((cam) => {
                const active = cam.id === selectedCamera.id;
                return (
                  <button
                    key={cam.id}
                    type="button"
                    onClick={() => {
                      setSelectedCameraId(cam.id);
                      setEditingPreset(null);
                      setStatusNote(`Selected ${cam.name} (${cam.ip || "no IP"}:${cam.port})`);
                    }}
                    style={{
                      padding: "7px 11px",
                      borderRadius: 7,
                      cursor: "pointer",
                      textAlign: "left",
                      background: active ? "#1D4ED8" : "#0F1622",
                      border: `1px solid ${active ? "#60A5FA" : "#283344"}`,
                      color: "#FFFFFF",
                      minWidth: 140,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{cam.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: active ? "#BFDBFE" : "#94A3B8" }}>
                      {cam.ip || "unconfigured"}:{cam.port}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Editable details for selected camera */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.1fr 1fr 0.5fr 1.5fr auto",
                gap: 8,
                marginTop: 12,
                alignItems: "end",
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>Name</span>
                <input
                  aria-label="Camera name"
                  type="text"
                  value={selectedCamera.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                  style={{ ...fieldStyle, width: "100%", boxSizing: "border-box" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>IP Address</span>
                <input
                  aria-label="PTZ Camera IP"
                  type="text"
                  value={selectedCamera.ip}
                  onChange={(e) => updateSelected({ ip: e.target.value })}
                  placeholder="Camera IP"
                  className="mono"
                  style={{ ...fieldStyle, width: "100%", boxSizing: "border-box" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>UDP Port</span>
                <input
                  aria-label="PTZ-IP UDP Port"
                  type="number"
                  min={1}
                  max={65535}
                  value={selectedCamera.port}
                  onChange={(e) =>
                    updateSelected({
                      port: Math.max(1, Math.min(65535, Number(e.target.value) || 52381)),
                    })
                  }
                  className="mono"
                  style={{ ...fieldStyle, width: "100%", boxSizing: "border-box", color: "#93C5FD" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10.5, color: "#9CA3AF" }}>Preview URL (MJPEG / HLS / image / video)</span>
                <input
                  aria-label="Camera preview URL"
                  type="text"
                  value={selectedCamera.previewUrl || ""}
                  onChange={(e) => updateSelected({ previewUrl: e.target.value })}
                  placeholder="http://…/stream.m3u8 or /snapshot.jpg"
                  className="mono"
                  style={{ ...fieldStyle, width: "100%", boxSizing: "border-box" }}
                />
              </label>
              <button
                type="button"
                onClick={removeCamera}
                disabled={cameras.length <= 1}
                title="Remove selected camera from roster"
                style={{
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 6,
                  cursor: cameras.length > 1 ? "pointer" : "not-allowed",
                  opacity: cameras.length > 1 ? 1 : 0.4,
                  background: "#3B1620",
                  border: "1px solid #7F1D1D",
                  color: "#FCA5A5",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                }}
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
          </div>

          {/* Motion + Presets */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div
              style={{
                background: "#161F30",
                border: "1px solid #233044",
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div style={sectionLabel}>VIRTUAL PAN / TILT PAD & ZOOM</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 60px)",
                  gridTemplateRows: "repeat(3, 58px)",
                  gap: 8,
                  justifyContent: "center",
                  marginBottom: 14,
                }}
              >
                <div />
                <button {...motionButtonProps("UP", 0, 1, 0)} className="btn" style={{ backgroundColor: activeDirection === "UP" ? "#0284C7" : "#1F2937" }}>
                  <ArrowUp size={24} />
                </button>
                <div />
                <button {...motionButtonProps("LEFT", -1, 0, 0)} className="btn" style={{ backgroundColor: activeDirection === "LEFT" ? "#0284C7" : "#1F2937" }}>
                  <ArrowLeft size={24} />
                </button>
                <button
                  type="button"
                  onClick={stopAll}
                  title="Emergency Stop PTZ Motors"
                  style={{
                    borderRadius: 10,
                    backgroundColor: "#161F30",
                    border: "1px solid #233044",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Sliders size={18} color="#38BDF8" />
                </button>
                <button {...motionButtonProps("RIGHT", 1, 0, 0)} className="btn" style={{ backgroundColor: activeDirection === "RIGHT" ? "#0284C7" : "#1F2937" }}>
                  <ArrowRight size={24} />
                </button>
                <div />
                <button {...motionButtonProps("DOWN", 0, -1, 0)} className="btn" style={{ backgroundColor: activeDirection === "DOWN" ? "#0284C7" : "#1F2937" }}>
                  <ArrowDown size={24} />
                </button>
                <div />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 12 }}>
                <button {...motionButtonProps("ZOOM_IN", 0, 0, 1)} className="btn" style={{ height: 40, padding: "0 16px", display: "flex", alignItems: "center", gap: 7, backgroundColor: activeDirection === "ZOOM_IN" ? "#0284C7" : "#1F2937" }}>
                  <ZoomIn size={17} /> Zoom In
                </button>
                <button {...motionButtonProps("ZOOM_OUT", 0, 0, -1)} className="btn" style={{ height: 40, padding: "0 16px", display: "flex", alignItems: "center", gap: 7, backgroundColor: activeDirection === "ZOOM_OUT" ? "#0284C7" : "#1F2937" }}>
                  <ZoomOut size={17} /> Zoom Out
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 11, color: "#9CA3AF" }}>Speed:</span>
                <input
                  type="range"
                  min={1}
                  max={24}
                  value={speed}
                  onChange={(e) => setSpeed(parseInt(e.target.value, 10))}
                  style={{ flex: 1, accentColor: "#38BDF8" }}
                />
                <span className="mono" style={{ fontSize: 12, color: "#38BDF8", width: 24 }}>{speed}</span>
              </div>
            </div>

            <div
              style={{
                background: "#161F30",
                border: "1px solid #233044",
                borderRadius: 10,
                padding: 14,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={sectionLabel}>CAMERA PRESETS — {selectedCamera.name.toUpperCase()}</div>
                <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>independent bank</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 360, overflowY: "auto" }}>
                {presets.map((p) => (
                  <div
                    key={p.presetNumber}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      borderRadius: 8,
                      backgroundColor: "#1F2937",
                      border: "1px solid #374151",
                    }}
                  >
                    {editingPreset === p.presetNumber ? (
                      <div style={{ display: "flex", gap: 6, flex: 1, marginRight: 8 }}>
                        <input
                          type="text"
                          value={presetNameInput}
                          onChange={(e) => setPresetNameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleConfirmSave(p.presetNumber);
                          }}
                          style={{ flex: 1, height: 30, backgroundColor: "#111827", border: "1px solid #38BDF8", borderRadius: 4, padding: "0 8px", color: "#F9FAFB", fontSize: 12 }}
                        />
                        <button type="button" onClick={() => handleConfirmSave(p.presetNumber)} className="btn" style={{ height: 30, padding: "0 10px", backgroundColor: "#0284C7", fontSize: 11 }}>
                          Save
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#F9FAFB" }}>{p.name}</div>
                        <span className="mono" style={{ fontSize: 10, color: "#9CA3AF" }}>Preset #{p.presetNumber}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleRecall(p.presetNumber, p.name)}
                        className="btn"
                        style={{ height: 30, padding: "0 9px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <Play size={12} /> Recall
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveClick(p.presetNumber)}
                        className="btn"
                        style={{ height: 30, padding: "0 8px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <Save size={12} /> Store
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Optics + Live Preview */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div
              style={{
                background: "#161F30",
                border: "1px solid #233044",
                borderRadius: 10,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={sectionLabel}>OPTICS & HOME CONTROL</div>

              {/* Focus */}
              <div style={{ borderRadius: 8, border: "1px solid #283344", background: "#0F1622", padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", display: "flex", alignItems: "center", gap: 6 }}>
                    <Focus size={13} color="#38BDF8" /> Focus
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["auto", "manual"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          const ip = selectedCamera.ip.trim();
                          const port = selectedCamera.port;
                          setFocusMode(m);
                          onOptics?.(ip, port, m === "auto" ? "focus_auto" : "focus_manual");
                          onFocusMode?.(m, ip, port);
                          setStatusNote(`Focus mode -> ${m.toUpperCase()} on ${selectedCamera.name} (${target})`);
                        }}
                        style={{
                          height: 24,
                          padding: "0 10px",
                          borderRadius: 5,
                          fontSize: 10.5,
                          fontWeight: 800,
                          cursor: "pointer",
                          background: focusMode === m ? "#0369A1" : "#161B24",
                          border: `1px solid ${focusMode === m ? "#38BDF8" : "#283344"}`,
                          color: "#FFFFFF",
                        }}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    {...holdProps("FOCUS_NEAR", () => driveFocus(-1, "FOCUS_NEAR"))}
                    className="btn"
                    style={{ flex: 1, height: 36, backgroundColor: activeDirection === "FOCUS_NEAR" ? "#0284C7" : "#1F2937", fontSize: 12 }}
                  >
                    Near (−)
                  </button>
                  <button
                    {...holdProps("FOCUS_FAR", () => driveFocus(1, "FOCUS_FAR"))}
                    className="btn"
                    style={{ flex: 1, height: 36, backgroundColor: activeDirection === "FOCUS_FAR" ? "#0284C7" : "#1F2937", fontSize: 12 }}
                  >
                    Far (+)
                  </button>
                </div>
              </div>

              {/* Iris */}
              <div style={{ borderRadius: 8, border: "1px solid #283344", background: "#0F1622", padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", display: "flex", alignItems: "center", gap: 6 }}>
                    <Sun size={13} color="#FBBF24" /> Iris
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>hold ± / reset</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    {...holdProps("IRIS_CLOSE", () => driveIris(-1, "IRIS_CLOSE"))}
                    className="btn"
                    style={{ flex: 1, height: 36, backgroundColor: activeDirection === "IRIS_CLOSE" ? "#B45309" : "#1F2937", fontSize: 13 }}
                  >
                    − Close
                  </button>
                  <button
                    type="button"
                    onClick={() => driveIris(0, "IRIS_STOP")}
                    className="btn"
                    style={{ flex: 1, height: 36, backgroundColor: "#1F2937", fontSize: 12 }}
                  >
                    Reset
                  </button>
                  <button
                    {...holdProps("IRIS_OPEN", () => driveIris(1, "IRIS_OPEN"))}
                    className="btn"
                    style={{ flex: 1, height: 36, backgroundColor: activeDirection === "IRIS_OPEN" ? "#B45309" : "#1F2937", fontSize: 13 }}
                  >
                    + Open
                  </button>
                </div>
              </div>

              {/* White balance + exposure */}
              <div style={{ borderRadius: 8, border: "1px solid #283344", background: "#0F1622", padding: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Crosshair size={13} color="#34D399" /> White Balance
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {WHITE_BALANCE_MODES.map((wb) => {
                    const active = whiteBalanceMode === wb.mode;
                    return (
                      <button
                        key={wb.mode}
                        type="button"
                        onClick={() => {
                          const ip = selectedCamera.ip.trim();
                          const port = selectedCamera.port;
                          setWhiteBalanceMode(wb.mode);
                          onOptics?.(ip, port, "wb_mode", wb.mode);
                          onWhiteBalance?.(wb.mode, ip, port);
                          setStatusNote(`White balance -> ${wb.label} on ${selectedCamera.name} (${target})`);
                        }}
                        style={{
                          height: 30,
                          borderRadius: 5,
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          background: active ? "#065F46" : "#161B24",
                          border: `1px solid ${active ? "#34D399" : "#283344"}`,
                          color: "#FFFFFF",
                        }}
                      >
                        {wb.label}
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", display: "flex", alignItems: "center", gap: 6, margin: "10px 0 8px" }}>
                  <Sliders size={13} color="#A78BFA" /> Exposure Mode
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {EXPOSURE_MODES.map((ex) => {
                    const active = exposureMode === ex.mode;
                    return (
                      <button
                        key={ex.mode}
                        type="button"
                        onClick={() => {
                          const ip = selectedCamera.ip.trim();
                          const port = selectedCamera.port;
                          setExposureMode(ex.mode);
                          onOptics?.(ip, port, "exposure_mode", ex.mode);
                          onExposureMode?.(ex.mode, ip, port);
                          setStatusNote(`Exposure -> ${ex.label} on ${selectedCamera.name} (${target})`);
                        }}
                        style={{
                          height: 30,
                          borderRadius: 5,
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          background: active ? "#5B21B6" : "#161B24",
                          border: `1px solid ${active ? "#A78BFA" : "#283344"}`,
                          color: "#FFFFFF",
                        }}
                      >
                        {ex.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const ip = selectedCamera.ip.trim();
                  const port = selectedCamera.port;
                  onOptics?.(ip, port, "home");
                  onHome?.(ip, port);
                  setStatusNote(`HOME sent to ${selectedCamera.name} (${target})`);
                }}
                className="btn"
                style={{
                  height: 42,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  background: "linear-gradient(180deg, #1D4ED8, #1E3A8A)",
                  border: "1px solid #60A5FA",
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                <Home size={17} /> HOME / RECENTER
              </button>
            </div>

            <div
              style={{
                background: "#161F30",
                border: "1px solid #233044",
                borderRadius: 10,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={sectionLabel}>LIVE CAMERA PREVIEW</span>
                <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>{selectedCamera.name}</span>
              </div>
              <CameraPreview url={selectedCamera.previewUrl || ""} name={selectedCamera.name} />
              <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.5 }}>
                Feeds are rendered directly from the camera's <code className="mono">previewUrl</code>.
                Image URLs are shown as MJPEG snapshots; HLS / MP4 / WebM URLs use the video player.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 22px",
            borderTop: "1px solid #1F2937",
            backgroundColor: "#182234",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span className="mono" style={{ fontSize: 12, color: "#93C5FD" }}>
            {statusNote || "Hold arrow / focus / iris buttons • Release anywhere to stop • Roster auto-saves locally"}
          </span>
          <button type="button" onClick={onClose} className="btn" style={{ height: 38, padding: "0 22px" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default PtzControlDeckModal;
