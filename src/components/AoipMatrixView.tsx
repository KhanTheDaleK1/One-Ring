import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Lock,
  Unlock,
  Clock,
  Activity,
  Radio,
  Bell,
  Search,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Cpu,
  ShieldCheck,
  Plus,
} from "lucide-react";
import type { AoipRoute } from "../types";

export interface AoipMatrixViewProps {
  routes: AoipRoute[];
  onRoutePatch: (rxIp: string, rxChanId: number, txChan: string, txDev: string) => void;
  onIdentifyDevice: (deviceIp: string) => void;
}

type SampleRateKhz = 48 | 96;
type AoipLatencyMs = 0.25 | 0.5 | 1.0 | 2.0 | 5.0;

interface DeviceConfigState {
  sampleRate: SampleRateKhz;
  encoding: "PCM 24";
  latencyMs: AoipLatencyMs;
  ip: string;
}

interface TxColumn {
  key: string;
  device: string;
  channel: string;
}

interface RxRow {
  key: string;
  device: string;
  channel: string;
  rxIp: string;
  rxChanId: number;
  txDevice: string;
  txChannel: string;
  rxStatus: AoipRoute["rxStatus"];
  signalDbfs: number;
  identifyFlashing: boolean;
}

const LATENCY_OPTIONS: AoipLatencyMs[] = [0.25, 0.5, 1.0, 2.0, 5.0];

const DEFAULT_PREVIEW_ROUTES: AoipRoute[] = [
  {
    id: "preview-1",
    rxDevice: "Broadcast-Broadcast-PC",
    rxChannel: "01-Stream L",
    txDevice: "Console-FOH-Aoip",
    txChannel: "01-Main L",
    rxStatus: "UNICAST",
    signalDbfs: -14.2,
    identifyFlashing: false,
  },
  {
    id: "preview-2",
    rxDevice: "Broadcast-Broadcast-PC",
    rxChannel: "02-Stream R",
    txDevice: "Console-FOH-Aoip",
    txChannel: "02-Main R",
    rxStatus: "UNICAST",
    signalDbfs: -14.4,
    identifyFlashing: false,
  },
  {
    id: "preview-3",
    rxDevice: "Console-FOH-Aoip",
    rxChannel: "01-Pastor Lav",
    txDevice: "Wireless-Stage",
    txChannel: "01-Pastor",
    rxStatus: "UNICAST",
    signalDbfs: -18.6,
    identifyFlashing: false,
  },
  {
    id: "preview-4",
    rxDevice: "Console-FOH-Aoip",
    rxChannel: "02-Pulpit Mic",
    txDevice: "Wireless-Stage",
    txChannel: "02-Pulpit",
    rxStatus: "MULTICAST",
    signalDbfs: -42.0,
    identifyFlashing: false,
  },
  {
    id: "preview-5",
    rxDevice: "Lobby-Amp-DSP",
    rxChannel: "01-Lobby Mono",
    txDevice: "Console-FOH-Aoip",
    txChannel: "03-Lobby Feed",
    rxStatus: "UNICAST",
    signalDbfs: -21.5,
    identifyFlashing: false,
  },
  {
    id: "preview-6",
    rxDevice: "Lobby-Amp-DSP",
    rxChannel: "02-CryRoom",
    txDevice: "Console-FOH-Aoip",
    txChannel: "04-CryRoom",
    rxStatus: "UNICAST",
    signalDbfs: -24.1,
    identifyFlashing: false,
  },
];

function extractIpFromLabel(name: string): string {
  const match = name.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return match ? match[1] : "";
}

