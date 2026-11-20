import React, { useCallback, useEffect, useRef, useState } from "react";

interface HoldConfirmButtonProps {
  label: string;
  holdMs?: number;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Defaults to a spoken description of the hold gesture. */
  ariaLabel?: string;
  style?: React.CSSProperties;
  className?: string;
}

type HoldSource = "pointer" | "keyboard" | null;

const isHoldKey = (key: string): boolean => key === " " || key === "Spacebar" || key === "Enter";

/**
 * Press-and-hold confirmation that works identically with a pointer or with
 * Space/Enter held on the keyboard. Progress is visual only; a live region
 * announces the hold and the result to assistive technology.
 */
export const HoldConfirmButton: React.FC<HoldConfirmButtonProps> = ({
  label,
  holdMs = 1500,
  onConfirm,
  disabled = false,
  danger = true,
  ariaLabel,
  style,
  className,
}) => {
  const [progress, setProgress] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const sourceRef = useRef<HoldSource>(null);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const cancel = useCallback((source?: HoldSource, clearAnnouncement = true) => {
    if (source && sourceRef.current !== source) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    sourceRef.current = null;
    setProgress(0);
    if (clearAnnouncement) setAnnouncement("");
  }, []);

  const startHold = useCallback(
    (source: HoldSource) => {
      if (disabled || sourceRef.current !== null) return;
      sourceRef.current = source;
      startRef.current = performance.now();
      setAnnouncement(`Hold to confirm. ${(holdMs / 1000).toFixed(1)} seconds required.`);

      const tick = (now: number) => {
        if (startRef.current === null || sourceRef.current === null) return;
        const pct = Math.min(1, (now - startRef.current) / holdMs);
        setProgress(pct);
        if (pct >= 1) {
          cancel(source, false);
          setAnnouncement(`${label} confirmed.`);
          onConfirmRef.current();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [cancel, disabled, holdMs, label]
  );

  useEffect(() => () => cancel(), [cancel]);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel ?? `${label}. Hold ${(holdMs / 1000).toFixed(1)} seconds to confirm.`}
      onPointerDown={() => startHold("pointer")}
      onPointerUp={() => cancel("pointer")}
      onPointerLeave={() => cancel("pointer")}
      onPointerCancel={() => cancel("pointer")}
      onKeyDown={(event) => {
        if (!isHoldKey(event.key)) return;
        event.preventDefault();
        if (!event.repeat) startHold("keyboard");
      }}
      onKeyUp={(event) => {
        if (!isHoldKey(event.key)) return;
        event.preventDefault();
        cancel("keyboard");
      }}
      onBlur={() => cancel()}
      className={`btn${className ? ` ${className}` : ""}`}
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: 48,
        padding: "0 16px",
        borderColor: danger ? "#7F1D1D" : "var(--border-strong)",
        background: danger ? "#2A1215" : "var(--bg-2)",
        color: danger ? "#FCA5A5" : "var(--text-primary)",
        userSelect: "none",
        touchAction: "none",
        ...style,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: `${Math.round(progress * 100)}%`,
          background: danger ? "rgba(239, 68, 68, 0.55)" : "rgba(59, 130, 246, 0.45)",
          transition: progress === 0 ? "width 0.12s ease" : "none",
          pointerEvents: "none",
        }}
      />
      <span aria-hidden="true" style={{ position: "relative", zIndex: 1 }}>
        {progress > 0 ? `Keep holding... ${Math.round(progress * 100)}%` : label}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </button>
  );
};

export default HoldConfirmButton;
