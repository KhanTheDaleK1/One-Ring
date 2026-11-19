import React, { useState } from "react";
import { Sliders, Activity, Power, X, RefreshCw, Volume2, Waves } from "lucide-react";

export type FxType =
  | "HALL_REVERB"
  | "PLATE_REVERB"
  | "STEREO_DELAY"
  | "GRAPHIC_EQ_31"
  | "PRECISION_LIMITER"
  | "DE_ESSER"
  | "STEREO_CHORUS"
  | "COMBINATOR";

export interface FxSlot {
  slotId: number; // 1 to 8
  type: FxType;
  name: string;
  enabled: boolean;
  sourceBus: number; // 1 to 16
  returnChannel: number; // 1 to 32 or aux
  parameters: { [key: string]: number };
}

interface ConsoleFxRackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEmitOsc?: (address: string, val: number | string) => void;
}

interface ParamSpec {
  min: number;
  max: number;
  step: number;
  unit: string;
}

const PARAM_SPECS: Record<string, ParamSpec> = {
  decayTime: { min: 0.2, max: 10.0, step: 0.1, unit: "s" },
  preDelayMs: { min: 0, max: 200, step: 1, unit: "ms" },
  highCutKhz: { min: 1.0, max: 20.0, step: 0.5, unit: "kHz" },
  highDampKhz: { min: 1.0, max: 20.0, step: 0.5, unit: "kHz" },
  lowCutHz: { min: 20, max: 400, step: 5, unit: "Hz" },
  wetMix: { min: 0, max: 100, step: 1, unit: "%" },
  delayMs: { min: 1, max: 1000, step: 5, unit: "ms" },
  feedbackPct: { min: 0, max: 100, step: 1, unit: "%" },
  speedHz: { min: 0.1, max: 10.0, step: 0.1, unit: "Hz" },
  depthPct: { min: 0, max: 100, step: 1, unit: "%" },
  phaseDeg: { min: 0, max: 180, step: 5, unit: "°" },
  gainDb: { min: -15, max: 15, step: 0.5, unit: "dB" },
  frequencyKhz: { min: 1.0, max: 16.0, step: 0.1, unit: "kHz" },
  thresholdDb: { min: -60, max: 0, step: 0.5, unit: "dB" },
  ratio: { min: 1.0, max: 20.0, step: 0.5, unit: ":1" },
  ceilingDb: { min: -18, max: 0, step: 0.1, unit: "dB" },
  releaseMs: { min: 10, max: 1000, step: 10, unit: "ms" },
  driveDb: { min: 0, max: 18, step: 0.5, unit: "dB" },
  densityPct: { min: 0, max: 100, step: 1, unit: "%" },
  speed: { min: 0, max: 10, step: 0.5, unit: "" },
};

function getParamSpec(paramName: string): ParamSpec {
  return PARAM_SPECS[paramName] ?? { min: 0, max: 100, step: 1, unit: "" };
}

