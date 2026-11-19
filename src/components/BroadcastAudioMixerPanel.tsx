import React, { useEffect, useMemo, useState } from "react";
import {
  Volume2,
  VolumeX,
  SlidersHorizontal,
  Sliders,
  Mic,
  Headphones,
  Radio,
  Film,
  Globe,
  Video,
  EyeOff,
  Eye,
  X,
  RotateCcw,
} from "lucide-react";
import type { SceneSourceItem, SourceType } from "../types";

export interface BroadcastAudioMixerPanelProps {
  sources: SceneSourceItem[];
  onToggleMute: (id: string) => void;
  onVolumeChange: (id: string, db: number) => void;
  onOpenFilters: (source: SceneSourceItem) => void;
  onUpdateTrackRouting: (id: string, tracks: boolean[]) => void;
  onUpdateSyncOffset: (id: string, offsetMs: number) => void;
}

type AudioMonitoringMode = "monitor_off" | "monitor_only" | "monitor_and_output";

interface DspChainNodes {
  sourceId?: string;
  ctx: AudioContext;
  hpf: BiquadFilterNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  delay: DelayNode;
  gainNode: GainNode;
  monitoringConnected: boolean;
}

const AUDIO_CAPABLE_TYPES: ReadonlySet<SourceType> = new Set<SourceType>([
  "audio_input_capture",
  "audio_output_capture",
  "app_audio_capture",
  "media",
  "browser",
  "video_capture_device",
]);

const TRACK_LABELS = [
  { index: 0, short: "1", name: "Track 1 (Master / Live Stream)" },
  { index: 1, short: "2", name: "Track 2 (Local Recording)" },
  { index: 2, short: "3", name: "Track 3 (VOD / Clean Speech)" },
  { index: 3, short: "4", name: "Track 4 (Stage / Lobby Feed)" },
  { index: 4, short: "5", name: "Track 5 (Multitrack ISO A)" },
  { index: 5, short: "6", name: "Track 6 (Multitrack ISO B)" },
];

function isAudioCapableSource(source: SceneSourceItem): boolean {
  return (
    AUDIO_CAPABLE_TYPES.has(source.type) ||
    typeof source.volumeDb === "number" ||
    typeof source.muted === "boolean"
  );
}

function clampDb(db: number | undefined): number {
  if (typeof db !== "number" || Number.isNaN(db)) return 0;
  return Math.max(-60, Math.min(0, db));
}

function normalizeMonitoringMode(raw: unknown): AudioMonitoringMode {
  if (raw === "monitor_only" || raw === "Monitor Only") return "monitor_only";
  if (raw === "monitor_and_output" || raw === "Monitor & Output") return "monitor_and_output";
  return "monitor_off";
}

function getSourceAsyncDelayMs(source?: SceneSourceItem): number {
  const flt = source?.filters?.find((f) => f.type === "async_delay" && f.enabled);
  const val = flt?.settings?.delayMs;
  return typeof val === "number" && !Number.isNaN(val) ? val : 0;
}

function setChainMonitoringConnected(chain: DspChainNodes, shouldMonitor: boolean): void {
  if (shouldMonitor && !chain.monitoringConnected) {
    chain.gainNode.connect(chain.ctx.destination);
    chain.monitoringConnected = true;
  } else if (!shouldMonitor && chain.monitoringConnected) {
    try {
      chain.gainNode.disconnect(chain.ctx.destination);
    } catch {
      // Ignore if destination node was already disconnected
    }
    chain.monitoringConnected = false;
  }
}

function getSourceTracks(
  source: SceneSourceItem,
  localOverrides: Record<string, boolean[]>
): boolean[] {
  const settingsTracks = source.settings?.tracks;
  const settingsAudioTracks = source.settings?.audioTracks;
  const raw = Array.isArray(settingsTracks)
    ? settingsTracks
    : Array.isArray(settingsAudioTracks)
    ? settingsAudioTracks
    : localOverrides[source.id];

  if (Array.isArray(raw)) {
    return [0, 1, 2, 3, 4, 5].map((i) => (typeof raw[i] === "boolean" ? raw[i] : true));
  }
  return [true, true, true, true, true, true];
}

function dbToMeterPercent(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db));
  return ((clamped + 60) / 60) * 100;
}

function renderSourceIcon(type: SourceType) {
  switch (type) {
    case "audio_input_capture":
      return <Mic size={14} color="#10B981" />;
    case "audio_output_capture":
      return <Headphones size={14} color="#34D399" />;
    case "app_audio_capture":
      return <Radio size={14} color="#2DD4BF" />;
    case "media":
      return <Film size={14} color="#38BDF8" />;
    case "browser":
      return <Globe size={14} color="#60A5FA" />;
    case "video_capture_device":
      return <Video size={14} color="#F87171" />;
    default:
      return <Volume2 size={14} color="#94A3B8" />;
  }
}

interface PeakMeterProps {
  active: boolean;
  muted: boolean;
  volumeDb: number;
  seedOffset: number;
  tick: number;
}

