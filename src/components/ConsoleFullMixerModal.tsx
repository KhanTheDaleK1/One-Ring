import { ConsoleFxRackModal } from "./ConsoleFxRackModal";
import { HoldConfirmButton } from "./HoldConfirmButton";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  X,
  Sliders,
  Volume2,
  VolumeX,
  Zap,
  Activity,
  RotateCcw,
  Radio,
  Layers,
  Grid,
  Check,
  Terminal,
  Maximize2,
  Settings2,
  ArrowRightLeft,
} from "lucide-react";
import {
  type ConsoleBankId,
  type EqBandState,
  type RoutingDomainId,
  type ConsoleChannelStripState,
  type ConsoleTopScreenTab,
  CONSOLE_COLORS,
  COLOR_MAP,
  buildInitialChannels,
  createDefaultEq,
  biquadDbAtFreq,
  hpfDbAtFreq,
  freqToNorm,
  normToFreq,
  faderDbToNormalized,
  normalizedToFaderDb,
  formatDb,
} from "./consoleShared";
import { ConsoleMixerOverview } from "./ConsoleMixerOverview";

export interface ConsoleFullMixerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendConsoleCommand?: (address: string, value: number | string) => void;
  embedded?: boolean;
  onPopout?: () => void;
}

const ROUTING_CONFIG: Record<
  RoutingDomainId,
  { subtitle: string; oscBase: string; destinations: string[]; sources: string[]; initialMap: Record<number, number> }
> = {
  "Local 1-32": {
    subtitle: "Stagebox & Local Rear XLR Input Block Assignment (Blocks of 8)",
    oscBase: "/config/routing/IN",
    destinations: ["Home Ch 1-8", "Home Ch 9-16", "Home Ch 17-24", "Home Ch 25-32"],
    sources: ["Local 1-8", "Local 9-16", "StageBox-A 1-8", "StageBox-A 9-16", "StageBox-A 17-24", "StageBox-A 25-32", "Card 1-8"],
    initialMap: { 0: 0, 1: 1, 2: 4, 3: 5 },
  },
  "StageBox-A": {
    subtitle: "Stagebox S32 / DL32 Trunk (Port A, 48ch @ 48kHz)",
    oscBase: "/config/routing/StageBoxA",
    destinations: ["A Out 1-8", "A Out 9-16", "A Out 17-24", "A Out 25-32", "A Out 33-40", "A Out 41-48"],
    sources: ["Local 1-8", "Local 9-16", "Out 1-8", "Out 9-16", "P16 1-8", "P16 9-16", "Card 1-8"],
    initialMap: { 0: 2, 1: 3, 2: 4, 3: 5, 4: 0, 5: 1 },
  },
  "StageBox-B": {
    subtitle: "Broadcast / FOH Link Trunk (Port B, 48ch @ 48kHz)",
    oscBase: "/config/routing/StageBoxB",
    destinations: ["B Out 1-8", "B Out 9-16", "B Out 17-24", "B Out 25-32", "B Out 33-40", "B Out 41-48"],
    sources: ["Local 1-8", "Local 9-16", "StageBox-A 1-8", "StageBox-A 9-16", "Out 1-8", "Out 9-16"],
    initialMap: { 0: 2, 1: 3, 2: 0, 3: 1, 4: 4, 5: 5 },
  },
  Card: {
    subtitle: "X-Aoip / X-USB 32x32 Expansion Card Output Routing",
    oscBase: "/config/routing/CARD",
    destinations: ["Card 1-8", "Card 9-16", "Card 17-24", "Card 25-32"],
    sources: ["Local 1-8", "Local 9-16", "StageBox-A 1-8", "StageBox-A 9-16", "Out 1-8", "Out 9-16", "P16 1-8"],
    initialMap: { 0: 0, 1: 1, 2: 2, 3: 4 },
  },
  "P16 Personal Bus": {
    subtitle: "Personal Bus P16-M Personal Monitor Bus Assignment (Ch 1-16)",
    oscBase: "/outputs/p16",
    destinations: ["P16 01-02", "P16 03-04", "P16 05-06", "P16 07-08", "P16 09-10", "P16 11-12", "P16 13-14", "P16 15-16"],
    sources: ["DirOut Ch 1-2", "DirOut Ch 4-5", "DirOut Ch 8-9", "DirOut Ch 12-13", "Bus 1-2", "Bus 3-4", "Main L/R", "Talkback"],
    initialMap: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 },
  },
};

// Console OSC expects normalized 0..1 values for continuous controls and a
// discrete 0..11 index for the compressor ratio.
const CONSOLE_COMP_RATIO_STEPS = [1.1, 1.3, 1.5, 1.7, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10.0, 20.0];

const oscUnit = (value: number): number => Math.max(0, Math.min(1, value));

const headampGainToOsc = (db: number): number => oscUnit((db + 12) / 72);
const gateThresholdToOsc = (db: number): number => oscUnit((db + 80) / 80);
const gateRangeToOsc = (db: number): number => oscUnit((db - 3) / 57);
const compThresholdToOsc = (db: number): number => oscUnit((db + 60) / 60);

function compRatioToOscIndex(ratio: number): number {
  let closest = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < CONSOLE_COMP_RATIO_STEPS.length; i += 1) {
    const distance = Math.abs(CONSOLE_COMP_RATIO_STEPS[i] - ratio);
    if (distance < bestDistance) {
      bestDistance = distance;
      closest = i;
    }
  }
  return closest;
}

const FX_EFFECT_TYPES = [
  "Hall Reverb",
  "Plate Reverb",
  "Stereo Delay",
  "Dual 31-Band GEQ",
  "De-Esser",
  "Wave Designer",
  "Combinator",
] as const;

type FxEffectType = (typeof FX_EFFECT_TYPES)[number];

interface FxSlotState {
  slot: number;
  type: FxEffectType;
  bypassed: boolean;
  params: [number, number, number, number];
}

function buildInitialFxSlots(): FxSlotState[] {
  return Array.from({ length: 8 }, (_, idx) => ({
    slot: idx + 1,
    type: FX_EFFECT_TYPES[idx % FX_EFFECT_TYPES.length],
    bypassed: false,
    params: [0.5, 0.5, 0.5, 0.5],
  }));
}

const SCENE_PRESETS = [
  "Sunday Service Default",
  "Worship Full Band",
  "Sermon / Teaching",
  "Acoustic / Prayer",
  "Broadcast Test Mix",
];

// USB stereo recorder transport states used by `/-stat/tape/state`.
const TAPE_STATE_ADDRESS = "/-stat/tape/state";
const USB_RECORDER_STATES = ["Stop", "Pause", "Play", "PauseRec", "Record"] as const;

function usbRecorderLabel(state: number): string {
  return USB_RECORDER_STATES[state] ?? "Stop";
}

const USER_LAYER_STORAGE_KEY = "onering_console_user_layers";

function loadUserLayers(): Record<"user1" | "user2", string[]> {
  try {
    const raw = localStorage.getItem(USER_LAYER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.user1) && Array.isArray(parsed?.user2)) {
        return parsed;
      }
    }
  } catch {}
  return {
    user1: ["ch-30", "ch-31", "ch-32", "ch-22", "ch-23", "ch-24", "ch-25", "ch-26", "ch-13", "ch-14", "ch-01", "ch-12", "dca-1", "dca-5", "dca-6", "dca-8"],
    user2: ["bus-01", "bus-02", "bus-03", "bus-04", "bus-05", "bus-06", "bus-07", "bus-08", "bus-09", "bus-10", "mtx-01", "mtx-02", "mtx-03", "mtx-04"],
  };
}

const TOP_SCREEN_TABS: Array<{ id: ConsoleTopScreenTab; label: string; icon: React.ComponentType<{ size?: number | string }> }> = [
  { id: "mixer", label: "Mixer", icon: Sliders },
  { id: "channel", label: "Channel", icon: Layers },
  { id: "config", label: "Config", icon: Settings2 },
  { id: "gate", label: "Gate", icon: Activity },
  { id: "dyn", label: "Dyn", icon: Activity },
  { id: "eq", label: "EQ", icon: Activity },
  { id: "sends", label: "Sends", icon: ArrowRightLeft },
  { id: "main", label: "Main", icon: Volume2 },
  { id: "fx1_4", label: "FX1 - 4", icon: Zap },
  { id: "fx5_8", label: "FX5 - 8", icon: Zap },
  { id: "routing", label: "Routing", icon: Grid },
];

