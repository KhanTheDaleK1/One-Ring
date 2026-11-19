import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  COLOR_MAP,
  type ConsoleBankId,
  type X32ChannelStripState,
  type X32TopScreenTab,
  biquadDbAtFreq,
  faderDbToFraction,
  formatDbCompact,
  fractionToFaderDb,
  hpfDbAtFreq,
  normToFreq,
} from "./x32Shared";

export interface X32MixerOverviewProps {
  channels: X32ChannelStripState[];
  visibleChannels: X32ChannelStripState[];
  selectedChannel: X32ChannelStripState;
  activeBank: ConsoleBankId;
  sendsOnFader: boolean;
  sofTarget: string;
  sendLevels: Record<string, Record<string, number>>;
  muteGroups: boolean[];
  talkbackA: boolean;
  talkbackB: boolean;
  automixGroups: Record<string, "Off" | "X" | "Y">;
  channelLinks: Record<string, boolean>;
  clockSource: "48kHz Internal" | "AES50" | "Card";
  mainLrDb: number;
  mainLrMeterLevel: number;
  mainLrMute: boolean;
  mainLrSolo: boolean;
  monoMcMode: boolean;
  sceneIndex: number;
  sceneName: string;
  canUndo: boolean;
  hasCopiedChannel: boolean;
  compactWidth: boolean;
  bankEditMode: boolean;
  userLayerIds: Record<"user1" | "user2", string[]>;
  onSelectChannel: (id: string) => void;
  onChangeBank: (bank: ConsoleBankId) => void;
  onToggleUserAssign: (channelId: string) => void;
  onToggleBankEdit: () => void;
  onSaveUserLayer: () => void;
  onLoadUserLayer: () => void;
  onChangeFader: (chId: string, db: number) => void;
  onChangeMainLrDb: (db: number) => void;
  onToggleMainLrMute: () => void;
  onToggleMainLrSolo: () => void;
  onToggleMonoMc: () => void;
  onToggleMute: (chId: string) => void;
  onToggleSolo: (chId: string) => void;
  onClearAllSolos: () => void;
  onTogglePhantom: (chId: string) => void;
  onTogglePolarity: (chId: string) => void;
  onAdjustGain: (chId: string, nextGain: number) => void;
  onRenameChannel: (chId: string, nextName: string) => void;
  onSelectBusTarget: (busId: string | null) => void;
  onToggleMuteGroup: (idx: number) => void;
  onToggleTalkback: (which: "A" | "B") => void;
  onToggleAutomix: (chId: string, group: "X" | "Y") => void;
  onOpenScreenTab: (tab: X32TopScreenTab) => void;
  onToggleResize: () => void;
  onSceneStep: (delta: number) => void;
  onSceneGo: () => void;
  onSceneUndo: () => void;
  onSaveScn: () => void;
  onLoadScn: () => void;
  onCopyChannel: () => void;
  onPasteChannel: () => void;
}

const DCA_BADGE_COLORS = [
  "#EF4444",
  "#22C55E",
  "#EAB308",
  "#3B82F6",
  "#EC4899",
  "#06B6D4",
  "#F97316",
  "#A855F7",
];

const LEFT_BANK_BUTTONS: Array<{ id: ConsoleBankId; label: string; sub?: string }> = [
  { id: "ch1_32", label: "1-32" },
  { id: "ch1_16", label: "1-16", sub: "DCA" },
  { id: "ch17_32", label: "17-32", sub: "DCA" },
  { id: "aux_fx", label: "Aux", sub: "FX" },
  { id: "bus1_16", label: "Bus", sub: "Mtx" },
  { id: "all", label: "All" },
  { id: "user1", label: "User 1" },
  { id: "user2", label: "User 2" },
];

const MiniGateSvg: React.FC<{ channel: X32ChannelStripState }> = React.memo(({ channel }) => {
  const threshNorm = Math.max(0, Math.min(1, (channel.gate.threshold + 80) / 80));
  const kneeX = (1 - threshNorm) * 20 + 6;
  const dropY = channel.gate.on ? Math.min(14, Math.max(4, (channel.gate.range / 60) * 14)) : 12;
  const pts = channel.gate.on
    ? `2,14 ${kneeX.toFixed(1)},14 ${(kneeX + 4).toFixed(1)},${(14 - dropY * 0.7).toFixed(1)} 34,2`
    : "2,14 34,2";

  return (
    <svg viewBox="0 0 36 16" style={{ width: "100%", height: 15, display: "block", background: "#0A0C0F", borderRadius: 2 }}>
      <polyline
        fill="none"
        stroke={channel.gate.on ? "#22D3EE" : "#475569"}
        strokeWidth="1.4"
        points={pts}
      />
    </svg>
  );
});

