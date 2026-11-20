import React, { useState } from "react";
import type { AppStateSnapshot } from "../types";
import { ConsoleFullMixerModal } from "./ConsoleFullMixerModal";
import { AoipMatrixView } from "./AoipMatrixView";
import { aoipControlCommand, routeAoipCrosspoint, sendConsoleOsc } from "../bridge";

interface EngineerViewProps {
  state: AppStateSnapshot;
  onBroadcastToggle: (targetId: string, live: boolean) => void;
  onToggleDcaMute: (dcaId: string) => void;
  onToggleBeltpackFault: () => void;
  onSwitchIpVideoReceiver: (receiverId: string, sourceName: string) => void;
  onAutoHealIpVideo: () => void;
  onFlashAoipIdentify: (routeId: string) => void;
}

export const EngineerView: React.FC<EngineerViewProps> = ({
  state,
  onBroadcastToggle,
  onToggleDcaMute,
  onToggleBeltpackFault,
  onSwitchIpVideoReceiver,
  onAutoHealIpVideo,
  onFlashAoipIdentify,
}) => {
  const [tab, setTab] = useState<"audio" | "aoip" | "ipVideo" | "broadcast" | "logs">("audio");
  const [showFullConsole, setShowFullConsole] = useState(false);

  return (
    <div style={{ padding: tab === "audio" ? "8px 12px" : 20, maxWidth: tab === "audio" ? "100%" : 1220, margin: "0 auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: tab === "audio" ? 8 : 14 }}>
        {(
          [
            ["audio", "Console Editor"],
            ["aoip", "AOIP Matrix"],
            ["ipVideo", "IP Video Matrix"],
            ["broadcast", "Stream & Recording Outputs"],
            ["logs", "Activity Log"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn"
            onClick={() => setTab(id)}
            style={{
              height: 40,
              padding: "0 14px",
              fontSize: 13,
              background: tab === id ? "#2563EB" : "#1C222D",
              borderColor: tab === id ? "#60A5FA" : "#2E3746",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "broadcast" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>Broadcast 33 Multi-Canvas + Broadcast DualOutputService</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
              {state.canvases.map((c) => (
                <div
                  key={c.uuid}
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    background: "#1C222D",
                    border: "1px solid #2A3241",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span>{c.name} ({c.aspect})</span>
                    <span className="mono" style={{ fontSize: 12, color: "#60A5FA" }}>{c.resolution}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "#34D399", marginTop: 6 }}>
                    Active Scene: {c.activeScene}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
                    Engine: {c.engine}
                  </div>
                </div>
              ))}
            </div>

            <h4>Broadcast & Recording Outputs</h4>
            <div style={{ display: "grid", gap: 10 }}>
              {state.broadcasts.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderRadius: 10,
                    background: "#1C222D",
                    border: "1px solid #2A3241",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{b.platform}</div>
                    <div className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                      {b.endpoint} • {b.canvas} • {b.live ? `${b.bitrateKbps} kbps • 0 dropped` : "Standby"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onBroadcastToggle(b.id, !b.live)}
                    style={{
                      height: 38,
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

            <h4 style={{ marginBottom: 8 }}>Broadcast 33 Automatic Recording Chapters (`CreateRecordChapter`)</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {state.recordChapters.map((ch) => (
                <span
                  key={ch}
                  className="mono"
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: "#121721",
                    border: "1px solid #2A3241",
                    color: "#34D399",
                  }}
                >
                  {ch}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "audio" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 12px",
              borderRadius: 6,
              background: "#141821",
              border: "1px solid #242A36",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 12.5, color: "#E2E8F0" }}>Console Editor (:10023)</strong>
              {state.dcas.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onToggleDcaMute(d.id)}
                  title={`${d.aoipTxChannel}: ${d.signalDb} dBFS — Click to Mute/Unmute DCA ${d.number}`}
                  style={{
                    height: 24,
                    padding: "0 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    background: d.muted ? "#7F1D1D" : "#065F46",
                    border: `1px solid ${d.muted ? "#EF4444" : "#10B981"}`,
                    color: "#FFFFFF",
                  }}
                >
                  DCA {d.number} {d.name}: {d.muted ? "MUTE" : `${d.levelDb}dB`}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              onClick={onToggleBeltpackFault}
              style={{
                height: 26,
                padding: "0 10px",
                fontSize: 11,
                background: state.beltpackFaultSimulated ? "#7F1D1D" : "#1C222D",
                borderColor: state.beltpackFaultSimulated ? "#EF4444" : "#475569",
              }}
            >
              {state.beltpackFaultSimulated ? "Clear Pastor Fault" : "Test Beltpack Fault (0xFE)"}
            </button>
          </div>

          <ConsoleFullMixerModal
            embedded
            isOpen={true}
            onClose={() => {}}
            onPopout={() => setShowFullConsole(true)}
            onSendConsoleCommand={(addr, val) => {
              if (typeof val === "number") sendConsoleOsc(addr, val);
            }}
          />
        </div>
      )}

      {tab === "aoip" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Aoip ARC Crosspoints (`_netaudio-arc._udp`) & Conmon Metering (`UDP :8751`)</h3>
          <div className="mono" style={{ padding: 12, borderRadius: 8, background: "#121721", border: "1px solid #2A3241", color: "#34D399", marginBottom: 14, fontSize: 12 }}>
            {state.aoipClock}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {state.aoipRoutes.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderRadius: 10,
                  background: "#1C222D",
                  border: "1px solid #2A3241",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {r.rxDevice} ({r.rxChannel}) ← {r.txDevice} ({r.txChannel})
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "#9CA3AF", marginTop: 3 }}>
                    ARC RXSTATUS: <strong style={{ color: "#34D399" }}>{r.rxStatus}</strong> • Conmon Peak: {r.signalDbfs} dBFS
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => onFlashAoipIdentify(r.id)}
                  style={{
                    height: 36,
                    padding: "0 12px",
                    fontSize: 12,
                    background: r.identifyFlashing ? "#D97706" : "#121721",
                    borderColor: r.identifyFlashing ? "#FBBF24" : "#2E3746",
                  }}
                >
                  {r.identifyFlashing ? "Flashing Hardware LED (0x0063)..." : "Identify Device (0x0063)"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "ipVideo" && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0 }}>IP Video 6 Discovery Service (`TCP :5959` `receiver_listener`)</h3>
              <p style={{ margin: "4px 0 0", color: "#9CA3AF", fontSize: 13 }}>
                Remotely retarget any IP Video Studio Monitor or decoder in the building via <code>&lt;control_receiver&gt;</code>, or auto-heal drifted displays.
              </p>
            </div>
            <button
              type="button"
              className="btn"
              onClick={onAutoHealIpVideo}
              style={{ height: 38, padding: "0 14px", background: "#065F46", borderColor: "#10B981" }}
            >
              Auto-Heal All Receivers to Show Spec
            </button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {state.ipVideoReceivers.map((rx) => (
              <div
                key={rx.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderRadius: 10,
                  background: "#1C222D",
                  border: `1px solid ${rx.status === "DRIFT" ? "#F59E0B" : "#2A3241"}`,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {rx.receiverName} <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>({rx.ip})</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: rx.status === "DRIFT" ? "#FBBF24" : "#34D399", marginTop: 3 }}>
                    Status: {rx.status} • Expected: {rx.expectedSource}
                  </div>
                </div>
                <select
                  value={rx.subscribedSource}
                  onChange={(e) => onSwitchIpVideoReceiver(rx.id, e.target.value)}
                  className="mono"
                  style={{
                    height: 36,
                    padding: "0 10px",
                    borderRadius: 8,
                    background: "#0B0D10",
                    color: "#F3F4F6",
                    border: "1px solid #3B82F6",
                    fontSize: 12,
                  }}
                >
                  {state.ipVideoSources.map((src) => (
                    <option key={src} value={src}>
                      {src}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Unified Protocol & Cue Execution Timeline</h3>
          <div
            className="mono"
            style={{
              display: "grid",
              gap: 6,
              padding: 14,
              borderRadius: 10,
              background: "#0B0D10",
              border: "1px solid #252C38",
              maxHeight: 420,
              overflowY: "auto",
              fontSize: 12,
              color: "#D1D5DB",
            }}
          >
            {state.eventLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}
      {tab === "aoip" && (
        <div style={{ marginTop: 14 }}>
          <AoipMatrixView
            routes={state.aoipRoutes}
            onRoutePatch={(rxIp, rxChanId, txChan, txDev) => {
              routeAoipCrosspoint(rxIp, rxChanId, txChan, txDev).catch(() => {});
            }}
            onIdentifyDevice={(deviceIp) => onFlashAoipIdentify(deviceIp)}
            onControlDevice={(targetIp, action, value) => {
              aoipControlCommand(targetIp, action, value).catch(() => {});
            }}
          />
        </div>
      )}

      <ConsoleFullMixerModal
        isOpen={showFullConsole}
        onClose={() => setShowFullConsole(false)}
        onSendConsoleCommand={(addr, val) => {
          if (typeof val === "number") sendConsoleOsc(addr, val);
        }}
      />
    </div>
  );
};
