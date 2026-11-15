import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight, ShieldCheck } from "lucide-react";
import type { AppStateSnapshot } from "../types";

interface PreflightViewProps {
  state: AppStateSnapshot;
  onEnterShowMode: () => void;
  onOpenEngineer: () => void;
}

export const PreflightView: React.FC<PreflightViewProps> = ({
  state,
  onEnterShowMode,
  onOpenEngineer,
}) => {
  const allPass = state.preflight.every((p) => p.status === "pass");

  return (
    <div style={{ maxWidth: 980, margin: "28px auto", padding: "0 20px" }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ShieldCheck size={24} color="#10B981" />
              <h2 style={{ margin: 0, fontSize: 22 }}>Pre-Service Readiness Check</h2>
            </div>
            <p style={{ margin: "6px 0 0", color: "#9CA3AF", fontSize: 14 }}>
              Automated verification across X32, Dante 48kHz Clock, YouTube Live, Facebook Live, FOH Slides, and PTZ Cameras.
            </p>
          </div>
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
            {allPass ? "ALL SYSTEMS READY" : "ATTENTION NEEDED"}
          </span>
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
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {chk.status === "pass" ? (
                  <CheckCircle2 size={20} color="#10B981" />
                ) : chk.status === "warn" ? (
                  <AlertTriangle size={20} color="#F59E0B" />
                ) : (
                  <XCircle size={20} color="#EF4444" />
                )}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    <span style={{ color: "#9CA3AF", marginRight: 8 }}>{chk.domain}</span>
                    {chk.title}
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>
                    {chk.detail}
                  </div>
                </div>
              </div>
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
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22 }}>
          <button type="button" className="btn" onClick={onOpenEngineer} style={{ height: 46, padding: "0 18px" }}>
            Open Engineer Setup
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
