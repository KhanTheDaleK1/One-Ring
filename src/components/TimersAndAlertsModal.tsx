import React, { useEffect, useRef, useState } from "react";
import {
  Timer,
  Clock,
  Play,
  Pause,
  RotateCcw,
  Bell,
  BellOff,
  Megaphone,
  AlertTriangle,
  X,
  Plus,
  Minus,
} from "lucide-react";

export interface TimersAndAlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBroadcastAlert: (message: string, active: boolean) => void;
  onUpdateTimerLabel: (label: string) => void;
}

type StageTimerMode = "auto" | "countdown" | "sermon" | "clock";

const COUNTDOWN_PRESETS_MIN = [3, 5, 10, 15, 20];

const ALERT_PRESETS = [
  "Parent #104 needed in Nursery Room B",
  "Parent #208 needed in Preschool Check-In",
  "Pastor: 5 minutes remaining",
  "Pastor: Wrap up now — Transition to Communion",
  "Please silence all mobile devices",
];

function formatCountdown(totalSec: number): string {
  const negative = totalSec < 0;
  const abs = Math.abs(Math.floor(totalSec));
  const hrs = Math.floor(abs / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;
  const body =
    hrs > 0
      ? `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

function formatElapsed(totalSec: number): string {
  const abs = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(abs / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatClock(date: Date, use24h: boolean): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: !use24h,
  });
}

export const TimersAndAlertsModal: React.FC<TimersAndAlertsModalProps> = ({
  isOpen,
  onClose,
  onBroadcastAlert,
  onUpdateTimerLabel,
}) => {
  // Service Countdown state
  const [countdownDurationSec, setCountdownDurationSec] = useState(5 * 60);
  const [countdownRemainingSec, setCountdownRemainingSec] = useState(5 * 60);
  const [countdownRunning, setCountdownRunning] = useState(false);
  const [customMinutesInput, setCustomMinutesInput] = useState("7");
  const [allowOvertime, setAllowOvertime] = useState(true);

  // Sermon Elapsed Timer state
  const [sermonElapsedSec, setSermonElapsedSec] = useState(0);
  const [sermonRunning, setSermonRunning] = useState(false);
  const [sermonTargetMin, setSermonTargetMin] = useState(35);

  // Wall Clock toggle
  const [showClock, setShowClock] = useState(true);
  const [clock24h, setClock24h] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());

  // Stage label source selector
  const [stageMode, setStageMode] = useState<StageTimerMode>("auto");

  // Stage & FOH Nursery Alert state
  const [alertInput, setAlertInput] = useState("Parent #104 needed in Nursery Room B");
  const [activeAlertMessage, setActiveAlertMessage] = useState("");
  const [alertActive, setAlertActive] = useState(false);
  const [alertHistory, setAlertHistory] = useState<string[]>([]);
  const [flashPulse, setFlashPulse] = useState(false);

  const hasUserSyncedRef = useRef(false);
  const lastLabelRef = useRef<string>("");
  const onUpdateTimerLabelRef = useRef(onUpdateTimerLabel);
  onUpdateTimerLabelRef.current = onUpdateTimerLabel;

  // 1-second master clock + running timer ticker (persists even while modal is hidden)
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
      if (countdownRunning) {
        setCountdownRemainingSec((prev) => {
          if (!allowOvertime && prev <= 0) {
            setCountdownRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }
      if (sermonRunning) {
        setSermonElapsedSec((prev) => prev + 1);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [countdownRunning, sermonRunning, allowOvertime]);

  // Pulse indicator when an alert is actively flashing
  useEffect(() => {
    if (!alertActive) {
      setFlashPulse(false);
      return;
    }
    setFlashPulse(true);
    const pulseTimer = window.setInterval(() => {
      setFlashPulse((p) => !p);
    }, 700);
    return () => window.clearInterval(pulseTimer);
  }, [alertActive]);

  const computeStageLabel = (): string => {
    const cdText = `COUNTDOWN ${formatCountdown(countdownRemainingSec)}`;
    const sermonText = `SERMON ${formatElapsed(sermonElapsedSec)}`;
    const clockText = formatClock(now, clock24h);

    if (stageMode === "countdown") {
      return showClock ? `${cdText} • ${clockText}` : cdText;
    }
    if (stageMode === "sermon") {
      return showClock ? `${sermonText} • ${clockText}` : sermonText;
    }
    if (stageMode === "clock") {
      return `CLOCK ${clockText}`;
    }

    // "auto": prioritize actively running timer
    const parts: string[] = [];
    if (countdownRunning || countdownRemainingSec !== countdownDurationSec) {
      parts.push(cdText);
    }
    if (sermonRunning || sermonElapsedSec > 0) {
      parts.push(sermonText);
    }
    if (parts.length === 0) {
      parts.push(cdText);
    }
    if (showClock) {
      parts.push(clockText);
    }
    return parts.join(" • ");
  };

  const liveStageLabel = computeStageLabel();

  useEffect(() => {
    if (!hasUserSyncedRef.current) return;
    if (liveStageLabel !== lastLabelRef.current) {
      lastLabelRef.current = liveStageLabel;
      onUpdateTimerLabelRef.current(liveStageLabel);
    }
  }, [liveStageLabel]);

  if (!isOpen) return null;

  const markSyncedAndEmit = (overrideLabel?: string) => {
    hasUserSyncedRef.current = true;
    if (overrideLabel !== undefined) {
      lastLabelRef.current = overrideLabel;
      onUpdateTimerLabel(overrideLabel);
    }
  };

  const applyCountdownMinutes = (mins: number) => {
    const safeMins = Math.max(1, Math.min(240, Math.round(mins)));
    const sec = safeMins * 60;
    setCountdownRunning(false);
    setCountdownDurationSec(sec);
    setCountdownRemainingSec(sec);
    hasUserSyncedRef.current = true;
  };

  const handleApplyCustomMinutes = () => {
    const parsed = Number(customMinutesInput);
    if (Number.isNaN(parsed) || parsed <= 0) return;
    const sec = Math.max(10, Math.min(240 * 60, Math.round(parsed * 60)));
    setCountdownRunning(false);
    setCountdownDurationSec(sec);
    setCountdownRemainingSec(sec);
    hasUserSyncedRef.current = true;
  };

  const handleFlashAlert = (msgOverride?: string) => {
    const msg = (msgOverride ?? alertInput).trim();
    if (!msg) return;
    setAlertInput(msg);
    setActiveAlertMessage(msg);
    setAlertActive(true);
    setAlertHistory((prev) => [msg, ...prev.filter((m) => m !== msg)].slice(0, 4));
    onBroadcastAlert(msg, true);
  };

  const handleClearAlert = () => {
    setAlertActive(false);
    setActiveAlertMessage("");
    onBroadcastAlert("", false);
  };

  const countdownProgressPct =
    countdownDurationSec > 0
      ? Math.max(0, Math.min(100, (countdownRemainingSec / countdownDurationSec) * 100))
      : 0;

  const countdownColor =
    countdownRemainingSec <= 0
      ? "#EF4444"
      : countdownRemainingSec <= 60
      ? "#FBBF24"
      : "#F8FAFC";

  const sermonOverTarget = sermonTargetMin > 0 && sermonElapsedSec >= sermonTargetMin * 60;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(8, 11, 16, 0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10001,
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 960,
          maxHeight: "88vh",
          background: "#121721",
          border: "1px solid #2E3748",
          borderRadius: 14,
          padding: 22,
          color: "#E2E8F0",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.7)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: "rgba(59, 130, 246, 0.16)",
                border: "1px solid rgba(59, 130, 246, 0.38)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Timer size={20} color="#60A5FA" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#FFFFFF" }}>
                Timers, Clock & Stage / Nursery Alerts
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94A3B8" }}>
                SlideHttp / SlideTcp stage confidence timers and real-time FOH & nursery alert ticker.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {showClock && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 11px",
                  borderRadius: 8,
                  background: "#0B0F17",
                  border: "1px solid #252C38",
                }}
              >
                <Clock size={14} color="#60A5FA" />
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0" }}>
                  {formatClock(now, clock24h)}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Timers and Alerts modal"
              style={{
                background: "transparent",
                border: "none",
                color: "#94A3B8",
                cursor: "pointer",
                padding: 4,
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Stage Output Label Preview Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            padding: "8px 12px",
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
              Stage Timer Feed:
            </span>
            <span
              className="mono"
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: "#93C5FD",
                background: "rgba(59, 130, 246, 0.12)",
                border: "1px solid rgba(59, 130, 246, 0.28)",
                padding: "3px 9px",
                borderRadius: 6,
              }}
            >
              {liveStageLabel}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value={stageMode}
              onChange={(e) => {
                setStageMode(e.target.value as StageTimerMode);
                hasUserSyncedRef.current = true;
              }}
              style={{
                height: 30,
                padding: "0 8px",
                background: "#161B24",
                border: "1px solid #2E3748",
                borderRadius: 6,
                color: "#E2E8F0",
                fontSize: 12,
              }}
            >
              <option value="auto">Stage Feed: Auto Active</option>
              <option value="countdown">Stage Feed: Countdown</option>
              <option value="sermon">Stage Feed: Sermon Elapsed</option>
              <option value="clock">Stage Feed: Clock Only</option>
            </select>

            <button
              type="button"
              onClick={() => {
                setShowClock((prev) => !prev);
                hasUserSyncedRef.current = true;
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                height: 30,
                padding: "0 10px",
                background: showClock ? "rgba(59, 130, 246, 0.18)" : "#161B24",
                border: `1px solid ${showClock ? "#3B82F6" : "#2E3748"}`,
                borderRadius: 6,
                color: showClock ? "#BFDBFE" : "#94A3B8",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Clock size={13} /> Clock {showClock ? "ON" : "OFF"}
            </button>

            {showClock && (
              <button
                type="button"
                onClick={() => {
                  setClock24h((v) => !v);
                  hasUserSyncedRef.current = true;
                }}
                style={{
                  height: 30,
                  padding: "0 9px",
                  background: "#161B24",
                  border: "1px solid #2E3748",
                  borderRadius: 6,
                  color: "#CBD5E1",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {clock24h ? "24H" : "12H"}
              </button>
            )}

            <button
              type="button"
              onClick={() => markSyncedAndEmit(liveStageLabel)}
              style={{
                height: 30,
                padding: "0 10px",
                background: "#1E293B",
                border: "1px solid #334155",
                borderRadius: 6,
                color: "#93C5FD",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Sync Label Now
            </button>
          </div>
        </div>

        {/* Scrollable Inner Panels */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            paddingRight: 4,
          }}
        >
          {/* Top Grid: Service Countdown + Sermon Count-Up */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: 14,
            }}
          >
            {/* Card 1: Service Countdown Timer */}
            <div style={panelCardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={cardHeadingStyle}>Service Countdown Timer</span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: countdownRunning
                      ? countdownRemainingSec <= 0
                        ? "rgba(239, 68, 68, 0.2)"
                        : "rgba(16, 185, 129, 0.16)"
                      : "rgba(100, 116, 139, 0.2)",
                    color: countdownRunning
                      ? countdownRemainingSec <= 0
                        ? "#FCA5A5"
                        : "#34D399"
                      : "#94A3B8",
                    border: `1px solid ${
                      countdownRunning
                        ? countdownRemainingSec <= 0
                          ? "#EF4444"
                          : "#10B981"
                        : "#334155"
                    }`,
                  }}
                >
                  {countdownRemainingSec <= 0
                    ? allowOvertime
                      ? "OVERTIME"
                      : "TIME UP"
                    : countdownRunning
                    ? "RUNNING"
                    : "PAUSED"}
                </span>
              </div>

              {/* Big Readout */}
              <div
                style={{
                  background: "#090D14",
                  border: "1px solid #1E2533",
                  borderRadius: 10,
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 42,
                      fontWeight: 800,
                      lineHeight: 1,
                      color: countdownColor,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {formatCountdown(countdownRemainingSec)}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      title="Subtract 1 minute"
                      onClick={() => {
                        setCountdownRemainingSec((s) => s - 60);
                        hasUserSyncedRef.current = true;
                      }}
                      style={nudgeBtnStyle}
                    >
                      <Minus size={13} /> 1m
                    </button>
                    <button
                      type="button"
                      title="Add 1 minute"
                      onClick={() => {
                        setCountdownRemainingSec((s) => s + 60);
                        hasUserSyncedRef.current = true;
                      }}
                      style={nudgeBtnStyle}
                    >
                      <Plus size={13} /> 1m
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div
                  style={{
                    height: 6,
                    background: "#1A2230",
                    borderRadius: 999,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${countdownProgressPct}%`,
                      background:
                        countdownRemainingSec <= 0
                          ? "#EF4444"
                          : countdownRemainingSec <= 60
                          ? "#F59E0B"
                          : "#3B82F6",
                      transition: "width 0.35s linear",
                    }}
                  />
                </div>
              </div>

              {/* Presets + Custom Minutes */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {COUNTDOWN_PRESETS_MIN.map((m) => {
                  const isCurrent = countdownDurationSec === m * 60;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => applyCountdownMinutes(m)}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 6,
                        border: `1px solid ${isCurrent ? "#3B82F6" : "#283344"}`,
                        background: isCurrent ? "rgba(59, 130, 246, 0.2)" : "#161B24",
                        color: isCurrent ? "#93C5FD" : "#CBD5E1",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {m}:00
                    </button>
                  );
                })}

                <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={customMinutesInput}
                    onChange={(e) => setCustomMinutesInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleApplyCustomMinutes();
                      }
                    }}
                    aria-label="Custom countdown minutes"
                    style={{
                      width: 58,
                      height: 28,
                      padding: "0 6px",
                      background: "#0B0F17",
                      border: "1px solid #2B3545",
                      borderRadius: 6,
                      color: "#FFFFFF",
                      fontSize: 12,
                      textAlign: "center",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleApplyCustomMinutes}
                    style={{
                      height: 28,
                      padding: "0 9px",
                      background: "#1E293B",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      color: "#E2E8F0",
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Set min
                  </button>
                </div>
              </div>

              {/* Start / Pause / Reset + Overtime toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      hasUserSyncedRef.current = true;
                      setCountdownRunning((r) => !r);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: `1px solid ${countdownRunning ? "#F59E0B" : "#10B981"}`,
                      background: countdownRunning ? "#92400E" : "#065F46",
                      color: "#FFFFFF",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {countdownRunning ? <Pause size={15} /> : <Play size={15} />}
                    {countdownRunning ? "Pause" : "Start"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      hasUserSyncedRef.current = true;
                      setCountdownRunning(false);
                      setCountdownRemainingSec(countdownDurationSec);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 13px",
                      borderRadius: 8,
                      border: "1px solid #2E3748",
                      background: "#1C222D",
                      color: "#CBD5E1",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <RotateCcw size={14} /> Reset
                  </button>
                </div>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    color: "#94A3B8",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allowOvertime}
                    onChange={(e) => setAllowOvertime(e.target.checked)}
                  />
                  Allow Overtime (-)
                </label>
              </div>
            </div>

            {/* Card 2: Elapsed / Count-Up Sermon Timer */}
            <div style={panelCardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={cardHeadingStyle}>Sermon Elapsed (Count-Up)</span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: sermonRunning
                      ? sermonOverTarget
                        ? "rgba(245, 158, 11, 0.2)"
                        : "rgba(16, 185, 129, 0.16)"
                      : "rgba(100, 116, 139, 0.2)",
                    color: sermonRunning
                      ? sermonOverTarget
                        ? "#FDE68A"
                        : "#34D399"
                      : "#94A3B8",
                    border: `1px solid ${
                      sermonRunning
                        ? sermonOverTarget
                          ? "#F59E0B"
                          : "#10B981"
                        : "#334155"
                    }`,
                  }}
                >
                  {sermonRunning ? (sermonOverTarget ? "PAST TARGET" : "COUNTING") : "STANDBY"}
                </span>
              </div>

              <div
                style={{
                  background: "#090D14",
                  border: "1px solid #1E2533",
                  borderRadius: 10,
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 42,
                      fontWeight: 800,
                      lineHeight: 1,
                      color: sermonOverTarget ? "#FBBF24" : "#34D399",
                    }}
                  >
                    {formatElapsed(sermonElapsedSec)}
                  </div>
                  <span className="mono" style={{ fontSize: 11.5, color: "#64748B" }}>
                    Target: {sermonTargetMin}:00
                  </span>
                </div>

                {/* Sermon Target Progress */}
                <div
                  style={{
                    height: 6,
                    background: "#1A2230",
                    borderRadius: 999,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(
                        100,
                        sermonTargetMin > 0 ? (sermonElapsedSec / (sermonTargetMin * 60)) * 100 : 0
                      )}%`,
                      background: sermonOverTarget ? "#F59E0B" : "#10B981",
                      transition: "width 0.35s linear",
                    }}
                  />
                </div>
              </div>

              {/* Target Minutes & Clock Summary */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94A3B8" }}>
                  <span>Target (min):</span>
                  {[25, 35, 45].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSermonTargetMin(t)}
                      style={{
                        padding: "4px 9px",
                        borderRadius: 6,
                        border: `1px solid ${sermonTargetMin === t ? "#10B981" : "#283344"}`,
                        background: sermonTargetMin === t ? "rgba(16, 185, 129, 0.18)" : "#161B24",
                        color: sermonTargetMin === t ? "#A7F3D0" : "#CBD5E1",
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {t}m
                    </button>
                  ))}
                </div>

                <span className="mono" style={{ fontSize: 11.5, color: "#94A3B8" }}>
                  {showClock ? `Wall Clock: ${formatClock(now, clock24h)}` : "Wall Clock Hidden"}
                </span>
              </div>

              {/* Start / Pause / Reset */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    hasUserSyncedRef.current = true;
                    setSermonRunning((r) => !r);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: `1px solid ${sermonRunning ? "#F59E0B" : "#3B82F6"}`,
                    background: sermonRunning ? "#92400E" : "#2563EB",
                    color: "#FFFFFF",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {sermonRunning ? <Pause size={15} /> : <Play size={15} />}
                  {sermonRunning ? "Pause Sermon" : "Start Sermon"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    hasUserSyncedRef.current = true;
                    setSermonRunning(false);
                    setSermonElapsedSec(0);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 13px",
                    borderRadius: 8,
                    border: "1px solid #2E3748",
                    background: "#1C222D",
                    color: "#CBD5E1",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <RotateCcw size={14} /> Reset
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Panel: Stage & FOH Messages / Nursery Alerts Ticker */}
          <div style={panelCardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Megaphone size={16} color="#FBBF24" />
                <span style={cardHeadingStyle}>
                  Stage & FOH Messages / Nursery Alerts Ticker
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: "3px 9px",
                  borderRadius: 999,
                  background: alertActive ? "rgba(239, 68, 68, 0.2)" : "rgba(100, 116, 139, 0.16)",
                  border: `1px solid ${alertActive ? "#EF4444" : "#334155"}`,
                  color: alertActive ? "#FCA5A5" : "#94A3B8",
                }}
              >
                {alertActive ? "LIVE ON FOH & STAGE" : "TICKER CLEAR"}
              </span>
            </div>

            {/* Live Ticker Preview Strip */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 9,
                background: alertActive
                  ? flashPulse
                    ? "rgba(220, 38, 38, 0.26)"
                    : "rgba(180, 83, 9, 0.24)"
                  : "#090D14",
                border: `1px solid ${
                  alertActive ? (flashPulse ? "#EF4444" : "#F59E0B") : "#1E2533"
                }`,
                transition: "background-color 0.25s ease, border-color 0.25s ease",
              }}
            >
              {alertActive ? (
                <AlertTriangle size={18} color={flashPulse ? "#FCA5A5" : "#FDE68A"} style={{ flexShrink: 0 }} />
              ) : (
                <BellOff size={16} color="#64748B" style={{ flexShrink: 0 }} />
              )}
              <div
                style={{
                  flex: 1,
                  fontSize: 13.5,
                  fontWeight: alertActive ? 700 : 500,
                  color: alertActive ? "#FFFFFF" : "#64748B",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {alertActive
                  ? activeAlertMessage
                  : "No active nursery or stage ticker alert. Enter a message below and press Flash Alert."}
              </div>
            </div>

            {/* Message Input + Flash / Clear Buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                value={alertInput}
                onChange={(e) => setAlertInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleFlashAlert();
                  }
                }}
                placeholder='e.g. "Parent #104 needed in Nursery Room B"'
                style={{
                  flex: 1,
                  minWidth: 240,
                  height: 38,
                  padding: "0 12px",
                  background: "#0B0F17",
                  border: "1px solid #2B3545",
                  borderRadius: 8,
                  color: "#FFFFFF",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                disabled={!alertInput.trim()}
                onClick={() => handleFlashAlert()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 38,
                  padding: "0 16px",
                  background: alertInput.trim() ? "#DC2626" : "#334155",
                  border: `1px solid ${alertInput.trim() ? "#EF4444" : "#475569"}`,
                  borderRadius: 8,
                  color: "#FFFFFF",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: alertInput.trim() ? "pointer" : "not-allowed",
                }}
              >
                <Bell size={15} /> Flash Alert
              </button>
              <button
                type="button"
                onClick={handleClearAlert}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 38,
                  padding: "0 14px",
                  background: "#1C222D",
                  border: "1px solid #2E3748",
                  borderRadius: 8,
                  color: "#CBD5E1",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <BellOff size={15} /> Clear Alert
              </button>
            </div>

            {/* Quick-Fill Nursery & Stage Presets */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginRight: 2 }}>
                QUICK PRESETS:
              </span>
              {ALERT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAlertInput(preset)}
                  style={{
                    padding: "4px 9px",
                    borderRadius: 999,
                    border: "1px solid #252C38",
                    background: "#161B24",
                    color: "#CBD5E1",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>

            {alertHistory.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginRight: 2 }}>
                  RECENT:
                </span>
                {alertHistory.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => handleFlashAlert(item)}
                    title="Click to re-flash this alert"
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "1px solid #2E3748",
                      background: "#0B0F17",
                      color: "#93C5FD",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Re-flash: {item}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
            paddingTop: 6,
            borderTop: "1px solid #1E2533",
            fontSize: 12,
            color: "#94A3B8",
          }}
        >
          <span>Timers continue running in the background when this window is closed.</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              background: "#1E2533",
              border: "1px solid #2E3748",
              borderRadius: 8,
              color: "#E2E8F0",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const panelCardStyle: React.CSSProperties = {
  background: "#0D1117",
  border: "1px solid #1E2533",
  borderRadius: 10,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 11,
};

const cardHeadingStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#CBD5E1",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const nudgeBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 3,
  height: 28,
  padding: "0 8px",
  background: "#161B24",
  border: "1px solid #283344",
  borderRadius: 6,
  color: "#CBD5E1",
  fontSize: 11.5,
  fontWeight: 700,
  cursor: "pointer",
};

export default TimersAndAlertsModal;
