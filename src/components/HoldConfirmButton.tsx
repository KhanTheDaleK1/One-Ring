import React, { useEffect, useRef, useState } from "react";

interface HoldConfirmButtonProps {
  label: string;
  holdMs?: number;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  style?: React.CSSProperties;
}

export const HoldConfirmButton: React.FC<HoldConfirmButtonProps> = ({
  label,
  holdMs = 1500,
  onConfirm,
  disabled = false,
  danger = true,
  style,
}) => {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const cancel = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setProgress(0);
  };

  const startHold = () => {
    if (disabled) return;
    startRef.current = performance.now();
    const tick = (now: number) => {
      if (startRef.current === null) return;
      const pct = Math.min(1, (now - startRef.current) / holdMs);
      setProgress(pct);
      if (pct >= 1) {
        cancel();
        onConfirm();
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={startHold}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      className="btn"
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: 48,
        padding: "0 16px",
        borderColor: danger ? "#7F1D1D" : "#374151",
        background: danger ? "#2A1215" : "#1C222D",
        color: danger ? "#FCA5A5" : "#F3F4F6",
        userSelect: "none",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${Math.round(progress * 100)}%`,
          background: danger ? "rgba(239, 68, 68, 0.55)" : "rgba(59, 130, 246, 0.45)",
          transition: progress === 0 ? "width 0.12s ease" : "none",
          pointerEvents: "none",
        }}
      />
      <span style={{ position: "relative", zIndex: 1 }}>
        {progress > 0 ? `Keep holding... ${Math.round(progress * 100)}%` : label}
      </span>
    </button>
  );
};
