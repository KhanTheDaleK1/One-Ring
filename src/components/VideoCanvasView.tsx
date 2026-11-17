import React from "react";
import {
  Camera,
  Video,
  Radio,
  Wifi,
  Sliders,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import type { AppStateSnapshot } from "../types";

interface VideoCanvasViewProps {
  state: AppStateSnapshot;
  onRecallCamera: (presetId: string) => void;
  onSwitchNdiReceiver: (rxId: string, src: string) => void;
}

export const VideoCanvasView: React.FC<VideoCanvasViewProps> = ({
  state,
  onRecallCamera,
  onSwitchNdiReceiver,
}) => {
  const cameras = state.cameras || [];
  const activeCamera = cameras.find((c) => c.id === state.activeCameraPresetId) || cameras[0];

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
      {/* Header */}
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
            <Camera size={18} color="#EF4444" />
            <strong style={{ fontSize: 16 }}>Video Switching & PTZ Cameras</strong>
          </div>
          <span style={{ fontSize: 12, color: "#64748B" }}>•</span>
          <span style={{ fontSize: 13, color: "#9CA3AF" }}>
            {cameras.length} camera presets configured
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 10px",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid #10B981",
              borderRadius: 6,
              color: "#34D399",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Wifi size={12} /> VISCA over IP :52381
          </span>
        </div>
      </div>

      {/* Main Multiview + PTZ Controls Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, flex: 1, minHeight: 0 }}>
        {/* Left: Multiview Camera Wall */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Camera Presets & Tally Grid
          </span>

          {cameras.length === 0 ? (
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
              <Video size={40} color="#475569" />
              <div>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>No Camera Presets Defined</h4>
                <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: 13, maxWidth: 360 }}>
                  Add PTZ camera angles for your pulpit, worship band, and wide congregation shots in Settings.
                </p>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              {cameras.map((cam) => {
                const isProgram = cam.tally === "program" || cam.id === state.activeCameraPresetId;
                const isPreview = cam.tally === "preview";
                return (
                  <div
                    key={cam.id}
                    onClick={() => onRecallCamera(cam.id)}
                    style={{
                      aspectRatio: "16 / 9",
                      background: "#121721",
                      border: isProgram
                        ? "3px solid #EF4444"
                        : isPreview
                        ? "3px solid #10B981"
                        : "1px solid #283344",
                      borderRadius: 8,
                      padding: 12,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      position: "relative",
                      boxShadow: isProgram ? "0 0 16px rgba(239, 68, 68, 0.4)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF" }}>
                        {cam.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: isProgram ? "#DC2626" : isPreview ? "#059669" : "#1E2533",
                          color: isProgram || isPreview ? "#FFFFFF" : "#94A3B8",
                        }}
                      >
                        {isProgram ? "ON AIR" : isPreview ? "PREVIEW" : "STANDBY"}
                      </span>
                    </div>

                    <div style={{ textAlign: "center", color: "#64748B", fontSize: 12, fontStyle: "italic" }}>
                      [IP Video Stream: {cam.protocol || "1080p60 NDI"}]
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94A3B8" }}>
                      <span>VISCA Preset #{cam.presetIndex}</span>
                      <span>Recall Angle</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: PTZ Pan/Tilt/Zoom Joystick Controls */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            PTZ Pan / Tilt / Zoom Control
          </span>

          <div
            style={{
              padding: 12,
              background: "#161B24",
              border: "1px solid #283344",
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            <div style={{ color: "#64748B" }}>Selected Camera:</div>
            <strong style={{ fontSize: 14, color: "#FFFFFF" }}>
              {activeCamera ? activeCamera.name : "No Camera Selected"}
            </strong>
          </div>

          {/* D-Pad Directional Controller */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
              maxWidth: 200,
              margin: "12px auto",
            }}
          >
            <div />
            <button
              type="button"
              style={{
                height: 50,
                background: "#1E2533",
                border: "1px solid #3B82F6",
                borderRadius: 8,
                color: "#60A5FA",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronUp size={24} />
            </button>
            <div />

            <button
              type="button"
              style={{
                height: 50,
                background: "#1E2533",
                border: "1px solid #3B82F6",
                borderRadius: 8,
                color: "#60A5FA",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronLeft size={24} />
            </button>
            <div
              style={{
                height: 50,
                background: "#0F131A",
                border: "1px solid #232D3F",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748B",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              PTZ
            </div>
            <button
              type="button"
              style={{
                height: 50,
                background: "#1E2533",
                border: "1px solid #3B82F6",
                borderRadius: 8,
                color: "#60A5FA",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronRight size={24} />
            </button>

            <div />
            <button
              type="button"
              style={{
                height: 50,
                background: "#1E2533",
                border: "1px solid #3B82F6",
                borderRadius: 8,
                color: "#60A5FA",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronDown size={24} />
            </button>
            <div />
          </div>

          {/* Zoom Buttons */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              type="button"
              style={{
                height: 40,
                background: "#161B24",
                border: "1px solid #283344",
                borderRadius: 8,
                color: "#E2E8F0",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Zoom In (+)
            </button>
            <button
              type="button"
              style={{
                height: 40,
                background: "#161B24",
                border: "1px solid #283344",
                borderRadius: 8,
                color: "#E2E8F0",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Zoom Out (-)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