const MiniEqCompSvg: React.FC<{ channel: X32ChannelStripState }> = React.memo(({ channel }) => {
  const pathD = useMemo(() => {
    const samples = 18;
    const pts: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const norm = i / samples;
      const freq = normToFreq(norm);
      let db = 0;
      if (channel.eqOn) {
        for (const band of channel.eqBands) {
          db += biquadDbAtFreq(band, freq);
        }
      }
      if (channel.hpfOn) {
        db += hpfDbAtFreq(channel.hpfFreqHz, freq);
      }
      const x = (norm * 36).toFixed(1);
      const clamped = Math.max(-15, Math.min(15, db));
      const y = (11 - (clamped / 15) * 9).toFixed(1);
      pts.push(`${i === 0 ? "M" : "L"}${x},${y}`);
    }
    return pts.join(" ");
  }, [channel.eqBands, channel.eqOn, channel.hpfFreqHz, channel.hpfOn]);

  return (
    <svg viewBox="0 0 36 22" style={{ width: "100%", height: 21, display: "block", background: "#0A0C0F", borderRadius: 2 }}>
      <line x1="0" y1="11" x2="36" y2="11" stroke="#1E2533" strokeWidth="0.6" />
      <path d={`${pathD} L36,22 L0,22 Z`} fill={channel.eqOn ? "rgba(234, 88, 12, 0.34)" : "rgba(100,116,139,0.16)"} />
      <path d={pathD} fill="none" stroke={channel.eqOn ? "#F97316" : "#64748B"} strokeWidth="1.2" />
      {channel.comp.on && (
        <polyline
          fill="none"
          stroke="#38BDF8"
          strokeWidth="0.9"
          strokeOpacity="0.85"
          points="0,20 18,12 36,6"
        />
      )}
    </svg>
  );
});

const MiniHpfPanSvg: React.FC<{ channel: X32ChannelStripState }> = React.memo(({ channel }) => {
  const hpfX = Math.max(4, Math.min(16, ((channel.hpfFreqHz - 20) / 380) * 14 + 4));
  const panPos = 18 + (channel.pan / 100) * 14;
  return (
    <svg viewBox="0 0 36 14" style={{ width: "100%", height: 14, display: "block", background: "#0A0C0F", borderRadius: 2 }}>
      <polyline
        fill="none"
        stroke={channel.hpfOn ? "#06B6D4" : "#334155"}
        strokeWidth="1.3"
        points={`1,13 ${hpfX.toFixed(1)},12 ${(hpfX + 4).toFixed(1)},2 35,2`}
      />
      <polygon
        points={`${panPos.toFixed(1)},10 ${(panPos - 3).toFixed(1)},13 ${(panPos + 3).toFixed(1)},13`}
        fill="#22D3EE"
      />
    </svg>
  );
});

interface HardwareFaderTrackProps {
  valueDb: number;
  meterLevel: number;
  muted: boolean;
  notchColor: string;
  stereoMeter?: boolean;
  onChange: (db: number) => void;
}

