import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Video,
  Camera,
  Radio,
  Server,
  Volume2,
  VolumeX,
  Crosshair,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Plus,
  Check,
  AlertTriangle,
  Wifi,
  Save,
  Play,
  Square,
  Tv,
  Sparkles,
} from "lucide-react";
import type { NdiReceiver } from "../types";

export interface NdiStudioToolsProps {
  sources: string[];
  receivers: NdiReceiver[];
  onSwitchReceiver: (rxId: string, source: string) => void;
  onPtzPreset: (sourceId: string, presetIdx: number) => void;
  onPanTilt: (sourceId: string, pan: number, tilt: number) => void;
}

type TestPatternKind = "smpte" | "ebu" | "grid";
type PtzMode = "recall" | "store";

const DEFAULT_RECEIVE_GROUPS = [
  "public",
  "Sanctuary-Cameras",
  "Broadcast-Feeds",
  "Stage-Monitors",
  "ProPresenter-Alpha",
  "Lobby-Signage",
];

const DEFAULT_PRESET_NAMES = [
  "Wide Shot",
  "Pulpit Tight",
  "Worship Lead",
  "Keys / Synth",
  "Drums",
  "Choir Loft",
  "Baptistry",
  "Altars / Stage",
];

function dbfsToLinear(dbfs: number): number {
  return Math.pow(10, dbfs / 20);
}

function formatTimecode(frameCount: number): string {
  const fps = 60;
  const totalSeconds = Math.floor(frameCount / fps);
  const frames = frameCount % fps;
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hrs = Math.floor(totalSeconds / 3600) % 24;
  return [hrs, mins, secs, frames].map((v) => String(v).padStart(2, "0")).join(":");
}

