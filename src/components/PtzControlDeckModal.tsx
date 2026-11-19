import React, { useState } from "react";
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
  onDrive?: (pan: number, tilt: number, zoom: number) => void;
  onRecallPreset?: (presetNum: number) => void;
  onSavePreset?: (presetNum: number, name: string) => void;
}

export const PtzControlDeckModal: React.FC<PtzControlDeckModalProps> = ({
  isOpen,
  onClose,
  cameraId = "cam1",
  cameraName = "Pastor Pulpit Cam (PTZ 1)",
  onDrive,
  onRecallPreset,
  onSavePreset,
}) => {
  const [speed, setSpeed] = useState<number>(12);
  const [activeDirection, setActiveDirection] = useState<string | null>(null);
  const [presets, setPresets] = useState<PtzPreset[]>([
    { id: "p1", name: "Pulpit Center", presetNumber: 1 },
    { id: "p2", name: "Stage Wide", presetNumber: 2 },
    { id: "p3", name: "Baptistry / Altar", presetNumber: 3 },
    { id: "p4", name: "Worship Leader Close", presetNumber: 4 },
    { id: "p5", name: "Band / Keys", presetNumber: 5 },
    { id: "p6", name: "Choir / Crowd", presetNumber: 6 },
  ]);
  const [editingPreset, setEditingPreset] = useState<number | null>(null);
  const [presetNameInput, setPresetNameInput] = useState<string>("");

  if (!isOpen) return null;

  const handlePointerDown = (dir: string, pan: number, tilt: number, zoom: number) => {
    setActiveDirection(dir);
    onDrive?.(pan, tilt, zoom);
  };

  const handlePointerUp = () => {
    setActiveDirection(null);
    onDrive?.(0, 0, 0);
  };

  const handleSaveClick = (presetNum: number) => {
    setEditingPreset(presetNum);
    const existing = presets.find((p) => p.presetNumber === presetNum);
    setPresetNameInput(existing ? existing.name : `Preset ${presetNum}`);
  };

  const handleConfirmSave = (presetNum: number) => {
    onSavePreset?.(presetNum, presetNameInput);
    setPresets((prev) =>
      prev.map((p) => (p.presetNumber === presetNum ? { ...p, name: presetNameInput } : p))
    );
    setEditingPreset(null);
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
          width: "820px",
          maxHeight: "85vh",
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
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Video size={22} color="#38BDF8" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#F9FAFB" }}>
                PTZ Control Deck & Preset Programmer
              </h2>
              <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                Target: {cameraName} • Protocol: VISCA-over-IP (:52381) / NDI PTZ
              </span>
            </div>
          </div>
          <button onClick={onClose} className="btn" style={{ padding: "6px 8px", background: "transparent", border: "none" }}>
            <X size={20} color="#9CA3AF" />
          </button>
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
                type="button"
                onPointerDown={() => handlePointerDown("UP", 0, 1, 0)}
                onPointerUp={handlePointerUp}
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
                type="button"
                onPointerDown={() => handlePointerDown("LEFT", -1, 0, 0)}
                onPointerUp={handlePointerUp}
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 10,
                  backgroundColor: "#161F30",
                  border: "1px solid #233044",
                }}
              >
                <Sliders size={18} color="#38BDF8" />
              </div>
              <button
                type="button"
                onPointerDown={() => handlePointerDown("RIGHT", 1, 0, 0)}
                onPointerUp={handlePointerUp}
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
                type="button"
                onPointerDown={() => handlePointerDown("DOWN", 0, -1, 0)}
                onPointerUp={handlePointerUp}
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
                type="button"
                onPointerDown={() => handlePointerDown("ZOOM_IN", 0, 0, 1)}
                onPointerUp={handlePointerUp}
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
                type="button"
                onPointerDown={() => handlePointerDown("ZOOM_OUT", 0, 0, -1)}
                onPointerUp={handlePointerUp}
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
                      onClick={() => onRecallPreset?.(p.presetNumber)}
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
            justifyContent: "flex-end",
          }}
        >
          <button onClick={onClose} className="btn" style={{ height: 38, padding: "0 22px" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
