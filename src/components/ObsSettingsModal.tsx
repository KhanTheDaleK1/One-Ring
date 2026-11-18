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
import type { ObsProfileSettings } from "../types";

export interface ObsSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: ObsProfileSettings;
  onSaveProfile: (p: ObsProfileSettings) => void;
  streamKey: string;
  rtmpUrl: string;
  onSaveStreamConfig: (url: string, key: string) => void;
  hotkeys: Record<string, string>;
  onSaveHotkeys: (hk: Record<string, string>) => void;
}

type ObsSettingsTab = "stream" | "output" | "video" | "hotkeys";

type StreamServiceName =
  | "YouTube - RTMPS"
  | "Facebook Live"
  | "Twitch"
  | "WebRTC WHIP"
  | "Custom RTMP";

const STREAM_SERVICES: Array<{
  service: StreamServiceName;
  defaultUrl: string;
  description: string;
}> = [
  {
    service: "YouTube - RTMPS",
    defaultUrl: "rtmps://a.rtmp.youtube.com/live2",
    description: "Encrypted RTMPS ingest (TLS port 443) for YouTube Live.",
  },
  {
    service: "Facebook Live",
    defaultUrl: "rtmps://live-api-s.facebook.com:443/rtmp",
    description: "Secure Facebook Live RTMPS streaming server.",
  },
  {
    service: "Twitch",
    defaultUrl: "rtmps://live.twitch.tv/app",
    description: "Twitch primary RTMPS ingest endpoint.",
  },
  {
    service: "WebRTC WHIP",
    defaultUrl: "https://whip.livepeer.studio/whip",
    description: "Ultra-low latency WebRTC-HTTP Ingestion Protocol (WHIP).",
  },
  {
    service: "Custom RTMP",
    defaultUrl: "",
    description: "Custom RTMP, RTMPS, or SRT broadcast server URL.",
  },
];

