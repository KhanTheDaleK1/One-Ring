import { MidiTriggerModal } from "./MidiTriggerModal";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Eye,
  EyeOff,
  Monitor,
  Network,
  RotateCcw,
  Save,
  Shield,
  Sliders,
  Users,
  Video,
} from "lucide-react";
import type {
  AppSettings,
  AppStateSnapshot,
  RecordingFormat,
  VideoEncoder,
} from "../types";

interface SettingsViewProps {
  state: AppStateSnapshot;
  onSave: (settings: AppSettings) => void;
  onCheckUpdates?: () => void;
}

type SettingsTab =
  | "console"
  | "aoip"
  | "broadcast"
  | "slides"
  | "ipVideo"
  | "general"
  | "station";

const TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: "console", label: "Audio Mixing", icon: <Sliders size={15} /> },
  { id: "aoip", label: "Audio Network", icon: <Network size={15} /> },
  { id: "broadcast", label: "Broadcasting", icon: <Video size={15} /> },
  { id: "slides", label: "Slides", icon: <Monitor size={15} /> },
  { id: "ipVideo", label: "Cameras", icon: <Camera size={15} /> },
  { id: "station", label: "Station & Sync", icon: <Users size={15} /> },
  { id: "general", label: "General", icon: <Shield size={15} /> },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 10px",
  borderRadius: 8,
  background: "#0B0D10",
  color: "#F3F4F6",
  border: "1px solid #2E3746",
  fontSize: 13,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  color: "#D1D5DB",
  marginBottom: 5,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6B7280",
  marginTop: 4,
};

const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <label style={{ display: "block" }}>
    <span style={labelStyle}>{label}</span>
    {children}
    {hint && <span style={{ ...hintStyle, display: "block" }}>{hint}</span>}
  </label>
);

