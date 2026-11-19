import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight, ShieldCheck, RefreshCw } from "lucide-react";
import type { AppStateSnapshot } from "../types";

interface PreflightViewProps {
  state: AppStateSnapshot;
  onRunProbes: () => void;
  onEnterShowMode: () => void;
  onOpenEngineer: () => void;
}

export const PreflightView: React.FC<PreflightViewProps> = ({
  state,
  onRunProbes,
  onEnterShowMode,
  onOpenEngineer,
}) => {
  const passedCount = state.preflight.filter((p) => p.status === "pass").length;
  const totalCount = state.preflight.length;
  const allPass = totalCount > 0 && passedCount === totalCount;

  return (
    <div style={{ maxWidth: 1040, margin: "24px auto", padding: "0 20px" }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ShieldCheck size={24} color="#10B981" />
              <h2 style={{ margin: 0, fontSize: 22 }}>Pre-Service Executable Readiness & Topology Proof</h2>
            </div>
            <p style={{ margin: "6px 0 0", color: "#9CA3AF", fontSize: 14 }}>
              Cross-validates Show File cues against live OBS 33 / Streamlabs Dual-Canvas, Dante Conmon/ARC, NDI 6 Discovery (:5959), ProPresenter v1, and X32 OSC.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={onRunProbes}
              style={{ height: 38, padding: "0 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
            >
              <RefreshCw size={14} /> Re-Probe All
            </button>
            <span
              className="mono"
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: allPass ? "rgba(16,185,129,0.14)" : "rgba(245,158,11,0.14)",
                color: allPass ? "#34D399" : "#FBBF24",
                border: `1px solid ${allPass ? "#065F46" : "#78350F"}`,
              }}
            >
              {allPass
                ? `${passedCount}/${totalCount} PROBES VERIFIED`
                : totalCount === 0
                ? "NO PROBES RUN"
                : `${passedCount}/${totalCount} PASSED — ATTENTION NEEDED`}
            </span>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {state.preflight.map((chk) => (
            <div
              key={chk.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 16px",
                borderRadius: 10,
                background: "#1C222D",
                border: "1px solid #2A3241",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ marginTop: 2 }}>
                  {chk.status === "pass" ? (
                    <CheckCircle2 size={20} color="#10B981" />
                  ) : chk.status === "warn" ? (
                    <AlertTriangle size={20} color="#F59E0B" />
                  ) : (
                    <XCircle size={20} color="#EF4444" />
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    <span style={{ color: "#60A5FA", marginRight: 8 }}>[{chk.domain}]</span>
                    {chk.title}
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>
                    {chk.detail}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "#34D399", marginTop: 3 }}>
                    Evidence: {chk.evidence}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {chk.fixLabel && (
                  <button
                    type="button"
                    className="btn"
                    onClick={onRunProbes}
                    style={{ height: 32, padding: "0 10px", fontSize: 12 }}
                  >
                    {chk.fixLabel}
                  </button>
                )}
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: chk.status === "pass" ? "#34D399" : "#FBBF24",
                  }}
                >
                  {chk.status.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22 }}>
          <button type="button" className="btn" onClick={onOpenEngineer} style={{ height: 46, padding: "0 18px" }}>
            Open Engineer Matrix & Logs
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