const HardwareFaderTrack: React.FC<HardwareFaderTrackProps> = ({
  valueDb,
  meterLevel,
  muted,
  notchColor,
  stereoMeter = false,
  onChange,
}) => {
  const railRef = useRef<HTMLDivElement | null>(null);

  const updateFromY = useCallback(
    (clientY: number) => {
      const el = railRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const frac = 1 - (clientY - rect.top) / Math.max(1, rect.height);
      onChange(fractionToFaderDb(frac));
    },
    [onChange]
  );

  const frac = faderDbToFraction(valueDb);
  const meterFrac = muted || meterLevel <= -60 ? 0 : Math.max(0, Math.min(1, (meterLevel + 60) / 60));
  const activeLeds = Math.round(meterFrac * 10);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        gap: 2,
        flex: 1,
        minHeight: 155,
        padding: "2px 2px",
        userSelect: "none",
      }}
    >
      {/* Left hairline dB ticks */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontSize: 7,
          lineHeight: 1,
          color: "#6B7280",
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          textAlign: "right",
          width: 11,
          padding: "4px 0",
        }}
      >
        <span>10</span>
        <span>5</span>
        <span style={{ color: "#D1D5DB", fontWeight: 700 }}>0</span>
        <span>5</span>
        <span>10</span>
        <span>20</span>
        <span>30</span>
        <span>50</span>
      </div>

      {/* Sculpted fader slot */}
      <div
        ref={railRef}
        role="slider"
        aria-valuemin={-90}
        aria-valuemax={10}
        aria-valuenow={valueDb}
        title="Drag fader (-90 to +10 dB). Double-click for 0.0 dB Unity."
        onDoubleClick={(e) => {
          e.stopPropagation();
          onChange(0);
        }}
        onWheel={(e) => {
          e.stopPropagation();
          const step = e.deltaY < 0 ? 1 : -1;
          onChange(Math.max(-90, Math.min(10, Math.round((valueDb + step) * 2) / 2)));
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromY(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1 || e.pointerType === "touch") {
            updateFromY(e.clientY);
          }
        }}
        style={{
          position: "relative",
          width: 19,
          background: "#06080A",
          borderLeft: "1px solid #1C2026",
          borderRight: "1px solid #1C2026",
          borderRadius: 2,
          cursor: "ns-resize",
          touchAction: "none",
        }}
      >
        {/* Tick marks */}
        {[10, 5, 0, -5, -10, -20, -30, -50].map((tickDb) => {
          const tPct = faderDbToFraction(tickDb) * 86 + 7;
          return (
            <div
              key={tickDb}
              style={{
                position: "absolute",
                left: 1,
                right: 1,
                bottom: `${tPct}%`,
                height: tickDb === 0 ? 1.5 : 1,
                background: tickDb === 0 ? "#9CA3AF" : "#262B34",
                pointerEvents: "none",
              }}
            />
          );
        })}

        {/* Recessed fader track */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 6,
            bottom: 6,
            width: 3,
            transform: "translateX(-50%)",
            background: "#020304",
            border: "1px solid #181C22",
          }}
        />

        {/* Sculpted X32 silver/gray fader cap */}
        <div
          style={{
            position: "absolute",
            left: 1,
            right: 1,
            bottom: `calc(${frac * 86 + 7}% - 10px)`,
            height: 20,
            background:
              "linear-gradient(180deg, #9CA3AF 0%, #6B7280 20%, #D1D5DB 44%, #374151 56%, #4B5563 82%, #9CA3AF 100%)",
            border: "1px solid #111827",
            borderRadius: 2,
            boxShadow: "0 2px 5px rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              height: 2.5,
              background: muted ? "#64748B" : notchColor,
              boxShadow: muted ? "none" : `0 0 4px ${notchColor}`,
            }}
          />
        </div>
      </div>

      {/* Adjacent 10-LED segmented meter (stereo pair option for Master LR) */}
      <div style={{ display: "flex", gap: 1.5, padding: "4px 0" }}>
        {(stereoMeter ? [0, 1] : [0]).map((colIdx) => (
          <div
            key={colIdx}
            style={{
              width: stereoMeter ? 4 : 3.5,
              display: "flex",
              flexDirection: "column-reverse",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            {Array.from({ length: 10 }, (_, idx) => {
              const lit = idx < activeLeds;
              const segColor =
                idx === 9 ? "#EF4444" : idx >= 7 ? "#F59E0B" : "#22C55E";
              return (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    borderRadius: 0.5,
                    background: lit ? segColor : "#151920",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export const X32MixerOverview: React.FC<X32MixerOverviewProps> = ({
  channels,
  visibleChannels,
  selectedChannel,
  activeBank,
  sendsOnFader,
  sofTarget,
  sendLevels,
  muteGroups,
  talkbackA,
  talkbackB,
  automixGroups,
  channelLinks,
  clockSource,
  mainLrDb,
  mainLrMeterLevel,
  mainLrMute,
  mainLrSolo,
  monoMcMode,
  sceneIndex,
  sceneName,
  canUndo,
  hasCopiedChannel,
  compactWidth,
  bankEditMode,
  userLayerIds,
  onSelectChannel,
  onChangeBank,
  onToggleUserAssign,
  onToggleBankEdit,
  onSaveUserLayer,
  onLoadUserLayer,
  onChangeFader,
  onChangeMainLrDb,
  onToggleMainLrMute,
  onToggleMainLrSolo,
  onToggleMonoMc,
  onToggleMute,
  onToggleSolo,
  onClearAllSolos,
  onTogglePhantom,
  onTogglePolarity,
  onAdjustGain,
  onRenameChannel,
  onSelectBusTarget,
  onToggleMuteGroup,
  onToggleTalkback,
  onToggleAutomix,
  onOpenScreenTab,
  onToggleResize,
  onSceneStep,
  onSceneGo,
  onSceneUndo,
  onSaveScn,
  onLoadScn,
  onCopyChannel,
  onPasteChannel,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  const selColor = COLOR_MAP[selectedChannel.color];
  const selAutomix = automixGroups[selectedChannel.id] || "Off";
  const activeBusChannel = sendsOnFader
    ? channels.find((c) => c.id === sofTarget) || null
    : null;

  const masterLabel = activeBusChannel
    ? activeBusChannel.shortLabel
    : monoMcMode
      ? "M/C"
      : "LR";

  const minStripW = compactWidth ? 32 : 38;

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        background: "#050608",
        color: "#E5E7EB",
        overflow: "hidden",
      }}
    >
      {/* LEFT SIDEBAR: Selected Badge + Vertical Meter + Bank Layers */}
      <div
        style={{
          width: 68,
          flexShrink: 0,
          background: "#1A1D22",
          borderRight: "1px solid #000000",
          display: "flex",
          flexDirection: "column",
          padding: 3,
          gap: 3,
        }}
      >
        {/* Top Selected Channel Indicator */}
        <div
          onClick={() => onOpenScreenTab("config")}
          title="Click to edit Channel Config & Scribble Color"
          style={{
            background: "#0B0D10",
            border: "1px solid #2D323B",
            borderRadius: 2,
            padding: 3,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              background: selColor.bg,
              color: selColor.text,
              borderRadius: 2,
              padding: "3px 2px",
              fontSize: 10,
              fontWeight: 800,
              textAlign: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {selectedChannel.name}
          </div>
          <div
            style={{
              fontSize: 9.5,
              color: "#CBD5E1",
              textAlign: "center",
              marginTop: 2,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}
          >
            {selectedChannel.shortLabel}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "stretch",
              height: 46,
              marginTop: 3,
              padding: "2px 4px",
              background: "#050709",
              borderRadius: 2,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                fontSize: 6.5,
                color: "#6B7280",
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                lineHeight: 1,
              }}
            >
              <span>-5</span>
              <span>-10</span>
              <span>-20</span>
              <span>-30</span>
              <span>-50</span>
            </div>
            <div
              style={{
                width: 8,
                background: "#11151B",
                borderRadius: 1,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height:
                    selectedChannel.mute || selectedChannel.meterLevel <= -60
                      ? "0%"
                      : `${Math.max(0, Math.min(95, ((selectedChannel.meterLevel + 60) / 60) * 100))}%`,
                  background: "linear-gradient(180deg, #F59E0B 0%, #22C55E 65%)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Bank Save / Load / Move / Edit */}
        <div
          style={{
            borderTop: "1px solid #2A2F38",
            paddingTop: 3,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              color: "#9CA3AF",
              textAlign: "center",
              fontWeight: 700,
            }}
          >
            Bank
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <button type="button" onClick={onSaveUserLayer} style={utilBtnStyle(false)} title="Save User Layer">
              Save
            </button>
            <button type="button" onClick={onLoadUserLayer} style={utilBtnStyle(false)} title="Load User Layer">
              Load
            </button>
            <button
              type="button"
              onClick={() => onOpenScreenTab("sends")}
              style={utilBtnStyle(false)}
              title="Open Sends Detail"
            >
              Move
            </button>
            <button
              type="button"
              onClick={onToggleBankEdit}
              style={utilBtnStyle(bankEditMode)}
              title="Toggle User Layer Channel Assignment Mode"
            >
              Edit
            </button>
          </div>
        </div>

        {/* Layer Bank Stack */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            flex: 1,
            marginTop: 2,
          }}
        >
          {LEFT_BANK_BUTTONS.map((btn) => {
            const active = activeBank === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => onChangeBank(btn.id)}
                style={{
                  flex: 1,
                  minHeight: 32,
                  borderRadius: 3,
                  background: active
                    ? "linear-gradient(180deg, #27323F 0%, #17202B 100%)"
                    : "linear-gradient(180deg, #32363E 0%, #23262C 100%)",
                  border: `1.5px solid ${active ? "#22D3EE" : "#111317"}`,
                  boxShadow: active ? "0 0 8px rgba(34,211,238,0.28)" : "none",
                  color: active ? "#22D3EE" : "#E5E7EB",
                  fontSize: 10.5,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1.05,
                  padding: "2px 0",
                }}
              >
                <span>{btn.label}</span>
                {btn.sub && <span style={{ fontSize: 9, opacity: 0.9 }}>{btn.sub}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* CENTER OVERVIEW CHANNEL STRIPS */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
          overflowY: "hidden",
          background: "#050608",
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, visibleChannels.length)}, minmax(${minStripW}px, 1fr))`,
        }}
      >
        {visibleChannels.map((ch, idx) => {
          const colDef = COLOR_MAP[ch.color];
          const isSelected = ch.id === selectedChannel.id;
          const displayDb = sendsOnFader ? (sendLevels[ch.id]?.[sofTarget] ?? -70) : ch.faderDb;
          const activeUserAssigned =
            (activeBank === "user1" && userLayerIds.user1.includes(ch.id)) ||
            (activeBank === "user2" && userLayerIds.user2.includes(ch.id));

          return (
            <div
              key={ch.id}
              onClick={() => onSelectChannel(ch.id)}
              style={{
                display: "flex",
                flexDirection: "column",
                background: isSelected ? "#181C22" : idx % 2 === 0 ? "#121418" : "#14171C",
                borderRight: "1px solid #040506",
                boxShadow: isSelected ? "inset 0 0 0 1.5px #22D3EE" : "none",
                padding: "2px 2px 3px",
                gap: 2,
                cursor: "pointer",
                minWidth: 0,
              }}
            >
              {/* 1. Top Gain Readout + FX / Polarity / 48V */}
              <div
                style={{
                  background: "#1A1D23",
                  borderRadius: 2,
                  padding: "2px 1px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div
                  onWheel={(e) => {
                    e.stopPropagation();
                    onAdjustGain(ch.id, Math.max(-12, Math.min(60, Math.round((ch.preampGainDb + (e.deltaY < 0 ? 0.5 : -0.5)) * 10) / 10)));
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectChannel(ch.id);
                    onOpenScreenTab("config");
                  }}
                  title="Preamp Gain (scroll to trim, click to open Config)"
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: "#D1D5DB",
                    textAlign: "center",
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}
                >
                  {ch.preampGainDb >= 0 ? `+${ch.preampGainDb.toFixed(1)}` : ch.preampGainDb.toFixed(1)}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                  <span
                    style={{
                      fontSize: 7,
                      fontWeight: 800,
                      padding: "0 2px",
                      borderRadius: 1.5,
                      background: ch.insertOn ? "#0E7490" : "#22262E",
                      color: ch.insertOn ? "#ECFEFF" : "#6B7280",
                    }}
                  >
                    FX
                  </span>
                  <button
                    type="button"
                    title="Toggle Polarity Ø"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePolarity(ch.id);
                    }}
                    style={{
                      border: "none",
                      padding: "0 2px",
                      fontSize: 7.5,
                      fontWeight: 800,
                      borderRadius: 1.5,
                      background: ch.polarityInvert ? "#D97706" : "#22262E",
                      color: ch.polarityInvert ? "#FFFFFF" : "#6B7280",
                      cursor: "pointer",
                    }}
                  >
                    ø
                  </button>
                  <button
                    type="button"
                    title="Toggle +48V Phantom Power"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePhantom(ch.id);
                    }}
                    style={{
                      border: "none",
                      padding: "0 2px",
                      fontSize: 7,
                      fontWeight: 800,
                      borderRadius: 1.5,
                      background: ch.phantom48v ? "#991B1B" : "#22262E",
                      color: ch.phantom48v ? "#FCA5A5" : "#6B7280",
                      cursor: "pointer",
                    }}
                  >
                    48
                  </button>
                </div>
              </div>

              {/* 2. Compact Sends / Bus Overview Micro-Bars (magenta telemetry rows) */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectChannel(ch.id);
                  onOpenScreenTab("sends");
                }}
                title="Bus Sends overview (click to edit Sends)"
                style={{
                  background: "#0B0D10",
                  borderRadius: 2,
                  padding: "2px 1px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                }}
              >
                {Array.from({ length: 6 }, (_, sIdx) => {
                  const send = ch.busSends[sIdx];
                  const lvl = send && send.on ? Math.max(0.15, (send.levelDb + 60) / 70) : 0;
                  return (
                    <div
                      key={sIdx}
                      style={{
                        height: 2.5,
                        background: "#1A1E26",
                        borderRadius: 1,
                        overflow: "hidden",
                      }}
                    >
                      {lvl > 0 && (
                        <div
                          style={{
                            width: `${Math.min(100, Math.round(lvl * 100))}%`,
                            height: "100%",
                            background: "#EC4899",
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 3. Mini Gate / EQ+Dyn / HPF+Pan Telemetry Graphs */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectChannel(ch.id);
                  onOpenScreenTab("gate");
                }}
                title="Mini Gate Curve (click to open Gate)"
              >
                <MiniGateSvg channel={ch} />
              </div>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectChannel(ch.id);
                  onOpenScreenTab("eq");
                }}
                title="Mini 4-Band EQ & Comp Curve (click to open EQ)"
              >
                <MiniEqCompSvg channel={ch} />
              </div>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectChannel(ch.id);
                  onOpenScreenTab("config");
                }}
                title="Mini HPF & Pan (click to open Config)"
              >
                <MiniHpfPanSvg channel={ch} />
              </div>

              {/* 4. Colored Hardware LCD Scribble Strip */}
              <div
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(ch.id);
                  setEditingName(ch.name);
                }}
                title="Double-click to rename channel"
                style={{
                  background: colDef.bg,
                  border: `1px solid ${colDef.border}`,
                  borderRadius: 2,
                  padding: "3px 2px",
                  minHeight: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {editingId === ch.id ? (
                  <input
                    type="text"
                    autoFocus
                    maxLength={12}
                    value={editingName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => {
                      const trimmed = editingName.trim();
                      if (trimmed) onRenameChannel(ch.id, trimmed);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const trimmed = editingName.trim();
                        if (trimmed) onRenameChannel(ch.id, trimmed);
                        setEditingId(null);
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    style={{
                      width: "100%",
                      fontSize: 9,
                      background: "#0B0D10",
                      color: "#FFFFFF",
                      border: "1px solid #22D3EE",
                      padding: "0 2px",
                      textAlign: "center",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 8.5,
                      fontWeight: 800,
                      color: colDef.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textAlign: "center",
                      lineHeight: 1.1,
                    }}
                  >
                    {ch.name}
                  </span>
                )}
              </div>

              {/* Optional Edit Mode toggle */}
              {bankEditMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleUserAssign(ch.id);
                  }}
                  style={{
                    height: 15,
                    fontSize: 8,
                    fontWeight: 800,
                    background: activeUserAssigned ? "#0891B2" : "#1F242D",
                    border: "1px solid #334155",
                    color: "#FFFFFF",
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                >
                  {activeUserAssigned ? "PINNED" : "+ USER"}
                </button>
              )}

              {/* 5. Solo Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSolo(ch.id);
                }}
                style={{
                  height: 18,
                  borderRadius: 2,
                  background: ch.solo
                    ? "linear-gradient(180deg, #F59E0B 0%, #B45309 100%)"
                    : "linear-gradient(180deg, #2D3139 0%, #1E2127 100%)",
                  border: `1px solid ${ch.solo ? "#FDE047" : "#0B0D10"}`,
                  color: ch.solo ? "#0B0D10" : "#D1D5DB",
                  fontSize: 8.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Solo
              </button>

              {/* 6. DCA / LR / Pan Assignment Matrix Dots */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectChannel(ch.id);
                  onOpenScreenTab("main");
                }}
                title="DCA & LR Assignment (click to open Main assign)"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 1.5,
                  padding: "2px 3px",
                  background: "#0B0D10",
                  borderRadius: 2,
                  justifyItems: "center",
                }}
              >
                {Array.from({ length: 8 }, (_, dIdx) => {
                  const assigned = (ch.dcaAssignMask & (1 << dIdx)) !== 0;
                  return (
                    <span
                      key={dIdx}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        fontSize: 5.5,
                        lineHeight: "7px",
                        textAlign: "center",
                        fontWeight: 800,
                        background: assigned ? DCA_BADGE_COLORS[dIdx] : "#1E222B",
                        color: assigned ? "#0B0D10" : "#4B5563",
                      }}
                    >
                      {dIdx + 1}
                    </span>
                  );
                })}
              </div>

              {/* 7. Exact dB Fader Readout */}
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  textAlign: "center",
                  color: sendsOnFader
                    ? "#38BDF8"
                    : isSelected
                      ? "#22D3EE"
                      : ch.mute
                        ? "#9CA3AF"
                        : "#E5E7EB",
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  lineHeight: 1.1,
                }}
              >
                {formatDbCompact(displayDb)}
              </div>

              {/* 8. Sculpted Tall X32 Fader + 10-LED Meter */}
              <HardwareFaderTrack
                valueDb={displayDb}
                meterLevel={ch.meterLevel}
                muted={ch.mute}
                notchColor={sendsOnFader ? "#38BDF8" : colDef.notch}
                onChange={(nextDb) => onChangeFader(ch.id, nextDb)}
              />

              {/* 9. Hardware Mute Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMute(ch.id);
                }}
                style={{
                  height: 19,
                  borderRadius: 2,
                  background: ch.mute
                    ? "linear-gradient(180deg, #DC2626 0%, #991B1B 100%)"
                    : "linear-gradient(180deg, #2D3139 0%, #1E2127 100%)",
                  border: `1px solid ${ch.mute ? "#F87171" : "#0B0D10"}`,
                  color: ch.mute ? "#FFFFFF" : "#D1D5DB",
                  fontSize: 8.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Mute
              </button>

              {/* 10. Channel Strip Number Footer */}
              <div
                style={{
                  fontSize: 8.5,
                  fontWeight: isSelected ? 800 : 600,
                  textAlign: "center",
                  color: isSelected ? "#22D3EE" : "#9CA3AF",
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  lineHeight: 1.1,
                }}
              >
                {ch.shortLabel}
              </div>
            </div>
          );
        })}
      </div>

      {/* RIGHT UTILITY MATRIX + BUS TARGETS + MAIN LR MASTER FADER */}
      <div
        style={{
          width: 232,
          flexShrink: 0,
          background: "#16191E",
          borderLeft: "1px solid #000000",
          display: "flex",
          flexDirection: "column",
          padding: 4,
          gap: 4,
        }}
      >
        {/* Top 4x2 Hardware Utility Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
          <button type="button" onClick={() => onOpenScreenTab("config")} style={rightTileStyle(false)}>
            Setup
          </button>
          <button type="button" onClick={() => onOpenScreenTab("routing")} style={rightTileStyle(false)}>
            Routing
          </button>
          <button type="button" onClick={() => onOpenScreenTab("eq")} style={rightTileStyle(false)}>
            Meter
          </button>
          <button type="button" onClick={onToggleResize} style={rightTileStyle(compactWidth)}>
            Resize
          </button>
          <button type="button" onClick={() => onOpenScreenTab("channel")} style={rightTileStyle(false)}>
            Library
          </button>
          <button type="button" onClick={() => onOpenScreenTab("main")} style={rightTileStyle(false)}>
            Assign
          </button>
          <button type="button" onClick={() => onOpenScreenTab("fx1_4")} style={rightTileStyle(false)}>
            Monitor
          </button>
          <button type="button" onClick={() => onOpenScreenTab("sends")} style={rightTileStyle(false)}>
            Utility
          </button>
        </div>

        {/* Scenes Recall & Snapshot Bar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#9CA3AF", fontWeight: 700, width: 42 }}>Scenes</span>
            <div
              style={{
                flex: 1,
                height: 18,
                background: "#0B0D10",
                border: "1px solid #2A2F38",
                borderRadius: 2,
                padding: "0 5px",
                display: "flex",
                alignItems: "center",
                fontSize: 9.5,
                color: "#E5E7EB",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {String(sceneIndex).padStart(2, "0")}: {sceneName}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr 1fr", gap: 2 }}>
            <button type="button" onClick={() => onSceneStep(-1)} style={utilBtnStyle(false)}>
              |◀
            </button>
            <button type="button" onClick={() => onSceneStep(1)} style={utilBtnStyle(false)}>
              ▶|
            </button>
            <button
              type="button"
              onClick={onSceneUndo}
              disabled={!canUndo}
              style={{
                ...utilBtnStyle(false),
                color: canUndo ? "#22D3EE" : "#4B5563",
                cursor: canUndo ? "pointer" : "not-allowed",
              }}
            >
              Undo
            </button>
            <button type="button" onClick={onSceneGo} style={utilBtnStyle(false)}>
              Go
            </button>
          </div>
        </div>

        {/* Save / Load / Copy / Paste Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
          <button type="button" onClick={onSaveScn} style={rightTileStyle(false)} title="Export .scn scene file">
            Save
          </button>
          <button type="button" onClick={onLoadScn} style={rightTileStyle(false)} title="Import .scn scene file">
            Load
          </button>
          <button type="button" onClick={onCopyChannel} style={rightTileStyle(false)} title="Copy selected channel">
            Copy
          </button>
          <button
            type="button"
            onClick={onPasteChannel}
            disabled={!hasCopiedChannel}
            style={{
              ...rightTileStyle(hasCopiedChannel),
              opacity: hasCopiedChannel ? 1 : 0.45,
            }}
            title="Paste copied channel parameters"
          >
            Paste
          </button>
        </div>

        {/* Clock Sync & Automix Indicators */}
        <div
          style={{
            background: "#0B0D10",
            border: "1px solid #232730",
            borderRadius: 2,
            padding: "4px 6px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 2,
              fontSize: 9,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              color: "#CBD5E1",
            }}
          >
            <span>■ A:{clockSource === "AES50" ? "48K" : "-"}</span>
            <span style={{ color: "#34D399" }}>■ L {clockSource === "48kHz Internal" ? "48K" : "EXT"}</span>
            <span>■ B:-</span>
            <span>■ C:{clockSource === "Card" ? "48K" : "-"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              onClick={() => onToggleAutomix(selectedChannel.id, "X")}
              style={{
                width: 24,
                height: 20,
                borderRadius: 2,
                background: selAutomix === "X" ? "#0E7490" : "#1D2129",
                border: `1.5px solid ${selAutomix === "X" ? "#22D3EE" : "#374151"}`,
                color: selAutomix === "X" ? "#ECFEFF" : "#9CA3AF",
                fontSize: 10,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              X
            </button>
            <span style={{ flex: 1, textAlign: "center", fontSize: 10, color: "#9CA3AF", fontWeight: 700 }}>
              Auto Mix
            </span>
            <button
              type="button"
              onClick={() => onToggleAutomix(selectedChannel.id, "Y")}
              style={{
                width: 24,
                height: 20,
                borderRadius: 2,
                background: selAutomix === "Y" ? "#0E7490" : "#1D2129",
                border: `1.5px solid ${selAutomix === "Y" ? "#22D3EE" : "#374151"}`,
                color: selAutomix === "Y" ? "#ECFEFF" : "#9CA3AF",
                fontSize: 10,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Y
            </button>
          </div>
        </div>

        {/* Lower Split: Select / Bus 1-16 / Mute Groups + Docked Main LR Master Fader */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 4 }}>
          {/* Left Matrix: Clear Solo, Talkback, Main LR, Bus 1-16, Mute Groups 1-6 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 3 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.7fr", gap: 2, alignItems: "center" }}>
              <button type="button" onClick={onClearAllSolos} style={utilBtnStyle(false)}>
                Clear Solo
              </button>
              <button
                type="button"
                onClick={() => onToggleTalkback("A")}
                style={utilBtnStyle(talkbackA)}
                title="Talkback A"
              >
                A
              </button>
              <button
                type="button"
                onClick={() => onToggleTalkback("B")}
                style={utilBtnStyle(talkbackB)}
                title="Talkback B"
              >
                B
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
              <button
                type="button"
                onClick={() => onSelectBusTarget(null)}
                style={rightBusStyle(!sendsOnFader && !monoMcMode)}
              >
                Main LR
              </button>
              <button
                type="button"
                onClick={onToggleMonoMc}
                style={rightBusStyle(!sendsOnFader && monoMcMode)}
              >
                M/C
              </button>
            </div>

            {/* Bus 1 - 16 Sends-on-Fader Matrix */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
              {Array.from({ length: 16 }, (_, idx) => {
                const n = idx + 1;
                const busId = `bus-${String(n).padStart(2, "0")}`;
                const active = sendsOnFader && sofTarget === busId;
                const linked = Boolean(channelLinks[busId]) || n === 9 || n === 10 || n === 11 || n === 12;
                return (
                  <button
                    key={busId}
                    type="button"
                    onClick={() => onSelectBusTarget(active ? null : busId)}
                    title={`Select Sends on Fader: Bus ${n}`}
                    style={{
                      ...rightBusStyle(active),
                      justifyContent: "space-between",
                      padding: "0 5px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <span>Bus {n}</span>
                    {linked && idx % 2 === 0 && (
                      <span style={{ fontSize: 7.5, color: "#22D3EE" }}>∞</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Mute Groups 1 - 6 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 9, color: "#9CA3AF", textAlign: "center", fontWeight: 700 }}>
                Mute Groups
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 2 }}>
                {muteGroups.map((active, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onToggleMuteGroup(idx)}
                    style={{
                      height: 22,
                      borderRadius: 2,
                      background: active ? "#DC2626" : "#252932",
                      border: `1px solid ${active ? "#F87171" : "#111317"}`,
                      color: active ? "#FFFFFF" : "#D1D5DB",
                      fontSize: 9.5,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Rightmost Dedicated MIX BUS / Main LR Master Fader */}
          <div
            style={{
              width: 72,
              background: "#12151A",
              border: `1px solid ${sendsOnFader ? "#38BDF8" : "#282D37"}`,
              borderRadius: 2,
              padding: "2px 3px 3px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div
              style={{
                background: "#E2E8F0",
                color: "#0F172A",
                fontSize: 8.5,
                fontWeight: 800,
                textAlign: "center",
                borderRadius: 2,
                padding: "2px 1px",
              }}
            >
              {sendsOnFader ? masterLabel : "MIX BUS"}
            </div>
            <button
              type="button"
              onClick={onToggleMainLrSolo}
              style={{
                height: 18,
                borderRadius: 2,
                background: mainLrSolo ? "#D97706" : "#262A32",
                border: `1px solid ${mainLrSolo ? "#FACC15" : "#111317"}`,
                color: mainLrSolo ? "#0F172A" : "#E5E7EB",
                fontSize: 8.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Solo
            </button>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                textAlign: "center",
                color: sendsOnFader ? "#38BDF8" : "#E5E7EB",
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}
            >
              {formatDbCompact(activeBusChannel ? activeBusChannel.faderDb : mainLrDb)}
            </div>
            <HardwareFaderTrack
              valueDb={activeBusChannel ? activeBusChannel.faderDb : mainLrDb}
              meterLevel={activeBusChannel ? activeBusChannel.meterLevel : mainLrMute ? -90 : mainLrMeterLevel}
              muted={activeBusChannel ? activeBusChannel.mute : mainLrMute}
              notchColor={sendsOnFader ? "#38BDF8" : "#F8FAFC"}
              stereoMeter={!activeBusChannel}
              onChange={(db) => {
                if (activeBusChannel) onChangeFader(activeBusChannel.id, db);
                else onChangeMainLrDb(db);
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (activeBusChannel) onToggleMute(activeBusChannel.id);
                else onToggleMainLrMute();
              }}
              style={{
                height: 19,
                borderRadius: 2,
                background: (activeBusChannel ? activeBusChannel.mute : mainLrMute)
                  ? "#DC2626"
                  : "#262A32",
                border: `1px solid ${(activeBusChannel ? activeBusChannel.mute : mainLrMute) ? "#F87171" : "#111317"}`,
                color: "#FFFFFF",
                fontSize: 8.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Mute
            </button>
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                textAlign: "center",
                color: "#CBD5E1",
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}
            >
              {masterLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function utilBtnStyle(active: boolean): React.CSSProperties {
  return {
    height: 22,
    borderRadius: 2,
    background: active
      ? "linear-gradient(180deg, #0E7490 0%, #155E75 100%)"
      : "linear-gradient(180deg, #2B2F37 0%, #1F2329 100%)",
    border: `1px solid ${active ? "#22D3EE" : "#111317"}`,
    color: active ? "#ECFEFF" : "#D1D5DB",
    fontSize: 8.5,
    fontWeight: 700,
    cursor: "pointer",
    padding: "0 2px",
  };
}

function rightTileStyle(active: boolean): React.CSSProperties {
  return {
    height: 28,
    borderRadius: 2,
    background: active
      ? "linear-gradient(180deg, #0E7490 0%, #155E75 100%)"
      : "linear-gradient(180deg, #2D313A 0%, #20242B 100%)",
    border: `1px solid ${active ? "#22D3EE" : "#111317"}`,
    color: active ? "#ECFEFF" : "#E5E7EB",
    fontSize: 9,
    fontWeight: 700,
    cursor: "pointer",
    padding: "0 2px",
  };
}

function rightBusStyle(active: boolean): React.CSSProperties {
  return {
    height: 22,
    borderRadius: 2,
    background: active
      ? "linear-gradient(180deg, #1E3A5F 0%, #152943 100%)"
      : "linear-gradient(180deg, #2A2E37 0%, #1E2128 100%)",
    border: `1.5px solid ${active ? "#22D3EE" : "#111317"}`,
    color: active ? "#22D3EE" : "#E5E7EB",
    fontSize: 9.5,
    fontWeight: 700,
    cursor: "pointer",
    padding: "0 4px",
  };
}