const PeakMeterBar: React.FC<PeakMeterProps> = ({
  active,
  muted,
  volumeDb,
  seedOffset,
  tick,
}) => {
  const [peakHoldPct, setPeakHoldPct] = useState(0);

  const liveLevelDb = useMemo(() => {
    if (!active || muted || volumeDb <= -60) return -60;
    const waveA = Math.sin((tick + seedOffset * 7) * 0.45) * 5.5;
    const waveB = Math.cos((tick * 1.7 + seedOffset * 13) * 0.31) * 4.0;
    const baseInputDb = -14 + waveA + waveB;
    return Math.max(-60, Math.min(0, baseInputDb + volumeDb * 0.65));
  }, [active, muted, volumeDb, seedOffset, tick]);

  const pct = dbToMeterPercent(liveLevelDb);
  const pctR = Math.max(0, Math.min(100, pct - (active && !muted ? (tick % 3 === 0 ? 2.5 : -1.2) : 0)));

  useEffect(() => {
    if (!active || muted || volumeDb <= -60) {
      setPeakHoldPct(0);
      return;
    }
    setPeakHoldPct((prev) => (pct >= prev ? pct : Math.max(0, prev - 2.2)));
  }, [pct, active, muted, volumeDb]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {[pct, pctR].map((channelPct, chIdx) => (
        <div
          key={chIdx}
          style={{
            position: "relative",
            height: 6,
            borderRadius: 3,
            background: "#090D14",
            border: "1px solid #1E2533",
            overflow: "hidden",
          }}
        >
          {/* Full gradient bar clipped by width */}
          <div
            style={{
              height: "100%",
              width: `${channelPct}%`,
              background:
                "linear-gradient(90deg, #10B981 0%, #10B981 64%, #F59E0B 78%, #EF4444 95%)",
              transition: "width 75ms linear",
            }}
          />
          {peakHoldPct > 2 && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `calc(${Math.min(99, peakHoldPct)}% - 2px)`,
                width: 2,
                background: peakHoldPct > 85 ? "#FCA5A5" : "#F8FAFC",
                opacity: 0.9,
              }}
            />
          )}
        </div>
      ))}
      <div
        className="mono"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "#475569",
          lineHeight: 1,
          marginTop: 1,
        }}
      >
        <span>-60</span>
        <span>-40</span>
        <span>-20</span>
        <span>-9</span>
        <span>0</span>
      </div>
    </div>
  );
};