export const ConsoleFullMixerModal: React.FC<ConsoleFullMixerModalProps> = ({
  isOpen,
  onClose,
  onSendConsoleCommand,
  embedded = false,
  onPopout,
}) => {
  const [channels, setChannels] = useState<ConsoleChannelStripState[]>(() => buildInitialChannels());
  const [undoStack, setUndoStack] = useState<ConsoleChannelStripState[][]>([]);
  const [copiedChannel, setCopiedChannel] = useState<ConsoleChannelStripState | null>(null);

  const [screenTab, setScreenTab] = useState<ConsoleTopScreenTab>("mixer");
  const [activeBank, setActiveBank] = useState<ConsoleBankId>("ch1_32");
  const [selectedId, setSelectedId] = useState<string>("ch-10");
  const [compactWidth, setCompactWidth] = useState<boolean>(false);
  const [bankEditMode, setBankEditMode] = useState<boolean>(false);
  const [userLayerIds, setUserLayerIds] = useState<Record<"user1" | "user2", string[]>>(() => loadUserLayers());

  const [routingDomain, setRoutingDomain] = useState<RoutingDomainId>("StageBox-A");
  const [routingSelections, setRoutingSelections] = useState<Record<RoutingDomainId, Record<number, number>>>(() => ({
    "Local 1-32": { ...ROUTING_CONFIG["Local 1-32"].initialMap },
    "StageBox-A": { ...ROUTING_CONFIG["StageBox-A"].initialMap },
    "StageBox-B": { ...ROUTING_CONFIG["StageBox-B"].initialMap },
    Card: { ...ROUTING_CONFIG.Card.initialMap },
    "P16 Personal Bus": { ...ROUTING_CONFIG["P16 Personal Bus"].initialMap },
  }));

  const [lastOsc, setLastOsc] = useState<string>("Console OSC :10023 — Offline (Pair mixer in Settings)");
  const [draggingBandIdx, setDraggingBandIdx] = useState<number | null>(null);
  const [sendsOnFader, setSendsOnFader] = useState<boolean>(false);
  const [sofTarget, setSofTarget] = useState<string>("bus-01");
  const [sendLevels, setSendLevels] = useState<Record<string, Record<string, number>>>({});
  const [muteGroups, setMuteGroups] = useState<boolean[]>([false, false, false, false, false, false]);
  const [rtaEnabled, setRtaEnabled] = useState<boolean>(true);
  const [rtaBars, setRtaBars] = useState<number[]>(() => Array.from({ length: 100 }, () => 0));
  const [channelLinks, setChannelLinks] = useState<Record<string, boolean>>({});
  const [channelDelays, setChannelDelays] = useState<Record<string, number>>({});
  const [fxSlots, setFxSlots] = useState<FxSlotState[]>(() => buildInitialFxSlots());
  const [fxRackOpen, setFxRackOpen] = useState<boolean>(false);
  const [sceneIndex, setSceneIndex] = useState<number>(1);
  const [automixGroups, setAutomixGroups] = useState<Record<string, "Off" | "X" | "Y">>({});
  const [talkbackA, setTalkbackA] = useState<boolean>(false);
  const [talkbackB, setTalkbackB] = useState<boolean>(false);
  const [clockSource, setClockSource] = useState<"48kHz Internal" | "StageBox" | "Card">("48kHz Internal");
  const [mainLrDb, setMainLrDb] = useState<number>(-2.5);
  const [mainLrMeterLevel] = useState<number>(-90);
  const [mainLrMute, setMainLrMute] = useState<boolean>(false);
  const [mainLrSolo, setMainLrSolo] = useState<boolean>(false);
  const [monoMcMode, setMonoMcMode] = useState<boolean>(false);
  const [recorderState, setRecorderState] = useState<number>(0);

  const scnFileInputRef = useRef<HTMLInputElement | null>(null);
  const eqSvgRef = useRef<SVGSVGElement | null>(null);
  const hardwareRtaActiveRef = useRef<boolean>(false);

  const emitOsc = useCallback(
    (address: string, value: number | string) => {
      setLastOsc(`${address}  ${typeof value === "string" ? `"${value}"` : value}`);
      onSendConsoleCommand?.(address, value);
    },
    [onSendConsoleCommand]
  );

  const pushUndoSnapshot = useCallback(() => {
    setUndoStack((prev) => [...prev.slice(-9), channels.map((c) => ({ ...c, eqBands: [...c.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState] }))]);
  }, [channels]);

  const patchChannel = useCallback(
    (id: string, updater: (prev: ConsoleChannelStripState) => ConsoleChannelStripState) => {
      setChannels((prev) => prev.map((ch) => (ch.id === id ? updater(ch) : ch)));
    },
    []
  );

  const handleImportScn = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const nameUpdates: Record<string, string> = {};
        const faderUpdates: Record<string, number> = {};
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          const nameMatch = line.match(/^\/ch\/(\d{2})\/config\/name\s+"?([^"\r\n]+)"?$/);
          if (nameMatch) {
            nameUpdates[`ch-${nameMatch[1]}`] = nameMatch[2].trim();
            continue;
          }
          const faderMatch = line.match(/^\/ch\/(\d{2})\/mix\/fader\s+([+-]?\d*\.?\d+)$/);
          if (faderMatch) {
            const rawVal = parseFloat(faderMatch[2]);
            if (!Number.isNaN(rawVal)) {
              const db = rawVal >= 0 && rawVal <= 1 ? normalizedToFaderDb(rawVal) : Math.max(-90, Math.min(10, rawVal));
              faderUpdates[`ch-${faderMatch[1]}`] = Math.round(db * 10) / 10;
            }
          }
        }
        const updateCount = Object.keys(nameUpdates).length + Object.keys(faderUpdates).length;
        if (updateCount > 0) {
          pushUndoSnapshot();
          setChannels((prev) =>
            prev.map((ch) => {
              const nextName = nameUpdates[ch.id];
              const nextFader = faderUpdates[ch.id];
              if (nextName === undefined && nextFader === undefined) return ch;
              return {
                ...ch,
                name: nextName !== undefined ? nextName : ch.name,
                faderDb: nextFader !== undefined ? nextFader : ch.faderDb,
              };
            })
          );
          setLastOsc(`Imported .scn (${updateCount} channel parameters)`);
        } else {
          setLastOsc("Imported .scn (no /ch/NN parameters found)");
        }
      } finally {
        e.target.value = "";
      }
    },
    [pushUndoSnapshot]
  );

  const handleExportScn = useCallback(() => {
    const ch1to32 = channels.filter((ch) => ch.oscPrefix.startsWith("/ch/"));
    const lines: string[] = ['#2.1# "OneRing_Console_Scene" "" %000000000 1'];
    for (const ch of ch1to32) {
      const safeName = ch.name.replace(/"/g, "'");
      lines.push(`${ch.oscPrefix}/config/name "${safeName}"`);
      lines.push(`${ch.oscPrefix}/mix/fader ${faderDbToNormalized(ch.faderDb).toFixed(4)}`);
    }
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "console-scene.scn";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastOsc(`Exported .scn (${ch1to32.length} channels)`);
  }, [channels]);

  useEffect(() => {
    if (!isOpen || embedded || fxRackOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, embedded, fxRackOpen, onClose]);

  useEffect(() => {
    const active = embedded || isOpen;
    if (!active || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let unlistenOsc: UnlistenFn | null = null;
    let unlistenRta: UnlistenFn | null = null;
    let disposed = false;

    const patchStrip = (
      id: string,
      updater: (strip: ConsoleChannelStripState) => ConsoleChannelStripState
    ) => {
      setChannels((prev) => prev.map((strip) => (strip.id === id ? updater(strip) : strip)));
    };
    const parseOn = (value: unknown): boolean | null => {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value > 0;
      return null;
    };
    const applyFaderOrMute = (
      param: string,
      value: unknown,
      strip: ConsoleChannelStripState
    ): ConsoleChannelStripState => {
      if (param === "fader" && typeof value === "number") {
        return { ...strip, faderDb: Math.round(normalizedToFaderDb(value) * 10) / 10 };
      }
      const on = parseOn(value);
      if (param === "on" && on !== null) return { ...strip, mute: !on };
      return strip;
    };

    listen<{ address?: string; path?: string; args?: unknown[]; value?: unknown }>("console://osc", (event) => {
      if (disposed) return;
      const payload = event.payload || {};
      const address = payload.address || payload.path || "";
      const rawVal = Array.isArray(payload.args) && payload.args.length > 0 ? payload.args[0] : payload.value;

      // USB recorder transport state (both local echoes and hardware pushes).
      if (address === TAPE_STATE_ADDRESS && typeof rawVal === "number") {
        setRecorderState(Math.max(0, Math.min(4, Math.round(rawVal))));
        return;
      }
      if (address === "/main/st/mix/fader" && typeof rawVal === "number") {
        setMainLrDb(Math.round(normalizedToFaderDb(rawVal) * 10) / 10);
        return;
      }
      if (address === "/main/st/mix/on") {
        const isOn = parseOn(rawVal);
        if (isOn !== null) setMainLrMute(!isOn);
        return;
      }

      // /ch/NN/config/name — scribble strip labels.
      const nameMatch = address.match(/^\/ch\/(\d{2})\/config\/name$/);
      if (nameMatch && typeof rawVal === "string") {
        patchStrip(`ch-${nameMatch[1]}`, (strip) => ({ ...strip, name: rawVal }));
        return;
      }

      // /ch/NN/mix/(fader|on|pan) — fader, mute and pan. OSC pan is 0..1 (0.5 center).
      const channelMatch = address.match(/^\/ch\/(\d{2})\/mix\/(fader|on|pan)$/);
      if (channelMatch) {
        const param = channelMatch[2];
        patchStrip(`ch-${channelMatch[1]}`, (strip) => {
          if (param === "pan" && typeof rawVal === "number") {
            return { ...strip, pan: Math.round((rawVal - 0.5) * 200) };
          }
          return applyFaderOrMute(param, rawVal, strip);
        });
        return;
      }

      // /bus/NN/mix/* and /mtx/NN/mix/* — bus and matrix strips.
      const stripMatch = address.match(/^\/(bus|mtx)\/(\d{2})\/mix\/(fader|on)$/);
      if (stripMatch) {
        const id = `${stripMatch[1]}-${stripMatch[2]}`;
        patchStrip(id, (strip) => applyFaderOrMute(stripMatch[3], rawVal, strip));
        return;
      }

      // /dca/N/(fader|on) — DCA masters (accept an optional /mix/ segment too).
      const dcaMatch = address.match(/^\/dca\/(\d{1,2})\/(?:mix\/)?(fader|on)$/);
      if (dcaMatch) {
        const id = `dca-${parseInt(dcaMatch[1], 10)}`;
        patchStrip(id, (strip) => applyFaderOrMute(dcaMatch[2], rawVal, strip));
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlistenOsc = fn;
      })
      .catch(() => {});

    listen<number[] | { bands?: number[]; data?: number[] }>("console://rta", (event) => {
      if (disposed) return;
      const payload = event.payload;
      const rawBands = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.bands)
          ? payload.bands
          : Array.isArray(payload?.data)
            ? payload.data
            : null;
      if (!rawBands || rawBands.length === 0) return;
      hardwareRtaActiveRef.current = true;
      setRtaBars(
        Array.from({ length: 100 }, (_, i) => {
          const val = rawBands[i] ?? 0;
          return Math.max(0.02, Math.min(1, typeof val === "number" ? val : 0));
        })
      );
    })
      .then((fn) => {
        if (disposed) fn();
        else unlistenRta = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      hardwareRtaActiveRef.current = false;
      if (unlistenOsc) unlistenOsc();
      if (unlistenRta) unlistenRta();
    };
  }, [isOpen, embedded]);

  // RTA bars remain silent (0) until live console://rta hardware frames arrive.

  const visibleChannels = useMemo(() => {
    if (activeBank === "ch1_32") return channels.filter((c) => c.bank === "ch1_16" || c.bank === "ch17_32");
    if (activeBank === "ch1_16") return channels.filter((c) => c.bank === "ch1_16" || c.bank === "dca1_8");
    if (activeBank === "ch17_32") return channels.filter((c) => c.bank === "ch17_32" || c.bank === "dca1_8");
    if (activeBank === "aux_fx") return channels.filter((c) => c.bank === "aux_fx");
    if (activeBank === "bus1_16") return channels.filter((c) => c.bank === "bus1_16" || c.bank === "mtx1_6");
    if (activeBank === "all") return channels;
    if (activeBank === "user1" || activeBank === "user2") {
      if (bankEditMode) return channels.slice(0, 32);
      const ids = userLayerIds[activeBank];
      return channels.filter((c) => ids.includes(c.id));
    }
    return channels.filter((c) => c.bank === activeBank);
  }, [channels, activeBank, bankEditMode, userLayerIds]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedId) || visibleChannels[0] || channels[0],
    [channels, selectedId, visibleChannels]
  );

  const selectedColor = COLOR_MAP[selectedChannel.color];

  // EQ SVG Math
  const svgW = 640;
  const svgH = 216;
  const padL = 36;
  const padR = 14;
  const padT = 14;
  const padB = 24;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const dbToY = (db: number) => padT + ((18 - Math.max(-18, Math.min(18, db))) / 36) * plotH;
  const yToDb = (y: number) => Math.max(-15, Math.min(15, Math.round((18 - ((y - padT) / plotH) * 36) * 2) / 2));

  const eqCurveData = useMemo(() => {
    const samples = 150;
    const totalPts: string[] = [];
    const bandPts: string[][] = [[], [], [], []];
    const hpfPts: string[] = [];

    for (let i = 0; i <= samples; i++) {
      const norm = i / samples;
      const freq = normToFreq(norm);
      const x = padL + norm * plotW;

      let totalDb = 0;
      selectedChannel.eqBands.forEach((band, bIdx) => {
        const db = selectedChannel.eqOn ? biquadDbAtFreq(band, freq) : 0;
        totalDb += db;
        bandPts[bIdx].push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${dbToY(db).toFixed(1)}`);
      });

      const hpfDb = selectedChannel.hpfOn ? hpfDbAtFreq(selectedChannel.hpfFreqHz, freq) : 0;
      if (selectedChannel.hpfOn) {
        totalDb += hpfDb;
        hpfPts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${dbToY(hpfDb).toFixed(1)}`);
      }
      totalPts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${dbToY(totalDb).toFixed(1)}`);
    }

    return {
      totalPath: totalPts.join(" "),
      bandPaths: bandPts.map((pts) => pts.join(" ")),
      hpfPath: hpfPts.join(" "),
    };
  }, [selectedChannel, plotW, plotH]);

  const handleEqSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingBandIdx === null || !eqSvgRef.current) return;
    const rect = eqSvgRef.current.getBoundingClientRect();
    const scaleX = svgW / Math.max(1, rect.width);
    const scaleY = svgH / Math.max(1, rect.height);
    const svgX = (e.clientX - rect.left) * scaleX;
    const svgY = (e.clientY - rect.top) * scaleY;
    const normX = Math.max(0, Math.min(1, (svgX - padL) / plotW));
    const nextFreq = normToFreq(normX);
    const nextGain = yToDb(svgY);

    patchChannel(selectedChannel.id, (prev) => {
      const nextBands = [...prev.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState];
      nextBands[draggingBandIdx] = { ...nextBands[draggingBandIdx], freq: nextFreq, gain: nextGain };
      return { ...prev, eqBands: nextBands };
    });
    const bandNum = draggingBandIdx + 1;
    emitOsc(`${selectedChannel.oscPrefix}/eq/${bandNum}/f`, nextFreq);
    emitOsc(`${selectedChannel.oscPrefix}/eq/${bandNum}/g`, nextGain);
  };

  if (!embedded && !isOpen) return null;

  const consoleFrame = (
    <div
      role="dialog"
      aria-modal={embedded ? undefined : true}
      aria-label="Console full mixer"
      style={{
        width: "100%",
        height: embedded ? "calc(100vh - 156px)" : "94vh",
        minHeight: embedded ? 600 : undefined,
        maxWidth: embedded ? "100%" : 1580,
        background: "#121418",
        border: "1px solid #2A2E37",
        borderRadius: embedded ? 8 : 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        color: "#F3F4F6",
        boxShadow: embedded ? "0 8px 24px rgba(0,0,0,0.45)" : "0 24px 70px rgba(0,0,0,0.78)",
      }}
    >
      {/* Hidden .scn file input */}
      <input
        ref={scnFileInputRef}
        type="file"
        accept=".scn,.txt"
        onChange={handleImportScn}
        style={{ display: "none" }}
      />

      {/* TOP Console-EDIT NAVIGATION TOOLBAR (Mirrors Mixer | Channel | Config | Gate | Dyn | EQ | Sends | Main | FX1-4 | FX5-8) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px",
          background: "linear-gradient(180deg, #2D3138 0%, #1F2329 100%)",
          borderBottom: "1px solid #000000",
          gap: 6,
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
          {TOP_SCREEN_TABS.map((t) => {
            const Icon = t.icon;
            const active = screenTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setScreenTab(t.id)}
                style={{
                  height: 30,
                  padding: "0 11px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: active ? 800 : 600,
                  cursor: "pointer",
                  background: active
                    ? "linear-gradient(180deg, #1E3A4C 0%, #132531 100%)"
                    : "linear-gradient(180deg, #343841 0%, #262A31 100%)",
                  border: `1.5px solid ${active ? "#22D3EE" : "#111317"}`,
                  color: active ? "#22D3EE" : "#E5E7EB",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon size={13} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setFxRackOpen(true)}
            title="Open the 8-slot effects rack"
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 4,
              background: "#1E242D",
              border: "1px solid #334155",
              color: "#CBD5E1",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            <Zap size={12} color="#38BDF8" />
            FX Rack
          </button>

          {sendsOnFader && (
            <button
              type="button"
              onClick={() => setSendsOnFader(false)}
              style={{
                height: 26,
                padding: "0 8px",
                borderRadius: 4,
                fontSize: 10.5,
                fontWeight: 800,
                background: "#0284C7",
                border: "1px solid #38BDF8",
                color: "#FFFFFF",
                cursor: "pointer",
              }}
            >
              SENDS ON FADER: {channels.find((c) => c.id === sofTarget)?.shortLabel || sofTarget} (Exit)
            </button>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 8px",
              borderRadius: 4,
              background: "#0B0D10",
              border: "1px solid #262A34",
              fontSize: 10.5,
              color: "#94A3B8",
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              maxWidth: 320,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <Terminal size={11} color="#22D3EE" />
            <span>{lastOsc}</span>
          </div>

          {embedded && onPopout && (
            <button
              type="button"
              onClick={onPopout}
              title="Pop out Console-Edit into fullscreen overlay"
              style={{
                height: 28,
                padding: "0 8px",
                borderRadius: 4,
                background: "#1E242D",
                border: "1px solid #334155",
                color: "#CBD5E1",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              <Maximize2 size={12} />
              Pop Out
            </button>
          )}

          {!embedded && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Console"
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                background: "#7F1D1D",
                border: "1px solid #EF4444",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Compact USB stereo recorder transport — /-stat/tape/state */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          background: "#0B0D10",
          borderBottom: "1px solid #222834",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "#94A3B8",
          }}
        >
          USB Stereo Recorder
        </span>
        <span
          aria-label={`Recorder state: ${usbRecorderLabel(recorderState)}`}
          style={{
            minWidth: 76,
            fontSize: 10,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            color: recorderState === 4 ? "#F87171" : recorderState === 2 ? "#34D399" : "#94A3B8",
          }}
        >
          ● {usbRecorderLabel(recorderState)}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {([
            ["STOP", 0],
            ["PAUSE", 1],
            ["PLAY", 2],
            ["REC", 4],
          ] as Array<[string, number]>).map(([label, state]) => {
            const active = recorderState === state;
            const danger = state === 4 || (state === 0 && recorderState === 4);
            const transportStyle: React.CSSProperties = {
              height: 24,
              minHeight: 24,
              minWidth: 48,
              padding: "0 8px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 800,
              cursor: "pointer",
              background: active ? (danger ? "#991B1B" : "#1E3A4C") : "#161B24",
              border: `1px solid ${active ? (danger ? "#EF4444" : "#22D3EE") : "#283344"}`,
              color: active ? "#FFFFFF" : "#94A3B8",
            };
            const startRecorder = () => {
              setRecorderState(state);
              emitOsc(TAPE_STATE_ADDRESS, state);
            };
            if (state === 0 || state === 4) {
              return (
                <HoldConfirmButton
                  key={label}
                  label={label}
                  ariaLabel={`${label} USB recorder. Hold to confirm.`}
                  holdMs={900}
                  danger={danger}
                  onConfirm={startRecorder}
                  style={transportStyle}
                />
              );
            }
            return (
              <button
                key={label}
                type="button"
                title={`Set recorder to ${usbRecorderLabel(state)}`}
                onClick={startRecorder}
                style={transportStyle}
              >
                {label}
              </button>
            );
          })}
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9.5,
            color: "#64748B",
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          }}
        >
          {TAPE_STATE_ADDRESS}
        </span>
      </div>

      {/* MAIN SCREEN VIEWPORT */}
      {screenTab === "mixer" && (
        <ConsoleMixerOverview
          channels={channels}
          visibleChannels={visibleChannels}
          selectedChannel={selectedChannel}
          activeBank={activeBank}
          sendsOnFader={sendsOnFader}
          sofTarget={sofTarget}
          sendLevels={sendLevels}
          muteGroups={muteGroups}
          talkbackA={talkbackA}
          talkbackB={talkbackB}
          automixGroups={automixGroups}
          channelLinks={channelLinks}
          clockSource={clockSource}
          mainLrDb={mainLrDb}
          mainLrMeterLevel={mainLrMeterLevel}
          mainLrMute={mainLrMute}
          mainLrSolo={mainLrSolo}
          monoMcMode={monoMcMode}
          sceneIndex={sceneIndex}
          sceneName={SCENE_PRESETS[(sceneIndex - 1 + SCENE_PRESETS.length) % SCENE_PRESETS.length]}
          canUndo={undoStack.length > 0}
          hasCopiedChannel={Boolean(copiedChannel)}
          compactWidth={compactWidth}
          bankEditMode={bankEditMode}
          userLayerIds={userLayerIds}
          onSelectChannel={(id) => setSelectedId(id)}
          onChangeBank={(bank) => {
            setActiveBank(bank);
            setBankEditMode(false);
          }}
          onToggleUserAssign={(chId) => {
            const targetKey = activeBank === "user2" ? "user2" : "user1";
            setUserLayerIds((prev) => {
              const cur = prev[targetKey];
              const nextList = cur.includes(chId) ? cur.filter((x) => x !== chId) : [...cur, chId];
              const updated = { ...prev, [targetKey]: nextList };
              try {
                localStorage.setItem(USER_LAYER_STORAGE_KEY, JSON.stringify(updated));
              } catch {}
              return updated;
            });
          }}
          onToggleBankEdit={() => setBankEditMode((prev) => !prev)}
          onSaveUserLayer={() => {
            try {
              localStorage.setItem(USER_LAYER_STORAGE_KEY, JSON.stringify(userLayerIds));
            } catch {}
            setLastOsc("Saved User 1 & User 2 custom fader banks");
          }}
          onLoadUserLayer={() => {
            setUserLayerIds(loadUserLayers());
            setLastOsc("Loaded saved User 1 & User 2 custom fader banks");
          }}
          onChangeFader={(chId, db) => {
            const ch = channels.find((c) => c.id === chId);
            if (!ch) return;
            if (sendsOnFader) {
              setSendLevels((prev) => ({
                ...prev,
                [chId]: { ...(prev[chId] || {}), [sofTarget]: db },
              }));
              const busPad = sofTarget.replace(/^(bus|mtx)-/, "").padStart(2, "0");
              emitOsc(`${ch.oscPrefix}/mix/${busPad}/level`, faderDbToNormalized(db));
            } else {
              patchChannel(chId, (prev) => ({ ...prev, faderDb: db }));
              emitOsc(`${ch.oscPrefix}/mix/fader`, faderDbToNormalized(db));
            }
          }}
          onChangeMainLrDb={(db) => {
            setMainLrDb(db);
            emitOsc(monoMcMode ? "/main/m/mix/fader" : "/main/st/mix/fader", faderDbToNormalized(db));
          }}
          onToggleMainLrMute={() => {
            const next = !mainLrMute;
            setMainLrMute(next);
            emitOsc(monoMcMode ? "/main/m/mix/on" : "/main/st/mix/on", next ? 0 : 1);
          }}
          onToggleMainLrSolo={() => {
            const next = !mainLrSolo;
            setMainLrSolo(next);
            emitOsc("/main/st/mix/solo", next ? 1 : 0);
          }}
          onToggleMonoMc={() => {
            setSendsOnFader(false);
            setMonoMcMode((prev) => !prev);
          }}
          onToggleMute={(chId) => {
            const ch = channels.find((c) => c.id === chId);
            if (!ch) return;
            const next = !ch.mute;
            patchChannel(chId, (prev) => ({ ...prev, mute: next }));
            emitOsc(`${ch.oscPrefix}/mix/on`, next ? 0 : 1);
          }}
          onToggleSolo={(chId) => {
            const ch = channels.find((c) => c.id === chId);
            if (!ch) return;
            const next = !ch.solo;
            patchChannel(chId, (prev) => ({ ...prev, solo: next }));
            emitOsc(`${ch.oscPrefix}/mix/solo`, next ? 1 : 0);
          }}
          onClearAllSolos={() => {
            setMainLrSolo(false);
            setChannels((prev) => prev.map((ch) => ({ ...ch, solo: false })));
            emitOsc("/-action/clearsolo", 1);
          }}
          onTogglePhantom={(chId) => {
            const ch = channels.find((c) => c.id === chId);
            if (!ch) return;
            const next = !ch.phantom48v;
            patchChannel(chId, (prev) => ({ ...prev, phantom48v: next }));
            const addr =
              ch.headampIndex !== null
                ? `/headamp/${String(ch.headampIndex).padStart(3, "0")}/phantom`
                : `${ch.oscPrefix}/preamp/phantom`;
            emitOsc(addr, next ? 1 : 0);
          }}
          onTogglePolarity={(chId) => {
            const ch = channels.find((c) => c.id === chId);
            if (!ch) return;
            const next = !ch.polarityInvert;
            patchChannel(chId, (prev) => ({ ...prev, polarityInvert: next }));
            emitOsc(`${ch.oscPrefix}/preamp/invert`, next ? 1 : 0);
          }}
          onAdjustGain={(chId, nextGain) => {
            const ch = channels.find((c) => c.id === chId);
            if (!ch) return;
            patchChannel(chId, (prev) => ({ ...prev, preampGainDb: nextGain }));
            const addr =
              ch.headampIndex !== null
                ? `/headamp/${String(ch.headampIndex).padStart(3, "0")}/gain`
                : `${ch.oscPrefix}/preamp/trim`;
            emitOsc(addr, headampGainToOsc(nextGain));
          }}
          onRenameChannel={(chId, nextName) => {
            const ch = channels.find((c) => c.id === chId);
            if (!ch) return;
            patchChannel(chId, (prev) => ({ ...prev, name: nextName }));
            emitOsc(`${ch.oscPrefix}/config/name`, nextName);
          }}
          onSelectBusTarget={(busId) => {
            if (!busId) {
              setSendsOnFader(false);
              setMonoMcMode(false);
            } else {
              setSofTarget(busId);
              setSendsOnFader(true);
            }
          }}
          onToggleMuteGroup={(idx) => {
            const next = !muteGroups[idx];
            setMuteGroups((prev) => prev.map((m, i) => (i === idx ? next : m)));
            emitOsc(`/config/mute/${idx + 1}`, next ? 1 : 0);
          }}
          onToggleTalkback={(which) => {
            if (which === "A") {
              const next = !talkbackA;
              setTalkbackA(next);
              emitOsc("/config/talk/A/on", next ? 1 : 0);
            } else {
              const next = !talkbackB;
              setTalkbackB(next);
              emitOsc("/config/talk/B/on", next ? 1 : 0);
            }
          }}
          onToggleAutomix={(chId, group) => {
            const current = automixGroups[chId] || "Off";
            const next = current === group ? "Off" : group;
            setAutomixGroups((prev) => ({ ...prev, [chId]: next }));
            emitOsc(`${selectedChannel.oscPrefix}/automix/group`, next === "Off" ? 0 : next === "X" ? 1 : 2);
          }}
          onOpenScreenTab={(t) => setScreenTab(t)}
          onToggleResize={() => setCompactWidth((prev) => !prev)}
          onSceneStep={(delta) =>
            setSceneIndex((prev) => ((prev - 1 + delta + SCENE_PRESETS.length) % SCENE_PRESETS.length) + 1)
          }
          onSceneGo={() => {
            pushUndoSnapshot();
            emitOsc("/-action/goscene", sceneIndex);
          }}
          onSceneUndo={() => {
            if (undoStack.length === 0) return;
            const prev = undoStack[undoStack.length - 1];
            setUndoStack((s) => s.slice(0, -1));
            setChannels(prev);
            setLastOsc("Reverted previous channel state (Undo)");
          }}
          onSaveScn={handleExportScn}
          onLoadScn={() => scnFileInputRef.current?.click()}
          onCopyChannel={() => {
            setCopiedChannel({
              ...selectedChannel,
              eqBands: [...selectedChannel.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState],
              busSends: selectedChannel.busSends.map((b) => ({ ...b })),
            });
            setLastOsc(`Copied ${selectedChannel.shortLabel} (${selectedChannel.name}) parameters`);
          }}
          onPasteChannel={() => {
            if (!copiedChannel) return;
            pushUndoSnapshot();
            patchChannel(selectedChannel.id, (prev) => ({
              ...prev,
              eqOn: copiedChannel.eqOn,
              eqBands: copiedChannel.eqBands.map((b) => ({ ...b })) as [EqBandState, EqBandState, EqBandState, EqBandState],
              gate: { ...copiedChannel.gate },
              comp: { ...copiedChannel.comp },
              hpfOn: copiedChannel.hpfOn,
              hpfFreqHz: copiedChannel.hpfFreqHz,
              busSends: copiedChannel.busSends.map((b) => ({ ...b })),
            }));
            setLastOsc(`Pasted EQ/Dyn/Sends onto ${selectedChannel.shortLabel}`);
          }}
          onOpenFxRack={() => setFxRackOpen(true)}
        />
      )}

      {/* NON-MIXER DETAIL SUB-SCREENS */}
      {screenTab !== "mixer" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", background: "#0D1117" }}>
          {/* Selected Channel Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 14px",
              background: "#131720",
              borderBottom: "1px solid #222834",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  background: selectedColor.bg,
                  border: `1px solid ${selectedColor.border}`,
                  color: selectedColor.text,
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {selectedChannel.shortLabel}: {selectedChannel.name}
              </span>
              <select
                value={selectedChannel.id}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{
                  height: 28,
                  padding: "0 8px",
                  borderRadius: 4,
                  background: "#090B0E",
                  border: "1px solid #334155",
                  color: "#E2E8F0",
                  fontSize: 12,
                }}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortLabel} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  const next = !selectedChannel.solo;
                  patchChannel(selectedChannel.id, (p) => ({ ...p, solo: next }));
                  emitOsc(`${selectedChannel.oscPrefix}/mix/solo`, next ? 1 : 0);
                }}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 4,
                  background: selectedChannel.solo ? "#D97706" : "#1D222B",
                  border: `1px solid ${selectedChannel.solo ? "#FACC15" : "#334155"}`,
                  color: "#FFFFFF",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                SOLO
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !selectedChannel.mute;
                  patchChannel(selectedChannel.id, (p) => ({ ...p, mute: next }));
                  emitOsc(`${selectedChannel.oscPrefix}/mix/on`, next ? 0 : 1);
                }}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 4,
                  background: selectedChannel.mute ? "#991B1B" : "#065F46",
                  border: `1px solid ${selectedChannel.mute ? "#EF4444" : "#10B981"}`,
                  color: "#FFFFFF",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {selectedChannel.mute ? <VolumeX size={12} /> : <Volume2 size={12} />}
                {selectedChannel.mute ? "MUTED" : "ON (LIVE)"}
              </button>
            </div>
          </div>

          {/* Channel / EQ / Gate / Dyn Combined View */}
          {(screenTab === "channel" || screenTab === "eq" || screenTab === "gate" || screenTab === "dyn") && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  screenTab === "eq" ? "1.9fr 0.55fr 0.55fr" : screenTab === "gate" ? "1.1fr 1.1fr 0.8fr" : screenTab === "dyn" ? "1.1fr 0.8fr 1.1fr" : "1.45fr 0.75fr 0.8fr",
                gap: 12,
                padding: 14,
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* 4-Band Parametric EQ */}
              <div style={{ background: "#10151F", border: `1px solid ${screenTab === "eq" ? "#22D3EE" : "#1E2533"}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>4-Band Parametric EQ</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !selectedChannel.eqOn;
                        patchChannel(selectedChannel.id, (p) => ({ ...p, eqOn: next }));
                        emitOsc(`${selectedChannel.oscPrefix}/eq/on`, next ? 1 : 0);
                      }}
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "2px 8px",
                        borderRadius: 4,
                        cursor: "pointer",
                        background: selectedChannel.eqOn ? "#065F46" : "#1E2533",
                        border: `1px solid ${selectedChannel.eqOn ? "#10B981" : "#334155"}`,
                        color: selectedChannel.eqOn ? "#34D399" : "#94A3B8",
                      }}
                    >
                      {selectedChannel.eqOn ? "EQ ACTIVE" : "BYPASSED"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRtaEnabled((p) => !p)}
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "2px 8px",
                        borderRadius: 4,
                        cursor: "pointer",
                        background: rtaEnabled ? "#1E3A8A" : "#1E2533",
                        border: `1px solid ${rtaEnabled ? "#3B82F6" : "#334155"}`,
                        color: rtaEnabled ? "#93C5FD" : "#94A3B8",
                      }}
                    >
                      100-Band RTA
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      patchChannel(selectedChannel.id, (p) => ({ ...p, eqBands: createDefaultEq(false) }));
                      emitOsc(`${selectedChannel.oscPrefix}/eq/reset`, 1);
                    }}
                    style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 4, background: "#161B24", border: "1px solid #283344", color: "#94A3B8", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <RotateCcw size={11} />
                    Flatten EQ
                  </button>
                </div>

                <div style={{ background: "#070A10", border: "1px solid #1E2533", borderRadius: 6, overflow: "hidden" }}>
                  <svg
                    ref={eqSvgRef}
                    viewBox={`0 0 ${svgW} ${svgH}`}
                    onPointerMove={handleEqSvgPointerMove}
                    onPointerUp={() => setDraggingBandIdx(null)}
                    onPointerCancel={() => setDraggingBandIdx(null)}
                    style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
                  >
                    {rtaEnabled && (
                      <g opacity={0.28}>
                        {rtaBars.map((val, idx) => {
                          const barW = plotW / 100;
                          const h = Math.max(2, val * plotH);
                          return (
                            <rect key={idx} x={padL + idx * barW + 0.5} y={svgH - padB - h} width={Math.max(1, barW - 1.2)} height={h} rx={1} fill="#38BDF8" />
                          );
                        })}
                      </g>
                    )}
                    {[-15, -10, -5, 0, 5, 10, 15].map((db) => {
                      const y = dbToY(db);
                      return (
                        <g key={db}>
                          <line x1={padL} y1={y} x2={svgW - padR} y2={y} stroke={db === 0 ? "#475569" : "#1E2533"} strokeWidth={db === 0 ? 1.2 : 0.8} strokeDasharray={db === 0 ? undefined : "3 3"} />
                          <text x={padL - 5} y={y + 3} fill={db === 0 ? "#CBD5E1" : "#64748B"} fontSize="9" textAnchor="end" fontFamily="monospace">
                            {db > 0 ? `+${db}` : db}
                          </text>
                        </g>
                      );
                    })}
                    {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((hz) => {
                      const x = padL + freqToNorm(hz) * plotW;
                      return (
                        <g key={hz}>
                          <line x1={x} y1={padT} x2={x} y2={svgH - padB} stroke="#1E2533" strokeWidth={0.8} />
                          <text x={x} y={svgH - 7} fill="#64748B" fontSize="9" textAnchor="middle" fontFamily="monospace">
                            {hz >= 1000 ? `${hz / 1000}k` : `${hz}`}
                          </text>
                        </g>
                      );
                    })}
                    {selectedChannel.hpfOn && eqCurveData.hpfPath && (
                      <path d={eqCurveData.hpfPath} fill="none" stroke="#10B981" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.75} />
                    )}
                    {selectedChannel.eqBands.map((band, bIdx) => (
                      <path key={band.id} d={eqCurveData.bandPaths[bIdx]} fill="none" stroke={band.color} strokeWidth={1.3} opacity={selectedChannel.eqOn ? 0.55 : 0.2} />
                    ))}
                    <path d={eqCurveData.totalPath} fill="none" stroke={selectedChannel.eqOn ? "#F8FAFC" : "#64748B"} strokeWidth={2.4} />
                    {selectedChannel.eqBands.map((band, bIdx) => {
                      const cx = padL + freqToNorm(band.freq) * plotW;
                      const cy = dbToY(band.gain);
                      return (
                        <g
                          key={band.id}
                          style={{ cursor: "grab" }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            eqSvgRef.current?.setPointerCapture(e.pointerId);
                            setDraggingBandIdx(bIdx);
                          }}
                        >
                          <circle cx={cx} cy={cy} r={10} fill={band.color} fillOpacity={0.22} stroke={band.color} strokeWidth={2} />
                          <text x={cx} y={cy + 3.5} fill="#FFFFFF" fontSize="9.5" fontWeight="800" textAnchor="middle" fontFamily="monospace">
                            {band.bandIndex}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {selectedChannel.eqBands.map((band, bIdx) => (
                    <div key={band.id} style={{ background: "#0A0E16", border: "1px solid #1E2533", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: 11, color: band.color }}>{band.bandIndex}. {band.label}</strong>
                        <span style={{ fontSize: 9.5, color: "#94A3B8" }}>{band.type}</span>
                      </div>
                      <label style={{ fontSize: 10, color: "#94A3B8" }}>
                        Freq: {band.freq >= 1000 ? `${(band.freq / 1000).toFixed(2)}k` : `${band.freq}Hz`}
                        <input
                          type="range"
                          min={0}
                          max={1000}
                          value={Math.round(freqToNorm(band.freq) * 1000)}
                          onChange={(e) => {
                            const freq = normToFreq(Number(e.target.value) / 1000);
                            patchChannel(selectedChannel.id, (p) => {
                              const nb = [...p.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState];
                              nb[bIdx] = { ...nb[bIdx], freq };
                              return { ...p, eqBands: nb };
                            });
                            emitOsc(`${selectedChannel.oscPrefix}/eq/${band.bandIndex}/f`, freq);
                          }}
                          style={{ width: "100%", accentColor: band.color }}
                        />
                      </label>
                      <label style={{ fontSize: 10, color: "#94A3B8" }}>
                        Gain: {band.gain > 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1)} dB
                        <input
                          type="range"
                          min={-15}
                          max={15}
                          step={0.5}
                          value={band.gain}
                          onChange={(e) => {
                            const gain = Number(e.target.value);
                            patchChannel(selectedChannel.id, (p) => {
                              const nb = [...p.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState];
                              nb[bIdx] = { ...nb[bIdx], gain };
                              return { ...p, eqBands: nb };
                            });
                            emitOsc(`${selectedChannel.oscPrefix}/eq/${band.bandIndex}/g`, gain);
                          }}
                          style={{ width: "100%", accentColor: band.color }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Noise Gate Panel */}
              <div style={{ background: "#10151F", border: `1px solid ${screenTab === "gate" ? "#22D3EE" : "#1E2533"}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Noise Gate</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.gate.on;
                      patchChannel(selectedChannel.id, (p) => ({ ...p, gate: { ...p.gate, on: next } }));
                      emitOsc(`${selectedChannel.oscPrefix}/gate/on`, next ? 1 : 0);
                    }}
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 8px",
                      borderRadius: 4,
                      cursor: "pointer",
                      background: selectedChannel.gate.on ? "#065F46" : "#1E2533",
                      border: `1px solid ${selectedChannel.gate.on ? "#10B981" : "#334155"}`,
                      color: selectedChannel.gate.on ? "#34D399" : "#94A3B8",
                    }}
                  >
                    {selectedChannel.gate.on ? "GATE ON" : "BYPASS"}
                  </button>
                </div>
                <div style={{ background: "#070A10", border: "1px solid #1E2533", borderRadius: 6, padding: 6 }}>
                  <svg viewBox="0 0 180 130" style={{ width: "100%", display: "block" }}>
                    <line x1={20} y1={110} x2={165} y2={15} stroke="#1E2533" strokeDasharray="3 3" />
                    <line x1={20} y1={110} x2={165} y2={110} stroke="#334155" />
                    <line x1={20} y1={15} x2={20} y2={110} stroke="#334155" />
                    {(() => {
                      const thrFrac = (selectedChannel.gate.threshold + 80) / 80;
                      const thrX = 20 + thrFrac * 145;
                      const thrY = 110 - thrFrac * 95;
                      const dropY = Math.min(110, thrY + (selectedChannel.gate.range / 60) * 55);
                      return <polyline points={`20,${dropY.toFixed(1)} ${thrX.toFixed(1)},${dropY.toFixed(1)} ${thrX.toFixed(1)},${thrY.toFixed(1)} 165,15`} fill="none" stroke={selectedChannel.gate.on ? "#10B981" : "#64748B"} strokeWidth={2.2} />;
                    })()}
                  </svg>
                </div>
                <label style={{ fontSize: 11, color: "#94A3B8" }}>
                  Threshold: <strong style={{ color: "#34D399" }}>{selectedChannel.gate.threshold} dB</strong>
                  <input
                    type="range"
                    min={-80}
                    max={0}
                    value={selectedChannel.gate.threshold}
                    onChange={(e) => {
                      const thr = Number(e.target.value);
                      patchChannel(selectedChannel.id, (p) => ({ ...p, gate: { ...p.gate, threshold: thr } }));
                      emitOsc(`${selectedChannel.oscPrefix}/gate/thr`, thr);
                    }}
                    style={{ width: "100%", accentColor: "#10B981" }}
                  />
                </label>
                <label style={{ fontSize: 11, color: "#94A3B8" }}>
                  Range: <strong style={{ color: "#34D399" }}>{selectedChannel.gate.range} dB</strong>
                  <input
                    type="range"
                    min={3}
                    max={60}
                    value={selectedChannel.gate.range}
                    onChange={(e) => {
                      const range = Number(e.target.value);
                      patchChannel(selectedChannel.id, (p) => ({ ...p, gate: { ...p.gate, range } }));
                      emitOsc(`${selectedChannel.oscPrefix}/gate/range`, range);
                    }}
                    style={{ width: "100%", accentColor: "#10B981" }}
                  />
                </label>
              </div>

              {/* Dynamics / Compressor */}
              <div style={{ background: "#10151F", border: `1px solid ${screenTab === "dyn" ? "#22D3EE" : "#1E2533"}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Compressor</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.comp.on;
                      patchChannel(selectedChannel.id, (p) => ({ ...p, comp: { ...p.comp, on: next } }));
                      emitOsc(`${selectedChannel.oscPrefix}/dyn/on`, next ? 1 : 0);
                    }}
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 8px",
                      borderRadius: 4,
                      cursor: "pointer",
                      background: selectedChannel.comp.on ? "#1E40AF" : "#1E2533",
                      border: `1px solid ${selectedChannel.comp.on ? "#3B82F6" : "#334155"}`,
                      color: selectedChannel.comp.on ? "#FFFFFF" : "#94A3B8",
                    }}
                  >
                    {selectedChannel.comp.on ? "COMP ON" : "BYPASS"}
                  </button>
                </div>
                <div style={{ background: "#070A10", border: "1px solid #1E2533", borderRadius: 6, padding: 6 }}>
                  <svg viewBox="0 0 180 130" style={{ width: "100%", display: "block" }}>
                    <line x1={20} y1={110} x2={165} y2={15} stroke="#1E2533" strokeDasharray="3 3" />
                    <line x1={20} y1={110} x2={165} y2={110} stroke="#334155" />
                    <line x1={20} y1={15} x2={20} y2={110} stroke="#334155" />
                    {(() => {
                      const thrFrac = (selectedChannel.comp.threshold + 60) / 60;
                      const kneeX = 20 + thrFrac * 145;
                      const kneeY = 110 - thrFrac * 95;
                      const outAbove = (60 - (selectedChannel.comp.threshold + 60)) / selectedChannel.comp.ratio;
                      const endY = Math.max(15, kneeY - (outAbove / 60) * 95);
                      return <polyline points={`20,110 ${kneeX.toFixed(1)},${kneeY.toFixed(1)} 165,${endY.toFixed(1)}`} fill="none" stroke={selectedChannel.comp.on ? "#60A5FA" : "#64748B"} strokeWidth={2.2} />;
                    })()}
                  </svg>
                </div>
                <label style={{ fontSize: 11, color: "#94A3B8" }}>
                  Threshold: <strong style={{ color: "#60A5FA" }}>{selectedChannel.comp.threshold} dB</strong>
                  <input
                    type="range"
                    min={-60}
                    max={0}
                    value={selectedChannel.comp.threshold}
                    onChange={(e) => {
                      const thr = Number(e.target.value);
                      patchChannel(selectedChannel.id, (p) => ({ ...p, comp: { ...p.comp, threshold: thr } }));
                      emitOsc(`${selectedChannel.oscPrefix}/dyn/thr`, thr);
                    }}
                    style={{ width: "100%", accentColor: "#3B82F6" }}
                  />
                </label>
                <label style={{ fontSize: 11, color: "#94A3B8" }}>
                  Ratio: <strong style={{ color: "#60A5FA" }}>{selectedChannel.comp.ratio.toFixed(1)}:1</strong>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={0.5}
                    value={selectedChannel.comp.ratio}
                    onChange={(e) => {
                      const ratio = Number(e.target.value);
                      patchChannel(selectedChannel.id, (p) => ({ ...p, comp: { ...p.comp, ratio } }));
                      emitOsc(`${selectedChannel.oscPrefix}/dyn/ratio`, ratio);
                    }}
                    style={{ width: "100%", accentColor: "#3B82F6" }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Config View */}
          {screenTab === "config" && (
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ background: "#10151F", border: "1px solid #1E2533", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <strong style={{ fontSize: 13 }}>Preamp, Polarity, HPF & Delay</strong>
                <label style={{ fontSize: 12, color: "#CBD5E1" }}>
                  Headamp Gain ({selectedChannel.preampGainDb >= 0 ? `+${selectedChannel.preampGainDb.toFixed(1)}` : selectedChannel.preampGainDb.toFixed(1)} dB)
                  <input
                    type="range"
                    min={-12}
                    max={60}
                    step={0.5}
                    value={selectedChannel.preampGainDb}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      patchChannel(selectedChannel.id, (p) => ({ ...p, preampGainDb: val }));
                      emitOsc(selectedChannel.headampIndex !== null ? `/headamp/${String(selectedChannel.headampIndex).padStart(3, "0")}/gain` : `${selectedChannel.oscPrefix}/preamp/trim`, val);
                    }}
                    style={{ width: "100%", accentColor: "#F59E0B" }}
                  />
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <HoldConfirmButton
                    label={`+48V Phantom ${selectedChannel.phantom48v ? "ON" : "OFF"}`}
                    ariaLabel={`${selectedChannel.name} +48V phantom power ${selectedChannel.phantom48v ? "on" : "off"}. Hold to confirm.`}
                    holdMs={1200}
                    onConfirm={() => {
                      const next = !selectedChannel.phantom48v;
                      patchChannel(selectedChannel.id, (p) => ({ ...p, phantom48v: next }));
                      emitOsc(selectedChannel.headampIndex !== null ? `/headamp/${String(selectedChannel.headampIndex).padStart(3, "0")}/phantom` : `${selectedChannel.oscPrefix}/preamp/phantom`, next ? 1 : 0);
                    }}
                    style={{ minHeight: 34, padding: "6px 12px", borderRadius: 6, background: selectedChannel.phantom48v ? "#991B1B" : "#1D222B", border: `1px solid ${selectedChannel.phantom48v ? "#EF4444" : "#334155"}`, color: "#FFF", fontWeight: 700, cursor: "pointer" }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.polarityInvert;
                      patchChannel(selectedChannel.id, (p) => ({ ...p, polarityInvert: next }));
                      emitOsc(`${selectedChannel.oscPrefix}/preamp/invert`, next ? 1 : 0);
                    }}
                    style={{ padding: "6px 12px", borderRadius: 6, background: selectedChannel.polarityInvert ? "#D97706" : "#1D222B", border: `1px solid ${selectedChannel.polarityInvert ? "#FACC15" : "#334155"}`, color: "#FFF", fontWeight: 700, cursor: "pointer" }}
                  >
                    Polarity Ø {selectedChannel.polarityInvert ? "INVERTED" : "NORMAL"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.hpfOn;
                      patchChannel(selectedChannel.id, (p) => ({ ...p, hpfOn: next }));
                      emitOsc(`${selectedChannel.oscPrefix}/preamp/hpon`, next ? 1 : 0);
                    }}
                    style={{ padding: "6px 12px", borderRadius: 6, background: selectedChannel.hpfOn ? "#065F46" : "#1D222B", border: `1px solid ${selectedChannel.hpfOn ? "#10B981" : "#334155"}`, color: "#FFF", fontWeight: 700, cursor: "pointer" }}
                  >
                    Low Cut HPF {selectedChannel.hpfOn ? `${selectedChannel.hpfFreqHz} Hz` : "OFF"}
                  </button>
                </div>
                <label style={{ fontSize: 12, color: "#CBD5E1" }}>
                  HPF Cutoff Frequency ({selectedChannel.hpfFreqHz} Hz)
                  <input
                    type="range"
                    min={20}
                    max={400}
                    value={selectedChannel.hpfFreqHz}
                    onChange={(e) => {
                      const hz = Number(e.target.value);
                      patchChannel(selectedChannel.id, (p) => ({ ...p, hpfFreqHz: hz, hpfOn: true }));
                      emitOsc(`${selectedChannel.oscPrefix}/preamp/hpf`, hz);
                    }}
                    style={{ width: "100%", accentColor: "#22D3EE" }}
                  />
                </label>
                <label style={{ fontSize: 12, color: "#CBD5E1" }}>
                  Delay Alignment ({channelDelays[selectedChannel.id] ?? 0} ms)
                  <input
                    type="range"
                    min={0}
                    max={500}
                    step={0.5}
                    value={channelDelays[selectedChannel.id] ?? 0}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setChannelDelays((prev) => ({ ...prev, [selectedChannel.id]: val }));
                      emitOsc(`${selectedChannel.oscPrefix}/delay/time`, val);
                    }}
                    style={{ width: "100%", accentColor: "#38BDF8" }}
                  />
                </label>
              </div>

              <div style={{ background: "#10151F", border: "1px solid #1E2533", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <strong style={{ fontSize: 13 }}>Scribble Strip Name & Console Hardware Color</strong>
                <input
                  type="text"
                  maxLength={12}
                  value={selectedChannel.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    patchChannel(selectedChannel.id, (p) => ({ ...p, name: val }));
                    emitOsc(`${selectedChannel.oscPrefix}/config/name`, val);
                  }}
                  style={{ height: 34, padding: "0 10px", background: "#07090D", border: "1px solid #334155", borderRadius: 6, color: "#FFF", fontSize: 13, fontWeight: 700 }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {CONSOLE_COLORS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => {
                        patchChannel(selectedChannel.id, (p) => ({ ...p, color: c.key }));
                        emitOsc(`${selectedChannel.oscPrefix}/config/color`, c.code);
                      }}
                      style={{ height: 32, borderRadius: 6, background: c.bg, border: `2px solid ${selectedChannel.color === c.key ? "#FFF" : c.border}`, color: c.text, fontWeight: 800, fontSize: 11, cursor: "pointer" }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !channelLinks[selectedChannel.id];
                    setChannelLinks((prev) => ({ ...prev, [selectedChannel.id]: next }));
                    emitOsc(`/config/chlink/${selectedChannel.id}`, next ? 1 : 0);
                  }}
                  style={{ height: 34, borderRadius: 6, background: channelLinks[selectedChannel.id] ? "#0E7490" : "#1D222B", border: `1px solid ${channelLinks[selectedChannel.id] ? "#22D3EE" : "#334155"}`, color: "#FFF", fontWeight: 700, cursor: "pointer" }}
                >
                  {channelLinks[selectedChannel.id] ? "Stereo Pair Linked" : "Link Odd/Even Stereo Pair"}
                </button>
              </div>
            </div>
          )}

          {/* Sends View */}
          {screenTab === "sends" && (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>
                MixBus Sends 1-16 — {selectedChannel.shortLabel} ({selectedChannel.name})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {selectedChannel.busSends.map((send) => {
                  const padBus = String(send.busNumber).padStart(2, "0");
                  return (
                    <div key={send.busNumber} style={{ background: "#10151F", border: `1px solid ${send.on ? "#3B82F688" : "#1E2533"}`, borderRadius: 6, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700 }}>Bus {padBus} • {send.label}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const nextOn = !send.on;
                            patchChannel(selectedChannel.id, (p) => ({
                              ...p,
                              busSends: p.busSends.map((b) => (b.busNumber === send.busNumber ? { ...b, on: nextOn } : b)),
                            }));
                            emitOsc(`${selectedChannel.oscPrefix}/mix/${padBus}/on`, nextOn ? 1 : 0);
                          }}
                          style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 7px", borderRadius: 4, cursor: "pointer", background: send.on ? "#065F46" : "#161B24", border: `1px solid ${send.on ? "#10B981" : "#283344"}`, color: send.on ? "#34D399" : "#64748B" }}
                        >
                          {send.on ? "ON" : "OFF"}
                        </button>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => {
                            const order: Array<"PRE" | "POST" | "SUB"> = ["PRE", "POST", "SUB"];
                            const nextTap = order[(order.indexOf(send.tap) + 1) % order.length];
                            patchChannel(selectedChannel.id, (p) => ({
                              ...p,
                              busSends: p.busSends.map((b) => (b.busNumber === send.busNumber ? { ...b, tap: nextTap } : b)),
                            }));
                            emitOsc(`${selectedChannel.oscPrefix}/mix/${padBus}/type`, nextTap);
                          }}
                          style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#161B24", border: "1px solid #283344", color: send.tap === "POST" ? "#FBBF24" : "#60A5FA", cursor: "pointer" }}
                        >
                          {send.tap}
                        </button>
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#CBD5E1" }}>{formatDb(send.levelDb)}</span>
                      </div>
                      <input
                        type="range"
                        min={-90}
                        max={10}
                        step={0.5}
                        value={send.levelDb}
                        onChange={(e) => {
                          const lvl = Number(e.target.value);
                          patchChannel(selectedChannel.id, (p) => ({
                            ...p,
                            busSends: p.busSends.map((b) => (b.busNumber === send.busNumber ? { ...b, levelDb: lvl, on: true } : b)),
                          }));
                          emitOsc(`${selectedChannel.oscPrefix}/mix/${padBus}/level`, lvl);
                        }}
                        style={{ width: "100%", accentColor: send.on ? "#3B82F6" : "#64748B" }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Main LR & DCA Matrix View */}
          {screenTab === "main" && (
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ background: "#10151F", border: "1px solid #1E2533", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <strong style={{ fontSize: 13 }}>Main Bus Routing & Pan ({selectedChannel.shortLabel})</strong>
                <label style={{ fontSize: 12, color: "#CBD5E1" }}>
                  Stereo Pan ({selectedChannel.pan === 0 ? "Center" : selectedChannel.pan < 0 ? `L${Math.abs(selectedChannel.pan)}` : `R${selectedChannel.pan}`})
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={selectedChannel.pan}
                    onChange={(e) => {
                      const pan = Number(e.target.value);
                      patchChannel(selectedChannel.id, (p) => ({ ...p, pan }));
                      emitOsc(`${selectedChannel.oscPrefix}/mix/pan`, (pan + 100) / 200);
                    }}
                    style={{ width: "100%", accentColor: "#22D3EE" }}
                  />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.lrAssign;
                      patchChannel(selectedChannel.id, (p) => ({ ...p, lrAssign: next }));
                      emitOsc(`${selectedChannel.oscPrefix}/mix/st`, next ? 1 : 0);
                    }}
                    style={{ flex: 1, height: 34, borderRadius: 6, background: selectedChannel.lrAssign ? "#065F46" : "#1D222B", border: `1px solid ${selectedChannel.lrAssign ? "#10B981" : "#334155"}`, color: "#FFF", fontWeight: 700, cursor: "pointer" }}
                  >
                    Stereo Main LR: {selectedChannel.lrAssign ? "ON" : "OFF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.monoAssign;
                      patchChannel(selectedChannel.id, (p) => ({ ...p, monoAssign: next }));
                      emitOsc(`${selectedChannel.oscPrefix}/mix/mono`, next ? 1 : 0);
                    }}
                    style={{ flex: 1, height: 34, borderRadius: 6, background: selectedChannel.monoAssign ? "#0E7490" : "#1D222B", border: `1px solid ${selectedChannel.monoAssign ? "#22D3EE" : "#334155"}`, color: "#FFF", fontWeight: 700, cursor: "pointer" }}
                  >
                    Mono / Center Bus: {selectedChannel.monoAssign ? "ON" : "OFF"}
                  </button>
                </div>
              </div>

              <div style={{ background: "#10151F", border: "1px solid #1E2533", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <strong style={{ fontSize: 13 }}>DCA Group Assignment (DCA 1 - 8)</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {Array.from({ length: 8 }, (_, idx) => {
                    const assigned = (selectedChannel.dcaAssignMask & (1 << idx)) !== 0;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          const nextMask = selectedChannel.dcaAssignMask ^ (1 << idx);
                          patchChannel(selectedChannel.id, (p) => ({ ...p, dcaAssignMask: nextMask }));
                          emitOsc(`${selectedChannel.oscPrefix}/grp/dca`, nextMask);
                        }}
                        style={{
                          height: 36,
                          borderRadius: 6,
                          background: assigned ? "#1E3A8A" : "#1D222B",
                          border: `1px solid ${assigned ? "#60A5FA" : "#334155"}`,
                          color: assigned ? "#FFFFFF" : "#94A3B8",
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        DCA {idx + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* FX1 - 4 / FX5 - 8 */}
          {(screenTab === "fx1_4" || screenTab === "fx5_8") && (
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {fxSlots.slice(screenTab === "fx1_4" ? 0 : 4, screenTab === "fx1_4" ? 4 : 8).map((fx) => (
                <div key={fx.slot} style={{ background: "#10151F", border: `1px solid ${fx.bypassed ? "#334155" : "#8B5CF6"}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#A78BFA", fontFamily: "monospace" }}>FX {fx.slot}</span>
                    <select
                      value={fx.type}
                      onChange={(e) => {
                        const nextType = e.target.value as FxEffectType;
                        setFxSlots((prev) => prev.map((s) => (s.slot === fx.slot ? { ...s, type: nextType } : s)));
                        emitOsc(`/fx/${fx.slot}/type`, nextType);
                      }}
                      style={{ flex: 1, height: 28, padding: "0 8px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: "#161B24", border: "1px solid #283344", color: "#E2E8F0" }}
                    >
                      {FX_EFFECT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const nextBypass = !fx.bypassed;
                        setFxSlots((prev) => prev.map((s) => (s.slot === fx.slot ? { ...s, bypassed: nextBypass } : s)));
                        emitOsc(`/fx/${fx.slot}/bypass`, nextBypass ? 1 : 0);
                      }}
                      style={{ height: 28, padding: "0 10px", borderRadius: 5, fontSize: 10, fontWeight: 800, cursor: "pointer", background: fx.bypassed ? "#991B1B" : "#065F46", border: `1px solid ${fx.bypassed ? "#EF4444" : "#10B981"}`, color: "#FFF" }}
                    >
                      {fx.bypassed ? "BYPASSED" : "ACTIVE"}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {fx.params.map((val, pIdx) => {
                      const parNum = String(pIdx + 1).padStart(2, "0");
                      return (
                        <div key={parNum} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 48, fontSize: 10, fontWeight: 700, color: "#94A3B8", fontFamily: "monospace" }}>Par {parNum}</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={val}
                            onChange={(e) => {
                              const nextVal = parseFloat(e.target.value);
                              setFxSlots((prev) =>
                                prev.map((s) => {
                                  if (s.slot !== fx.slot) return s;
                                  const np = [...s.params] as [number, number, number, number];
                                  np[pIdx] = nextVal;
                                  return { ...s, params: np };
                                })
                              );
                              emitOsc(`/fx/${fx.slot}/par/${parNum}`, nextVal);
                            }}
                            style={{ flex: 1, accentColor: "#8B5CF6" }}
                          />
                          <span style={{ width: 34, textAlign: "right", fontSize: 10, fontFamily: "monospace" }}>{val.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Routing Matrix View */}
          {screenTab === "routing" && (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Console Routing Matrix — {routingDomain}</div>
                  <div style={{ fontSize: 11, color: "#94A3B8" }}>{ROUTING_CONFIG[routingDomain].subtitle}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["StageBox-A", "StageBox-B", "Local 1-32", "Card", "P16 Personal Bus"] as RoutingDomainId[]).map((dom) => {
                    const active = routingDomain === dom;
                    return (
                      <button
                        key={dom}
                        type="button"
                        onClick={() => setRoutingDomain(dom)}
                        style={{ height: 28, padding: "0 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", background: active ? "#7C3AED" : "#161B24", border: `1px solid ${active ? "#A855F7" : "#283344"}`, color: active ? "#FFF" : "#94A3B8" }}
                      >
                        <Radio size={11} style={{ marginRight: 5, verticalAlign: "-1px" }} />
                        {dom}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ background: "#10151F", border: "1px solid #1E2533", borderRadius: 8, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#161B24", borderBottom: "1px solid #1E2533" }}>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "#94A3B8" }}>Output / Destination Block</th>
                      {ROUTING_CONFIG[routingDomain].sources.map((src) => (
                        <th key={src} style={{ textAlign: "center", padding: "8px 10px", color: "#CBD5E1", fontWeight: 700, whiteSpace: "nowrap" }}>{src}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROUTING_CONFIG[routingDomain].destinations.map((dest, rowIdx) => {
                      const activeCol = routingSelections[routingDomain][rowIdx] ?? 0;
                      return (
                        <tr key={dest} style={{ borderBottom: "1px solid #1A202C" }}>
                          <td style={{ padding: "8px 12px", fontWeight: 700, color: "#E2E8F0", fontFamily: "monospace", background: "#0F141D" }}>{dest}</td>
                          {ROUTING_CONFIG[routingDomain].sources.map((src, colIdx) => {
                            const patched = activeCol === colIdx;
                            return (
                              <td key={src} style={{ textAlign: "center", padding: 6, borderLeft: "1px solid #1E2533" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRoutingSelections((prev) => ({
                                      ...prev,
                                      [routingDomain]: { ...prev[routingDomain], [rowIdx]: colIdx },
                                    }));
                                    emitOsc(`${ROUTING_CONFIG[routingDomain].oscBase}/${dest.replace(/\s+/g, "_")}`, src);
                                  }}
                                  style={{ width: 28, height: 24, borderRadius: 5, cursor: "pointer", background: patched ? "#065F46" : "#161B24", border: `1px solid ${patched ? "#10B981" : "#283344"}`, color: patched ? "#34D399" : "#475569", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                >
                                  {patched ? <Check size={14} /> : "·"}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* StageBox-A/B & Clock Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px",
          background: "#080B10",
          borderTop: "1px solid #1E2533",
          fontSize: 10.5,
          color: "#94A3B8",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span><strong style={{ color: "#34D399" }}>StageBox-A:</strong> Connected (48ch @ 48kHz)</span>
          <span><strong style={{ color: "#34D399" }}>StageBox-B:</strong> Link Ready</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#64748B", fontWeight: 700 }}>Clock:</span>
          {(["48kHz Internal", "StageBox", "Card"] as const).map((src) => {
            const active = clockSource === src;
            return (
              <button
                key={src}
                type="button"
                onClick={() => {
                  setClockSource(src);
                  emitOsc("/config/sync", src === "48kHz Internal" ? 0 : src === "StageBox" ? 1 : 2);
                }}
                style={{
                  height: 20,
                  padding: "0 8px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: active ? "#065F46" : "#161B24",
                  border: `1px solid ${active ? "#10B981" : "#283344"}`,
                  color: active ? "#D1FAE5" : "#94A3B8",
                }}
              >
                {src}
              </button>
            );
          })}
        </div>
      
      {/* 8-Slot Virtual Stereo FX Rack Modal */}
      <ConsoleFxRackModal
        isOpen={fxRackOpen}
        onClose={() => setFxRackOpen(false)}
        onEmitOsc={emitOsc}
      />
</div>
    </div>
  );

  if (embedded) return consoleFrame;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(8, 11, 16, 0.88)",
        backdropFilter: "blur(6px)",
        zIndex: 10020,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
    >
      {consoleFrame}
    </div>
  );
};

export default ConsoleFullMixerModal;
