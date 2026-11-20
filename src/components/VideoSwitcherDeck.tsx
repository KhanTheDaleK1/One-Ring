import React, { useEffect, useState } from "react";
import { Radio, Tv, Layers, Play, Square, RefreshCw, Scissors, Sliders } from "lucide-react";
import {
  discoverIpVideoBridgeSources,
  getIpVideoBridgeStatus,
  isTauriRuntime,
  sendIpVideoBridgeTestFrame,
  startIpVideoBridgeOutput,
  stopIpVideoBridgeOutput,
  switcherConnect,
  switcherDisconnect,
  switcherGetState,
  switcherSendCommand,
  type IpVideoBridgeStatusInfo,
  type SwitcherStateSnapshot,
} from "../bridge";
import { HoldConfirmButton } from "./HoldConfirmButton";

export const VideoSwitcherDeck: React.FC = () => {
  const [host, setHost] = useState("192.0.2.240");
  const [port, setPort] = useState(9910);
  const [sw, setSw] = useState<SwitcherStateSnapshot | null>(null);
  const [swError, setSwError] = useState<string | null>(null);

  const [ipStatus, setIpStatus] = useState<IpVideoBridgeStatusInfo | null>(null);
  const [streamName, setStreamName] = useState("One Ring Program");
  const [ipNotice, setIpNotice] = useState<string | null>(null);
  const [ipBusy, setIpBusy] = useState(false);

  useEffect(() => {
    switcherGetState().then(setSw).catch(() => {});
    getIpVideoBridgeStatus().then(setIpStatus).catch(() => {});
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<SwitcherStateSnapshot>("switcher://state", (ev) => {
          setSw(ev.payload);
        });
      } catch {
        // optional
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const handleConnect = async () => {
    setSwError(null);
    try {
      const next = await switcherConnect(host, port);
      setSw(next);
    } catch (err) {
      setSwError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDisconnect = async () => {
    setSwError(null);
    const next = await switcherDisconnect();
    setSw(next);
  };

  const send = async (action: Record<string, unknown>) => {
    setSwError(null);
    try {
      await switcherSendCommand(action);
    } catch (err) {
      setSwError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleIpOutput = async () => {
    setIpBusy(true);
    setIpNotice(null);
    try {
      if (ipStatus?.sending) {
        const next = await stopIpVideoBridgeOutput();
        setIpStatus(next);
        setIpNotice("Stopped LAN IP Video output.");
      } else {
        const next = await startIpVideoBridgeOutput(streamName);
        setIpStatus(next);
        setIpNotice(`Broadcasting LAN IP Video as "${next.senderName}".`);
      }
    } catch (err) {
      setIpNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIpBusy(false);
    }
  };

  const handleDiscoverIp = async () => {
    setIpBusy(true);
    setIpNotice(null);
    try {
      const found = await discoverIpVideoBridgeSources(1200);
      const st = await getIpVideoBridgeStatus();
      setIpStatus(st);
      setIpNotice(found.length > 0 ? `Found ${found.length} LAN IP video source(s).` : "No LAN IP video sources found.");
    } catch (err) {
      setIpNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIpBusy(false);
    }
  };

  const handleSendTestBar = async () => {
    setIpNotice(null);
    try {
      const count = await sendIpVideoBridgeTestFrame(1280, 720);
      const st = await getIpVideoBridgeStatus();
      setIpStatus(st);
      setIpNotice(`Sent test color-bar frame (#${count}).`);
    } catch (err) {
      setIpNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const online = sw?.link === "online";
  const programId = sw?.program?.["0"];
  const previewId = sw?.preview?.["0"];
  const ftbActive = Boolean(sw?.ftbBlack?.["0"]);
  const busInputs = (sw?.inputs || []).filter((i) => i.isBusSource);
  const inputName = (id: number | undefined) => {
    if (id === undefined) return "—";
    const found = sw?.inputs.find((i) => i.id === id);
    return found ? found.shortName || found.longName : `In ${id}`;
  };
  const uskMap = sw?.keyOnAir?.["0"] || {};
  const dskMap = sw?.dskOnAir || {};
  const macros = Object.entries(sw?.macros || {});

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Hardware Video Switcher Control Surface (UDP :9910) */}
      <div className="card" style={{ padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Tv size={16} color="#60A5FA" />
            <strong style={{ fontSize: 14 }}>Hardware Video Switcher (UDP :9910)</strong>
            <span
              className="mono"
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: online ? "rgba(16,185,129,0.16)" : "rgba(148,163,184,0.14)",
                color: online ? "#34D399" : "#94A3B8",
                border: `1px solid ${online ? "#10B981" : "#334155"}`,
              }}
            >
              {sw?.link?.toUpperCase() || "IDLE"} {sw?.product ? `· ${sw.product}` : ""}
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.0.2.240"
              aria-label="Hardware switcher IP address"
              className="mono"
              style={{
                width: 150,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#0F172A",
                color: "#F8FAFC",
                fontSize: 12,
              }}
            />
            <input
              type="number"
              value={port}
              min={1}
              max={65535}
              onChange={(e) => setPort(Number(e.target.value) || 9910)}
              aria-label="Hardware switcher UDP port"
              className="mono"
              style={{
                width: 74,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#0F172A",
                color: "#F8FAFC",
                fontSize: 12,
              }}
            />
            {online || sw?.link === "connecting" ? (
              <button type="button" className="btn btn-sm" onClick={handleDisconnect}>
                Disconnect
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-primary" onClick={handleConnect}>
                Connect
              </button>
            )}
          </div>
        </div>

        {swError && (
          <div role="alert" style={{ fontSize: 12, color: "#FCA5A5", background: "#450A0A", padding: "8px 10px", borderRadius: 6 }}>
            {swError}
          </div>
        )}

        {/* Next (Preview) & Live (Program) Tally Monitors */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ padding: 14, borderRadius: 8, background: "#0B1220", border: "2px solid #16A34A" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#4ADE80", letterSpacing: "0.06em" }}>
              NEXT (PREVIEW)
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#F8FAFC", marginTop: 4 }}>
              {inputName(previewId)}
            </div>
          </div>
          <div style={{ padding: 14, borderRadius: 8, background: "#1A0D10", border: "2px solid #DC2626" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#F87171", letterSpacing: "0.06em" }}>
              LIVE (PROGRAM){ftbActive ? " · FTB ACTIVE" : ""}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#FFFFFF", marginTop: 4 }}>
              {inputName(programId)}
            </div>
          </div>
        </div>

        {/* Source Row + Transition Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {(busInputs.length > 0 ? busInputs.slice(0, 12) : [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({
            id,
            longName: `Cam ${id}`,
            shortName: `CAM${id}`,
            isExternal: true,
            isBusSource: true,
            isAuxSource: true,
          }))).map((inp) => {
            const isPgm = programId === inp.id;
            const isPvw = previewId === inp.id;
            return (
              <button
                key={inp.id}
                type="button"
                disabled={!online}
                onClick={(e) =>
                  send(
                    e.shiftKey
                      ? { action: "setProgram", me: 0, source: inp.id }
                      : { action: "setPreview", me: 0, source: inp.id }
                  )
                }
                title={`Click: Preview (${inp.longName}) · Shift+Click: Direct Program`}
                style={{
                  minWidth: 68,
                  padding: "8px 10px",
                  borderRadius: 7,
                  border: `2px solid ${isPgm ? "#EF4444" : isPvw ? "#22C55E" : "#334155"}`,
                  background: isPgm ? "#7F1D1D" : isPvw ? "#14532D" : "#111827",
                  color: "#F8FAFC",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: online ? "pointer" : "not-allowed",
                  opacity: online ? 1 : 0.55,
                }}
              >
                {inp.shortName || inp.longName}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn"
            disabled={!online}
            onClick={() => send({ action: "cut", me: 0 })}
            style={{ background: "#1E293B", borderColor: "#475569", display: "flex", alignItems: "center", gap: 6 }}
          >
            <Scissors size={14} /> CUT
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!online}
            onClick={() => send({ action: "auto", me: 0 })}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Sliders size={14} /> AUTO / FADE
          </button>
          <HoldConfirmButton
            label={ftbActive ? "HOLD: RELEASE FTB" : "HOLD: FADE TO BLACK"}
            holdMs={700}
            disabled={!online}
            onConfirm={() => send({ action: "fadeToBlack", me: 0 })}
          />

          {Object.entries(uskMap).map(([k, on]) => (
            <button
              key={`usk-${k}`}
              type="button"
              className="btn btn-sm"
              disabled={!online}
              onClick={() => send({ action: "setKey", me: 0, keyer: Number(k), on: !on })}
              style={{
                background: on ? "#991B1B" : "#1E293B",
                borderColor: on ? "#EF4444" : "#334155",
              }}
            >
              <Layers size={12} /> USK {Number(k) + 1} {on ? "ON" : "OFF"}
            </button>
          ))}

          {Object.entries(dskMap).map(([k, on]) => (
            <button
              key={`dsk-${k}`}
              type="button"
              className="btn btn-sm"
              disabled={!online}
              onClick={() => send({ action: "setDsk", dsk: Number(k), on: !on })}
              style={{
                background: on ? "#991B1B" : "#1E293B",
                borderColor: on ? "#EF4444" : "#334155",
              }}
            >
              DSK {Number(k) + 1} {on ? "ON" : "OFF"}
            </button>
          ))}

          {macros.slice(0, 6).map(([idx, name]) => (
            <button
              key={`macro-${idx}`}
              type="button"
              className="btn btn-sm"
              disabled={!online}
              onClick={() => send({ action: "runMacro", index: Number(idx) })}
            >
              <Play size={11} /> {name}
            </button>
          ))}
        </div>
      </div>

      {/* Dynamic-Load LAN IP Video Broadcast Output & Discovery */}
      <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Radio size={16} color={ipStatus?.sending ? "#34D399" : "#38BDF8"} />
            <strong style={{ fontSize: 14 }}>LAN IP Video Broadcast Bridge (Dynamic Runtime)</strong>
            <span
              className="mono"
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: ipStatus?.available ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.15)",
                color: ipStatus?.available ? "#34D399" : "#FBBF24",
                border: `1px solid ${ipStatus?.available ? "#10B981" : "#D97706"}`,
              }}
            >
              {ipStatus?.sending
                ? `LIVE · ${ipStatus.framesSent} frames`
                : ipStatus?.available
                  ? "RUNTIME LOADED"
                  : "RUNTIME NOT INSTALLED"}
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={streamName}
              onChange={(e) => setStreamName(e.target.value)}
              placeholder="One Ring Program"
              aria-label="LAN IP video broadcast stream name"
              style={{
                width: 180,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#0F172A",
                color: "#F8FAFC",
                fontSize: 12,
              }}
            />
            <button
              type="button"
              className={ipStatus?.sending ? "btn btn-sm btn-danger" : "btn btn-sm btn-primary"}
              disabled={ipBusy || !ipStatus?.available}
              onClick={handleToggleIpOutput}
              style={{ display: "flex", alignItems: "center", gap: 5 }}
            >
              {ipStatus?.sending ? <><Square size={12} /> Stop Output</> : <><Radio size={12} /> Start IP Output</>}
            </button>
            {ipStatus?.sending && (
              <button type="button" className="btn btn-sm" onClick={handleSendTestBar}>
                Send Test Bars
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              disabled={ipBusy}
              onClick={handleDiscoverIp}
              style={{ display: "flex", alignItems: "center", gap: 5 }}
            >
              <RefreshCw size={12} /> Discover LAN
            </button>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#94A3B8" }}>
          {ipNotice || ipStatus?.detail || "Checking host IP video runtime..."}
        </div>

        {(ipStatus?.discoveredSources?.length ?? 0) > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ipStatus!.discoveredSources.map((src) => (
              <span
                key={src}
                className="mono"
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "#1E293B",
                  border: "1px solid #334155",
                  color: "#E2E8F0",
                }}
              >
                {src}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