const SubSection: React.FC<{
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <div
    style={{
      padding: 16,
      borderRadius: 10,
      background: "#1C222D",
      border: "1px solid #2A3241",
    }}
  >
    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: description ? 2 : 12 }}>
      {title}
    </div>
    {description && (
      <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 12 }}>{description}</div>
    )}
    {children}
  </div>
);

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ state, onSave, onCheckUpdates }) => {
  const [tab, setTab] = useState<SettingsTab>("console");
  const [draft, setDraft] = useState<AppSettings>(() => cloneSettings(state.settings));
  const [showSecret, setShowSecret] = useState(false);
  const [showMidiModal, setShowMidiModal] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // Re-hydrate the form whenever the authoritative AppState settings actually
  // change (initial load, save round-trip, or a pushed IPC patch). Compare the
  // serialized value so the simulator's 1 Hz snapshot ticks do not clobber edits.
  const incomingSettings = useMemo(
    () => JSON.stringify(state.settings),
    [state.settings]
  );
  const lastSavedSettingsRef = useRef<string | null>(null);

  useEffect(() => {
    setDraft(cloneSettings(state.settings));
    // A save round-trip echoes the same settings object back through the
    // simulator/IPC. Don't wipe the "Saved" confirmation in that case.
    if (lastSavedSettingsRef.current !== incomingSettings) {
      setSaveNote(null);
    }
    lastSavedSettingsRef.current = null;
  }, [incomingSettings]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(state.settings),
    [draft, state.settings]
  );

  const pinValid =
    draft.general.engineerPin === "" || /^\d{4,8}$/.test(draft.general.engineerPin);
  const consoleValid = draft.console.oscPort > 0;

  function patchSection<K extends keyof AppSettings>(
    key: K,
    patch: Partial<AppSettings[K]>
  ) {
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setSaveNote(null);
  }

  const handleSave = () => {
    if (!pinValid || !consoleValid) return;
    lastSavedSettingsRef.current = JSON.stringify(draft);
    onSave(cloneSettings(draft));
    setSaveNote("Saved to AppState — persisted by the Rust backend.");
  };

  const handleRevert = () => {
    setDraft(cloneSettings(state.settings));
    setSaveNote(null);
  };

  const updateDestination = (
    id: string,
    patch: Partial<AppSettings["broadcast"]["destinations"][number]>
  ) => {
    patchSection("broadcast", {
      destinations: draft.broadcast.destinations.map((dest) =>
        dest.id === id ? { ...dest, ...patch } : dest
      ),
    });
  };

  const addDestination = (platform: "videoPlatform" | "socialPlatform" | "custom") => {
    const id = `${platform}-${Date.now().toString(36)}`;
    const preset = {
      videoPlatform: { platform: "Video Platform Live", rtmpUrl: "rtmps://ingest.example.com/live2" },
      socialPlatform: { platform: "Social Platform Live", rtmpUrl: "rtmps://ingest.example.com:443/rtmp" },
      custom: { platform: "Custom RTMPS", rtmpUrl: "" },
    }[platform];
    patchSection("broadcast", {
      destinations: [
        ...draft.broadcast.destinations,
        { id, platform: preset.platform, rtmpUrl: preset.rtmpUrl, streamKey: "", enabled: true },
      ],
    });
  };

  const removeDestination = (id: string) => {
    patchSection("broadcast", {
      destinations: draft.broadcast.destinations.filter((dest) => dest.id !== id),
    });
  };

  const importShowChannels = () => {
    patchSection("console", {
      dcaMappings: state.dcas.map((dca) => ({
        dcaId: dca.id,
        dcaNumber: dca.number,
        dcaName: dca.name,
        sourceChannel: dca.aoipTxChannel,
      })),
    });
  };

  const importShowPresets = () => {
    patchSection("ipVideoPtz", {
      presetNames: state.cameras.map((camera) => ({
        presetId: camera.id,
        cameraId: camera.cameraId,
        label: camera.name,
      })),
    });
  };

  const updateDcaMapping = (dcaId: string, sourceChannel: string) => {
    patchSection("console", {
      dcaMappings: draft.console.dcaMappings.map((mapping) =>
        mapping.dcaId === dcaId ? { ...mapping, sourceChannel } : mapping
      ),
    });
  };

  const updatePresetName = (presetId: string, label: string) => {
    patchSection("ipVideoPtz", {
      presetNames: draft.ipVideoPtz.presetNames.map((preset) =>
        preset.presetId === presetId ? { ...preset, label } : preset
      ),
    });
  };

  return (
    <div style={{ padding: 20, maxWidth: 1220, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>Settings & Device Configuration</h2>
          <p style={{ margin: "4px 0 0", color: "#9CA3AF", fontSize: 13 }}>
            Configure every production domain. Changes are stored in AppState and written to disk
            by the Rust backend automatically.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {dirty && (
            <span className="mono" style={{ fontSize: 11, color: "#FBBF24" }}>
              UNSAVED CHANGES
            </span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => setShowMidiModal(true)}
            style={{ height: 38, padding: "0 12px", fontSize: 12 }}
          >
            MIDI Surface
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleRevert}
            disabled={!dirty}
            style={{ height: 38, padding: "0 14px", display: "flex", alignItems: "center", gap: 6 }}
          >
            <RotateCcw size={14} /> Revert
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleSave}
            disabled={!dirty || !pinValid || !consoleValid}
            style={{
              height: 38,
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: dirty ? "#2563EB" : "#1C222D",
              borderColor: dirty ? "#60A5FA" : "#2E3746",
            }}
          >
            <Save size={14} /> Save Configuration
          </button>
        </div>
      </div>

      {(saveNote || !pinValid || !consoleValid) && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 12,
            background: saveNote ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
            border: `1px solid ${saveNote ? "#10B981" : "#F59E0B"}`,
            color: saveNote ? "#34D399" : "#FBBF24",
          }}
        >
          {saveNote ??
            [!consoleValid && "OSC port must be between 1 and 65535.", !pinValid && "Engineer PIN must be empty or 4–8 digits."]
              .filter(Boolean)
              .join(" ")}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="btn"
            onClick={() => setTab(entry.id)}
            style={{
              height: 40,
              padding: "0 14px",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: tab === entry.id ? "#2563EB" : "#1C222D",
              borderColor: tab === entry.id ? "#60A5FA" : "#2E3746",
            }}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "console" && (
        <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Audio Mixing — Console Control</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Field label="Mixer IP address" hint="IPv4 address of the mixing console on the control VLAN.">
              <input
                style={inputStyle}
                className="mono"
                value={draft.console.ipAddress}
                onChange={(e) => patchSection("console", { ipAddress: e.target.value })}
                placeholder="192.168.1.50"
              />
            </Field>
            <Field label="OSC port" hint="UDP control port. Console default is 10023.">
              <input
                style={inputStyle}
                className="mono"
                type="number"
                min={1}
                max={65535}
                value={draft.console.oscPort}
                onChange={(e) => patchSection("console", { oscPort: Number(e.target.value) })}
              />
            </Field>
            <Field label="Keepalive interval (s)" hint="Keepalive subscription refresh cadence.">
              <input
                style={inputStyle}
                className="mono"
                type="number"
                min={1}
                max={120}
                value={draft.console.keepaliveIntervalSec}
                onChange={(e) =>
                  patchSection("console", { keepaliveIntervalSec: Number(e.target.value) })
                }
              />
            </Field>
          </div>

          <SubSection
            title="Channel → DCA mappings"
            description="Bind the source channels that feed each show DCA used by the cue engine."
          >
            <div style={{ marginBottom: 10 }}>
              <button type="button" className="btn" onClick={importShowChannels} disabled={state.dcas.length === 0} style={{ height: 32, padding: "0 11px", fontSize: 12 }}>
                Import channels from show file
              </button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {draft.console.dcaMappings.map((mapping) => (
                <div
                  key={mapping.dcaId}
                  style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "center" }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      DCA {mapping.dcaNumber} — {mapping.dcaName}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "#6B7280" }}>
                      {mapping.dcaId}
                    </div>
                  </div>
                  <input
                    style={inputStyle}
                    className="mono"
                    value={mapping.sourceChannel}
                    onChange={(e) => updateDcaMapping(mapping.dcaId, e.target.value)}
                    placeholder="Ch 01-08 — Band Stems"
                  />
                </div>
              ))}
              {draft.console.dcaMappings.length === 0 && (
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                  No DCA mappings yet. Add channels in the show builder, then import them here.
                </div>
              )}
            </div>
          </SubSection>
        </div>
      )}

      {tab === "aoip" && (
        <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Audio Network</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 12 }}>
            <Field label="Network interface" hint="NIC used for audio-network discovery and metering traffic.">
              <input
                style={inputStyle}
                className="mono"
                list="aoip-interfaces"
                value={draft.aoip.subnetInterface}
                onChange={(e) => patchSection("aoip", { subnetInterface: e.target.value })}
                placeholder="en0 — Audio VLAN"
              />
              <datalist id="aoip-interfaces">
                <option value="Auto (default route)" />
                <option value="en0 — Ethernet / Audio VLAN" />
                <option value="en1 — Wi-Fi" />
                <option value="eth0 — Audio VLAN" />
                <option value="192.168.10.0/24" />
              </datalist>
            </Field>
            <Field label="Metering UDP port" hint="Peak metering UDP port. Default 8751.">
              <input
                style={inputStyle}
                className="mono"
                type="number"
                min={1}
                max={65535}
                value={draft.aoip.conmonMeterPort}
                onChange={(e) => patchSection("aoip", { conmonMeterPort: Number(e.target.value) })}
              />
            </Field>
            <Field label="Control UDP port" hint="Device control / identify channel. Default 8700.">
              <input
                style={inputStyle}
                className="mono"
                type="number"
                min={1}
                max={65535}
                value={draft.aoip.conmonControlPort}
                onChange={(e) =>
                  patchSection("aoip", { conmonControlPort: Number(e.target.value) })
                }
              />
            </Field>
          </div>

          <SubSection
            title="Clock Sync Warning Thresholds"
            description="Raise a warning or error when PTP offset exceeds these millisecond thresholds."
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Warning at (ms)" hint="Amber health status.">
                <input
                  style={inputStyle}
                  className="mono"
                  type="number"
                  min={1}
                  value={draft.aoip.clockSyncWarnMs}
                  onChange={(e) =>
                    patchSection("aoip", { clockSyncWarnMs: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Error at (ms)" hint="Red health status / preflight failure.">
                <input
                  style={inputStyle}
                  className="mono"
                  type="number"
                  min={1}
                  value={draft.aoip.clockSyncErrorMs}
                  onChange={(e) =>
                    patchSection("aoip", { clockSyncErrorMs: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
          </SubSection>
        </div>
      )}

      {tab === "broadcast" && (
        <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Multi-RTMPS Destinations</h3>
          {draft.broadcast.destinations.map((dest) => (
            <SubSection key={dest.id} title={`${dest.platform} (${dest.id})`}>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.6fr auto", gap: 12, alignItems: "end" }}>
                <Field label="RTMPS ingest URL">
                  <input
                    style={inputStyle}
                    className="mono"
                    value={dest.rtmpUrl}
                    onChange={(e) => updateDestination(dest.id, { rtmpUrl: e.target.value })}
                    placeholder="rtmps://ingest.example.com/live2"
                  />
                </Field>
                <Field label="Stream key">
                  <input
                    style={inputStyle}
                    className="mono"
                    type="password"
                    value={dest.streamKey}
                    onChange={(e) => updateDestination(dest.id, { streamKey: e.target.value })}
                    placeholder="Paste stream key"
                  />
                </Field>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    height: 38,
                    fontSize: 12,
                    fontWeight: 700,
                    color: dest.enabled ? "#34D399" : "#9CA3AF",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={dest.enabled}
                    onChange={(e) => updateDestination(dest.id, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>
              </div>
            </SubSection>
          ))}

          <SubSection title="Local recording" description="Applied to recording outputs and chapter marks.">
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
              <Field label="Recording path" hint="Folder or filename stem for service recordings.">
                <input
                  style={inputStyle}
                  className="mono"
                  value={draft.broadcast.recordingPath}
                  onChange={(e) => patchSection("broadcast", { recordingPath: e.target.value })}
                  placeholder="/recordings/service"
                />
              </Field>
              <Field label="Container format">
                <select
                  style={inputStyle}
                  value={draft.broadcast.recordingFormat}
                  onChange={(e) =>
                    patchSection("broadcast", {
                      recordingFormat: e.target.value as RecordingFormat,
                    })
                  }
                >
                  <option value="MKV">MKV — crash-safe</option>
                  <option value="MP4">MP4 — web-ready</option>
                </select>
              </Field>
              <Field label="Hardware encoder">
                <select
                  style={inputStyle}
                  value={draft.broadcast.encoder}
                  onChange={(e) =>
                    patchSection("broadcast", { encoder: e.target.value as VideoEncoder })
                  }
                >
                  <option value="HardwareGpu">Hardware GPU</option>
                  <option value="HardwareMedia">Hardware Media</option>
                  <option value="Software">Software (x264)</option>
                </select>
              </Field>
            </div>
          </SubSection>
        </div>
      )}

      {tab === "slides" && (
        <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Slides & Presentation</h3>
          <SubSection
            title="Song Library Credentials (Song Library)"
            description="OAuth credentials for song search & import. Stored locally on the production machine."
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="OAuth client ID">
                <input
                  style={inputStyle}
                  className="mono"
                  value={draft.slides.songLibraryClientId}
                  onChange={(e) =>
                    patchSection("slides", { songLibraryClientId: e.target.value })
                  }
                  placeholder="songLibrary-client-id"
                />
              </Field>
              <Field label="OAuth client secret">
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 40 }}
                    className="mono"
                    type={showSecret ? "text" : "password"}
                    value={draft.slides.songLibraryClientSecret}
                    onChange={(e) =>
                      patchSection("slides", { songLibraryClientSecret: e.target.value })
                    }
                    placeholder="songLibrary-client-secret"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    title={showSecret ? "Hide secret" : "Show secret"}
                    style={{
                      position: "absolute",
                      right: 6,
                      top: 6,
                      width: 28,
                      height: 26,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "transparent",
                      border: "none",
                      color: "#9CA3AF",
                      cursor: "pointer",
                    }}
                  >
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>
            </div>
          </SubSection>

          <SubSection
            title="Physical Display Assignment"
            description="Choose which output surface receives each presentation role."
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Field label="FOH Window" hint="Operator preview / control surface.">
                <input
                  style={inputStyle}
                  className="mono"
                  list="display-assignments"
                  value={draft.slides.displayAssignments.fohWindow}
                  onChange={(e) =>
                    patchSection("slides", {
                      displayAssignments: {
                        ...draft.slides.displayAssignments,
                        fohWindow: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Stage Display Window" hint="Confidence lyrics / clock output.">
                <input
                  style={inputStyle}
                  className="mono"
                  list="display-assignments"
                  value={draft.slides.displayAssignments.stageDisplayWindow}
                  onChange={(e) =>
                    patchSection("slides", {
                      displayAssignments: {
                        ...draft.slides.displayAssignments,
                        stageDisplayWindow: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Alpha key output" hint="Lower-third key or alpha channel destination.">
                <input
                  style={inputStyle}
                  className="mono"
                  list="display-assignments"
                  value={draft.slides.displayAssignments.ipVideoAlphaOutput}
                  onChange={(e) =>
                    patchSection("slides", {
                      displayAssignments: {
                        ...draft.slides.displayAssignments,
                        ipVideoAlphaOutput: e.target.value,
                      },
                    })
                  }
                />
              </Field>
            </div>
            <datalist id="display-assignments">
              <option value="DISPLAY1 — FOH Operator (1920x1080)" />
              <option value="DISPLAY2 — Stage Confidence (1920x1080)" />
              <option value="DISPLAY3 — 4K Broadcast (3840x2160)" />
              <option value="Network Video — Stage Display" />
              <option value="Network Video — Audience Alpha Key" />
            </datalist>
          </SubSection>
        </div>
      )}

      {tab === "ipVideo" && (
        <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Cameras & Discovery</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Discovery range start" hint="First IPv4 address swept for cameras.">
              <input
                style={inputStyle}
                className="mono"
                value={draft.ipVideoPtz.discoveryRangeStart}
                onChange={(e) =>
                  patchSection("ipVideoPtz", { discoveryRangeStart: e.target.value })
                }
                placeholder="192.168.1.1"
              />
            </Field>
            <Field label="Discovery range end" hint="Last IPv4 address in the sweep.">
              <input
                style={inputStyle}
                className="mono"
                value={draft.ipVideoPtz.discoveryRangeEnd}
                onChange={(e) =>
                  patchSection("ipVideoPtz", { discoveryRangeEnd: e.target.value })
                }
                placeholder="192.168.1.254"
              />
            </Field>
            <Field label="Camera control UDP port" hint="Camera control UDP port. Default 52381.">
              <input
                style={inputStyle}
                className="mono"
                type="number"
                min={1}
                max={65535}
                value={draft.ipVideoPtz.ptzIpPort}
                onChange={(e) => patchSection("ipVideoPtz", { ptzIpPort: Number(e.target.value) })}
              />
            </Field>
          </div>

          <SubSection
            title="Camera Preset Naming"
            description="Friendly labels shown on Show Mode preset buttons."
          >
            <div style={{ display: "grid", gap: 8 }}>
              {draft.ipVideoPtz.presetNames.map((preset) => (
                <div
                  key={preset.presetId}
                  style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "center" }}
                >
                  <div className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                    {preset.cameraId} / {preset.presetId}
                  </div>
                  <input
                    style={inputStyle}
                    value={preset.label}
                    onChange={(e) => updatePresetName(preset.presetId, e.target.value)}
                    placeholder="1: Stage Wide"
                  />
                </div>
              ))}
              {draft.ipVideoPtz.presetNames.length === 0 && (
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                  No PTZ presets discovered yet.
                </div>
              )}
            </div>
          </SubSection>
        </div>
      )}

      {tab === "general" && (
        <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>General</h3>
          <SubSection
            title="Engineer Mode PIN"
            description="Volunteer Show Mode stays locked to cue execution. Enter this PIN to unlock Engineer Mode."
          >
            <div style={{ maxWidth: 320 }}>
              <Field
                label="Unlock PIN"
                hint={pinValid ? "4–8 digits. Stored in the local settings file." : "PIN must be 4–8 digits."}
              >
                <input
                  style={{
                    ...inputStyle,
                    borderColor: pinValid ? "#2E3746" : "#F59E0B",
                    letterSpacing: pinValid ? undefined : 1,
                  }}
                  className="mono"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={draft.general.engineerPin}
                  onChange={(e) =>
                    patchSection("general", {
                      engineerPin: e.target.value.replace(/\D/g, ""),
                    })
                  }
                  placeholder="••••"
                />
              </Field>
            </div>
          </SubSection>

          <SubSection
            title="Persistence"
            description="Settings are saved into the AppState snapshot and serialized to settings.json by the Rust backend on every save."
          >
            <div className="mono" style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.7 }}>
              IPC command: <span style={{ color: "#60A5FA" }}>update_settings</span>
              <br />
              Backend: <span style={{ color: "#60A5FA" }}>src-tauri/src/state.rs</span>
              <br />
              File: <span style={{ color: "#34D399" }}>app_config_dir()/settings.json</span>
            </div>
          </SubSection>
        </div>
      )}
      <MidiTriggerModal
        isOpen={showMidiModal}
        onClose={() => setShowMidiModal(false)}
        onSaveBindings={() => setSaveNote("Saved MIDI control surface mappings.")}
      />
    </div>
  );
};