export const ConsoleFxRackModal: React.FC<ConsoleFxRackModalProps> = ({
  isOpen,
  onClose,
  onEmitOsc,
}) => {
  const [selectedSlot, setSelectedSlot] = useState<number>(1);
  const [slots, setSlots] = useState<FxSlot[]>([
    {
      slotId: 1,
      type: "HALL_REVERB",
      name: "Vocal Hall Reverb",
      enabled: true,
      sourceBus: 13,
      returnChannel: 1,
      parameters: { decayTime: 2.4, preDelayMs: 35, highCutKhz: 8.5, wetMix: 85 },
    },
    {
      slotId: 2,
      type: "PLATE_REVERB",
      name: "Snare & Acoustic Plate",
      enabled: true,
      sourceBus: 14,
      returnChannel: 2,
      parameters: { decayTime: 1.6, preDelayMs: 15, highCutKhz: 11.0, wetMix: 65 },
    },
    {
      slotId: 3,
      type: "STEREO_DELAY",
      name: "Tap Delay (1/4 Note)",
      enabled: true,
      sourceBus: 15,
      returnChannel: 3,
      parameters: { delayMs: 480, feedbackPct: 35, highDampKhz: 6.0, wetMix: 40 },
    },
    {
      slotId: 4,
      type: "STEREO_CHORUS",
      name: "Worship Acoustic Chorus",
      enabled: true,
      sourceBus: 16,
      returnChannel: 4,
      parameters: { speedHz: 0.8, depthPct: 45, phaseDeg: 90, wetMix: 50 },
    },
    {
      slotId: 5,
      type: "GRAPHIC_EQ_31",
      name: "Dual 31-Band Main EQ",
      enabled: true,
      sourceBus: 1,
      returnChannel: 5,
      parameters: { lowCutHz: 30, highCutKhz: 18, gainDb: 0 },
    },
    {
      slotId: 6,
      type: "DE_ESSER",
      name: "Pastor Vocal De-Esser",
      enabled: true,
      sourceBus: 2,
      returnChannel: 6,
      parameters: { frequencyKhz: 6.2, thresholdDb: -24, ratio: 4.5 },
    },
    {
      slotId: 7,
      type: "PRECISION_LIMITER",
      name: "Broadcast Out Limiter",
      enabled: true,
      sourceBus: 3,
      returnChannel: 7,
      parameters: { ceilingDb: -0.5, releaseMs: 120, driveDb: 3.5 },
    },
    {
      slotId: 8,
      type: "COMBINATOR",
      name: "5-Band Master Multi-Band",
      enabled: true,
      sourceBus: 4,
      returnChannel: 8,
      parameters: { thresholdDb: -18, densityPct: 60, speed: 2 },
    },
  ]);

  if (!isOpen) return null;

  const currentSlot = slots.find((s) => s.slotId === selectedSlot) || slots[0];

  const handleToggleEnable = (slotId: number) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.slotId === slotId) {
          const next = !s.enabled;
          onEmitOsc?.(`/fx/${slotId}/insert/on`, next ? 1 : 0);
          return { ...s, enabled: next };
        }
        return s;
      })
    );
  };

  const handleParamChange = (paramKey: string, val: number, paramIndex: number) => {
    const spec = getParamSpec(paramKey);
    const clamped = Math.max(spec.min, Math.min(spec.max, val));
    setSlots((prev) =>
      prev.map((s) => {
        if (s.slotId === currentSlot.slotId) {
          return { ...s, parameters: { ...s.parameters, [paramKey]: clamped } };
        }
        return s;
      })
    );
    const normalized =
      spec.max > spec.min ? (clamped - spec.min) / (spec.max - spec.min) : 0;
    const parNum = String(paramIndex + 1).padStart(2, "0");
    onEmitOsc?.(`/fx/${currentSlot.slotId}/par/${parNum}`, Math.max(0, Math.min(1, normalized)));
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
          width: "980px",
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
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Waves size={24} color="#38BDF8" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#F9FAFB" }}>
                Console Virtual 8-Slot Stereo FX Rack
              </h2>
              <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                Internal DSP Processors • Reverbs, Delays, Graphic EQs, De-Esser & Combinators
              </span>
            </div>
          </div>
          <button onClick={onClose} className="btn" style={{ padding: "6px 8px", background: "transparent", border: "none" }}>
            <X size={20} color="#9CA3AF" />
          </button>
        </div>

        {/* 8-Slot Selector Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(8, 1fr)",
            gap: 8,
            padding: "14px 20px",
            backgroundColor: "#131C2E",
            borderBottom: "1px solid #1F2937",
          }}
        >
          {slots.map((s) => {
            const isSelected = s.slotId === selectedSlot;
            return (
              <button
                key={s.slotId}
                type="button"
                onClick={() => setSelectedSlot(s.slotId)}
                className="btn"
                style={{
                  height: 60,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "6px 4px",
                  borderRadius: 8,
                  backgroundColor: isSelected ? "#1E3A8A" : "#1F2937",
                  borderColor: isSelected ? "#38BDF8" : "#374151",
                  borderWidth: isSelected ? 2 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? "#38BDF8" : "#9CA3AF" }}>
                    FX {s.slotId}
                  </span>
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      backgroundColor: s.enabled ? "#34D399" : "#6B7280",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: "#D1D5DB",
                    marginTop: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {s.type.replace(/_/g, " ")}
                </span>
              </button>
            );
          })}
        </div>

        {/* Current FX Editor Panel */}
        <div style={{ flex: 1, padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderRadius: 10,
              backgroundColor: "#1F2937",
              border: "1px solid #374151",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#38BDF8" }}>
                  SLOT {currentSlot.slotId}
                </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#F9FAFB" }}>
                  {currentSlot.name}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>
                Algorithm: {currentSlot.type} • Send Bus: #{currentSlot.sourceBus} • Return: Ch #{currentSlot.returnChannel}
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleToggleEnable(currentSlot.slotId)}
              className="btn"
              style={{
                height: 42,
                padding: "0 18px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                backgroundColor: currentSlot.enabled ? "#065F46" : "#27171A",
                borderColor: currentSlot.enabled ? "#059669" : "#7F1D1D",
                color: currentSlot.enabled ? "#A7F3D0" : "#FCA5A5",
              }}
            >
              <Power size={16} />
              {currentSlot.enabled ? "ACTIVE (Bypassed=Off)" : "BYPASSED"}
            </button>
          </div>

          {/* Parameters Controls */}
          <div
            style={{
              padding: 20,
              borderRadius: 10,
              backgroundColor: "#161F30",
              border: "1px solid #233044",
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 20,
            }}
          >
            {Object.entries(currentSlot.parameters).map(([paramName, val], paramIndex) => {
              const spec = getParamSpec(paramName);
              return (
                <div
                  key={paramName}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: "#1F2937",
                    border: "1px solid #374151",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF", textTransform: "capitalize", marginBottom: 8 }}>
                    {paramName.replace(/([A-Z])/g, " $1")}
                  </span>
                  <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "#38BDF8", marginBottom: 12 }}>
                    {val}{spec.unit ? ` ${spec.unit}` : ""}
                  </span>
                  <input
                    type="range"
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    value={val}
                    onChange={(e) => handleParamChange(paramName, parseFloat(e.target.value), paramIndex)}
                    style={{ width: "100%", accentColor: "#38BDF8", cursor: "pointer" }}
                  />
                </div>
              );
            })}
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
          <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
            Bi-directional OSC sync on UDP port 10023
          </span>
          <button onClick={onClose} className="btn" style={{ height: 38, padding: "0 22px" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
