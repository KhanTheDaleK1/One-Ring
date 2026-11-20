import React, { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight, ShieldCheck, RefreshCw } from "lucide-react";
import type { AppStateSnapshot } from "../types";

interface PreflightViewProps {
  state: AppStateSnapshot;
  onRunProbes: () => void | Promise<void>;
  onEnterShowMode: () => void;
  onOpenEngineer: () => void;
}

function plainDomainLabel(domain: string): string {
  const key = domain.trim().toLowerCase();
  if (key.includes("audio") || key.includes("console") || key.includes("aoip")) return "Audio";
  if (key.includes("video") || key.includes("camera") || key.includes("ptz")) return "Video";
  if (key.includes("slide") || key.includes("present")) return "Slides";
  if (key.includes("broadcast") || key.includes("stream") || key.includes("record")) return "Broadcast";
  if (key.includes("network") || key.includes("sync") || key.includes("hub")) return "Network";
  return domain;
}

export const PreflightView: React.FC<PreflightViewProps> = ({
  state,
  onRunProbes,
  onEnterShowMode,
  onOpenEngineer,
}) => {
  const [probing, setProbing] = useState(false);
  const passedCount = state.preflight.filter((p) => p.status === "pass").length;
  const warnCount = state.preflight.filter((p) => p.status === "warn").length;
  const failCount = state.preflight.filter((p) => p.status === "fail").length;
  const totalCount = state.preflight.length;
  const allPass = totalCount > 0 && passedCount === totalCount;

  const runProbes = async () => {
    setProbing(true);
    try {
      await Promise.resolve(onRunProbes());
    } finally {
      setProbing(false);
    }
  };

  const statusSummary =
    totalCount === 0
      ? "No checks run yet"
      : allPass
      ? `${passedCount}/${totalCount} checks ready`
      : `${failCount} failed, ${warnCount} warning${warnCount === 1 ? "" : "s"}`;

  return (
    <div style={{ maxWidth: 1040, margin: "24px auto", padding: "0 20px" }}>
      <div className="card" style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ShieldCheck size={24} color="#10B981" />
              <h2 style={{ margin: 0, fontSize: 22 }}>Is everything ready for service?</h2>
            </div>
            <p style={{ margin: "6px 0 0", color: "#9CA3AF", fontSize: 14, maxWidth: 720 }}>
              Run a quick readiness check before you go live. We’ll verify audio, video, slides, and broadcast
              connections and clearly show what needs attention.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() => void runProbes()}
              disabled={probing}
              aria-busy={probing}
              style={{ height: 38, padding: "0 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
            >
              <RefreshCw size={14} /> {probing ? "Checking…" : totalCount === 0 ? "Run first check" : "Run checks again"}
            </button>
            <span
              className="mono"
              role="status"
              aria-live="polite"
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: allPass
                  ? "rgba(16,185,129,0.14)"
                  : totalCount === 0
                  ? "rgba(148,163,184,0.14)"
                  : failCount > 0
                  ? "rgba(239,68,68,0.14)"
                  : "rgba(245,158,11,0.14)",
                color: allPass ? "#34D399" : totalCount === 0 ? "#CBD5E1" : failCount > 0 ? "#F87171" : "#FBBF24",
                border: `1px solid ${
                  allPass ? "#065F46" : totalCount === 0 ? "#475569" : failCount > 0 ? "#7F1D1D" : "#78350F"
                }`,
              }}
            >
              {statusSummary}
            </span>
          </div>
        </div>

        {probing && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(59,130,246,0.12)",
              border: "1px solid #2563EB",
              color: "#93C5FD",
              fontSize: 13,
            }}
          >
            Checking your service connections…
          </div>
        )}

        {totalCount === 0 ? (
          <div
            style={{
              padding: "24px 18px",
              borderRadius: 10,
              background: "#1C222D",
              border: "1px dashed #475569",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No checks run yet</div>
            <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 14 }}>
              Run a first check to confirm audio, video, slides, and broadcast connections are ready.
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => void runProbes()}
              disabled={probing}
              style={{ height: 40, padding: "0 16px" }}
            >
              {probing ? "Checking…" : "Run first check"}
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {state.preflight.map((chk) => (
              <div
                key={chk.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  padding: "14px 16px",
                  borderRadius: 10,
                  background: "#1C222D",
                  border: "1px solid #2A3241",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: "1 1 320px" }}>
                  <div style={{ marginTop: 2 }} aria-hidden="true">
                    {chk.status === "pass" ? (
                      <CheckCircle2 size={20} color="#10B981" />
                    ) : chk.status === "warn" ? (
                      <AlertTriangle size={20} color="#F59E0B" />
                    ) : (
                      <XCircle size={20} color="#EF4444" />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      <span
                        style={{
                          display: "inline-block",
                          marginRight: 8,
                          padding: "1px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#93C5FD",
                          background: "rgba(59,130,246,0.14)",
                          border: "1px solid #1D4ED8",
                        }}
                      >
                        {plainDomainLabel(chk.domain)}
                      </span>
                      {chk.title}
                    </div>
                    <div style={{ fontSize: 13, color: "#D1D5DB", marginTop: 4 }}>{chk.detail}</div>
                    {chk.evidence && (
                      <details style={{ marginTop: 6 }}>
                        <summary
                          style={{
                            cursor: "pointer",
                            fontSize: 12,
                            color: "#94A3B8",
                            userSelect: "none",
                          }}
                        >
                          Technical details
                        </summary>
                        <div className="mono" style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
                          {chk.evidence}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {chk.status !== "pass" && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void runProbes()}
                      disabled={probing}
                      style={{ height: 32, padding: "0 10px", fontSize: 12 }}
                    >
                      {probing ? "Checking…" : "Retry check"}
                    </button>
                  )}
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color:
                        chk.status === "pass" ? "#34D399" : chk.status === "warn" ? "#FBBF24" : "#F87171",
                    }}
                  >
                    {chk.status === "pass" ? "READY" : chk.status === "warn" ? "CHECK" : "NEEDS ATTENTION"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 22,
          }}
        >
          <button type="button" className="btn" onClick={onOpenEngineer} style={{ height: 46, padding: "0 18px" }}>
            Open Engineer tools
          </button>
          <button
            type="button"
            className="btn"
            onClick={onEnterShowMode}
            style={{
              height: 52,
              padding: "0 24px",
              background: "#10B981",
              borderColor: "#059669",
              color: "#04120D",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            Enter Volunteer Show Mode
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