export const BroadcastAudioMixerPanel: React.FC<BroadcastAudioMixerPanelProps> = ({
  sources,
  onToggleMute,
  onVolumeChange,
  onOpenFilters,
  onUpdateTrackRouting,
  onUpdateSyncOffset,
}) => {
  const [tick, setTick] = useState(0);
  const [showHiddenSources, setShowHiddenSources] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [liveAudioActive, setLiveAudioActive] = useState(false);
  const [liveMicDb, setLiveMicDb] = useState<number>(-60);
  const [liveSystemDb, setLiveSystemDb] = useState<number>(-60);
  const [dspHpfEnabled, setDspHpfEnabled] = useState(true);
  const [dspCompEnabled, setDspCompEnabled] = useState(true);
  const [dspEqOpen, setDspEqOpen] = useState(false);
  const [dspEqEnabled, setDspEqEnabled] = useState(true);
  const [dspEqLowDb, setDspEqLowDb] = useState(0);
  const [dspEqMidDb, setDspEqMidDb] = useState(0);
  const [dspEqHighDb, setDspEqHighDb] = useState(0);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const micStreamRef = React.useRef<MediaStream | null>(null);
  const sysStreamRef = React.useRef<MediaStream | null>(null);
  const micRafRef = React.useRef<number | null>(null);
  const sysRafRef = React.useRef<number | null>(null);
  const dspChainsRef = React.useRef<DspChainNodes[]>([]);

  const [viewMode, setViewMode] = useState<"mixer" | "matrix">("mixer");
  const [localTrackOverrides, setLocalTrackOverrides] = useState<Record<string, boolean[]>>({});
  const [localSyncOffsets, setLocalSyncOffsets] = useState<Record<string, number>>({});
  const [localMonoMap, setLocalMonoMap] = useState<Record<string, boolean>>({});
  const [localMonitoring, setLocalMonitoring] = useState<Record<string, AudioMonitoringMode>>({});

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => (t + 1) % 10000);
    }, 90);
    return () => {
      window.clearInterval(id);
      if (micRafRef.current !== null) {
        cancelAnimationFrame(micRafRef.current);
        micRafRef.current = null;
      }
      if (sysRafRef.current !== null) {
        cancelAnimationFrame(sysRafRef.current);
        sysRafRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (sysStreamRef.current) {
        sysStreamRef.current.getTracks().forEach((t) => t.stop());
        sysStreamRef.current = null;
      }
      for (const chain of dspChainsRef.current) {
        try {
          chain.gainNode.disconnect();
        } catch {}
      }
      dspChainsRef.current = [];
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  const allAudioSources = useMemo(
    () => sources.filter(isAudioCapableSource),
    [sources]
  );

  const hiddenCount = useMemo(
    () => allAudioSources.filter((s) => Boolean(s.hideInMixer)).length,
    [allAudioSources]
  );

  const visibleMixerSources = useMemo(
    () =>
      showHiddenSources
        ? allAudioSources
        : allAudioSources.filter((s) => !s.hideInMixer),
    [allAudioSources, showHiddenSources]
  );

  const getSourceEqGains = (source?: SceneSourceItem) => {
    if (!dspEqEnabled) {
      return { lowDb: 0, midDb: 0, highDb: 0 };
    }
    const eqFilter = source?.filters?.find((f) => f.type === "basic_eq" && f.enabled);
    const filterLow = typeof eqFilter?.settings?.lowDb === "number" ? eqFilter.settings.lowDb : 0;
    const filterMid = typeof eqFilter?.settings?.midDb === "number" ? eqFilter.settings.midDb : 0;
    const filterHigh = typeof eqFilter?.settings?.highDb === "number" ? eqFilter.settings.highDb : 0;
    return {
      lowDb: Math.max(-24, Math.min(24, filterLow + dspEqLowDb)),
      midDb: Math.max(-24, Math.min(24, filterMid + dspEqMidDb)),
      highDb: Math.max(-24, Math.min(24, filterHigh + dspEqHighDb)),
    };
  };

  const getSourceCompSettings = (source?: SceneSourceItem) => {
    if (!dspCompEnabled) {
      return { threshold: 0, ratio: 1, attack: 0.005, release: 0.15 };
    }
    const compFilter = source?.filters?.find((f) => f.type === "compressor" && f.enabled);
    const threshold = typeof compFilter?.settings?.thresholdDb === "number" ? compFilter.settings.thresholdDb : -18;
    const ratio = typeof compFilter?.settings?.ratio === "number" ? Math.max(1, Math.min(20, compFilter.settings.ratio)) : 4;
    const attack = typeof compFilter?.settings?.attackMs === "number" ? Math.max(0, Math.min(1, compFilter.settings.attackMs / 1000)) : 0.005;
    const release = typeof compFilter?.settings?.releaseMs === "number" ? Math.max(0.01, Math.min(1, compFilter.settings.releaseMs / 1000)) : 0.15;
    return { threshold, ratio, attack, release };
  };

  const getSourceDelaySec = (sourceId?: string, source?: SceneSourceItem): number => {
    const syncMs =
      (sourceId ? localSyncOffsets[sourceId] : undefined) ??
      (typeof source?.settings?.syncOffsetMs === "number" ? source.settings.syncOffsetMs : 0);
    const asyncFilterMs = getSourceAsyncDelayMs(source);
    const totalMs = Math.max(0, Math.min(5000, syncMs + asyncFilterMs));
    return totalMs / 1000;
  };

  const getSourceLinearGain = (source?: SceneSourceItem): number => {
    if (!source) return 1.0;
    if (source.muted) return 0;
    const faderDb = clampDb(source.volumeDb);
    const gainFilter = source.filters?.find((f) => f.type === "gain" && f.enabled);
    const filterDb = typeof gainFilter?.settings?.db === "number" ? gainFilter.settings.db : 0;
    const totalDb = faderDb + filterDb;
    let linear = faderDb <= -60 ? 0 : Math.pow(10, totalDb / 20);
    const inverted = source.filters?.some((f) => f.type === "invert_polarity" && f.enabled);
    if (inverted) linear *= -1;
    return linear;
  };

  const getSourceMonitoring = (source: SceneSourceItem): AudioMonitoringMode =>
    localMonitoring[source.id] ?? normalizeMonitoringMode(source.settings?.monitoring);

  useEffect(() => {
    const hpfFreq = dspHpfEnabled ? 80 : 10;
    for (const chain of dspChainsRef.current) {
      if (chain.ctx.state === "closed") continue;
      const now = chain.ctx.currentTime;
      const targetSource = chain.sourceId
        ? sources.find((s) => s.id === chain.sourceId)
        : allAudioSources.find((s) => s.type === "audio_input_capture") ?? allAudioSources[0];
      const effectiveId = chain.sourceId ?? targetSource?.id;

      chain.hpf.frequency.setTargetAtTime(hpfFreq, now, 0.01);

      const eqGains = getSourceEqGains(targetSource);
      chain.eqLow.gain.setTargetAtTime(eqGains.lowDb, now, 0.01);
      chain.eqMid.gain.setTargetAtTime(eqGains.midDb, now, 0.01);
      chain.eqHigh.gain.setTargetAtTime(eqGains.highDb, now, 0.01);

      const compCfg = getSourceCompSettings(targetSource);
      chain.comp.threshold.setTargetAtTime(compCfg.threshold, now, 0.01);
      chain.comp.ratio.setTargetAtTime(compCfg.ratio, now, 0.01);
      chain.comp.attack.setTargetAtTime(compCfg.attack, now, 0.01);
      chain.comp.release.setTargetAtTime(compCfg.release, now, 0.01);

      const delaySec = getSourceDelaySec(effectiveId, targetSource);
      chain.delay.delayTime.setTargetAtTime(delaySec, now, 0.01);

      const linearGain = getSourceLinearGain(targetSource);
      chain.gainNode.gain.setTargetAtTime(linearGain, now, 0.01);

      const monitoring: AudioMonitoringMode = effectiveId
        ? localMonitoring[effectiveId] ?? normalizeMonitoringMode(targetSource?.settings?.monitoring)
        : "monitor_off";
      setChainMonitoringConnected(
        chain,
        monitoring === "monitor_only" || monitoring === "monitor_and_output"
      );
    }
  }, [
    sources,
    allAudioSources,
    dspHpfEnabled,
    dspCompEnabled,
    dspEqEnabled,
    dspEqLowDb,
    dspEqMidDb,
    dspEqHighDb,
    localSyncOffsets,
    localMonitoring,
  ]);

  const connectWithDspChain = (
    ctx: AudioContext,
    src: MediaStreamAudioSourceNode,
    analyser: AnalyserNode,
    sourceId?: string
  ) => {
    const matchedSource = sourceId
      ? sources.find((s) => s.id === sourceId)
      : allAudioSources.find((s) => s.type === "audio_input_capture") ?? allAudioSources[0];
    const effectiveId = sourceId ?? matchedSource?.id;

    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = dspHpfEnabled ? 80 : 10;

    // 3-Band EQ (Lowshelf 120Hz, Peaking 1kHz, Highshelf 6kHz)
    const eqGains = getSourceEqGains(matchedSource);
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = "lowshelf";
    eqLow.frequency.value = 120;
    eqLow.gain.value = eqGains.lowDb;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = "peaking";
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1.0;
    eqMid.gain.value = eqGains.midDb;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = "highshelf";
    eqHigh.frequency.value = 6000;
    eqHigh.gain.value = eqGains.highDb;

    const compCfg = getSourceCompSettings(matchedSource);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = compCfg.threshold;
    comp.ratio.value = compCfg.ratio;
    comp.attack.value = compCfg.attack;
    comp.release.value = compCfg.release;

    // Sync Offset DelayNode (supports up to 5000 ms)
    const delay = ctx.createDelay(5.0);
    delay.delayTime.value = getSourceDelaySec(effectiveId, matchedSource);

    const gainNode = ctx.createGain();
    gainNode.gain.value = getSourceLinearGain(matchedSource);

    src.connect(hpf);
    hpf.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(comp);
    comp.connect(delay);
    delay.connect(gainNode);
    gainNode.connect(analyser);

    const monitoring: AudioMonitoringMode = effectiveId
      ? localMonitoring[effectiveId] ?? normalizeMonitoringMode(matchedSource?.settings?.monitoring)
      : "monitor_off";

    const chain: DspChainNodes = {
      sourceId,
      ctx,
      hpf,
      eqLow,
      eqMid,
      eqHigh,
      comp,
      delay,
      gainNode,
      monitoringConnected: false,
    };

    if (monitoring === "monitor_only" || monitoring === "monitor_and_output") {
      gainNode.connect(ctx.destination);
      chain.monitoringConnected = true;
    }

    dspChainsRef.current.push(chain);
  };

  const enableLivePcMicCapture = async (targetSourceId?: string) => {
    try {
      if (micRafRef.current !== null) {
        cancelAnimationFrame(micRafRef.current);
        micRafRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      const ctx = audioCtxRef.current || new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const matchedMic = targetSourceId
        ? sources.find((s) => s.id === targetSourceId)
        : allAudioSources.find((s) => s.type === "audio_input_capture") ?? allAudioSources[0];
      connectWithDspChain(ctx, src, analyser, matchedMic?.id);
      const buf = new Float32Array(analyser.fftSize);
      setLiveAudioActive(true);

      const poll = () => {
        if (micStreamRef.current !== stream) return;
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const abs = Math.abs(buf[i]);
          if (abs > peak) peak = abs;
        }
        const db = peak > 0.0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(peak))) : -60;
        setLiveMicDb(db);
        micRafRef.current = requestAnimationFrame(poll);
      };
      micRafRef.current = requestAnimationFrame(poll);
    } catch {}
  };

  const enableLiveSystemAudioCapture = async (targetSourceId?: string) => {
    try {
      if (sysRafRef.current !== null) {
        cancelAnimationFrame(sysRafRef.current);
        sysRafRef.current = null;
      }
      if (sysStreamRef.current) {
        sysStreamRef.current.getTracks().forEach((t) => t.stop());
        sysStreamRef.current = null;
      }
      const ctx = audioCtxRef.current || new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      // Stop unused video capture tracks immediately; we only meter/process system audio.
      stream.getVideoTracks().forEach((t) => t.stop());
      sysStreamRef.current = stream;
      if (stream.getAudioTracks().length > 0) {
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        const matchedSys = targetSourceId
          ? sources.find((s) => s.id === targetSourceId)
          : allAudioSources.find(
              (s) => s.type === "audio_output_capture" || s.type === "app_audio_capture"
            ) ?? allAudioSources[0];
        connectWithDspChain(ctx, src, analyser, matchedSys?.id);
        const buf = new Float32Array(analyser.fftSize);
        const poll = () => {
          if (sysStreamRef.current !== stream) return;
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const abs = Math.abs(buf[i]);
            if (abs > peak) peak = abs;
          }
          const db = peak > 0.0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(peak))) : -60;
          setLiveSystemDb(db);
          sysRafRef.current = requestAnimationFrame(poll);
        };
        sysRafRef.current = requestAnimationFrame(poll);
      }
      setLiveAudioActive(true);
    } catch {}
  };

  const handleTrackToggle = (source: SceneSourceItem, trackIndex: number) => {
    const current = getSourceTracks(source, localTrackOverrides);
    const next = current.map((val, idx) => (idx === trackIndex ? !val : val));
    setLocalTrackOverrides((prev) => ({ ...prev, [source.id]: next }));
    onUpdateTrackRouting(source.id, next);
  };

  const handleSyncOffsetChange = (source: SceneSourceItem, rawMs: number) => {
    const nextMs = Math.max(-950, Math.min(5000, Number.isFinite(rawMs) ? Math.round(rawMs) : 0));
    setLocalSyncOffsets((prev) => ({ ...prev, [source.id]: nextMs }));
    onUpdateSyncOffset(source.id, nextMs);
    const asyncFilterMs = getSourceAsyncDelayMs(source);
    const delaySec = Math.max(0, Math.min(5, (nextMs + asyncFilterMs) / 1000));
    for (const chain of dspChainsRef.current) {
      if (chain.ctx.state === "closed") continue;
      if (!chain.sourceId || chain.sourceId === source.id) {
        chain.delay.delayTime.setTargetAtTime(delaySec, chain.ctx.currentTime, 0.01);
      }
    }
  };

  return (
    <div
      style={{
        background: "#0D1117",
        border: "1px solid #1E2533",
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
        color: "#E2E8F0",
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Volume2 size={16} color="#10B981" />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#CBD5E1",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Broadcast Audio Mixer & Track Matrix
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              padding: "2px 7px",
              borderRadius: 999,
              background: "#161B24",
              border: "1px solid #283344",
              color: "#94A3B8",
            }}
          >
            {visibleMixerSources.length} active
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {/* Inline View Toggle */}
          <div
            style={{
              display: "flex",
              background: "#090D14",
              border: "1px solid #252C38",
              borderRadius: 7,
              padding: 2,
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("mixer")}
              style={{
                padding: "4px 9px",
                borderRadius: 5,
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                background: viewMode === "mixer" ? "#1E293B" : "transparent",
                color: viewMode === "mixer" ? "#93C5FD" : "#64748B",
              }}
            >
              Mixer Strips
            </button>
            <button
              type="button"
              onClick={() => setViewMode("matrix")}
              style={{
                padding: "4px 9px",
                borderRadius: 5,
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                background: viewMode === "matrix" ? "#1E293B" : "transparent",
                color: viewMode === "matrix" ? "#93C5FD" : "#64748B",
              }}
            >
              Routing Table
            </button>
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHiddenSources((s) => !s)}
              title="Toggle hidden mixer sources"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                height: 28,
                padding: "0 9px",
                background: showHiddenSources ? "rgba(59, 130, 246, 0.16)" : "#161B24",
                border: `1px solid ${showHiddenSources ? "#3B82F6" : "#283344"}`,
                borderRadius: 6,
                color: showHiddenSources ? "#93C5FD" : "#94A3B8",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {showHiddenSources ? <Eye size={13} /> : <EyeOff size={13} />}
              {hiddenCount} Hidden
            </button>
          )}

          <button
            type="button"
            onClick={() => void enableLivePcMicCapture()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              height: 28,
              padding: "0 10px",
              background: liveAudioActive ? "rgba(16, 185, 129, 0.16)" : "#161B24",
              border: `1px solid ${liveAudioActive ? "#10B981" : "#283344"}`,
              borderRadius: 6,
              color: liveAudioActive ? "#6EE7B7" : "#94A3B8",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Mic size={13} /> {liveAudioActive ? "PC Mic Armed" : "Arm PC Mic Capture"}
          </button>

          <button
            type="button"
            onClick={() => setDspHpfEnabled((v) => !v)}
            title="Toggle 80Hz High-Pass Filter DSP"
            style={{
              height: 24,
              padding: "0 8px",
              borderRadius: 999,
              border: `1px solid ${dspHpfEnabled ? "#3B82F6" : "#283344"}`,
              background: dspHpfEnabled ? "rgba(59, 130, 246, 0.18)" : "#161B24",
              color: dspHpfEnabled ? "#93C5FD" : "#64748B",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            HPF 80Hz
          </button>

          <button
            type="button"
            onClick={() => setDspEqOpen((v) => !v)}
            title="Toggle 3-Band EQ DSP Controls (120Hz / 1kHz / 6kHz)"
            style={{
              height: 24,
              padding: "0 8px",
              borderRadius: 999,
              border: `1px solid ${dspEqOpen || dspEqLowDb !== 0 || dspEqMidDb !== 0 || dspEqHighDb !== 0 ? "#8B5CF6" : "#283344"}`,
              background: dspEqOpen ? "rgba(139, 92, 246, 0.2)" : "#161B24",
              color: dspEqOpen ? "#DDD6FE" : "#94A3B8",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            3-Band EQ
          </button>

          <button
            type="button"
            onClick={() => setDspCompEnabled((v) => !v)}
            title="Toggle Broadcast Compressor/Limiter DSP"
            style={{
              height: 24,
              padding: "0 8px",
              borderRadius: 999,
              border: `1px solid ${dspCompEnabled ? "#10B981" : "#283344"}`,
              background: dspCompEnabled ? "rgba(16, 185, 129, 0.18)" : "#161B24",
              color: dspCompEnabled ? "#6EE7B7" : "#64748B",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Comp {dspCompEnabled ? "ON" : "OFF"}
          </button>

          <button
            type="button"
            onClick={() => setShowAdvancedModal(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              height: 28,
              padding: "0 10px",
              background: "#1C222D",
              border: "1px solid #2E3748",
              borderRadius: 6,
              color: "#E2E8F0",
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Sliders size={13} color="#60A5FA" /> Advanced Audio Properties
          </button>
        </div>
      </div>

      {/* Collapsible Live 3-Band EQ Trim Bar */}
      {dspEqOpen && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            padding: "8px 12px",
            background: "#121721",
            border: "1px solid #283344",
            borderRadius: 8,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setDspEqEnabled((v) => !v)}
            style={{
              height: 24,
              padding: "0 8px",
              borderRadius: 5,
              border: `1px solid ${dspEqEnabled ? "#8B5CF6" : "#283344"}`,
              background: dspEqEnabled ? "rgba(139, 92, 246, 0.18)" : "#161B24",
              color: dspEqEnabled ? "#DDD6FE" : "#64748B",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            EQ {dspEqEnabled ? "ON" : "BYPASS"}
          </button>

          {[
            { label: "Low 120Hz", value: dspEqLowDb, set: setDspEqLowDb },
            { label: "Mid 1kHz", value: dspEqMidDb, set: setDspEqMidDb },
            { label: "High 6kHz", value: dspEqHighDb, set: setDspEqHighDb },
          ].map((band) => (
            <div key={band.label} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 150 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", minWidth: 64 }}>
                {band.label}
              </span>
              <input
                type="range"
                min={-15}
                max={15}
                step={0.5}
                value={band.value}
                aria-label={`DSP ${band.label}`}
                onChange={(e) => band.set(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#8B5CF6", cursor: "pointer" }}
              />
              <span className="mono" style={{ fontSize: 10.5, color: "#DDD6FE", minWidth: 46, textAlign: "right" }}>
                {band.value > 0 ? `+${band.value.toFixed(1)}` : band.value.toFixed(1)} dB
              </span>
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              setDspEqLowDb(0);
              setDspEqMidDb(0);
              setDspEqHighDb(0);
            }}
            style={{
              height: 24,
              padding: "0 8px",
              borderRadius: 5,
              border: "1px solid #283344",
              background: "#161B24",
              color: "#94A3B8",
              fontSize: 10.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Flat
          </button>
        </div>
      )}

      {/* Empty State */}
      {visibleMixerSources.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "#64748B",
            fontSize: 12.5,
            background: "#121721",
            border: "1px dashed #252C38",
            borderRadius: 8,
          }}
        >
          No audio-capable sources visible in mixer.
          {hiddenCount > 0 && !showHiddenSources && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setShowHiddenSources(true)}
                style={{
                  padding: "4px 10px",
                  background: "#1E293B",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  color: "#93C5FD",
                  fontSize: 11.5,
                  cursor: "pointer",
                }}
              >
                Show {hiddenCount} hidden source{hiddenCount > 1 ? "s" : ""}
              </button>
            </div>
          )}
        </div>
      ) : viewMode === "mixer" ? (
        /* MIXER CHANNEL STRIPS VIEW */
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 0,
            overflowY: "auto",
            paddingRight: 2,
          }}
        >
          {visibleMixerSources.map((source, idx) => {
            const db = clampDb(source.volumeDb);
            const muted = Boolean(source.muted);
            const tracks = getSourceTracks(source, localTrackOverrides);
            const filterCount = source.filters?.length ?? 0;
            const monitoring = getSourceMonitoring(source);

            return (
              <div
                key={source.id}
                style={{
                  background: "#121721",
                  border: `1px solid ${muted ? "#3F2329" : "#1E2533"}`,
                  borderLeft: source.colorTag
                    ? `4px solid ${source.colorTag}`
                    : `3px solid ${source.enabled && !muted ? "#10B981" : "#334155"}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  opacity: source.enabled ? 1 : 0.68,
                }}
              >
                {/* Row 1: Source Name + dB Readout + Action Buttons */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    {renderSourceIcon(source.type)}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: muted ? "#94A3B8" : "#F8FAFC",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {source.name}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748B", textTransform: "uppercase" }}>
                        {source.type.replace(/_/g, " ")}
                        {!source.enabled && " • Inactive"}
                        {source.hideInMixer && " • Hidden"}
                      </div>
                    </div>
                  </div>

                  {/* dB Numeric + Reset + Filters + Monitoring + Mute */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      title="Double-click or click to reset fader to 0.0 dB"
                      onClick={() => onVolumeChange(source.id, 0)}
                      className="mono"
                      style={{
                        minWidth: 68,
                        height: 28,
                        padding: "0 8px",
                        borderRadius: 6,
                        background: "#090D14",
                        border: "1px solid #252C38",
                        color: muted ? "#F87171" : db === 0 ? "#34D399" : "#E2E8F0",
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        textAlign: "right",
                      }}
                    >
                      {muted ? "MUTED" : db <= -60 ? "-∞ dB" : `${db.toFixed(1)} dB`}
                    </button>

                    <button
                      type="button"
                      title="VST / AU Audio Filters"
                      onClick={() => onOpenFilters(source)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        height: 28,
                        padding: "0 8px",
                        borderRadius: 6,
                        background:
                          filterCount > 0 ? "rgba(168, 85, 247, 0.16)" : "#161B24",
                        border: `1px solid ${filterCount > 0 ? "#A855F7" : "#283344"}`,
                        color: filterCount > 0 ? "#D8B4FE" : "#94A3B8",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <SlidersHorizontal size={12} />
                      <span>Filters{filterCount > 0 ? ` (${filterCount})` : ""}</span>
                    </button>

                    <select
                      aria-label={`${source.name} audio monitoring`}
                      title="Audio Monitoring"
                      value={monitoring}
                      onChange={(e) => {
                        const mode = e.target.value as AudioMonitoringMode;
                        setLocalMonitoring((prev) => ({ ...prev, [source.id]: mode }));
                        const shouldMonitor =
                          mode === "monitor_only" || mode === "monitor_and_output";
                        if (shouldMonitor && audioCtxRef.current?.state === "suspended") {
                          void audioCtxRef.current.resume();
                        }
                        for (const chain of dspChainsRef.current) {
                          if (chain.ctx.state === "closed") continue;
                          if (!chain.sourceId || chain.sourceId === source.id) {
                            setChainMonitoringConnected(chain, shouldMonitor);
                          }
                        }
                      }}
                      style={{
                        height: 28,
                        padding: "0 6px",
                        borderRadius: 6,
                        background:
                          monitoring !== "monitor_off" ? "rgba(59, 130, 246, 0.16)" : "#161B24",
                        border: `1px solid ${monitoring !== "monitor_off" ? "#3B82F6" : "#283344"}`,
                        color: monitoring !== "monitor_off" ? "#93C5FD" : "#CBD5E1",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <option value="monitor_off">Monitor Off</option>
                      <option value="monitor_only">Monitor Only</option>
                      <option value="monitor_and_output">Monitor & Output</option>
                    </select>

                    <button
                      type="button"
                      title={muted ? "Unmute source" : "Mute source"}
                      aria-label={muted ? `Unmute ${source.name}` : `Mute ${source.name}`}
                      onClick={() => onToggleMute(source.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 30,
                        height: 28,
                        borderRadius: 6,
                        background: muted ? "#7F1D1D" : "#161B24",
                        border: `1px solid ${muted ? "#EF4444" : "#283344"}`,
                        color: muted ? "#FCA5A5" : "#E2E8F0",
                        cursor: "pointer",
                      }}
                    >
                      {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                  </div>
                </div>

                {/* Row 2: Peak Meter + dB Fader */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center" }}>
                  <PeakMeterBar
                    active={source.enabled}
                    muted={muted}
                    volumeDb={db}
                    seedOffset={idx + 1}
                    tick={tick}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="range"
                      min={-60}
                      max={0}
                      step={0.5}
                      value={db}
                      aria-label={`${source.name} volume in dB`}
                      onChange={(e) => onVolumeChange(source.id, Number(e.target.value))}
                      style={{
                        width: "100%",
                        accentColor: muted ? "#EF4444" : "#10B981",
                        cursor: "pointer",
                      }}
                    />
                  </div>
                </div>

                {/* Row 3: Sync Offset + Broadcast Tracks 1-6 Routing */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 8,
                    paddingTop: 4,
                    borderTop: "1px solid #1A2130",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <label style={{ fontSize: 10.5, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>
                      Sync Offset
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        value={
                          localSyncOffsets[source.id] ??
                          (typeof source.settings?.syncOffsetMs === "number"
                            ? source.settings.syncOffsetMs
                            : 0)
                        }
                        step={10}
                        min={-950}
                        max={5000}
                        aria-label={`${source.name} sync offset milliseconds`}
                        onChange={(e) => handleSyncOffsetChange(source, Number(e.target.value))}
                        style={{
                          width: 72,
                          height: 26,
                          padding: "0 6px",
                          background: "#090D14",
                          border: "1px solid #283344",
                          borderRadius: 5,
                          color: "#E2E8F0",
                          fontSize: 11.5,
                        }}
                      />
                      <span style={{ fontSize: 11, color: "#64748B" }}>ms</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>
                      Tracks
                    </span>
                    {TRACK_LABELS.map((tr) => {
                      const checked = tracks[tr.index];
                      return (
                        <label
                          key={tr.index}
                          title={tr.name}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 7px",
                            borderRadius: 5,
                            border: `1px solid ${checked ? "#2563EB" : "#252C38"}`,
                            background: checked ? "rgba(37, 99, 235, 0.2)" : "#090D14",
                            color: checked ? "#BFDBFE" : "#64748B",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            userSelect: "none",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleTrackToggle(source, tr.index)}
                            style={{ margin: 0, accentColor: "#3B82F6", cursor: "pointer" }}
                          />
                          <span>{tr.short}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* INLINE ADVANCED TRACK ROUTING MATRIX TABLE */
        <div style={{ overflowX: "auto", overflowY: "auto", minHeight: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1E2533", color: "#94A3B8", textAlign: "left" }}>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Volume (dB)</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Tracks 1–6</th>
                <th style={{ ...thStyle, textAlign: "right" }}>VST/AU</th>
              </tr>
            </thead>
            <tbody>
              {visibleMixerSources.map((source) => {
                const db = clampDb(source.volumeDb);
                const muted = Boolean(source.muted);
                const tracks = getSourceTracks(source, localTrackOverrides);
                const filterCount = source.filters?.length ?? 0;
                return (
                  <tr key={source.id} style={{ borderBottom: "1px solid #161D29" }}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {renderSourceIcon(source.type)}
                        <span style={{ fontWeight: 600, color: "#F8FAFC" }}>{source.name}</span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => onToggleMute(source.id)}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: `1px solid ${muted ? "#EF4444" : "#10B981"}`,
                          background: muted ? "rgba(239,68,68,0.16)" : "rgba(16,185,129,0.14)",
                          color: muted ? "#FCA5A5" : "#6EE7B7",
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {muted ? "MUTED" : "LIVE"}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="range"
                          min={-60}
                          max={0}
                          step={0.5}
                          value={db}
                          onChange={(e) => onVolumeChange(source.id, Number(e.target.value))}
                          style={{ width: 90, accentColor: "#10B981" }}
                        />
                        <span className="mono" style={{ fontSize: 11, minWidth: 50 }}>
                          {db.toFixed(1)} dB
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        {TRACK_LABELS.map((tr) => (
                          <label
                            key={tr.index}
                            title={tr.name}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 2,
                              fontSize: 11,
                              color: tracks[tr.index] ? "#93C5FD" : "#64748B",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={tracks[tr.index]}
                              onChange={() => handleTrackToggle(source, tr.index)}
                            />
                            {tr.short}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => onOpenFilters(source)}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: "1px solid #2E3748",
                          background: "#161B24",
                          color: filterCount > 0 ? "#D8B4FE" : "#CBD5E1",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        Filters ({filterCount})
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Broadcast Advanced Audio Properties Modal */}
      {showAdvancedModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(8, 11, 16, 0.85)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10002,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 980,
              maxHeight: "88vh",
              background: "#121721",
              border: "1px solid #2E3748",
              borderRadius: 14,
              padding: 22,
              color: "#E2E8F0",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              boxShadow: "0 24px 60px rgba(0, 0, 0, 0.72)",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "rgba(16, 185, 129, 0.16)",
                    border: "1px solid rgba(16, 185, 129, 0.36)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Sliders size={18} color="#34D399" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#FFFFFF" }}>
                    Advanced Audio Properties (Broadcast Tracks 1–6)
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94A3B8" }}>
                    Configure per-source gain, mute, sync offset delay, VST/AU filter chains, and Track 1–6 routing.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvancedModal(false)}
                aria-label="Close Advanced Audio Properties"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94A3B8",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Scrollable Properties Matrix */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                background: "#0D1117",
                border: "1px solid #1E2533",
                borderRadius: 10,
                padding: 10,
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #252C38", color: "#94A3B8", textAlign: "left" }}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Volume (-60..0 dB)</th>
                    <th style={thStyle}>Mono</th>
                    <th style={thStyle}>Sync Offset</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Tracks [1] [2] [3] [4] [5] [6]</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allAudioSources.map((source) => {
                    const db = clampDb(source.volumeDb);
                    const muted = Boolean(source.muted);
                    const tracks = getSourceTracks(source, localTrackOverrides);
                    const mono = Boolean(localMonoMap[source.id]);
                    const syncMs =
                      localSyncOffsets[source.id] ??
                      (typeof source.settings?.syncOffsetMs === "number"
                        ? source.settings.syncOffsetMs
                        : 0);
                    const filterCount = source.filters?.length ?? 0;

                    return (
                      <tr key={source.id} style={{ borderBottom: "1px solid #19202D" }}>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            {renderSourceIcon(source.type)}
                            <div>
                              <div style={{ fontWeight: 700, color: "#FFFFFF" }}>{source.name}</div>
                              <div style={{ fontSize: 10, color: "#64748B" }}>
                                {source.type.replace(/_/g, " ")}
                                {source.hideInMixer ? " • Hidden in Mixer" : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                              type="range"
                              min={-60}
                              max={0}
                              step={0.5}
                              value={db}
                              onChange={(e) => onVolumeChange(source.id, Number(e.target.value))}
                              style={{ width: 95, accentColor: "#10B981" }}
                            />
                            <span className="mono" style={{ fontSize: 11.5, minWidth: 54 }}>
                              {db.toFixed(1)} dB
                            </span>
                            <button
                              type="button"
                              title="Reset to 0 dB"
                              onClick={() => onVolumeChange(source.id, 0)}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#64748B",
                                cursor: "pointer",
                                padding: 2,
                              }}
                            >
                              <RotateCcw size={12} />
                            </button>
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={mono}
                            onChange={(e) =>
                              setLocalMonoMap((prev) => ({
                                ...prev,
                                [source.id]: e.target.checked,
                              }))
                            }
                            aria-label={`Downmix ${source.name} to Mono`}
                          />
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input
                              type="number"
                              value={syncMs}
                              step={10}
                              min={-950}
                              max={5000}
                              aria-label={`${source.name} sync offset ms`}
                              onChange={(e) => handleSyncOffsetChange(source, Number(e.target.value))}
                              style={{
                                width: 64,
                                height: 28,
                                padding: "0 6px",
                                background: "#090D14",
                                border: "1px solid #283344",
                                borderRadius: 5,
                                color: "#E2E8F0",
                                fontSize: 12,
                              }}
                            />
                            <span style={{ fontSize: 11, color: "#64748B" }}>ms</span>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <div style={{ display: "inline-flex", gap: 5 }}>
                            {TRACK_LABELS.map((tr) => {
                              const checked = tracks[tr.index];
                              return (
                                <label
                                  key={tr.index}
                                  title={tr.name}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    padding: "3px 6px",
                                    borderRadius: 5,
                                    border: `1px solid ${checked ? "#3B82F6" : "#252C38"}`,
                                    background: checked
                                      ? "rgba(59, 130, 246, 0.2)"
                                      : "#090D14",
                                    color: checked ? "#BFDBFE" : "#64748B",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleTrackToggle(source, tr.index)}
                                    style={{ margin: 0 }}
                                  />
                                  {tr.short}
                                </label>
                              );
                            })}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => onToggleMute(source.id)}
                              style={{
                                padding: "4px 9px",
                                borderRadius: 6,
                                border: `1px solid ${muted ? "#EF4444" : "#2E3748"}`,
                                background: muted ? "#7F1D1D" : "#161B24",
                                color: muted ? "#FCA5A5" : "#E2E8F0",
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {muted ? "Unmute" : "Mute"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowAdvancedModal(false);
                                onOpenFilters(source);
                              }}
                              style={{
                                padding: "4px 9px",
                                borderRadius: 6,
                                border: "1px solid #2E3748",
                                background: "#161B24",
                                color: filterCount > 0 ? "#D8B4FE" : "#93C5FD",
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              VST/AU ({filterCount})
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
                fontSize: 11.5,
                color: "#94A3B8",
              }}
            >
              <span>Tip: Route Track 1 to Live Stream, Track 2 to Recording, and Track 3 to Music-Free VOD.</span>
              <button
                type="button"
                onClick={() => setShowAdvancedModal(false)}
                style={{
                  padding: "7px 18px",
                  background: "#2563EB",
                  border: "1px solid #3B82F6",
                  borderRadius: 8,
                  color: "#FFFFFF",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tdStyle: React.CSSProperties = {
  padding: "9px 10px",
  verticalAlign: "middle",
};

export default BroadcastAudioMixerPanel;
