import React, { useCallback, useEffect, useRef, useState } from "react";
import { Video, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, Save, Play, X, Sliders } from "lucide-react";

export interface PtzPreset {
  id: string;
  name: string;
  presetNumber: number;
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
}

const PRESETS_STORAGE_KEY = "onering_ptz_presets_v1";

const DEFAULT_PRESETS: PtzPreset[] = [
  { id: "p1", name: "Pulpit Center", presetNumber: 1 },
  { id: "p2", name: "Stage Wide", presetNumber: 2 },
  { id: "p3", name: "Baptistry / Altar", presetNumber: 3 },
  { id: "p4", name: "Worship Leader Close", presetNumber: 4 },
  { id: "p5", name: "Band / Keys", presetNumber: 5 },
  { id: "p6", name: "Choir / Crowd", presetNumber: 6 },
];

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
}) => {
  const [speed, setSpeed] = useState<number>(12);
  const [cameraIp, setCameraIp] = useState<string>(defaultIp);
  const [cameraPort, setCameraPort] = useState<number>(defaultPort || 52381);
  const [activeDirection, setActiveDirection] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [presets, setPresets] = useState<PtzPreset[]>(() => {
    try {
      const saved = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_PRESETS;
  });
  const [editingPreset, setEditingPreset] = useState<number | null>(null);
  const [presetNameInput, setPresetNameInput] = useState<string>("");
  const activeDirRef = useRef<string | null>(null);

  const stopMotion = useCallback(() => {
    if (activeDirRef.current === null) return;
    activeDirRef.current = null;
    setActiveDirection(null);
    onDrive?.(0, 0, 0, cameraIp.trim(), cameraPort);
  }, [onDrive, cameraIp, cameraPort]);

  // Safety guarantee: release anywhere on window or focus loss ALWAYS halts camera motors.
  useEffect(() => {
    if (!isOpen) return;
    const onGlobalRelease = () => stopMotion();
    window.addEventListener("pointerup", onGlobalRelease);
    window.addEventListener("pointercancel", onGlobalRelease);
    window.addEventListener("blur", onGlobalRelease);
    return () => {
      window.removeEventListener("pointerup", onGlobalRelease);
      window.removeEventListener("pointercancel", onGlobalRelease);
      window.removeEventListener("blur", onGlobalRelease);
      stopMotion();
    };
  }, [isOpen, stopMotion]);

  if (!isOpen) return null;

  const handlePointerDown = (dir: string, panSign: number, tiltSign: number, zoomSign: number) => {
    activeDirRef.current = dir;
    setActiveDirection(dir);
    const ptSpeed = Math.max(1, Math.min(24, speed));
    const zoomSpeed = Math.max(1, Math.min(7, Math.round((speed / 24) * 7)));
    const pan = panSign * ptSpeed;
    const tilt = tiltSign * Math.min(20, ptSpeed);
    const zoom = zoomSign * zoomSpeed;
    onDrive?.(pan, tilt, zoom, cameraIp.trim(), cameraPort);
    setStatusNote(`Driving ${dir} @ speed ${zoomSign !== 0 ? zoomSpeed : ptSpeed} -> ${cameraIp}:${cameraPort}`);
  };

  const handleSaveClick = (presetNum: number) => {
    setEditingPreset(presetNum);
    const existing = presets.find((p) => p.presetNumber === presetNum);
    setPresetNameInput(existing ? existing.name : `Preset ${presetNum}`);
  };

  const handleConfirmSave = (presetNum: number) => {
    const cleanName = presetNameInput.trim() || `Preset ${presetNum}`;
    onSavePreset?.(presetNum, cleanName, cameraIp.trim(), cameraPort);
    setPresets((prev) => {
      const updated = prev.map((p) =>
        p.presetNumber === presetNum ? { ...p, name: cleanName } : p
      );
      try {
        localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setStatusNote(`Stored Preset #${presetNum} ("${cleanName}") on ${cameraIp}:${cameraPort}`);
    setEditingPreset(null);
  };

  const handleRecall = (presetNum: number, name: string) => {
    onRecallPreset?.(presetNum, cameraIp.trim(), cameraPort);
    setStatusNote(`Recalled Preset #${presetNum} ("${name}") on ${cameraIp}:${cameraPort}`);
  };

  const motionButtonProps = (dir: string, pan: number, tilt: number, zoom: number) => ({
    type: "button" as const,
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      handlePointerDown(dir, pan, tilt, zoom);
    },
    onPointerUp: stopMotion,
    onPointerLeave: stopMotion,
    onPointerCancel: stopMotion,
  });

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
          width: "840px",
          maxHeight: "88vh",
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
            padding: "16px 22px",
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
                Target: {cameraName} ({cameraId}) • PTZ-IP-over-IP UDP
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="text"
              aria-label="PTZ Camera IP"
              value={cameraIp}
              onChange={(e) => setCameraIp(e.target.value)}
              placeholder="Camera IP"
              className="mono"
              style={{
                width: 132,
                height: 32,
                backgroundColor: "#0B0D10",
                border: "1px solid #374151",
                borderRadius: 6,
                padding: "0 8px",
                color: "#E5E7EB",
                fontSize: 12,
              }}
            />
            <input
              type="number"
              aria-label="PTZ-IP UDP Port"
              value={cameraPort}
              min={1}
              max={65535}
              onChange={(e) => setCameraPort(Math.max(1, Math.min(65535, Number(e.target.value) || 52381)))}
              className="mono"
              style={{
                width: 72,
                height: 32,
                backgroundColor: "#0B0D10",
                border: "1px solid #374151",
                borderRadius: 6,
                padding: "0 8px",
                color: "#93C5FD",
                fontSize: 12,
              }}
            />
            <button onClick={onClose} className="btn" style={{ padding: "6px 8px", background: "transparent", border: "none" }}>
              <X size={20} color="#9CA3AF" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.2fr", flex: 1, padding: 22, gap: 20 }}>
          {/* Virtual Directional Joystick & Zoom */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#9CA3AF" }}>VIRTUAL PAN / TILT PAD</span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 64px)",
                gridTemplateRows: "repeat(3, 64px)",
                gap: 8,
              }}
            >
              <div />
              <button
                {...motionButtonProps("UP", 0, 1, 0)}
                className="btn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: activeDirection === "UP" ? "#0284C7" : "#1F2937",
                }}
              >
                <ArrowUp size={24} />
              </button>
              <div />

              <button
                {...motionButtonProps("LEFT", -1, 0, 0)}
                className="btn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: activeDirection === "LEFT" ? "#0284C7" : "#1F2937",
                }}
              >
                <ArrowLeft size={24} />
              </button>
              <button
                type="button"
                onClick={stopMotion}
                title="Emergency Stop PTZ Motors"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 10,
                  backgroundColor: "#161F30",
                  border: "1px solid #233044",
                  cursor: "pointer",
                }}
              >
                <Sliders size={18} color="#38BDF8" />
              </button>
              <button
                {...motionButtonProps("RIGHT", 1, 0, 0)}
                className="btn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: activeDirection === "RIGHT" ? "#0284C7" : "#1F2937",
                }}
              >
                <ArrowRight size={24} />
              </button>

              <div />
              <button
                {...motionButtonProps("DOWN", 0, -1, 0)}
                className="btn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: activeDirection === "DOWN" ? "#0284C7" : "#1F2937",
                }}
              >
                <ArrowDown size={24} />
              </button>
              <div />
            </div>

            {/* Zoom Controls & Speed */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
              <button
                {...motionButtonProps("ZOOM_IN", 0, 0, 1)}
                className="btn"
                style={{
                  height: 44,
                  padding: "0 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: activeDirection === "ZOOM_IN" ? "#0284C7" : "#1F2937",
                }}
              >
                <ZoomIn size={18} /> Zoom In
              </button>
              <button
                {...motionButtonProps("ZOOM_OUT", 0, 0, -1)}
                className="btn"
                style={{
                  height: 44,
                  padding: "0 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: activeDirection === "ZOOM_OUT" ? "#0284C7" : "#1F2937",
                }}
              >
                <ZoomOut size={18} /> Zoom Out
              </button>
            </div>
            <div style={{ width: "80%", display: "flex", alignItems: "center", gap: 10 }}>
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

          {/* Presets Programmer Panel */}
          <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid #1F2937", paddingLeft: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#9CA3AF", marginBottom: 12 }}>
              CAMERA PRESETS (RECALL & STORE)
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflowY: "auto" }}>
              {presets.map((p) => (
                <div
                  key={p.presetNumber}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
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
                        style={{
                          flex: 1,
                          height: 32,
                          backgroundColor: "#111827",
                          border: "1px solid #38BDF8",
                          borderRadius: 4,
                          padding: "0 8px",
                          color: "#F9FAFB",
                          fontSize: 12,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleConfirmSave(p.presetNumber)}
                        className="btn"
                        style={{ height: 32, padding: "0 10px", backgroundColor: "#0284C7", fontSize: 11 }}
                      >
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
                      style={{ height: 32, padding: "0 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Play size={12} /> Recall
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveClick(p.presetNumber)}
                      className="btn"
                      style={{ height: 32, padding: "0 8px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Save size={12} /> Store
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid #1F2937",
            backgroundColor: "#182234",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span className="mono" style={{ fontSize: 12, color: "#93C5FD" }}>
            {statusNote || "Hold arrow/zoom buttons to drive • Release anywhere to stop"}
          </span>
          <button type="button" onClick={onClose} className="btn" style={{ height: 38, padding: "0 22px" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
