import React, { useEffect, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Keyboard,
  Monitor,
  Radio,
  RotateCcw,
  Settings,
  Sliders,
  X,
} from "lucide-react";
import type { BroadcastProfileSettings } from "../types";

export interface BroadcastSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: BroadcastProfileSettings;
  onSaveProfile: (p: BroadcastProfileSettings) => void;
  streamKey: string;
  rtmpUrl: string;
  onSaveStreamConfig: (url: string, key: string) => void;
  hotkeys: Record<string, string>;
  onSaveHotkeys: (hk: Record<string, string>) => void;
}

type BroadcastSettingsTab = "stream" | "output" | "video" | "hotkeys";

type OutputMode = "simple" | "advanced" | "custom_ffmpeg";

interface EncoderSettings {
  codec: string;
  rateControl: "CBR" | "VBR" | "CQP";
  bitrateKbps: number;
  keyframeIntervalSec: number;
  bFrames: number;
  audioTrackAssignment: boolean[];
}

interface OutputModeConfig {
  mode: OutputMode;
  stream: EncoderSettings;
  record: EncoderSettings;
  replay: EncoderSettings;
  customFfmpegArgs: string;
}

const OUTPUT_CONFIG_STORAGE_KEY = "onering_broadcast_output_mode_config";

const CODEC_OPTIONS = [
  { value: "h264_hardware_gpu", label: "H.264 (Hardware GPU)" },
  { value: "h264_hardware_media", label: "H.264 (Hardware Media)" },
  { value: "libx264", label: "H.264 (Software x264)" },
  { value: "hevc_hardware", label: "HEVC (Hardware)" },
  { value: "av1_hardware_gpu", label: "AV1 (Hardware GPU)" },
];

function defaultTrackAssignment(all = true): boolean[] {
  return [0, 1, 2, 3, 4, 5].map(() => all);
}

function defaultEncoderSettings(overrides?: Partial<EncoderSettings>): EncoderSettings {
  return {
    codec: "h264_hardware_gpu",
    rateControl: "CBR",
    bitrateKbps: 6000,
    keyframeIntervalSec: 2,
    bFrames: 2,
    audioTrackAssignment: defaultTrackAssignment(true),
    ...overrides,
  };
}

function defaultOutputConfig(profile?: BroadcastProfileSettings): OutputModeConfig {
  const baseBitrate = profile?.bitrateKbps ?? 6000;
  const baseKeyInt = profile?.keyframeIntervalSec ?? 2;
  const baseCodec = profile?.videoEncoder ?? "h264_hardware_gpu";
  const baseRc = profile?.rateControl ?? "CBR";
  return {
    mode: "simple",
    stream: defaultEncoderSettings({
      codec: baseCodec,
      rateControl: baseRc,
      bitrateKbps: baseBitrate,
      keyframeIntervalSec: baseKeyInt,
      bFrames: 2,
      audioTrackAssignment: [true, false, true, false, false, false],
    }),
    record: defaultEncoderSettings({
      codec: baseCodec,
      rateControl: "VBR",
      bitrateKbps: Math.max(baseBitrate, 12000),
      keyframeIntervalSec: baseKeyInt,
      bFrames: 2,
      audioTrackAssignment: [true, true, true, true, true, true],
    }),
    replay: defaultEncoderSettings({
      codec: baseCodec,
      rateControl: "VBR",
      bitrateKbps: Math.max(4500, Math.round(baseBitrate * 0.8)),
      keyframeIntervalSec: baseKeyInt,
      bFrames: 2,
      audioTrackAssignment: [true, true, false, false, false, false],
    }),
    customFfmpegArgs: "",
  };
}

function normalizeTrackAssignment(raw: unknown): boolean[] {
  if (!Array.isArray(raw)) return defaultTrackAssignment(true);
  return [0, 1, 2, 3, 4, 5].map((i) => (typeof raw[i] === "boolean" ? raw[i] : true));
}

function normalizeEncoderSettings(raw: any, fallback: EncoderSettings): EncoderSettings {
  if (!raw || typeof raw !== "object") return fallback;
  const rateControl =
    raw.rateControl === "CBR" || raw.rateControl === "VBR" || raw.rateControl === "CQP"
      ? raw.rateControl
      : fallback.rateControl;
  return {
    codec: typeof raw.codec === "string" && raw.codec ? raw.codec : fallback.codec,
    rateControl,
    bitrateKbps:
      typeof raw.bitrateKbps === "number" && Number.isFinite(raw.bitrateKbps)
        ? Math.max(500, Math.round(raw.bitrateKbps))
        : fallback.bitrateKbps,
    keyframeIntervalSec:
      typeof raw.keyframeIntervalSec === "number" && Number.isFinite(raw.keyframeIntervalSec)
        ? Math.max(0, Math.round(raw.keyframeIntervalSec))
        : fallback.keyframeIntervalSec,
    bFrames:
      typeof raw.bFrames === "number" && Number.isFinite(raw.bFrames)
        ? Math.max(0, Math.min(16, Math.round(raw.bFrames)))
        : fallback.bFrames,
    audioTrackAssignment: normalizeTrackAssignment(raw.audioTrackAssignment),
  };
}