function parseChanNumber(channelLabel: string, fallbackIndex: number): number {
  const match = channelLabel.match(/\d+/);
  if (match) {
    const parsed = Number(match[0]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallbackIndex;
}

export const AoipMatrixView: React.FC<AoipMatrixViewProps> = ({
  routes,
  onRoutePatch,
  onIdentifyDevice,
}) => {
  const [deviceLocked, setDeviceLocked] = useState<boolean>(false);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [deviceConfigs, setDeviceConfigs] = useState<Record<string, DeviceConfigState>>({});
  const [collapsedTx, setCollapsedTx] = useState<Record<string, boolean>>({});
  const [collapsedRx, setCollapsedRx] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [hoveredCell, setHoveredCell] = useState<{ rxKey: string; txKey: string } | null>(null);
  const [showSpareChannels, setShowSpareChannels] = useState<boolean>(false);
  const [identifyingLocal, setIdentifyingLocal] = useState<Record<string, boolean>>({});
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [optimisticPatches, setOptimisticPatches] = useState<
    Record<string, { txDevice: string; txChannel: string; rxStatus: AoipRoute["rxStatus"] }>
  >({});

  useEffect(() => {
    setOptimisticPatches({});
  }, [routes]);

  const showNotice = (msg: string) => {
    setNoticeMsg(msg);
    setTimeout(() => setNoticeMsg(null), 2600);
  };

  const isPreviewMode = routes.length === 0;
  const effectiveRoutes = isPreviewMode ? DEFAULT_PREVIEW_ROUTES : routes;

  const { txGroups, rxGroups, allDeviceNames, deviceIpMap } = useMemo(() => {
    const txByDev = new Map<string, Set<string>>();
    const rxByDev = new Map<string, AoipRoute[]>();
    const devOrder: string[] = [];

    const ensureDev = (dev: string) => {
      if (dev && !devOrder.includes(dev)) devOrder.push(dev);
    };

    for (const r of effectiveRoutes) {
      if (r.txDevice) {
        ensureDev(r.txDevice);
        if (!txByDev.has(r.txDevice)) txByDev.set(r.txDevice, new Set());
        if (r.txChannel) txByDev.get(r.txDevice)!.add(r.txChannel);
      }
      if (r.rxDevice) {
        ensureDev(r.rxDevice);
        if (!rxByDev.has(r.rxDevice)) rxByDev.set(r.rxDevice, []);
        rxByDev.get(r.rxDevice)!.push(r);
      }
    }

    if (showSpareChannels) {
      for (const dev of devOrder) {
        if (!txByDev.has(dev)) txByDev.set(dev, new Set());
        const txSet = txByDev.get(dev)!;
        for (let i = 1; i <= 4; i++) {
          const chName = `${String(i).padStart(2, "0")}-Ch ${i}`;
          if (txSet.size < 4 && ![...txSet].some((c) => parseChanNumber(c, 0) === i)) {
            txSet.add(chName);
          }
        }
        if (!rxByDev.has(dev)) rxByDev.set(dev, []);
      }
    }

    const ipMap: Record<string, string> = {};
    devOrder.forEach((dev) => {
      ipMap[dev] = deviceConfigs[dev]?.ip || extractIpFromLabel(dev);
    });

    const q = searchQuery.trim().toLowerCase();

    const txGrpList = Array.from(txByDev.entries())
      .map(([device, chanSet]) => {
        const channels = Array.from(chanSet)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .filter((ch) => !q || device.toLowerCase().includes(q) || ch.toLowerCase().includes(q))
          .map((channel): TxColumn => ({ key: `${device}:::${channel}`, device, channel }));
        return { device, ip: ipMap[device], channels };
      })
      .filter((g) => g.channels.length > 0);

    const rxGrpList = Array.from(rxByDev.entries())
      .map(([device, list]) => {
        const seen = new Set<string>();
        const rows: RxRow[] = [];
        list.forEach((r, idx) => {
          if (seen.has(r.rxChannel)) return;
          seen.add(r.rxChannel);
          if (q && !device.toLowerCase().includes(q) && !r.rxChannel.toLowerCase().includes(q)) return;
          const rxKey = `${device}:::${r.rxChannel}`;
          const opt = optimisticPatches[rxKey];
          rows.push({
            key: rxKey,
            device,
            channel: r.rxChannel,
            rxIp: ipMap[device],
            rxChanId: parseChanNumber(r.rxChannel, idx + 1),
            txDevice: opt ? opt.txDevice : r.txDevice,
            txChannel: opt ? opt.txChannel : r.txChannel,
            rxStatus: opt ? opt.rxStatus : r.rxStatus,
            signalDbfs: r.signalDbfs,
            identifyFlashing: r.identifyFlashing || Boolean(identifyingLocal[device]),
          });
        });
        rows.sort((a, b) => a.channel.localeCompare(b.channel, undefined, { numeric: true }));
        return { device, ip: ipMap[device], rows };
      })
      .filter((g) => g.rows.length > 0);

    return {
      txGroups: txGrpList,
      rxGroups: rxGrpList,
      allDeviceNames: devOrder,
      deviceIpMap: ipMap,
    };
  }, [effectiveRoutes, showSpareChannels, deviceConfigs, searchQuery, optimisticPatches, identifyingLocal]);

  const activeDevice =
    selectedDevice && allDeviceNames.includes(selectedDevice)
      ? selectedDevice
      : allDeviceNames[0] || "Console-FOH-Aoip";

  const activeDeviceCfg: DeviceConfigState = deviceConfigs[activeDevice] || {
    sampleRate: 48,
    encoding: "PCM 24",
    latencyMs: 0.5,
    ip: deviceIpMap[activeDevice] || "192.168.1.101",
  };

  const patchDeviceConfig = (patch: Partial<DeviceConfigState>) => {
    setDeviceConfigs((prev) => ({
      ...prev,
      [activeDevice]: {
        ...activeDeviceCfg,
        ...patch,
      },
    }));
  };

  const visibleTxCols = useMemo(
    () => txGroups.flatMap((g) => (collapsedTx[g.device] ? [] : g.channels)),
    [txGroups, collapsedTx]
  );

  const totalSubscribed = useMemo(
    () =>
      rxGroups.reduce(
        (sum, g) => sum + g.rows.filter((r) => Boolean(r.txDevice && r.txChannel)).length,
        0
      ),
    [rxGroups]
  );

  const unresolvedCount = useMemo(
    () =>
      rxGroups.reduce(
        (sum, g) => sum + g.rows.filter((r) => r.rxStatus === "UNRESOLVED" && Boolean(r.txChannel)).length,
        0
      ),
    [rxGroups]
  );

  const grandmasterDevice = txGroups[0]?.device || allDeviceNames[0] || "Console-FOH-Aoip";

  const handleCrosspointClick = (row: RxRow, col: TxColumn) => {
    if (deviceLocked) {
      showNotice("Device Lock active — unlock to modify Aoip subscriptions");
      return;
    }

    if (!row.rxIp.trim()) {
      showNotice(
        `No IP configured for ${row.device} — add the device IP in Settings before patching Aoip routes`
      );
      return;
    }

    const isSame = row.txDevice === col.device && row.txChannel === col.channel;
    if (isSame) {
      setOptimisticPatches((prev) => ({
        ...prev,
        [row.key]: { txDevice: "", txChannel: "", rxStatus: "UNRESOLVED" },
      }));
      onRoutePatch(row.rxIp, row.rxChanId, "", "");
      showNotice(`Unsubscribed ${row.device} (${row.channel})`);
    } else {
      setOptimisticPatches((prev) => ({
        ...prev,
        [row.key]: { txDevice: col.device, txChannel: col.channel, rxStatus: "UNICAST" },
      }));
      onRoutePatch(row.rxIp, row.rxChanId, col.channel, col.device);
      showNotice(`Patched ${row.device} (${row.channel}) <- ${col.device} (${col.channel})`);
    }
  };

  const triggerIdentify = (devName: string, ip: string) => {
    if (!ip.trim()) {
      showNotice(
        `No IP configured for ${devName} — add the device IP in Settings before sending IDENTIFY`
      );
      return;
    }
    setIdentifyingLocal((prev) => ({ ...prev, [devName]: !prev[devName] }));
    onIdentifyDevice(ip);
    showNotice(`Sent Aoip IDENTIFY (0x0063) to ${devName} (${ip})`);
  };

  const hoveredRx = useMemo(
    () => (hoveredCell ? rxGroups.flatMap((g) => g.rows).find((r) => r.key === hoveredCell.rxKey) : null),
    [hoveredCell, rxGroups]
  );
  const hoveredTx = useMemo(
    () => (hoveredCell ? visibleTxCols.find((c) => c.key === hoveredCell.txKey) : null),
    [hoveredCell, visibleTxCols]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: "#080B10",
        color: "#F3F4F6",
        padding: 14,
        borderRadius: 12,
        border: "1px solid #1E2533",
        position: "relative",
      }}
    >
      {noticeMsg && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "#121721",
            border: "1px solid #10B981",
            color: "#FFFFFF",
            padding: "9px 14px",
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 600,
            zIndex: 10050,
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
          }}
        >
          {noticeMsg}
        </div>
      )}

      {/* Top Header & PTPv2 Clock Status Badge */}
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Radio size={18} color="#10B981" />
            <strong style={{ fontSize: 15 }}>Audio Network Controller Matrix</strong>
          </div>

          {/* PTPv2 Grandmaster & Clock Status Badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "4px 10px",
              borderRadius: 7,
              background: "rgba(16, 185, 129, 0.14)",
              border: "1px solid #10B981",
              color: "#34D399",
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}
          >
            <Clock size={13} />
            <span>PTPv2 Grandmaster: {grandmasterDevice}</span>
            <span style={{ color: "#6EE7B7" }}>•</span>
            <span>LOCKED (±0.002 ms)</span>
          </div>

          {isPreviewMode && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(245, 158, 11, 0.15)",
                border: "1px solid #F59E0B",
                color: "#FBBF24",
              }}
            >
              Sanctuary Preview Topology
            </span>
          )}

          {unresolvedCount > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(239, 68, 68, 0.16)",
                border: "1px solid #EF4444",
                color: "#FCA5A5",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <AlertTriangle size={12} />
              {unresolvedCount} Unresolved
            </span>
          )}
        </div>

        {/* Device Lock Toggle & Stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11.5,
              color: "#94A3B8",
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              padding: "4px 8px",
              background: "#0B0E15",
              border: "1px solid #1E2533",
              borderRadius: 6,
            }}
          >
            {totalSubscribed} Active Crosspoints
          </span>

          <button
            type="button"
            onClick={() => {
              const next = !deviceLocked;
              setDeviceLocked(next);
              showNotice(next ? "Device Lock engaged: matrix read-only" : "Device Lock released");
            }}
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              background: deviceLocked ? "#7F1D1D" : "#161B24",
              border: `1px solid ${deviceLocked ? "#EF4444" : "#283344"}`,
              color: deviceLocked ? "#FECACA" : "#E2E8F0",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {deviceLocked ? <Lock size={14} color="#F87171" /> : <Unlock size={14} color="#34D399" />}
            {deviceLocked ? "Device Locked" : "Device Unlocked"}
          </button>
        </div>
      </div>

      {/* Device Configuration Bar: Sample Rate, Encoding, Latency, Search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          padding: "10px 14px",
          background: "#0D1117",
          border: "1px solid #1E2533",
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* Active Device Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Cpu size={14} color="#60A5FA" />
            <span style={{ fontSize: 11.5, color: "#94A3B8", fontWeight: 600 }}>Device Config:</span>
            <select
              value={activeDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              style={{
                height: 30,
                padding: "0 8px",
                borderRadius: 6,
                background: "#161B24",
                border: "1px solid #283344",
                color: "#FFFFFF",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {allDeviceNames.map((dev) => (
                <option key={dev} value={dev}>
                  {dev} ({deviceIpMap[dev]})
                </option>
              ))}
            </select>
          </div>

          {/* Sample Rate: 48 kHz / 96 kHz */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11, color: "#94A3B8", marginRight: 2 }}>Sample Rate:</span>
            {([48, 96] as SampleRateKhz[]).map((sr) => {
              const active = activeDeviceCfg.sampleRate === sr;
              return (
                <button
                  key={sr}
                  type="button"
                  disabled={deviceLocked}
                  onClick={() => {
                    patchDeviceConfig({ sampleRate: sr });
                    showNotice(`${activeDevice} Sample Rate set to ${sr} kHz`);
                  }}
                  style={{
                    height: 28,
                    padding: "0 9px",
                    borderRadius: 5,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: deviceLocked ? "not-allowed" : "pointer",
                    background: active ? "#2563EB" : "#161B24",
                    border: `1px solid ${active ? "#60A5FA" : "#283344"}`,
                    color: active ? "#FFFFFF" : "#94A3B8",
                    opacity: deviceLocked ? 0.6 : 1,
                  }}
                >
                  {sr} kHz
                </button>
              );
            })}
          </div>

          {/* Encoding: PCM 24 */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>Encoding:</span>
            <span
              style={{
                height: 28,
                padding: "0 9px",
                borderRadius: 5,
                background: "#161B24",
                border: "1px solid #3B82F688",
                color: "#60A5FA",
                fontSize: 11,
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}
            >
              {activeDeviceCfg.encoding}
            </span>
          </div>

          {/* Latency: 0.25, 0.5, 1.0, 2.0, 5.0 ms */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11, color: "#94A3B8", marginRight: 2 }}>Latency:</span>
            {LATENCY_OPTIONS.map((lat) => {
              const active = activeDeviceCfg.latencyMs === lat;
              return (
                <button
                  key={lat}
                  type="button"
                  disabled={deviceLocked}
                  onClick={() => {
                    patchDeviceConfig({ latencyMs: lat });
                    showNotice(`${activeDevice} Rx Latency set to ${lat.toFixed(lat < 1 ? 2 : 1)} ms`);
                  }}
                  style={{
                    height: 28,
                    padding: "0 8px",
                    borderRadius: 5,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: deviceLocked ? "not-allowed" : "pointer",
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    background: active ? "#065F46" : "#161B24",
                    border: `1px solid ${active ? "#10B981" : "#283344"}`,
                    color: active ? "#34D399" : "#94A3B8",
                    opacity: deviceLocked ? 0.6 : 1,
                  }}
                >
                  {lat < 1 ? lat.toFixed(2) : lat.toFixed(1)} ms
                </button>
              );
            })}
          </div>
        </div>

        {/* Search & Spare Channel Toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowSpareChannels((prev) => !prev)}
            style={{
              height: 30,
              padding: "0 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              background: showSpareChannels ? "#1E3A8A" : "#161B24",
              border: `1px solid ${showSpareChannels ? "#3B82F6" : "#283344"}`,
              color: showSpareChannels ? "#FFFFFF" : "#94A3B8",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Plus size={12} />
            {showSpareChannels ? "Spare Ch Shown" : "Show Spare Ch"}
          </button>

          <div style={{ position: "relative" }}>
            <Search
              size={13}
              color="#64748B"
              style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}
            />
            <input
              type="text"
              placeholder="Filter devices/channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                height: 30,
                paddingLeft: 28,
                paddingRight: 10,
                width: 190,
                borderRadius: 6,
                background: "#080B10",
                border: "1px solid #283344",
                color: "#FFFFFF",
                fontSize: 12,
              }}
            />
          </div>
        </div>
      </div>

      {/* X/Y Crosspoint Matrix Grid */}
      <div
        style={{
          background: "#0D1117",
          border: "1px solid #1E2533",
          borderRadius: 10,
          overflow: "auto",
          maxHeight: 540,
        }}
      >
        <table
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            fontSize: 11.5,
            minWidth: "100%",
          }}
        >
          <thead>
            {/* Row 1: TX Device Group Headers */}
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  top: 0,
                  zIndex: 12,
                  background: "#12161F",
                  borderRight: "2px solid #283344",
                  borderBottom: "1px solid #1E2533",
                  padding: "8px 12px",
                  textAlign: "left",
                  minWidth: 260,
                  color: "#94A3B8",
                  fontWeight: 700,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>Aoip Transmitters (TX) →</span>
                  <span style={{ fontSize: 10, color: "#60A5FA" }}>
                    {activeDeviceCfg.sampleRate}kHz / {activeDeviceCfg.encoding}
                  </span>
                </div>
              </th>

              {txGroups.map((grp) => {
                const collapsed = Boolean(collapsedTx[grp.device]);
                const colSpan = collapsed ? 1 : grp.channels.length;
                return (
                  <th
                    key={grp.device}
                    colSpan={colSpan}
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 10,
                      background: "#151B26",
                      borderBottom: "1px solid #283344",
                      borderRight: "2px solid #283344",
                      padding: "6px 8px",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedTx((prev) => ({ ...prev, [grp.device]: !prev[grp.device] }))
                        }
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#E2E8F0",
                          fontWeight: 700,
                          fontSize: 11.5,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: 0,
                        }}
                      >
                        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <span>{grp.device}</span>
                      </button>

                      <button
                        type="button"
                        title={`Identify ${grp.device} (${grp.ip})`}
                        onClick={() => triggerIdentify(grp.device, grp.ip)}
                        style={{
                          background: identifyingLocal[grp.device] ? "#D97706" : "#1C222D",
                          border: `1px solid ${identifyingLocal[grp.device] ? "#FBBF24" : "#2E3746"}`,
                          borderRadius: 4,
                          padding: "2px 5px",
                          color: identifyingLocal[grp.device] ? "#FFFFFF" : "#94A3B8",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: 9.5,
                          fontWeight: 700,
                        }}
                      >
                        <Bell size={10} />
                        ID
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>

            {/* Row 2: TX Channel Columns (Rotated Vertical Labels) */}
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  top: 34,
                  zIndex: 12,
                  background: "#10141D",
                  borderRight: "2px solid #283344",
                  borderBottom: "2px solid #283344",
                  padding: "8px 12px",
                  textAlign: "left",
                  verticalAlign: "bottom",
                  color: "#94A3B8",
                  fontSize: 11,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Aoip Receivers (RX) ↓</span>
                  <span style={{ fontSize: 10, color: "#64748B" }}>Click cell to patch</span>
                </div>
              </th>

              {txGroups.map((grp) => {
                if (collapsedTx[grp.device]) {
                  return (
                    <th
                      key={`${grp.device}-collapsed`}
                      style={{
                        position: "sticky",
                        top: 34,
                        zIndex: 9,
                        background: "#0F141C",
                        borderRight: "2px solid #283344",
                        borderBottom: "2px solid #283344",
                        width: 34,
                        minWidth: 34,
                        height: 108,
                        color: "#64748B",
                        fontSize: 10,
                      }}
                    >
                      …
                    </th>
                  );
                }

                return grp.channels.map((col, idx) => {
                  const isColHover = hoveredCell?.txKey === col.key;
                  const isGroupEnd = idx === grp.channels.length - 1;
                  return (
                    <th
                      key={col.key}
                      title={`${col.device} : ${col.channel}`}
                      style={{
                        position: "sticky",
                        top: 34,
                        zIndex: 9,
                        background: isColHover ? "#17253B" : "#10141D",
                        borderBottom: "2px solid #283344",
                        borderRight: isGroupEnd ? "2px solid #283344" : "1px solid #1E2533",
                        width: 36,
                        minWidth: 36,
                        maxWidth: 36,
                        height: 112,
                        padding: "6px 2px",
                        verticalAlign: "bottom",
                      }}
                    >
                      <div
                        style={{
                          writingMode: "vertical-rl",
                          transform: "rotate(180deg)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxHeight: 98,
                          margin: "0 auto",
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: isColHover ? "#60A5FA" : "#CBD5E1",
                          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        }}
                      >
                        {col.channel}
                      </div>
                    </th>
                  );
                });
              })}
            </tr>
          </thead>

          <tbody>
            {rxGroups.map((rxGrp) => {
              const isCollapsed = Boolean(collapsedRx[rxGrp.device]);
              const flashing = rxGrp.rows.some((r) => r.identifyFlashing);
              return (
                <React.Fragment key={rxGrp.device}>
                  {/* RX Device Group Row */}
                  <tr>
                    <td
                      colSpan={1 + txGroups.reduce((acc, g) => acc + (collapsedTx[g.device] ? 1 : g.channels.length), 0)}
                      style={{
                        background: "#131924",
                        borderBottom: "1px solid #1E2533",
                        padding: "6px 12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedRx((prev) => ({ ...prev, [rxGrp.device]: !prev[rxGrp.device] }))
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "#FFFFFF",
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              padding: 0,
                            }}
                          >
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            <span>{rxGrp.device}</span>
                          </button>
                          <span
                            style={{
                              fontSize: 10.5,
                              color: "#94A3B8",
                              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                            }}
                          >
                            ({rxGrp.ip})
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => triggerIdentify(rxGrp.device, rxGrp.ip)}
                          style={{
                            height: 24,
                            padding: "0 9px",
                            borderRadius: 5,
                            fontSize: 10.5,
                            fontWeight: 700,
                            cursor: "pointer",
                            background: flashing ? "#D97706" : "#1C222D",
                            border: `1px solid ${flashing ? "#FBBF24" : "#2E3746"}`,
                            color: flashing ? "#FFFFFF" : "#CBD5E1",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Bell size={11} />
                          {flashing ? "Identifying LED..." : "Identify Device"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* RX Channel Rows */}
                  {!isCollapsed &&
                    rxGrp.rows.map((row) => {
                      const isRowHover = hoveredCell?.rxKey === row.key;
                      const statusColor =
                        row.rxStatus === "UNICAST"
                          ? "#10B981"
                          : row.rxStatus === "MULTICAST"
                          ? "#3B82F6"
                          : row.rxStatus === "PREPARING"
                          ? "#F59E0B"
                          : "#EF4444";
                      const signalPresent = row.signalDbfs > -60;

                      return (
                        <tr key={row.key}>
                          <td
                            style={{
                              position: "sticky",
                              left: 0,
                              zIndex: 5,
                              background: isRowHover ? "#151F2E" : "#0D1117",
                              borderRight: "2px solid #283344",
                              borderBottom: "1px solid #1E2533",
                              padding: "5px 12px",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                                <span
                                  title={`Conmon Signal: ${row.signalDbfs.toFixed(1)} dBFS`}
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: signalPresent ? "#10B981" : "#334155",
                                    boxShadow: signalPresent ? "0 0 6px #10B981" : "none",
                                    flexShrink: 0,
                                  }}
                                />
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: isRowHover ? "#FFFFFF" : "#E2E8F0",
                                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {row.channel}
                                </span>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                <span
                                  style={{
                                    fontSize: 9.5,
                                    color: signalPresent ? "#34D399" : "#64748B",
                                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                  }}
                                >
                                  {row.signalDbfs.toFixed(1)}dB
                                </span>
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 800,
                                    padding: "1px 5px",
                                    borderRadius: 4,
                                    color: statusColor,
                                    background: `${statusColor}20`,
                                    border: `1px solid ${statusColor}66`,
                                  }}
                                >
                                  {row.txChannel ? row.rxStatus : "UNPATCHED"}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Matrix Cells */}
                          {txGroups.map((txGrp) => {
                            if (collapsedTx[txGrp.device]) {
                              const hasMatch =
                                Boolean(row.txChannel) && row.txDevice === txGrp.device;
                              return (
                                <td
                                  key={`${row.key}-${txGrp.device}-collapsed`}
                                  style={{
                                    background: "#0B0E14",
                                    borderRight: "2px solid #283344",
                                    borderBottom: "1px solid #1E2533",
                                    textAlign: "center",
                                  }}
                                >
                                  {hasMatch ? (
                                    <span
                                      style={{
                                        display: "inline-block",
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        background: "#10B981",
                                      }}
                                    />
                                  ) : (
                                    <span style={{ color: "#334155" }}>·</span>
                                  )}
                                </td>
                              );
                            }

                            return txGrp.channels.map((col, idx) => {
                              const isPatched =
                                row.txDevice === col.device && row.txChannel === col.channel;
                              const isCellHover =
                                hoveredCell?.rxKey === row.key && hoveredCell?.txKey === col.key;
                              const isCrosshair =
                                hoveredCell?.rxKey === row.key || hoveredCell?.txKey === col.key;
                              const isGroupEnd = idx === txGrp.channels.length - 1;

                              return (
                                <td
                                  key={`${row.key}-${col.key}`}
                                  onMouseEnter={() =>
                                    setHoveredCell({ rxKey: row.key, txKey: col.key })
                                  }
                                  onMouseLeave={() => setHoveredCell(null)}
                                  onClick={() => handleCrosspointClick(row, col)}
                                  title={
                                    isPatched
                                      ? `Subscribed: ${row.device}/${row.channel} ← ${col.device}/${col.channel} (Click to unsubscribe)`
                                      : `Patch ${row.device}/${row.channel} ← ${col.device}/${col.channel}`
                                  }
                                  style={{
                                    width: 36,
                                    height: 30,
                                    textAlign: "center",
                                    verticalAlign: "middle",
                                    cursor: deviceLocked ? "not-allowed" : "pointer",
                                    borderBottom: "1px solid #1E2533",
                                    borderRight: isGroupEnd
                                      ? "2px solid #283344"
                                      : "1px solid #18202C",
                                    background: isCellHover
                                      ? "rgba(59, 130, 246, 0.24)"
                                      : isCrosshair
                                      ? "rgba(59, 130, 246, 0.08)"
                                      : "#090C12",
                                    transition: "background-color 0.08s ease",
                                  }}
                                >
                                  {isPatched ? (
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        width: 20,
                                        height: 20,
                                        borderRadius: 5,
                                        background:
                                          row.rxStatus === "UNRESOLVED" ? "#991B1B" : "#059669",
                                        border: `1px solid ${
                                          row.rxStatus === "UNRESOLVED" ? "#EF4444" : "#34D399"
                                        }`,
                                        color: "#FFFFFF",
                                        boxShadow: "0 0 8px rgba(16, 185, 129, 0.35)",
                                      }}
                                    >
                                      {row.rxStatus === "UNRESOLVED" ? (
                                        <AlertTriangle size={12} />
                                      ) : (
                                        <Check size={13} strokeWidth={3} />
                                      )}
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        display: "inline-block",
                                        width: 6,
                                        height: 6,
                                        borderRadius: "50%",
                                        background: isCellHover ? "#60A5FA" : "#1E2533",
                                      }}
                                    />
                                  )}
                                </td>
                              );
                            });
                          })}
                        </tr>
                      );
                    })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Crosspoint Readout & Conmon Telemetry */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          padding: "8px 12px",
          background: "#12161F",
          border: "1px solid #1E2533",
          borderRadius: 8,
          fontSize: 11.5,
          color: "#94A3B8",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={14} color="#34D399" />
          {hoveredRx && hoveredTx ? (
            <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: "#E2E8F0" }}>
              Crosspoint: <strong>{hoveredRx.device}</strong> ({hoveredRx.channel}) ←{" "}
              <strong style={{ color: "#34D399" }}>{hoveredTx.device}</strong> ({hoveredTx.channel})
            </span>
          ) : (
            <span>Hover any X/Y crosspoint to inspect route; click to subscribe or unsubscribe.</span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ShieldCheck size={13} color="#10B981" />
            ARC Port :4440 • Conmon :8751
          </span>
        </div>
      </div>
    </div>
  );
};

export default AoipMatrixView;