export const NdiStudioTools: React.FC<NdiStudioToolsProps> = ({
  sources,
  receivers,
  onSwitchReceiver,
  onPtzPreset,
  onPanTilt,
}) => {
  // NDI Access Manager state
  const [discoveryEnabled, setDiscoveryEnabled] = useState<boolean>(true);
  const [discoveryHost, setDiscoveryHost] = useState<string>("10.1.24.10:5959");
  const [appliedDiscoveryHost, setAppliedDiscoveryHost] = useState<string>("10.1.24.10:5959");
  const [availableGroups, setAvailableGroups] = useState<string[]>(DEFAULT_RECEIVE_GROUPS);
  const [activeGroups, setActiveGroups] = useState<string[]>(["public", "Sanctuary-Cameras", "Broadcast-Feeds"]);
  const [newGroupName, setNewGroupName] = useState<string>("");

  // Test Pattern & 1kHz Tone state
  const [patternKind, setPatternKind] = useState<TestPatternKind>("smpte");
  const [toneEnabled, setToneEnabled] = useState<boolean>(false);
  const [toneFreqHz, setToneFreqHz] = useState<number>(1000);
  const [toneLevelDbfs, setToneLevelDbfs] = useState<number>(-20);
  const [toneError, setToneError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscNodeRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // PTZ Joystick & Preset state
  const ptzSources = useMemo(() => {
    if (sources.length > 0) return sources;
    return ["CAM-1 (Pulpit PTZ)", "CAM-2 (Wide PTZ)", "CAM-3 (Stage Left PTZ)"];
  }, [sources]);

  const [selectedPtzSource, setSelectedPtzSource] = useState<string>(() => {
    const cam = ptzSources.find((s) => /cam|ptz/i.test(s));
    return cam || ptzSources[0];
  });
  const [ptzMode, setPtzMode] = useState<PtzMode>("recall");
  const [ptzSpeed, setPtzSpeed] = useState<number>(0.75);
  const [joyPos, setJoyPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [activePresetBySource, setActivePresetBySource] = useState<Record<string, number>>({});
  const [storedPresetsBySource, setStoredPresetsBySource] = useState<Record<string, number[]>>({});
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const joystickRef = useRef<HTMLDivElement | null>(null);
  const isDraggingJoyRef = useRef<boolean>(false);

  useEffect(() => {
    if (!ptzSources.includes(selectedPtzSource)) {
      setSelectedPtzSource(ptzSources[0]);
    }
  }, [ptzSources, selectedPtzSource]);

  const notify = useCallback((msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => setStatusBanner(null), 2600);
  }, []);

  // HTML5 Canvas SMPTE / HD Color Bars & Motion Sweep loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let frame = 0;

    const renderFrame = () => {
      const w = canvas.width;
      const h = canvas.height;
      frame += 1;

      if (patternKind === "smpte") {
        // SMPTE RP 219 HD Color Bars
        const topH = Math.round(h * 0.583);
        const midH = Math.round(h * 0.083);
        const rampH = Math.round(h * 0.084);
        const botY = topH + midH + rampH;
        const botH = h - botY;

        const sideW = Math.round(w * 0.125);
        const centerW = w - sideW * 2;
        const barW = centerW / 7;

        // Top section: 40% Gray flanks + 7 x 75% bars
        ctx.fillStyle = "#666666";
        ctx.fillRect(0, 0, sideW, topH);
        ctx.fillRect(w - sideW, 0, sideW, topH);

        const topBars = ["#BFBFBF", "#BFBF00", "#00BFBF", "#00BF00", "#BF00BF", "#BF0000", "#0000BF"];
        topBars.forEach((col, i) => {
          ctx.fillStyle = col;
          ctx.fillRect(sideW + i * barW, 0, Math.ceil(barW), topH);
        });

        // Middle castellations
        ctx.fillStyle = "#00BFBF";
        ctx.fillRect(0, topH, sideW, midH);
        ctx.fillStyle = "#0000BF";
        ctx.fillRect(w - sideW, topH, sideW, midH);

        const midBars = ["#0000BF", "#131313", "#BF00BF", "#131313", "#00BFBF", "#131313", "#BFBFBF"];
        midBars.forEach((col, i) => {
          ctx.fillStyle = col;
          ctx.fillRect(sideW + i * barW, topH, Math.ceil(barW), midH);
        });

        // Ramp strip (0% -> 100% Luma)
        const rampY = topH + midH;
        ctx.fillStyle = "#F5F500";
        ctx.fillRect(0, rampY, sideW, rampH);
        ctx.fillStyle = "#BF0000";
        ctx.fillRect(w - sideW, rampY, sideW, rampH);

        const grad = ctx.createLinearGradient(sideW, 0, sideW + centerW, 0);
        grad.addColorStop(0, "#0A0A0A");
        grad.addColorStop(1, "#FFFFFF");
        ctx.fillStyle = grad;
        ctx.fillRect(sideW, rampY, centerW, rampH);

        // Moving motion-verification block inside ramp
        const sweepX = sideW + ((frame * 3) % Math.max(1, centerW - 22));
        ctx.fillStyle = "#06B6D4";
        ctx.fillRect(sweepX, rampY + 3, 22, rampH - 6);

        // Bottom PLUGE section
        ctx.fillStyle = "#191919";
        ctx.fillRect(0, botY, sideW, botH);
        ctx.fillStyle = "#191919";
        ctx.fillRect(w - sideW, botY, sideW, botH);

        const plugeSegs = [
          { wFrac: 0.17, color: "#00214C" },
          { wFrac: 0.21, color: "#FFFFFF" },
          { wFrac: 0.17, color: "#32006A" },
          { wFrac: 0.15, color: "#121212" },
          { wFrac: 0.06, color: "#070707" }, // -2% super-black
          { wFrac: 0.06, color: "#121212" }, // 0% black
          { wFrac: 0.06, color: "#1B1B1B" }, // +2%
          { wFrac: 0.06, color: "#242424" }, // +4%
          { wFrac: 0.06, color: "#121212" },
        ];
        let cursorX = sideW;
        plugeSegs.forEach((seg) => {
          const segW = centerW * seg.wFrac;
          ctx.fillStyle = seg.color;
          ctx.fillRect(cursorX, botY, Math.ceil(segW), botH);
          cursorX += segW;
        });
      } else if (patternKind === "ebu") {
        const ebuBars = ["#FFFFFF", "#DFDF00", "#00DFDF", "#00DF00", "#DF00DF", "#DF0000", "#0000DF", "#0A0A0A"];
        const bw = w / ebuBars.length;
        ebuBars.forEach((col, i) => {
          ctx.fillStyle = col;
          ctx.fillRect(i * bw, 0, Math.ceil(bw), h);
        });
        // Motion bar at bottom
        const mx = (frame * 4) % (w - 36);
        ctx.fillStyle = "#10B981";
        ctx.fillRect(mx, h - 18, 36, 10);
      } else {
        // Convergence & Safe Area Grid
        ctx.fillStyle = "#090D14";
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = "#1E293B";
        ctx.lineWidth = 1;
        const step = 40;
        for (let x = 0; x <= w; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y <= h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Action safe (90%) & Title safe (80%)
        ctx.strokeStyle = "#3B82F6";
        ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
        ctx.strokeStyle = "#10B981";
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
        ctx.setLineDash([]);

        // Center circle & crosshair
        ctx.strokeStyle = "#F8FAFC";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 96, 0, Math.PI * 2);
        ctx.stroke();

        // Rotating sweep hand
        const angle = (frame * 0.04) % (Math.PI * 2);
        ctx.strokeStyle = "#EF4444";
        ctx.beginPath();
        ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos(angle) * 90, h / 2 + Math.sin(angle) * 90);
        ctx.stroke();
      }

      // Live Slate & Timecode Burn-In
      const slateW = 290;
      const slateH = 52;
      const slateX = (w - slateW) / 2;
      const slateY = Math.round(h * 0.38);
      ctx.fillStyle = "rgba(8, 11, 16, 0.84)";
      ctx.fillRect(slateX, slateY, slateW, slateH);
      ctx.strokeStyle = "#3B82F6";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(slateX, slateY, slateW, slateH);

      ctx.fillStyle = "#E2E8F0";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("NDI 6 TEST PATTERN • 1920x1080p60", w / 2, slateY + 18);

      ctx.fillStyle = toneEnabled ? "#34D399" : "#F8FAFC";
      ctx.font = "bold 15px monospace";
      ctx.fillText(
        `${formatTimecode(frame)}  ${toneEnabled ? `• ${(toneFreqHz / 1000).toFixed(1)}kHz ${toneLevelDbfs}dBFS` : "• TONE MUTE"}`,
        w / 2,
        slateY + 39
      );

      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, [patternKind, toneEnabled, toneFreqHz, toneLevelDbfs]);

  // WebAudio 1kHz Sine Tone Generator lifecycle
  const stopTone = useCallback(() => {
    if (oscNodeRef.current) {
      try {
        oscNodeRef.current.stop();
        oscNodeRef.current.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
      oscNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      try {
        gainNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      gainNodeRef.current = null;
    }
    setToneEnabled(false);
  }, []);

  const toggleTone = useCallback(() => {
    setToneError(null);
    if (toneEnabled) {
      stopTone();
      return;
    }
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        setToneError("WebAudio API unavailable in this browser.");
        return;
      }
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(toneFreqHz, ctx.currentTime);
      gain.gain.setValueAtTime(dbfsToLinear(toneLevelDbfs), ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      oscNodeRef.current = osc;
      gainNodeRef.current = gain;
      setToneEnabled(true);
    } catch (err) {
      setToneError(err instanceof Error ? err.message : "Failed to start WebAudio tone");
      setToneEnabled(false);
    }
  }, [toneEnabled, stopTone, toneFreqHz, toneLevelDbfs]);

  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (ctx && oscNodeRef.current && gainNodeRef.current && toneEnabled) {
      oscNodeRef.current.frequency.setValueAtTime(toneFreqHz, ctx.currentTime);
      gainNodeRef.current.gain.setValueAtTime(dbfsToLinear(toneLevelDbfs), ctx.currentTime);
    }
  }, [toneFreqHz, toneLevelDbfs, toneEnabled]);

  useEffect(() => {
    return () => {
      stopTone();
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => undefined);
        audioCtxRef.current = null;
      }
    };
  }, [stopTone]);

  // PTZ Joystick Pointer handlers
  const updateJoystickFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const pad = joystickRef.current;
      if (!pad) return;
      const rect = pad.getBoundingClientRect();
      const radius = rect.width / 2 - 14;
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      const clampedDist = Math.min(radius, dist);
      const angle = Math.atan2(dy, dx);
      const nx = radius > 0 ? (Math.cos(angle) * clampedDist) / radius : 0;
      const ny = radius > 0 ? (Math.sin(angle) * clampedDist) / radius : 0;

      const pan = Math.round(nx * ptzSpeed * 100) / 100;
      const tilt = Math.round(-ny * ptzSpeed * 100) / 100;
      setJoyPos({ x: nx, y: ny });
      onPanTilt(selectedPtzSource, pan, tilt);
    },
    [onPanTilt, ptzSpeed, selectedPtzSource]
  );

  const releaseJoystick = useCallback(() => {
    if (!isDraggingJoyRef.current) return;
    isDraggingJoyRef.current = false;
    setJoyPos({ x: 0, y: 0 });
    onPanTilt(selectedPtzSource, 0, 0);
  }, [onPanTilt, selectedPtzSource]);

  const handlePresetClick = (presetIdx: number) => {
    if (ptzMode === "store") {
      setStoredPresetsBySource((prev) => {
        const existing = prev[selectedPtzSource] || [];
        const next = existing.includes(presetIdx) ? existing : [...existing, presetIdx];
        return { ...prev, [selectedPtzSource]: next };
      });
      onPtzPreset(selectedPtzSource, presetIdx);
      setPtzMode("recall");
      notify(`Stored Preset #${presetIdx} on ${selectedPtzSource}`);
    } else {
      setActivePresetBySource((prev) => ({ ...prev, [selectedPtzSource]: presetIdx }));
      onPtzPreset(selectedPtzSource, presetIdx);
      notify(`Recalled Preset #${presetIdx} on ${selectedPtzSource}`);
    }
  };

  const driftedCount = receivers.filter((r) => r.status === "DRIFT").length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        background: "#080B10",
        color: "#F3F4F6",
        padding: 14,
        borderRadius: 12,
        border: "1px solid #1E2533",
        position: "relative",
      }}
    >
      {statusBanner && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "#121721",
            border: "1px solid #3B82F6",
            color: "#FFFFFF",
            padding: "9px 14px",
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 600,
            zIndex: 10050,
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
          }}
        >
          {statusBanner}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          padding: "10px 14px",
          background: "#12161F",
          border: "1px solid #1E2533",
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Video size={18} color="#3B82F6" />
          <strong style={{ fontSize: 15 }}>NDI 6 Studio Tools</strong>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              padding: "2px 8px",
              borderRadius: 6,
              background: "rgba(59, 130, 246, 0.16)",
              border: "1px solid #3B82F6",
              color: "#60A5FA",
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}
          >
            DISCOVERY :5959
          </span>
          <span style={{ fontSize: 12, color: "#94A3B8" }}>
            {sources.length} Sources • {receivers.length} Receivers
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {driftedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                receivers
                  .filter((r) => r.status === "DRIFT")
                  .forEach((r) => onSwitchReceiver(r.id, r.expectedSource));
                notify(`Re-patched ${driftedCount} drifted NDI receiver(s)`);
              }}
              style={{
                height: 30,
                padding: "0 11px",
                borderRadius: 6,
                background: "#92400E",
                border: "1px solid #F59E0B",
                color: "#FEF3C7",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <AlertTriangle size={13} />
              Heal {driftedCount} Drifted Receiver{driftedCount > 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>

      {/* Top Row: NDI Router Matrix + NDI Access Manager */}
      <div style={{ display: "grid", gridTemplateColumns: "1.45fr 0.95fr", gap: 14 }}>
        {/* 1. NDI Router Matrix */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              NDI Router Crosspoint Matrix
            </span>
            <span style={{ fontSize: 11, color: "#64748B" }}>
              Click cell to route NDI source to receiver
            </span>
          </div>

          {receivers.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                border: "1px dashed #283344",
                borderRadius: 8,
                color: "#64748B",
                fontSize: 12.5,
              }}
            >
              No NDI receivers discovered in snapshot. Waiting for NDI :5959 receiver advertisements.
            </div>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid #1E2533", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: "#12161F", borderBottom: "1px solid #283344" }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: "#94A3B8", minWidth: 210 }}>
                      Receiver (RX) ↓ / Source (TX) →
                    </th>
                    {sources.map((src) => (
                      <th
                        key={src}
                        style={{
                          padding: "8px 8px",
                          color: "#CBD5E1",
                          borderLeft: "1px solid #1E2533",
                          textAlign: "center",
                          whiteSpace: "nowrap",
                          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                          fontSize: 10.5,
                        }}
                      >
                        {src}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {receivers.map((rx) => {
                    const statusColor =
                      rx.status === "CONNECTED"
                        ? "#10B981"
                        : rx.status === "DRIFT"
                        ? "#F59E0B"
                        : "#EF4444";

                    return (
                      <tr key={rx.id} style={{ borderBottom: "1px solid #161B24" }}>
                        <td style={{ padding: "8px 10px", background: "#0F141D" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                            <div>
                              <div style={{ fontWeight: 700, color: "#FFFFFF", display: "flex", alignItems: "center", gap: 6 }}>
                                <span>{rx.receiverName}</span>
                                {rx.tallyProgram && (
                                  <span
                                    style={{
                                      fontSize: 9,
                                      fontWeight: 800,
                                      padding: "1px 5px",
                                      borderRadius: 4,
                                      background: "#DC2626",
                                      color: "#FFFFFF",
                                    }}
                                  >
                                    PGM
                                  </span>
                                )}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "#94A3B8",
                                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                }}
                              >
                                {rx.ip} • Exp: {rx.expectedSource}
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 800,
                                padding: "2px 6px",
                                borderRadius: 4,
                                color: statusColor,
                                background: `${statusColor}20`,
                                border: `1px solid ${statusColor}66`,
                              }}
                            >
                              {rx.status}
                            </span>
                          </div>
                        </td>

                        {sources.map((src) => {
                          const isSubscribed = rx.subscribedSource === src;
                          const isExpected = rx.expectedSource === src;
                          return (
                            <td
                              key={`${rx.id}-${src}`}
                              style={{
                                textAlign: "center",
                                padding: 6,
                                borderLeft: "1px solid #1E2533",
                                background: isSubscribed
                                  ? rx.tallyProgram
                                    ? "rgba(239, 68, 68, 0.14)"
                                    : "rgba(16, 185, 129, 0.12)"
                                  : "transparent",
                              }}
                            >
                              <button
                                type="button"
                                title={`Route ${src} -> ${rx.receiverName}`}
                                onClick={() => {
                                  onSwitchReceiver(rx.id, src);
                                  notify(`Routed ${rx.receiverName} -> ${src}`);
                                }}
                                style={{
                                  width: 28,
                                  height: 24,
                                  borderRadius: 5,
                                  cursor: "pointer",
                                  background: isSubscribed
                                    ? rx.tallyProgram
                                      ? "#DC2626"
                                      : "#059669"
                                    : "#161B24",
                                  border: isSubscribed
                                    ? `1px solid ${rx.tallyProgram ? "#F87171" : "#34D399"}`
                                    : isExpected
                                    ? "1px dashed #F59E0B"
                                    : "1px solid #283344",
                                  color: isSubscribed ? "#FFFFFF" : "#475569",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {isSubscribed ? <Check size={14} strokeWidth={3} /> : "·"}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 2. NDI Access Manager */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              NDI Access Manager
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 5,
                background: discoveryEnabled ? "rgba(16, 185, 129, 0.14)" : "#161B24",
                border: `1px solid ${discoveryEnabled ? "#10B981" : "#283344"}`,
                color: discoveryEnabled ? "#34D399" : "#94A3B8",
              }}
            >
              {discoveryEnabled ? "Discovery Server Active" : "mDNS Multicast"}
            </span>
          </div>

          {/* Discovery Server Host Input */}
          <div
            style={{
              background: "#12161F",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <Server size={14} color="#60A5FA" />
                NDI Discovery Server
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !discoveryEnabled;
                  setDiscoveryEnabled(next);
                  notify(next ? `Switched to NDI Discovery Server (${appliedDiscoveryHost})` : "Switched to mDNS local discovery");
                }}
                style={{
                  height: 24,
                  padding: "0 9px",
                  borderRadius: 5,
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: discoveryEnabled ? "#2563EB" : "#161B24",
                  border: `1px solid ${discoveryEnabled ? "#60A5FA" : "#283344"}`,
                  color: "#FFFFFF",
                }}
              >
                {discoveryEnabled ? "Enabled" : "Disabled"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                value={discoveryHost}
                disabled={!discoveryEnabled}
                onChange={(e) => setDiscoveryHost(e.target.value)}
                placeholder="10.1.24.10:5959"
                style={{
                  flex: 1,
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 6,
                  background: "#080B10",
                  border: "1px solid #283344",
                  color: discoveryEnabled ? "#FFFFFF" : "#64748B",
                  fontSize: 12,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}
              />
              <button
                type="button"
                disabled={!discoveryEnabled}
                onClick={() => {
                  const trimmed = discoveryHost.trim() || "10.1.24.10:5959";
                  setAppliedDiscoveryHost(trimmed);
                  notify(`Discovery Server updated -> ${trimmed}`);
                }}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 6,
                  background: "#1E3A8A",
                  border: "1px solid #3B82F6",
                  color: "#FFFFFF",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: discoveryEnabled ? "pointer" : "not-allowed",
                  opacity: discoveryEnabled ? 1 : 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Wifi size={13} />
                Apply
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: "#64748B", fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
              Active Endpoint: {discoveryEnabled ? appliedDiscoveryHost : "224.0.0.251:5353 (mDNS)"}
            </div>
          </div>

          {/* Receive Group Pills */}
          <div
            style={{
              background: "#12161F",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              flex: 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <Radio size={14} color="#10B981" />
                Receive Groups ({activeGroups.length} active)
              </span>
              <span style={{ fontSize: 10.5, color: "#64748B" }}>Toggle groups to filter feeds</span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {availableGroups.map((grp) => {
                const active = activeGroups.includes(grp);
                return (
                  <button
                    key={grp}
                    type="button"
                    onClick={() => {
                      setActiveGroups((prev) =>
                        prev.includes(grp) ? prev.filter((g) => g !== grp) : [...prev, grp]
                      );
                    }}
                    style={{
                      height: 28,
                      padding: "0 10px",
                      borderRadius: 999,
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: active ? "rgba(16, 185, 129, 0.18)" : "#161B24",
                      border: `1px solid ${active ? "#10B981" : "#283344"}`,
                      color: active ? "#34D399" : "#94A3B8",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {active && <Check size={11} />}
                    {grp}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newGroupName.trim()) {
                    const g = newGroupName.trim();
                    if (!availableGroups.includes(g)) setAvailableGroups((prev) => [...prev, g]);
                    if (!activeGroups.includes(g)) setActiveGroups((prev) => [...prev, g]);
                    setNewGroupName("");
                  }
                }}
                placeholder="Add custom NDI group..."
                style={{
                  flex: 1,
                  height: 30,
                  padding: "0 10px",
                  borderRadius: 6,
                  background: "#080B10",
                  border: "1px solid #283344",
                  color: "#FFFFFF",
                  fontSize: 11.5,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const g = newGroupName.trim();
                  if (!g) return;
                  if (!availableGroups.includes(g)) setAvailableGroups((prev) => [...prev, g]);
                  if (!activeGroups.includes(g)) setActiveGroups((prev) => [...prev, g]);
                  setNewGroupName("");
                }}
                style={{
                  height: 30,
                  padding: "0 10px",
                  borderRadius: 6,
                  background: "#161B24",
                  border: "1px solid #283344",
                  color: "#E2E8F0",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Plus size={13} />
                Add
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Test Pattern + 1kHz WebAudio Generator (Left) & Live PTZ Joystick / Presets (Right) */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 14 }}>
        {/* 3. SMPTE / HD Color Bars Canvas + 1kHz WebAudio Tone Generator */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
              <Tv size={14} color="#60A5FA" />
              Test Patterns — SMPTE / HD Color Bars + 1kHz Tone
            </span>

            <div style={{ display: "flex", gap: 4 }}>
              {(
                [
                  { id: "smpte", label: "SMPTE HD" },
                  { id: "ebu", label: "EBU 75%" },
                  { id: "grid", label: "Grid" },
                ] as const
              ).map((pat) => {
                const active = patternKind === pat.id;
                return (
                  <button
                    key={pat.id}
                    type="button"
                    onClick={() => setPatternKind(pat.id)}
                    style={{
                      height: 26,
                      padding: "0 9px",
                      borderRadius: 5,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: active ? "#2563EB" : "#161B24",
                      border: `1px solid ${active ? "#60A5FA" : "#283344"}`,
                      color: active ? "#FFFFFF" : "#94A3B8",
                    }}
                  >
                    {pat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live HTML5 Canvas */}
          <div
            style={{
              background: "#000000",
              border: "1px solid #283344",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <canvas
              ref={canvasRef}
              width={640}
              height={360}
              style={{ width: "100%", height: "auto", display: "block", aspectRatio: "16 / 9" }}
            />
          </div>

          {/* 1kHz WebAudio Tone Generator Controls */}
          <div
            style={{
              background: "#12161F",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={toggleTone}
                style={{
                  height: 34,
                  padding: "0 13px",
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: toneEnabled ? "#059669" : "#161B24",
                  border: `1px solid ${toneEnabled ? "#34D399" : "#283344"}`,
                  color: "#FFFFFF",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {toneEnabled ? <Square size={13} /> : <Play size={13} />}
                {toneEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {toneEnabled ? "Stop 1kHz Tone" : "Start 1kHz Tone"}
              </button>

              <select
                value={toneFreqHz}
                onChange={(e) => setToneFreqHz(Number(e.target.value))}
                style={{
                  height: 34,
                  padding: "0 8px",
                  borderRadius: 6,
                  background: "#080B10",
                  border: "1px solid #283344",
                  color: "#E2E8F0",
                  fontSize: 11.5,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}
              >
                <option value={440}>440 Hz</option>
                <option value={1000}>1000 Hz (1 kHz)</option>
                <option value={10000}>10 kHz</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 180 }}>
              <span style={{ fontSize: 11, color: "#94A3B8", whiteSpace: "nowrap" }}>
                Ref Level:
              </span>
              <input
                type="range"
                min={-40}
                max={-6}
                step={1}
                value={toneLevelDbfs}
                onChange={(e) => setToneLevelDbfs(Number(e.target.value))}
                style={{ flex: 1, accentColor: toneEnabled ? "#10B981" : "#64748B" }}
              />
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: toneEnabled ? "#34D399" : "#94A3B8",
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  minWidth: 64,
                  textAlign: "right",
                }}
              >
                {toneEnabled ? `${toneLevelDbfs.toFixed(1)} dBFS` : "-∞ dBFS"}
              </span>
            </div>
          </div>
          {toneError && (
            <div style={{ fontSize: 11, color: "#F87171" }}>Audio error: {toneError}</div>
          )}
        </div>

        {/* 4. Live PTZ Joystick & Preset Store-Recall Strip */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
              <Camera size={14} color="#EF4444" />
              NDI PTZ Joystick & Preset Store-Recall
            </span>

            <select
              value={selectedPtzSource}
              onChange={(e) => setSelectedPtzSource(e.target.value)}
              style={{
                height: 28,
                padding: "0 8px",
                borderRadius: 6,
                background: "#161B24",
                border: "1px solid #3B82F6",
                color: "#FFFFFF",
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              {ptzSources.map((src) => (
                <option key={src} value={src}>
                  {src}
                </option>
              ))}
            </select>
          </div>

          {/* Joystick + Nudge Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 14,
              alignItems: "center",
              background: "#12161F",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: 12,
            }}
          >
            {/* 2D Pointer Joystick */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div
                ref={joystickRef}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  isDraggingJoyRef.current = true;
                  updateJoystickFromPointer(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (isDraggingJoyRef.current) {
                    updateJoystickFromPointer(e.clientX, e.clientY);
                  }
                }}
                onPointerUp={releaseJoystick}
                onPointerCancel={releaseJoystick}
                style={{
                  width: 156,
                  height: 156,
                  borderRadius: "50%",
                  background: "radial-gradient(circle at center, #161E2E 0%, #090D14 72%)",
                  border: "2px solid #283344",
                  position: "relative",
                  cursor: "grab",
                  touchAction: "none",
                  boxShadow: "inset 0 0 24px rgba(0,0,0,0.8)",
                }}
              >
                {/* Guide Rings */}
                <div
                  style={{
                    position: "absolute",
                    inset: 26,
                    borderRadius: "50%",
                    border: "1px dashed #283344",
                    pointerEvents: "none",
                  }}
                />
                {/* Crosshairs */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 10,
                    bottom: 10,
                    width: 1,
                    background: "#1E293B",
                    pointerEvents: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: 10,
                    right: 10,
                    height: 1,
                    background: "#1E293B",
                    pointerEvents: "none",
                  }}
                />
                {/* Draggable Gimbal Puck */}
                <div
                  style={{
                    position: "absolute",
                    left: `calc(50% + ${joyPos.x * 58}px - 18px)`,
                    top: `calc(50% + ${joyPos.y * 58}px - 18px)`,
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 35%, #60A5FA 0%, #2563EB 55%, #1E3A8A 100%)",
                    border: "2px solid #93C5FD",
                    boxShadow: "0 4px 14px rgba(37, 99, 235, 0.55)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <Crosshair size={14} color="#FFFFFF" />
                </div>
              </div>

              <div
                style={{
                  fontSize: 10.5,
                  color: "#94A3B8",
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}
              >
                PAN {(joyPos.x * ptzSpeed).toFixed(2)} • TILT {(-joyPos.y * ptzSpeed).toFixed(2)}
              </div>
            </div>

            {/* Nudge Pad & Speed */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 38px)",
                  gap: 5,
                  justifyContent: "center",
                }}
              >
                <div />
                <button
                  type="button"
                  onPointerDown={() => onPanTilt(selectedPtzSource, 0, ptzSpeed)}
                  onPointerUp={() => onPanTilt(selectedPtzSource, 0, 0)}
                  style={{
                    height: 36,
                    borderRadius: 6,
                    background: "#161B24",
                    border: "1px solid #3B82F6",
                    color: "#60A5FA",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ChevronUp size={18} />
                </button>
                <div />

                <button
                  type="button"
                  onPointerDown={() => onPanTilt(selectedPtzSource, -ptzSpeed, 0)}
                  onPointerUp={() => onPanTilt(selectedPtzSource, 0, 0)}
                  style={{
                    height: 36,
                    borderRadius: 6,
                    background: "#161B24",
                    border: "1px solid #3B82F6",
                    color: "#60A5FA",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  title="Stop / Center Home"
                  onClick={() => {
                    setJoyPos({ x: 0, y: 0 });
                    onPanTilt(selectedPtzSource, 0, 0);
                    notify(`Sent PTZ Home/Stop to ${selectedPtzSource}`);
                  }}
                  style={{
                    height: 36,
                    borderRadius: 6,
                    background: "#1E2533",
                    border: "1px solid #334155",
                    color: "#CBD5E1",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  type="button"
                  onPointerDown={() => onPanTilt(selectedPtzSource, ptzSpeed, 0)}
                  onPointerUp={() => onPanTilt(selectedPtzSource, 0, 0)}
                  style={{
                    height: 36,
                    borderRadius: 6,
                    background: "#161B24",
                    border: "1px solid #3B82F6",
                    color: "#60A5FA",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ChevronRight size={18} />
                </button>

                <div />
                <button
                  type="button"
                  onPointerDown={() => onPanTilt(selectedPtzSource, 0, -ptzSpeed)}
                  onPointerUp={() => onPanTilt(selectedPtzSource, 0, 0)}
                  style={{
                    height: 36,
                    borderRadius: 6,
                    background: "#161B24",
                    border: "1px solid #3B82F6",
                    color: "#60A5FA",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ChevronDown size={18} />
                </button>
                <div />
              </div>

              <label style={{ fontSize: 11, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>PTZ Speed</span>
                  <strong style={{ color: "#E2E8F0", fontFamily: "monospace" }}>
                    {Math.round(ptzSpeed * 100)}%
                  </strong>
                </span>
                <input
                  type="range"
                  min={0.15}
                  max={1.0}
                  step={0.05}
                  value={ptzSpeed}
                  onChange={(e) => setPtzSpeed(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#3B82F6" }}
                />
              </label>
            </div>
          </div>

          {/* Preset Store-Recall Strip */}
          <div
            style={{
              background: "#12161F",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              flex: 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", display: "flex", alignItems: "center", gap: 5 }}>
                <Sparkles size={13} color="#F59E0B" />
                PTZ Presets (1-8)
              </span>

              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setPtzMode("recall")}
                  style={{
                    height: 24,
                    padding: "0 10px",
                    borderRadius: 5,
                    fontSize: 10.5,
                    fontWeight: 800,
                    cursor: "pointer",
                    background: ptzMode === "recall" ? "#2563EB" : "#161B24",
                    border: `1px solid ${ptzMode === "recall" ? "#60A5FA" : "#283344"}`,
                    color: ptzMode === "recall" ? "#FFFFFF" : "#94A3B8",
                  }}
                >
                  RECALL
                </button>
                <button
                  type="button"
                  onClick={() => setPtzMode("store")}
                  style={{
                    height: 24,
                    padding: "0 10px",
                    borderRadius: 5,
                    fontSize: 10.5,
                    fontWeight: 800,
                    cursor: "pointer",
                    background: ptzMode === "store" ? "#D97706" : "#161B24",
                    border: `1px solid ${ptzMode === "store" ? "#FBBF24" : "#283344"}`,
                    color: ptzMode === "store" ? "#FFFFFF" : "#94A3B8",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Save size={11} />
                  STORE
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {DEFAULT_PRESET_NAMES.map((label, idx) => {
                const presetNum = idx + 1;
                const isActive = activePresetBySource[selectedPtzSource] === presetNum;
                const isStored = (storedPresetsBySource[selectedPtzSource] || []).includes(presetNum);

                return (
                  <button
                    key={presetNum}
                    type="button"
                    onClick={() => handlePresetClick(presetNum)}
                    style={{
                      padding: "8px 6px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background:
                        ptzMode === "store"
                          ? "#2A1E0A"
                          : isActive
                          ? "#1E3A8A"
                          : "#161B24",
                      border:
                        ptzMode === "store"
                          ? "1px solid #F59E0B"
                          : isActive
                          ? "1px solid #60A5FA"
                          : "1px solid #283344",
                      color: "#FFFFFF",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 2,
                    }}
                  >
                    <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          color: ptzMode === "store" ? "#FBBF24" : isActive ? "#93C5FD" : "#64748B",
                          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        }}
                      >
                        P{presetNum}
                      </span>
                      {isStored && (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#10B981",
                          }}
                        />
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "100%",
                      }}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NdiStudioTools;
