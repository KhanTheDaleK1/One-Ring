import React, { useState } from "react";
import { Move, X, Check, RotateCw } from "lucide-react";
import type { SceneSourceItem, SourceTransform } from "../types";

interface SourceTransformModalProps {
  source: SceneSourceItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveTransform: (sourceId: string, transform: SourceTransform) => void;
}

export const DEFAULT_TRANSFORM: SourceTransform = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  rotation: 0,
  scaleFilter: "bicubic",
  blendingMode: "normal",
  deinterlacing: "disable",
  flipH: false,
  flipV: false,
};

export const SourceTransformModal: React.FC<SourceTransformModalProps> = ({
  source,
  isOpen,
  onClose,
  onSaveTransform,
}) => {
  if (!isOpen || !source) return null;

  const [transform, setTransform] = useState<SourceTransform>({
    ...DEFAULT_TRANSFORM,
    ...(source.transform || {}),
  });

  const patch = <K extends keyof SourceTransform>(key: K, val: SourceTransform[K]) => {
    setTransform((prev) => ({ ...prev, [key]: val }));
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
        zIndex: 10004,
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 500,
          background: "#121721",
          border: "1px solid #3B82F6",
          borderRadius: 12,
          padding: 24,
          color: "#E2E8F0",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 20px 50px rgba(0,0,0,0.65)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Move size={18} color="#60A5FA" />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#FFFFFF" }}>
              Scene Item Transform: {source.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Position X</label>
            <input type="number" style={inputStyle} value={transform.x} onChange={(e) => patch("x", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Position Y</label>
            <input type="number" style={inputStyle} value={transform.y} onChange={(e) => patch("y", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Width (px)</label>
            <input type="number" style={inputStyle} value={transform.width} onChange={(e) => patch("width", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Height (px)</label>
            <input type="number" style={inputStyle} value={transform.height} onChange={(e) => patch("height", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Rotation (deg)</label>
            <input type="number" style={inputStyle} value={transform.rotation} onChange={(e) => patch("rotation", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Scale Filtering</label>
            <select style={inputStyle} value={transform.scaleFilter} onChange={(e) => patch("scaleFilter", e.target.value as any)}>
              <option value="disable">Disable</option>
              <option value="point">Point (Sharp Pixel)</option>
              <option value="bilinear">Bilinear</option>
              <option value="bicubic">Bicubic (Sharpened 16 samples)</option>
              <option value="lanczos">Lanczos (36 samples)</option>
              <option value="area">Area</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Blending Mode</label>
            <select style={inputStyle} value={transform.blendingMode} onChange={(e) => patch("blendingMode", e.target.value as any)}>
              <option value="normal">Normal</option>
              <option value="additive">Add</option>
              <option value="subtract">Subtract</option>
              <option value="screen">Screen</option>
              <option value="multiply">Multiply</option>
              <option value="lighten">Lighten</option>
              <option value="darken">Darken</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Deinterlacing</label>
            <select style={inputStyle} value={transform.deinterlacing} onChange={(e) => patch("deinterlacing", e.target.value as any)}>
              <option value="disable">Disable</option>
              <option value="discard">Discard</option>
              <option value="retro">Retro</option>
              <option value="blend">Blend</option>
              <option value="linear">Linear</option>
              <option value="yadif">Yadif 2x</option>
            </select>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setTransform({ ...DEFAULT_TRANSFORM })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              background: "#1E2533",
              border: "1px solid #2E3748",
              color: "#CBD5E1",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <RotateCw size={13} /> Reset Transform
          </button>

          <div style={{ display: "flex", gap: 8 }}>
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
                onSaveTransform(source.id, transform);
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
              <Check size={16} /> Apply Transform
            </button>
          </div>
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
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  background: "#0B0E14",
  border: "1px solid #2B3545",
  borderRadius: 6,
  color: "#FFFFFF",
  fontSize: 13,
  boxSizing: "border-box",
};