const VIDEO_ENCODERS: Array<{
  value: ObsProfileSettings["videoEncoder"];
  label: string;
  hint: string;
}> = [
  { value: "h264_nvenc", label: "h264_nvenc — NVIDIA NVENC H.264", hint: "Hardware GPU encode" },
  { value: "h264_videotoolbox", label: "h264_videotoolbox — Apple VideoToolbox H.264", hint: "macOS Apple Silicon / T2" },
  { value: "libx264", label: "libx264 — Software x264", hint: "CPU software encode" },
  { value: "av1_nvenc", label: "av1_nvenc — NVIDIA NVENC AV1", hint: "Next-gen RTX 40+ AV1" },
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
const AUDIO_BITRATE_OPTIONS: Array<ObsProfileSettings["audioBitrateKbps"]> = [
  128,
  160,
  192,
  320,
];
const RECORDING_FORMATS: Array<{
  value: ObsProfileSettings["recordingFormat"];
  label: string;
}> = [
  { value: "mkv", label: "Matroska Video (.mkv) — Crash-safe" },
  { value: "mp4", label: "MPEG-4 (.mp4)" },
  { value: "flv", label: "Flash Video (.flv)" },
];

export const DEFAULT_OBS_HOTKEYS: Record<string, string> = {
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
  if (lower.includes("youtube.com")) return "YouTube - RTMPS";
  if (lower.includes("facebook.com")) return "Facebook Live";
  if (lower.includes("twitch.tv")) return "Twitch";
  if (lower.includes("whip") || lower.startsWith("https://")) return "WebRTC WHIP";
  return "Custom RTMP";
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export const ObsSettingsModal: React.FC<ObsSettingsModalProps> = ({
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
  const [activeTab, setActiveTab] = useState<ObsSettingsTab>("stream");
  const [draftProfile, setDraftProfile] = useState<ObsProfileSettings>({ ...profile });
  const [service, setService] = useState<StreamServiceName>(() => inferServiceFromUrl(rtmpUrl));
  const [draftRtmpUrl, setDraftRtmpUrl] = useState(rtmpUrl);
  const [draftStreamKey, setDraftStreamKey] = useState(streamKey);
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [draftHotkeys, setDraftHotkeys] = useState<Record<string, string>>({
    ...DEFAULT_OBS_HOTKEYS,
    ...hotkeys,
  });
  const [capturingAction, setCapturingAction] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraftProfile({ ...profile });
    setService(inferServiceFromUrl(rtmpUrl));
    setDraftRtmpUrl(rtmpUrl);
    setDraftStreamKey(streamKey);
    setShowStreamKey(false);
    setDraftHotkeys({ ...DEFAULT_OBS_HOTKEYS, ...hotkeys });
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

  const patchProfile = <K extends keyof ObsProfileSettings>(
    key: K,
    val: ObsProfileSettings[K]
  ) => {
    setDraftProfile((prev) => ({ ...prev, [key]: val }));
  };

  const handleServiceChange = (nextService: StreamServiceName) => {
    setService(nextService);
    const preset = STREAM_SERVICES.find((s) => s.service === nextService);
    if (preset && preset.defaultUrl) {
      setDraftRtmpUrl(preset.defaultUrl);
    }
  };

  const handleSaveAll = () => {
    const sanitizedProfile: ObsProfileSettings = {
      ...draftProfile,
      name: draftProfile.name.trim() || "One Ring OBS Profile",
      bitrateKbps: clamp(Math.round(draftProfile.bitrateKbps), 2500, 25000),
      keyframeIntervalSec: clamp(Math.round(draftProfile.keyframeIntervalSec), 0, 10),
    };
    onSaveProfile(sanitizedProfile);
    onSaveStreamConfig(draftRtmpUrl.trim(), draftStreamKey);
    onSaveHotkeys(draftHotkeys);
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

  const tabs: Array<{ id: ObsSettingsTab; label: string; icon: React.ReactNode }> = [
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
      aria-label="OBS Settings"
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
                OBS Studio Settings
              </h3>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>
                Profile: {draftProfile.name || "Default"} • {draftProfile.baseResolution} @ {draftProfile.fps}fps
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close OBS Settings"
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
            aria-label="OBS Settings Sections"
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
                  <label htmlFor="obs-stream-service" style={labelStyle}>
                    Service
                  </label>
                  <select
                    id="obs-stream-service"
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
                  <label htmlFor="obs-stream-url" style={labelStyle}>
                    Server URL
                  </label>
                  <input
                    id="obs-stream-url"
                    type="text"
                    style={inputStyle}
                    value={draftRtmpUrl}
                    onChange={(e) => setDraftRtmpUrl(e.target.value)}
                    placeholder="rtmps://a.rtmp.youtube.com/live2"
                  />
                </div>

                <div>
                  <label htmlFor="obs-stream-key" style={labelStyle}>
                    Stream Key
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      id="obs-stream-key"
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
                  <h4 style={sectionTitleStyle}>Streaming & Recording Output</h4>
                  <p style={sectionDescStyle}>
                    Configure video encoder, bitrate control, audio quality, and crash-safe recording container.
                  </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="obs-video-encoder" style={labelStyle}>
                      Video Encoder
                    </label>
                    <select
                      id="obs-video-encoder"
                      style={inputStyle}
                      value={draftProfile.videoEncoder}
                      onChange={(e) =>
                        patchProfile(
                          "videoEncoder",
                          e.target.value as ObsProfileSettings["videoEncoder"]
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
                    <label htmlFor="obs-rate-control" style={labelStyle}>
                      Rate Control
                    </label>
                    <select
                      id="obs-rate-control"
                      style={inputStyle}
                      value={draftProfile.rateControl}
                      onChange={(e) =>
                        patchProfile(
                          "rateControl",
                          e.target.value as ObsProfileSettings["rateControl"]
                        )
                      }
                    >
                      <option value="CBR">CBR (Constant Bitrate — Streaming)</option>
                      <option value="VBR">VBR (Variable Bitrate)</option>
                      <option value="CQP">CQP (Constant QP — Recording)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <label htmlFor="obs-bitrate" style={{ ...labelStyle, marginBottom: 0 }}>
                      Bitrate (2500–25000 kbps)
                    </label>
                    <span style={{ fontSize: 12, color: "#60A5FA", fontWeight: 700 }}>
                      {draftProfile.bitrateKbps} kbps ({(draftProfile.bitrateKbps / 1000).toFixed(1)} Mbps)
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      type="range"
                      aria-label="Bitrate Slider"
                      min={2500}
                      max={25000}
                      step={250}
                      value={clamp(draftProfile.bitrateKbps, 2500, 25000)}
                      onChange={(e) => patchProfile("bitrateKbps", Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <input
                      id="obs-bitrate"
                      type="number"
                      min={2500}
                      max={25000}
                      step={250}
                      value={draftProfile.bitrateKbps}
                      onChange={(e) => patchProfile("bitrateKbps", Number(e.target.value))}
                      onBlur={() =>
                        patchProfile("bitrateKbps", clamp(draftProfile.bitrateKbps, 2500, 25000))
                      }
                      style={{ ...inputStyle, width: 110 }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="obs-keyframe" style={labelStyle}>
                      Keyframe Interval (sec)
                    </label>
                    <input
                      id="obs-keyframe"
                      type="number"
                      min={0}
                      max={10}
                      step={1}
                      style={inputStyle}
                      value={draftProfile.keyframeIntervalSec}
                      onChange={(e) => patchProfile("keyframeIntervalSec", Number(e.target.value))}
                      onBlur={() =>
                        patchProfile(
                          "keyframeIntervalSec",
                          clamp(draftProfile.keyframeIntervalSec, 0, 10)
                        )
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor="obs-audio-bitrate" style={labelStyle}>
                      Audio Bitrate (128–320 kbps)
                    </label>
                    <select
                      id="obs-audio-bitrate"
                      style={inputStyle}
                      value={draftProfile.audioBitrateKbps}
                      onChange={(e) =>
                        patchProfile(
                          "audioBitrateKbps",
                          Number(e.target.value) as ObsProfileSettings["audioBitrateKbps"]
                        )
                      }
                    >
                      {AUDIO_BITRATE_OPTIONS.map((kbps) => (
                        <option key={kbps} value={kbps}>
                          {kbps} kbps
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="obs-audio-sample-rate" style={labelStyle}>
                      Audio Sample Rate
                    </label>
                    <select
                      id="obs-audio-sample-rate"
                      style={inputStyle}
                      value={draftProfile.audioSampleRate}
                      onChange={(e) =>
                        patchProfile(
                          "audioSampleRate",
                          Number(e.target.value) as ObsProfileSettings["audioSampleRate"]
                        )
                      }
                    >
                      <option value={48000}>48 kHz (Broadcast)</option>
                      <option value={44100}>44.1 kHz</option>
                    </select>
                  </div>
                </div>

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
                  <div>
                    <label htmlFor="obs-rec-format" style={labelStyle}>
                      Recording Format
                    </label>
                    <select
                      id="obs-rec-format"
                      style={inputStyle}
                      value={draftProfile.recordingFormat}
                      onChange={(e) =>
                        patchProfile(
                          "recordingFormat",
                          e.target.value as ObsProfileSettings["recordingFormat"]
                        )
                      }
                    >
                      {RECORDING_FORMATS.map((fmt) => (
                        <option key={fmt.value} value={fmt.value}>
                          {fmt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                      fontSize: 13,
                      color: "#E2E8F0",
                      fontWeight: 600,
                    }}
                  >
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
                  <label htmlFor="obs-profile-name" style={labelStyle}>
                    Profile Name
                  </label>
                  <input
                    id="obs-profile-name"
                    type="text"
                    style={inputStyle}
                    value={draftProfile.name}
                    onChange={(e) => patchProfile("name", e.target.value)}
                    placeholder="Sunday Morning 1080p60"
                  />
                </div>

                <div>
                  <label htmlFor="obs-base-res" style={labelStyle}>
                    Base (Canvas) Resolution
                  </label>
                  <select
                    id="obs-base-res"
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
                  <label htmlFor="obs-output-res" style={labelStyle}>
                    Output (Scaled) Resolution
                  </label>
                  <select
                    id="obs-output-res"
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
                  <label htmlFor="obs-common-fps" style={labelStyle}>
                    Common FPS Values
                  </label>
                  <select
                    id="obs-common-fps"
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
                      setDraftHotkeys({ ...DEFAULT_OBS_HOTKEYS });
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
            <Check size={16} /> Save OBS Settings
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
