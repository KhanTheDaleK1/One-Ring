import React, { useState } from "react";
import type { AppStateSnapshot } from "../types";

interface EngineerViewProps {
  state: AppStateSnapshot;
  onBroadcastToggle: (targetId: string, live: boolean) => void;
  onToggleDcaMute: (dcaId: string) => void;
}

export const EngineerView: React.FC<EngineerViewProps> = ({
  state,
  onBroadcastToggle,
  onToggleDcaMute,
}) => {
  const [tab, setTab] = useState<"broadcast" | "audio" | "dante" | "cues">("broadcast");

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(
          [
            ["broadcast", "Multi-Broadcast (YT + FB) & OBS"],
            ["audio", "X32 Mixer & DCAs"],
            ["dante", "Dante Clock & Discovery"],
            ["cues", "Cue Stack Inspector"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn"
            onClick={() => setTab(id)}
            style={{
              height: 42,
              padding: "0 16px",
              background: tab === id ? "#2563EB" : "#1C222D",
              borderColor: tab === id ? "#60A5FA" : "#2E3746",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "broadcast" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Multi-Broadcast Destinations (Independent Control)</h3>
          <p style={{ color: "#9CA3AF", fontSize: 14 }}>
            Single local encode fanned out to YouTube Live and Facebook Live RTMPS endpoints + local NAS recording.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {state.broadcasts.map((b) => (
              <div
                key={b.id}
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
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{b.platform}</div>
                  <div className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                    {b.endpoint} • {b.live ? `${b.bitrateKbps} kbps • 0 dropped` : "Standby"}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => onBroadcastToggle(b.id, !b.live)}
                  style={{
                    height: 40,
                    padding: "0 16px",
                    background: b.live ? "#7F1D1D" : "#065F46",
                    borderColor: b.live ? "#EF4444" : "#10B981",
                  }}
                >
                  {b.live ? "Stop Target" : "Start Target"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "audio" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Behringer X32 DCAs (Unrestricted Engineer Access)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {state.dcas.map((d) => (
              <div key={d.id} style={{ padding: 14, borderRadius: 10, background: "#1C222D", border: "1px solid #2A3241" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>DCA {d.number}: {d.name}</div>
                <div className="mono" style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 10 }}>
                  Level: {d.levelDb} dB (Bounds: {d.minDb} to +{d.maxDb})
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => onToggleDcaMute(d.id)}
                  style={{
                    width: "100%",
                    height: 40,
                    background: d.muted ? "#7F1D1D" : "#065F46",
                    borderColor: d.muted ? "#EF4444" : "#10B981",
                  }}
                >
                  {d.muted ? "MUTED" : "ACTIVE"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "dante" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Dante Network & Clock Status</h3>
          <div className="mono" style={{ padding: 14, borderRadius: 10, background: "#1C222D", border: "1px solid #2A3241", color: "#34D399" }}>
            {state.danteClock}
          </div>
          <p style={{ color: "#9CA3AF", fontSize: 14, marginTop: 12 }}>
            Protocol hooks in <code>crates/ring-av-routing</code> will bind to the reverse-engineered specs produced by <code>rea-decompiler</code> in <code>docs/re-findings/dante-*.md</code>.
          </p>
        </div>
      )}

      {tab === "cues" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Service Cue Stack ({state.serviceName})</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {state.cues.map((c) => (
              <div key={c.id} style={{ padding: 12, borderRadius: 10, background: "#1C222D", border: "1px solid #2A3241" }}>
                <div style={{ fontWeight: 700 }}>{c.index}. {c.title}</div>
                <div className="mono" style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>
                  {c.actions.join("  |  ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