function loadOutputConfig(profile?: BroadcastProfileSettings): OutputModeConfig {
  const defaults = defaultOutputConfig(profile);
  try {
    const raw = localStorage.getItem(OUTPUT_CONFIG_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults;
    const mode: OutputMode =
      parsed.mode === "simple" || parsed.mode === "advanced" || parsed.mode === "custom_ffmpeg"
        ? parsed.mode
        : defaults.mode;
    return {
      mode,
      stream: normalizeEncoderSettings(parsed.stream, defaults.stream),
      record: normalizeEncoderSettings(parsed.record, defaults.record),
      replay: normalizeEncoderSettings(parsed.replay, defaults.replay),
      customFfmpegArgs:
        typeof parsed.customFfmpegArgs === "string" ? parsed.customFfmpegArgs : defaults.customFfmpegArgs,
    };
  } catch {
    return defaults;
  }
}

function saveOutputConfig(config: OutputModeConfig) {
  try {
    localStorage.setItem(OUTPUT_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

type StreamServiceName =
  | "Video Platform - RTMPS"
  | "Social Platform Live"
  | "Streaming"
  | "WebRTC WHIP"
  | "Custom RTMP";

const STREAM_SERVICES: Array<{
  service: StreamServiceName;
  defaultUrl: string;
  description: string;
}> = [
  {
    service: "Video Platform - RTMPS",
    defaultUrl: "rtmps://ingest.example.com/live2",
    description: "Encrypted RTMPS ingest (TLS port 443) for Video Platform Live.",
  },
  {
    service: "Social Platform Live",
    defaultUrl: "rtmps://ingest.example.com:443/rtmp",
    description: "Secure Social Platform Live RTMPS streaming server.",
  },
  {
    service: "Streaming",
    defaultUrl: "rtmps://ingest.example.com/app",
    description: "Streaming primary RTMPS ingest endpoint.",
  },
  {
    service: "WebRTC WHIP",
    defaultUrl: "https://whip.example.com/whip",
    description: "Ultra-low latency WebRTC-HTTP Ingestion Protocol (WHIP).",
  },
  {
    service: "Custom RTMP",
    defaultUrl: "",
    description: "Custom RTMP, RTMPS, or SRT broadcast server URL.",
  },
];

const VIDEO_ENCODERS: Array<{
  value: BroadcastProfileSettings["videoEncoder"];
  label: string;
  hint: string;
}> = [
  { value: "h264_hardware_gpu", label: "h264_hardware_gpu — Hardware GPU H.264", hint: "Hardware GPU encode" },
  { value: "h264_hardware_media", label: "h264_hardware_media — Hardware Media H.264", hint: "Hardware-accelerated media engine" },
  { value: "libx264", label: "libx264 — Software x264", hint: "CPU software encode" },
  { value: "av1_hardware_gpu", label: "av1_hardware_gpu — Hardware GPU AV1", hint: "Next-generation AV1" },
];

const BASE_RESOLUTIONS = ["1920x1080", "2560x1440", "3840x2160", "1080x1920"];
const OUTPUT_RESOLUTIONS = [
  "1920x1080",
  "1280x720",
  "2560x1440",
  "3840x2160",
  "1080x1920",
  "720x1280",
];
const COMMON_FPS_VALUES = [60, 30, 24];
const AUDIO_BITRATE_OPTIONS: Array<BroadcastProfileSettings["audioBitrateKbps"]> = [
  128,
  160,
  192,
  320,
];
const RECORDING_FORMATS: Array<{
  value: BroadcastProfileSettings["recordingFormat"];
  label: string;
}> = [
  { value: "mkv", label: "Matroska Video (.mkv) — Crash-safe" },
  { value: "mp4", label: "MPEG-4 (.mp4)" },
  { value: "flv", label: "Flash Video (.flv)" },
];

export const DEFAULT_BROADCAST_HOTKEYS: Record<string, string> = {
  "Start/Stop Stream": "Ctrl+Shift+S",
  "Start/Stop Recording": "Ctrl+Shift+R",
  "Save Replay": "F9",
  "Studio Transition": "F8",
  "Mute Mic": "Ctrl+M",
};

const HOTKEY_ACTION_DEFS: Array<{
  id: string;
  label: string;
  description: string;
}> = [
  {
    id: "Start/Stop Stream",
    label: "Start/Stop Stream",
    description: "Toggle live broadcast stream output",
  },
  {
    id: "Start/Stop Recording",
    label: "Start/Stop Recording",
    description: "Pause or resume active local recording",
  },
  {
    id: "Save Replay",
    label: "Save Replay",
    description: "Write rolling Replay Buffer clip to disk",
  },
  {
    id: "Studio Transition",
    label: "Studio Transition",
    description: "Execute Preview → Program scene transition",
  },
  {
    id: "Mute Mic",
    label: "Mute Mic",
    description: "Toggle mute on primary microphone input",
  },
];

export interface KeyLikeEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export function formatHotkeyFromEvent(e: KeyLikeEvent): string | null {
  if (
    e.key === "Control" ||
    e.key === "Shift" ||
    e.key === "Alt" ||
    e.key === "Meta" ||
    e.key === "Dead" ||
    e.key === "Unidentified"
  ) {
    return null;
  }

  if (e.key === "Escape") {
    return null;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");

  let keyName = e.key;
  if (e.code && e.code.startsWith("Key")) {
    keyName = e.code.slice(3).toUpperCase();
  } else if (e.code && e.code.startsWith("Digit")) {
    keyName = e.code.slice(5);
  } else if (e.code === "Space" || e.key === " ") {
    keyName = "Space";
  } else if (/^F\d{1,2}$/i.test(e.key)) {
    keyName = e.key.toUpperCase();
  } else if (keyName.length === 1) {
    keyName = keyName.toUpperCase();
  }

  parts.push(keyName);
  return parts.join("+");
}

function inferServiceFromUrl(url: string): StreamServiceName {
  const lower = url.toLowerCase();
  if (lower.includes("video.example.com")) return "Video Platform - RTMPS";
  if (lower.includes("social.example.com")) return "Social Platform Live";
  if (lower.includes("stream.example.com")) return "Streaming";
  if (lower.includes("whip") || lower.startsWith("https://")) return "WebRTC WHIP";
  return "Custom RTMP";
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export const BroadcastSettingsModal: React.FC<BroadcastSettingsModalProps> = ({
  isOpen,
  onClose,
  profile,
  onSaveProfile,
  streamKey,
  rtmpUrl,
  onSaveStreamConfig,
  hotkeys,
  onSaveHotkeys,
}) => {
  const [activeTab, setActiveTab] = useState<BroadcastSettingsTab>("stream");
  const [draftProfile, setDraftProfile] = useState<BroadcastProfileSettings>({ ...profile });
  const [outputConfig, setOutputConfig] = useState<OutputModeConfig>(() => loadOutputConfig(profile));
  const [service, setService] = useState<StreamServiceName>(() => inferServiceFromUrl(rtmpUrl));
  const [draftRtmpUrl, setDraftRtmpUrl] = useState(rtmpUrl);
  const [draftStreamKey, setDraftStreamKey] = useState(streamKey);
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [draftHotkeys, setDraftHotkeys] = useState<Record<string, string>>({
    ...DEFAULT_BROADCAST_HOTKEYS,
    ...hotkeys,
  });
  const [capturingAction, setCapturingAction] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraftProfile({ ...profile });
    setOutputConfig(loadOutputConfig(profile));
    setService(inferServiceFromUrl(rtmpUrl));
    setDraftRtmpUrl(rtmpUrl);
    setDraftStreamKey(streamKey);
    setShowStreamKey(false);
    setDraftHotkeys({ ...DEFAULT_BROADCAST_HOTKEYS, ...hotkeys });
    setCapturingAction(null);
  }, [isOpen, profile, rtmpUrl, streamKey, hotkeys]);

  useEffect(() => {
    if (!isOpen) return;
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturingAction) {
        onClose();
      }
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [isOpen, capturingAction, onClose]);

  if (!isOpen) return null;

  const patchProfile = <K extends keyof BroadcastProfileSettings>(
    key: K,
    val: BroadcastProfileSettings[K]
  ) => {
    setDraftProfile((prev) => ({ ...prev, [key]: val }));
  };

  const patchEncoder = (
    target: "stream" | "record" | "replay",
    patch: Partial<EncoderSettings>
  ) => {
    setOutputConfig((prev) => ({
      ...prev,
      [target]: { ...prev[target], ...patch },
    }));
  };

  const toggleEncoderTrack = (
    target: "stream" | "record" | "replay",
    trackIndex: number
  ) => {
    setOutputConfig((prev) => {
      const current = prev[target].audioTrackAssignment;
      const nextTracks = current.map((v, i) => (i === trackIndex ? !v : v));
      return {
        ...prev,
        [target]: { ...prev[target], audioTrackAssignment: nextTracks },
      };
    });
  };

  const handleServiceChange = (nextService: StreamServiceName) => {
    setService(nextService);
    const preset = STREAM_SERVICES.find((s) => s.service === nextService);
    if (preset && preset.defaultUrl) {
      setDraftRtmpUrl(preset.defaultUrl);
    }
  };

  const handleSaveAll = () => {
    const sanitizedProfile: BroadcastProfileSettings = {
      ...draftProfile,
      name: draftProfile.name.trim() || "One Ring Broadcast Profile",
      bitrateKbps: clamp(Math.round(draftProfile.bitrateKbps), 2500, 25000),
      keyframeIntervalSec: clamp(Math.round(draftProfile.keyframeIntervalSec), 0, 10),
    };
    onSaveProfile(sanitizedProfile);
    onSaveStreamConfig(draftRtmpUrl.trim(), draftStreamKey);
    onSaveHotkeys(draftHotkeys);
    saveOutputConfig(outputConfig);
    onClose();
  };

  const handleHotkeyKeyDown = (actionId: string, e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      setCapturingAction(null);
      e.currentTarget.blur();
      return;
    }

    if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey) {
      setDraftHotkeys((prev) => ({ ...prev, [actionId]: "" }));
      setCapturingAction(null);
      e.currentTarget.blur();
      return;
    }

    const combo = formatHotkeyFromEvent(e);
    if (!combo) return;

    setDraftHotkeys((prev) => ({ ...prev, [actionId]: combo }));
    setCapturingAction(null);
    e.currentTarget.blur();
  };

  const selectedServiceMeta = STREAM_SERVICES.find((s) => s.service === service);

  const tabs: Array<{ id: BroadcastSettingsTab; label: string; icon: React.ReactNode }> = [
    { id: "stream", label: "Stream", icon: <Radio size={15} /> },
    { id: "output", label: "Output", icon: <Sliders size={15} /> },
    { id: "video", label: "Video", icon: <Monitor size={15} /> },
    { id: "hotkeys", label: "Hotkeys", icon: <Keyboard size={15} /> },
  ];

  const baseOptions = BASE_RESOLUTIONS.includes(draftProfile.baseResolution)
    ? BASE_RESOLUTIONS
    : [draftProfile.baseResolution, ...BASE_RESOLUTIONS];
  const outputOptions = OUTPUT_RESOLUTIONS.includes(draftProfile.outputResolution)
    ? OUTPUT_RESOLUTIONS
    : [draftProfile.outputResolution, ...OUTPUT_RESOLUTIONS];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Broadcast Settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(8, 11, 16, 0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10005,
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 780,
          maxHeight: "88vh",
          background: "#121721",
          border: "1px solid #3B82F6",
          borderRadius: 12,
          color: "#E2E8F0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 50px rgba(0,0,0,0.68)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid #1E2533",
            background: "#0F141D",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Settings size={20} color="#60A5FA" />
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#FFFFFF" }}>
                Broadcast Studio Settings
              </h3>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>
                Profile: {draftProfile.name || "Default"} • {draftProfile.baseResolution} @ {draftProfile.fps}fps
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Broadcast Settings"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94A3B8",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body: Left Tab Rail + Bounded Scrollable Content */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Tab Navigation */}
          <div
            role="tablist"
            aria-label="Broadcast Settings Sections"
            style={{
              width: 170,
              flexShrink: 0,
              background: "#0B0E14",
              borderRight: "1px solid #1E2533",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: active ? "1px solid #3B82F6" : "1px solid transparent",
                    background: active ? "#1E3A8A" : "transparent",
                    color: active ? "#FFFFFF" : "#94A3B8",
                    fontSize: 13,
                    fontWeight: active ? 700 : 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Scrollable Settings Pane */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {activeTab === "stream" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <h4 style={sectionTitleStyle}>Stream Destination</h4>
                  <p style={sectionDescStyle}>
                    Configure your primary broadcast service, ingest server URL, and stream key.
                  </p>
                </div>

                <div>
                  <label htmlFor="broadcast-stream-service" style={labelStyle}>
                    Service
                  </label>
                  <select
                    id="broadcast-stream-service"
                    style={inputStyle}
                    value={service}
                    onChange={(e) => handleServiceChange(e.target.value as StreamServiceName)}
                  >
                    {STREAM_SERVICES.map((s) => (
                      <option key={s.service} value={s.service}>
                        {s.service}
                      </option>
                    ))}
                  </select>
                  {selectedServiceMeta && (
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
                      {selectedServiceMeta.description}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="broadcast-stream-url" style={labelStyle}>
                    Server URL
                  </label>
                  <input
                    id="broadcast-stream-url"
                    type="text"
                    style={inputStyle}
                    value={draftRtmpUrl}
                    onChange={(e) => setDraftRtmpUrl(e.target.value)}
                    placeholder="rtmps://ingest.example.com/live2"
                  />
                </div>

                <div>
                  <label htmlFor="broadcast-stream-key" style={labelStyle}>
                    Stream Key
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      id="broadcast-stream-key"
                      type={showStreamKey ? "text" : "password"}
                      style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }}
                      value={draftStreamKey}
                      onChange={(e) => setDraftStreamKey(e.target.value)}
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowStreamKey((v) => !v)}
                      aria-label={showStreamKey ? "Hide Stream Key" : "Show Stream Key"}
                      style={{
                        height: 38,
                        padding: "0 12px",
                        background: "#1C222D",
                        border: "1px solid #2B3545",
                        color: "#CBD5E1",
                        borderRadius: 6,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {showStreamKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      {showStreamKey ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "output" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <h4 style={sectionTitleStyle}>Output Modes & Encoder Targets</h4>
                  <p style={sectionDescStyle}>
                    Choose Simple, Advanced, or Custom FFmpeg mode. Stream, Record, and Replay encoder settings are independent and saved locally.
                  </p>
                </div>

                <div>
                  <label style={labelStyle}>Output Mode</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {([
                      { id: "simple", label: "Simple" },
                      { id: "advanced", label: "Advanced" },
                      { id: "custom_ffmpeg", label: "Custom FFmpeg" },
                    ] as Array<{ id: OutputMode; label: string }>).map((opt) => {
                      const active = outputConfig.mode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setOutputConfig((prev) => ({ ...prev, mode: opt.id }))}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 7,
                            border: `1px solid ${active ? "#3B82F6" : "#2B3545"}`,
                            background: active ? "#1E3A8A" : "#161B24",
                            color: active ? "#FFFFFF" : "#CBD5E1",
                            fontSize: 12.5,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {outputConfig.mode === "simple" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={panelStyle}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF", marginBottom: 8 }}>
                        Shared Output Profile (applied to Stream, Record, Replay)
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <label htmlFor="simple-codec" style={labelStyle}>Codec</label>
                          <select
                            id="simple-codec"
                            style={inputStyle}
                            value={outputConfig.stream.codec}
                            onChange={(e) => {
                              const codec = e.target.value;
                              patchEncoder("stream", { codec });
                              patchEncoder("record", { codec });
                              patchEncoder("replay", { codec });
                            }}
                          >
                            {CODEC_OPTIONS.map((c) => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="simple-rate" style={labelStyle}>Rate Control</label>
                          <select
                            id="simple-rate"
                            style={inputStyle}
                            value={outputConfig.stream.rateControl}
                            onChange={(e) => {
                              const rateControl = e.target.value as EncoderSettings["rateControl"];
                              patchEncoder("stream", { rateControl });
                              patchEncoder("record", { rateControl });
                              patchEncoder("replay", { rateControl });
                            }}
                          >
                            <option value="CBR">CBR</option>
                            <option value="VBR">VBR</option>
                            <option value="CQP">CQP</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 10 }}>
                        <div>
                          <label style={labelStyle}>Bitrate (kbps)</label>
                          <input
                            type="number"
                            style={inputStyle}
                            value={outputConfig.stream.bitrateKbps}
                            onChange={(e) => {
                              const bitrateKbps = Number(e.target.value) || 0;
                              patchEncoder("stream", { bitrateKbps });
                              patchEncoder("record", { bitrateKbps: Math.max(bitrateKbps, outputConfig.record.bitrateKbps) });
                              patchEncoder("replay", { bitrateKbps: Math.max(2000, Math.round(bitrateKbps * 0.8)) });
                            }}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Keyframe Interval (sec)</label>
                          <input
                            type="number"
                            style={inputStyle}
                            min={0}
                            max={10}
                            value={outputConfig.stream.keyframeIntervalSec}
                            onChange={(e) => {
                              const keyframeIntervalSec = Number(e.target.value) || 0;
                              patchEncoder("stream", { keyframeIntervalSec });
                              patchEncoder("record", { keyframeIntervalSec });
                              patchEncoder("replay", { keyframeIntervalSec });
                            }}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>B-frames</label>
                          <input
                            type="number"
                            style={inputStyle}
                            min={0}
                            max={16}
                            value={outputConfig.stream.bFrames}
                            onChange={(e) => {
                              const bFrames = Number(e.target.value) || 0;
                              patchEncoder("stream", { bFrames });
                              patchEncoder("record", { bFrames });
                              patchEncoder("replay", { bFrames });
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12, color: "#94A3B8" }}>
                        Audio track assignment for Simple mode uses each target's saved defaults (Stream/Record/Replay). Switch to Advanced to edit per-target track routing.
                      </div>
                    </div>
                  </div>
                )}

                {(outputConfig.mode === "advanced" || outputConfig.mode === "custom_ffmpeg") && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {([
                      { key: "stream", title: "Stream Encoder (Independent)" },
                      { key: "record", title: "Record Encoder (Independent)" },
                      { key: "replay", title: "Replay Encoder (Independent)" },
                    ] as Array<{ key: "stream" | "record" | "replay"; title: string }>).map((section) => {
                      const enc = outputConfig[section.key];
                      return (
                        <div key={section.key} style={panelStyle}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF", marginBottom: 8 }}>
                            {section.title}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                            <div>
                              <label style={labelStyle}>Codec</label>
                              <select
                                style={inputStyle}
                                value={enc.codec}
                                onChange={(e) => patchEncoder(section.key, { codec: e.target.value })}
                              >
                                {CODEC_OPTIONS.map((c) => (
                                  <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={labelStyle}>Rate Control (CBR/VBR/CQP)</label>
                              <select
                                style={inputStyle}
                                value={enc.rateControl}
                                onChange={(e) =>
                                  patchEncoder(section.key, {
                                    rateControl: e.target.value as EncoderSettings["rateControl"],
                                  })
                                }
                              >
                                <option value="CBR">CBR</option>
                                <option value="VBR">VBR</option>
                                <option value="CQP">CQP</option>
                              </select>
                            </div>
                            <div>
                              <label style={labelStyle}>Bitrate (kbps)</label>
                              <input
                                type="number"
                                style={inputStyle}
                                value={enc.bitrateKbps}
                                onChange={(e) =>
                                  patchEncoder(section.key, { bitrateKbps: Number(e.target.value) || 0 })
                                }
                              />
                            </div>
                            <div>
                              <label style={labelStyle}>Keyframe Interval (sec)</label>
                              <input
                                type="number"
                                min={0}
                                max={10}
                                style={inputStyle}
                                value={enc.keyframeIntervalSec}
                                onChange={(e) =>
                                  patchEncoder(section.key, {
                                    keyframeIntervalSec: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label style={labelStyle}>B-frames</label>
                              <input
                                type="number"
                                min={0}
                                max={16}
                                style={inputStyle}
                                value={enc.bFrames}
                                onChange={(e) =>
                                  patchEncoder(section.key, { bFrames: Number(e.target.value) || 0 })
                                }
                              />
                            </div>
                          </div>
                          <div style={{ marginTop: 10 }}>
                            <label style={labelStyle}>Audio Track Assignment (1–6)</label>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {[0, 1, 2, 3, 4, 5].map((i) => {
                                const checked = enc.audioTrackAssignment[i];
                                return (
                                  <label
                                    key={i}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 5,
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      border: `1px solid ${checked ? "#3B82F6" : "#2B3545"}`,
                                      background: checked ? "rgba(59,130,246,0.18)" : "#0B0E14",
                                      color: checked ? "#BFDBFE" : "#94A3B8",
                                      fontSize: 12,
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleEncoderTrack(section.key, i)}
                                    />
                                    Track {i + 1}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {outputConfig.mode === "custom_ffmpeg" && (
                      <div style={panelStyle}>
                        <label htmlFor="custom-ffmpeg-args" style={labelStyle}>
                          Custom FFmpeg Arguments Template
                        </label>
                        <textarea
                          id="custom-ffmpeg-args"
                          value={outputConfig.customFfmpegArgs}
                          onChange={(e) =>
                            setOutputConfig((prev) => ({ ...prev, customFfmpegArgs: e.target.value }))
                          }
                          placeholder="Optional custom encoder arguments..."
                          style={{
                            width: "100%",
                            minHeight: 90,
                            padding: 10,
                            background: "#0B0E14",
                            border: "1px solid #2B3545",
                            borderRadius: 6,
                            color: "#FFFFFF",
                            fontSize: 12,
                            fontFamily: "monospace",
                            boxSizing: "border-box",
                            resize: "vertical",
                          }}
                        />
                        <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 6 }}>
                          Custom mode preserves per-target Stream/Record/Replay encoder settings above and stores this template in local settings.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div
                  style={{
                    background: "#0B0E14",
                    border: "1px solid #1E2533",
                    borderRadius: 8,
                    padding: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF" }}>
                    Base Profile (shared defaults)
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label htmlFor="broadcast-video-encoder" style={labelStyle}>
                        Video Encoder
                      </label>
                      <select
                        id="broadcast-video-encoder"
                        style={inputStyle}
                        value={draftProfile.videoEncoder}
                        onChange={(e) =>
                          patchProfile(
                            "videoEncoder",
                            e.target.value as BroadcastProfileSettings["videoEncoder"]
                          )
                        }
                      >
                        {VIDEO_ENCODERS.map((enc) => (
                          <option key={enc.value} value={enc.value}>
                            {enc.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="broadcast-rate-control" style={labelStyle}>
                        Rate Control
                      </label>
                      <select
                        id="broadcast-rate-control"
                        style={inputStyle}
                        value={draftProfile.rateControl}
                        onChange={(e) =>
                          patchProfile(
                            "rateControl",
                            e.target.value as BroadcastProfileSettings["rateControl"]
                          )
                        }
                      >
                        <option value="CBR">CBR</option>
                        <option value="VBR">VBR</option>
                        <option value="CQP">CQP</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <label htmlFor="broadcast-audio-bitrate" style={labelStyle}>
                        Audio Bitrate
                      </label>
                      <select
                        id="broadcast-audio-bitrate"
                        style={inputStyle}
                        value={draftProfile.audioBitrateKbps}
                        onChange={(e) =>
                          patchProfile(
                            "audioBitrateKbps",
                            Number(e.target.value) as BroadcastProfileSettings["audioBitrateKbps"]
                          )
                        }
                      >
                        {AUDIO_BITRATE_OPTIONS.map((kbps) => (
                          <option key={kbps} value={kbps}>{kbps} kbps</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="broadcast-audio-sample-rate" style={labelStyle}>
                        Audio Sample Rate
                      </label>
                      <select
                        id="broadcast-audio-sample-rate"
                        style={inputStyle}
                        value={draftProfile.audioSampleRate}
                        onChange={(e) =>
                          patchProfile(
                            "audioSampleRate",
                            Number(e.target.value) as BroadcastProfileSettings["audioSampleRate"]
                          )
                        }
                      >
                        <option value={48000}>48 kHz</option>
                        <option value={44100}>44.1 kHz</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="broadcast-rec-format" style={labelStyle}>
                        Recording Format
                      </label>
                      <select
                        id="broadcast-rec-format"
                        style={inputStyle}
                        value={draftProfile.recordingFormat}
                        onChange={(e) =>
                          patchProfile(
                            "recordingFormat",
                            e.target.value as BroadcastProfileSettings["recordingFormat"]
                          )
                        }
                      >
                        {RECORDING_FORMATS.map((fmt) => (
                          <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "#E2E8F0", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={draftProfile.autoRemuxToMp4}
                      onChange={(e) => patchProfile("autoRemuxToMp4", e.target.checked)}
                    />
                    <span>Auto-Remux MKV→MP4 after recording stops</span>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "video" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <h4 style={sectionTitleStyle}>Canvas & Scaling</h4>
                  <p style={sectionDescStyle}>
                    Set internal compositing canvas dimensions, scaled output stream resolution, and frame rate.
                  </p>
                </div>

                <div>
                  <label htmlFor="broadcast-profile-name" style={labelStyle}>
                    Profile Name
                  </label>
                  <input
                    id="broadcast-profile-name"
                    type="text"
                    style={inputStyle}
                    value={draftProfile.name}
                    onChange={(e) => patchProfile("name", e.target.value)}
                    placeholder="Sunday Morning 1080p60"
                  />
                </div>

                <div>
                  <label htmlFor="broadcast-base-res" style={labelStyle}>
                    Base (Canvas) Resolution
                  </label>
                  <select
                    id="broadcast-base-res"
                    style={inputStyle}
                    value={draftProfile.baseResolution}
                    onChange={(e) => patchProfile("baseResolution", e.target.value)}
                  >
                    {baseOptions.map((res) => (
                      <option key={res} value={res}>
                        {res} {res === "1080x1920" ? "(9:16 Vertical)" : "(16:9 Widescreen)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="broadcast-output-res" style={labelStyle}>
                    Output (Scaled) Resolution
                  </label>
                  <select
                    id="broadcast-output-res"
                    style={inputStyle}
                    value={draftProfile.outputResolution}
                    onChange={(e) => patchProfile("outputResolution", e.target.value)}
                  >
                    {outputOptions.map((res) => (
                      <option key={res} value={res}>
                        {res}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="broadcast-common-fps" style={labelStyle}>
                    Common FPS Values
                  </label>
                  <select
                    id="broadcast-common-fps"
                    style={inputStyle}
                    value={draftProfile.fps}
                    onChange={(e) => patchProfile("fps", Number(e.target.value))}
                  >
                    {COMMON_FPS_VALUES.map((fps) => (
                      <option key={fps} value={fps}>
                        {fps} FPS
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  style={{
                    background: "#0B0E14",
                    border: "1px solid #1E2533",
                    borderRadius: 8,
                    padding: 12,
                    fontSize: 12,
                    color: "#94A3B8",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    Frame Interval: {(1000 / Math.max(1, draftProfile.fps)).toFixed(2)} ms
                  </span>
                  <span>
                    Canvas: {draftProfile.baseResolution} → {draftProfile.outputResolution}
                  </span>
                </div>
              </div>
            )}

            {activeTab === "hotkeys" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <h4 style={sectionTitleStyle}>Global Broadcast Hotkeys</h4>
                    <p style={sectionDescStyle}>
                      Click any shortcut input and press your key combination. Press Backspace to clear, Esc to cancel.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftHotkeys({ ...DEFAULT_BROADCAST_HOTKEYS });
                      setCapturingAction(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 10px",
                      background: "#1C222D",
                      border: "1px solid #2B3545",
                      color: "#CBD5E1",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 11.5,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    <RotateCcw size={13} /> Reset Defaults
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {HOTKEY_ACTION_DEFS.map((action) => {
                    const isCapturing = capturingAction === action.id;
                    const currentCombo = draftHotkeys[action.id] || "";

                    return (
                      <div
                        key={action.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "10px 12px",
                          background: "#0B0E14",
                          border: `1px solid ${isCapturing ? "#3B82F6" : "#1E2533"}`,
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF" }}>
                            {action.label}
                          </div>
                          <div style={{ fontSize: 11, color: "#64748B" }}>
                            {action.description}
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <input
                            type="text"
                            readOnly
                            aria-label={`${action.label} Hotkey`}
                            value={isCapturing ? "Press keys..." : currentCombo || "Unassigned"}
                            onFocus={() => setCapturingAction(action.id)}
                            onClick={() => setCapturingAction(action.id)}
                            onBlur={() => {
                              if (capturingAction === action.id) {
                                setCapturingAction(null);
                              }
                            }}
                            onKeyDown={(e) => handleHotkeyKeyDown(action.id, e)}
                            style={{
                              width: 170,
                              height: 34,
                              padding: "0 10px",
                              background: isCapturing ? "#1E3A8A" : "#161B24",
                              border: `1px solid ${isCapturing ? "#60A5FA" : "#2B3545"}`,
                              borderRadius: 6,
                              color: isCapturing
                                ? "#FFFFFF"
                                : currentCombo
                                ? "#93C5FD"
                                : "#64748B",
                              fontSize: 12,
                              fontWeight: 700,
                              fontFamily: "monospace",
                              textAlign: "center",
                              cursor: "pointer",
                              outline: "none",
                            }}
                          />
                          <button
                            type="button"
                            title={`Clear ${action.label} hotkey`}
                            onClick={() => {
                              setDraftHotkeys((prev) => ({ ...prev, [action.id]: "" }));
                              setCapturingAction(null);
                            }}
                            style={{
                              height: 34,
                              width: 34,
                              background: "#161B24",
                              border: "1px solid #2B3545",
                              color: "#94A3B8",
                              borderRadius: 6,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            padding: "14px 20px",
            borderTop: "1px solid #1E2533",
            background: "#0F141D",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              background: "#1E2533",
              border: "1px solid #2E3748",
              color: "#CBD5E1",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveAll}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 18px",
              background: "#2563EB",
              border: "1px solid #3B82F6",
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <Check size={16} /> Save Broadcast Settings
          </button>
        </div>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: "#94A3B8",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 10px",
  background: "#0B0E14",
  border: "1px solid #2B3545",
  borderRadius: 6,
  color: "#FFFFFF",
  fontSize: 13,
  boxSizing: "border-box",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 700,
  color: "#FFFFFF",
};

const sectionDescStyle: React.CSSProperties = {
  margin: "4px 0 0 0",
  fontSize: 12,
  color: "#94A3B8",
};

const panelStyle: React.CSSProperties = {
  background: "#0B0E14",
  border: "1px solid #1E2533",
  borderRadius: 8,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
