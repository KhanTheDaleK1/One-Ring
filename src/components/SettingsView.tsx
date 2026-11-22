import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Camera,
  Check,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Monitor,
  Network,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shield,
  Sliders,
  Trash2,
  Upload,
  Users,
  Video,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import type {
  AppSettings,
  AppStateSnapshot,
  AudienceRelayConfig,
  ConnectionTestResult,
  DiscoveredLanDevice,
  PtzCameraEntry,
  RecordingFormat,
  StationRole,
  VideoEncoder,
} from "../types";
import {
  configureAudienceRelay,
  DEFAULT_AUDIENCE_RELAY_CONFIG,
  discoverLanDevices,
  exportDiagnosticBundle,
  exportSettingsBundle,
  getAiAssistantStatus,
  importSettingsBundle,
  installOpenCodeCli,
  listHostDisplays,
  openConfigDirectory,
  resetSettingsSection,
  testSubsystemConnection,
  type AiAssistantStatusInfo,
  type HostDisplayInfo,
  checkForUpdate,
  installNativeUpdate,
} from "../bridge";
import { RemoteControlView } from "./RemoteControlView";
import { MidiTriggerModal } from "./MidiTriggerModal";

interface SettingsViewProps {
  state: AppStateSnapshot;
  onSave: (settings: AppSettings) => void;
  onCheckUpdates?: () => void;
  onOpenBroadcastSettings?: () => void;
}

type SettingsTab =
  | "console"
  | "aoip"
  | "broadcast"
  | "slides"
  | "ipVideo"
  | "general"
  | "station";

type RelayMode = "disabled" | AudienceRelayConfig["mode"];
type HealthLevel = "ok" | "warn" | "error" | "none";

const APP_VERSION = "0.3.12";
const RELAY_STORAGE_KEY = "onering_audience_relay_config";
const CAMERA_ROSTER_KEY = "onering_ptz_camera_roster";

const TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: "console", label: "Audio Mixing", icon: <Sliders size={15} /> },
  { id: "aoip", label: "Audio Network", icon: <Network size={15} /> },
  { id: "broadcast", label: "Broadcasting", icon: <Video size={15} /> },
  { id: "slides", label: "Slides", icon: <Monitor size={15} /> },
  { id: "ipVideo", label: "Cameras", icon: <Camera size={15} /> },
  { id: "station", label: "Station & Sync", icon: <Users size={15} /> },
  { id: "general", label: "General", icon: <Shield size={15} /> },
];

const TAB_SECTIONS: Record<SettingsTab, Array<keyof AppSettings>> = {
  console: ["console"],
  aoip: ["aoip"],
  broadcast: ["broadcast"],
  slides: ["slides"],
  ipVideo: ["ipVideoPtz"],
  station: ["station", "sync"],
  general: ["general"],
};

const HARDWARE_TABS: SettingsTab[] = [
  "console",
  "aoip",
  "broadcast",
  "slides",
  "ipVideo",
  "station",
];
const DISCOVERY_TABS: SettingsTab[] = ["aoip", "slides", "ipVideo", "station"];

const HEALTH_IDS: Record<SettingsTab, string[]> = {
  console: ["console", "mixer"],
  aoip: ["aoip", "audio"],
  broadcast: ["broadcast", "stream", "dual_stream"],
  slides: ["slides", "presentation"],
  ipVideo: ["ip_video", "camera"],
  station: ["station", "sync", "hub"],
  general: [],
};

const HEALTH_LABELS: Record<SettingsTab, string[]> = {
  console: ["console", "mixer"],
  aoip: ["network", "audio"],
  broadcast: ["broadcast", "stream"],
  slides: ["slides", "presentation"],
  ipVideo: ["camera", "video"],
  station: ["station", "sync", "hub"],
  general: [],
};

const SEARCH_KEYWORDS: Record<SettingsTab, string> = {
  console: "mixer osc ip port dca channel udp control keepalive",
  aoip: "network interface metering clock timing subnet discovery udp",
  broadcast: "stream destination rtmp key encoder recording audience chat relay telemetry webhook endpoint channel token",
  slides: "presentation song library credentials display oauth display assignment",
  ipVideo: "camera ptz discovery preset roster ip port range control",
  station: "sync hub lan cloud profile token role station name",
  general: "pin ui scale contrast accessibility crash reporting relay privacy diagnostics profile updates config version maintenance",
};

const DEFAULT_SECTIONS: AppSettings = {
  console: {
    ipAddress: "",
    oscPort: 10023,
    keepaliveIntervalSec: 8,
    dcaMappings: [],
  },
  aoip: {
    subnetInterface: "Auto (default route)",
    conmonMeterPort: 8751,
    conmonControlPort: 8700,
    clockSyncWarnMs: 50,
    clockSyncErrorMs: 150,
  },
  broadcast: {
    destinations: [],
    recordingPath: "",
    recordingFormat: "MKV",
    encoder: "Software",
  },
  slides: {
    songLibraryClientId: "",
    songLibraryClientSecret: "",
    displayAssignments: {
      fohWindow: "",
      stageDisplayWindow: "",
      ipVideoAlphaOutput: "",
    },
  },
  ipVideoPtz: {
    discoveryRangeStart: "",
    discoveryRangeEnd: "",
    ptzIpPort: 52381,
    presetNames: [],
    cameras: [],
  },
  general: {
    canvasTitle: "Main Sanctuary",
    canvasTabs: [
      { id: "mixing", label: "Mixing", enabled: true },
      { id: "video", label: "Video", enabled: true },
      { id: "slides", label: "Slides", enabled: true },
      { id: "broadcast", label: "Broadcast", enabled: true },
      { id: "master", label: "Master", enabled: true },
    ],
    engineerPin: "",
    uiScale: 100,
    highContrast: false,
    confirmUnsavedLeave: true,
    autoCrashReporting: false,
    crashRelayUrl: "",
  },
  station: {
    role: "master",
    stationName: "",
    lockToRole: false,
  },
  sync: {
    lanDiscoveryEnabled: true,
    hubAddress: "ws://0.0.0.0:47800",
    syncPort: 47800,
    cloudSyncEnabled: false,
    accountEmail: "",
    profileName: "",
    venueId: "",
    syncToken: "",
    autoSyncOnLaunch: false,
    lastSyncedAt: "",
  },
};

const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_RE =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IPV4_SCAN_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;

function isValidHost(value: string): boolean {
  const trimmed = value.trim();
  return IPV4_RE.test(trimmed) || HOSTNAME_RE.test(trimmed);
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isValidRtmpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "rtmp:" || parsed.protocol === "rtmps:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function isValidEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "ws:", "wss:"].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/** Crash relays are optional, but any configured endpoint must be HTTPS. */
function isValidCrashRelayUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

/** Accept both percentage values (100) and multiplier values (1.0) from persisted profiles. */
function normalizedUiScale(value: number | undefined): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 100;
  return raw <= 2 ? Math.round(raw * 100) : raw;
}

function loadCameraRoster(): PtzCameraEntry[] {
  try {
    const raw = localStorage.getItem(CAMERA_ROSTER_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as PtzCameraEntry[];
    }
  } catch {
    // Ignore a malformed locally saved camera roster.
  }
  return [];
}

/** Only non-secret relay settings belong in localStorage; tokens stay in memory / native storage. */
function persistRelayConfig(config: AudienceRelayConfig): void {
  const { authToken: _secret, ...persisted } = config;
  localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify(persisted));
}

function loadRelayConfig(): AudienceRelayConfig {
  try {
    const raw = localStorage.getItem(RELAY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudienceRelayConfig>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const config: AudienceRelayConfig = {
          ...DEFAULT_AUDIENCE_RELAY_CONFIG,
          ...parsed,
          authToken: "",
        };
        if (typeof parsed.authToken === "string") {
          // Rewrite any legacy entry that captured a secret without it.
          persistRelayConfig(config);
        }
        return config;
      }
    }
  } catch {
    // Ignore a malformed locally saved relay configuration.
  }
  return { ...DEFAULT_AUDIENCE_RELAY_CONFIG };
}

function downloadJson(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cardStyle: React.CSSProperties = { padding: 20, display: "grid", gap: 14 };

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 10px",
  borderRadius: 8,
  background: "#0B0D10",
  color: "#F3F4F6",
  border: "1px solid #2E3746",
  fontSize: 13,
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

const errorStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "#F87171",
  marginTop: 4,
};

function inputWithError(error?: string): React.CSSProperties {
  return { ...inputStyle, borderColor: error ? "#EF4444" : "#2E3746" };
}

const Field: React.FC<{
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}> = ({ label, hint, error, children }) => (
  <label style={{ display: "block" }}>
    <span style={labelStyle}>{label}</span>
    {children}
    {error ? (
      <span style={errorStyle}>{error}</span>
    ) : hint ? (
      <span style={{ ...hintStyle, display: "block" }}>{hint}</span>
    ) : null}
  </label>
);

const SubSection: React.FC<{
  title: string;
  description?: string;
  keywords?: string;
  search?: string;
  children: React.ReactNode;
}> = ({ title, description, keywords, search, children }) => {
  const query = (search ?? "").trim().toLowerCase();
  const matched =
    query.length > 0 &&
    `${title} ${description ?? ""} ${keywords ?? ""}`.toLowerCase().includes(query);
  if (query.length > 0 && !matched) return null;
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        background: "#1C222D",
        border: `1px solid ${matched ? "#FBBF24" : "#2A3241"}`,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 14,
          marginBottom: description ? 2 : 12,
          color: matched ? "#FBBF24" : undefined,
        }}
      >
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 12 }}>{description}</div>
      )}
      {children}
    </div>
  );
};

const SecretInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  ariaLabel: string;
  placeholder?: string;
  invalid?: boolean;
}> = ({ value, onChange, visible, onToggle, ariaLabel, placeholder, invalid }) => (
  <div style={{ position: "relative" }}>
    <input
      aria-label={ariaLabel}
      style={{ ...inputWithError(invalid ? "invalid" : undefined), paddingRight: 40 }}
      className="mono"
      type={visible ? "text" : "password"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
    <button
      type="button"
      aria-label={visible ? `Hide ${ariaLabel}` : `Show ${ariaLabel}`}
      title={visible ? "Hide value" : "Show value"}
      onClick={onToggle}
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
      {visible ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  </div>
);

const NumericInput: React.FC<{
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  style?: React.CSSProperties;
  className?: string;
  "aria-label"?: string;
}> = ({ value, onCommit, min, max, step, integer = true, style, className, ...rest }) => {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const commit = () => {
    const raw = text.trim();
    if (raw === "") {
      setText(String(value));
      return;
    }
    let parsed = integer ? parseInt(raw, 10) : Number(raw);
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    if (typeof min === "number") parsed = Math.max(min, parsed);
    if (typeof max === "number") parsed = Math.min(max, parsed);
    if (parsed !== value) onCommit(parsed);
    setText(String(parsed));
  };

  return (
    <input
      {...rest}
      type="number"
      className={className}
      style={style}
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  state,
  onSave,
  onCheckUpdates,
  onOpenBroadcastSettings,
}) => {
  const isDesktop = typeof window !== "undefined" && window.innerWidth > 768;
  const [tab, setTab] = useState<SettingsTab>("console");
  const [draft, setDraft] = useState<AppSettings>(() => cloneSettings(state.settings));
  const [cameraRoster, setCameraRoster] = useState<PtzCameraEntry[]>(() =>
    draft.ipVideoPtz.cameras && draft.ipVideoPtz.cameras.length > 0
      ? draft.ipVideoPtz.cameras
      : loadCameraRoster()
  );
  const cameras = cameraRoster;
  const [search, setSearch] = useState("");
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [showMidiModal, setShowMidiModal] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hostDisplays, setHostDisplays] = useState<HostDisplayInfo[]>([]);
  const [testResults, setTestResults] = useState<Partial<Record<SettingsTab, ConnectionTestResult>>>(
    {}
  );
  const [testingTab, setTestingTab] = useState<SettingsTab | null>(null);
  const [discoveredByTab, setDiscoveredByTab] = useState<
    Partial<Record<SettingsTab, DiscoveredLanDevice[]>>
  >({});
  const [discoveringTab, setDiscoveringTab] = useState<SettingsTab | null>(null);
  const [discoverNotes, setDiscoverNotes] = useState<Partial<Record<SettingsTab, string>>>({});
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);
  const [bundleNote, setBundleNote] = useState<string | null>(null);
  const initialRelay = useMemo(loadRelayConfig, []);
  const [relay, setRelay] = useState<AudienceRelayConfig>(initialRelay);
  const [relayMode, setRelayMode] = useState<RelayMode>(
    initialRelay.enabled ? initialRelay.mode : "disabled"
  );
  const [relayNote, setRelayNote] = useState<string | null>(null);
  const [relayBusy, setRelayBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiAssistantStatusInfo | null>(null);
  const [installingOpenCode, setInstallingOpenCode] = useState(false);
  const [openCodeNote, setOpenCodeNote] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (tab !== "general") return;
    let cancelled = false;
    getAiAssistantStatus()
      .then((next) => {
        if (!cancelled) setAiStatus(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab]);

  // Check for updates on startup
  useEffect(() => {
    let cancelled = false;
    setUpdateChecking(true);
    checkForUpdate()
      .then((info) => {
        if (!cancelled) {
          setUpdateAvailable(!!info && info.update_available);
          setUpdateChecking(false);
          if (info && info.update_available) {
            setUpdateProgress(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUpdateChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const installOpenCode = async () => {
    if (installingOpenCode) return;
    setInstallingOpenCode(true);
    setOpenCodeNote(null);
    try {
      const updated = await installOpenCodeCli();
      setAiStatus(updated);
      setOpenCodeNote(
        updated.opencodeInstalled
          ? "OpenCode CLI installed and detected."
          : "Installer finished, but the CLI was not detected yet. Restart One Ring and check again."
      );
    } catch (err) {
      setOpenCodeNote(`Installation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstallingOpenCode(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    listHostDisplays()
      .then((displays) => {
        if (!cancelled) setHostDisplays(Array.isArray(displays) ? displays : []);
      })
      .catch(() => {
        if (!cancelled) setHostDisplays([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const incomingSettings = useMemo(() => JSON.stringify(state.settings), [state.settings]);
  const lastSavedSettingsRef = useRef<string | null>(null);

  useEffect(() => {
    setDraft(cloneSettings(state.settings));
    if (lastSavedSettingsRef.current !== incomingSettings) {
      setSaveNote(null);
      setSaveError(null);
    }
    lastSavedSettingsRef.current = null;
  }, [incomingSettings]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(state.settings),
    [draft, state.settings]
  );

  const dirtyTabs = useMemo(
    () =>
      TABS.filter((entry) =>
        TAB_SECTIONS[entry.id].some(
          (section) =>
            JSON.stringify(draft[section]) !== JSON.stringify(state.settings[section])
        )
      ).map((entry) => entry.id),
    [draft, state.settings]
  );

  const query = search.trim().toLowerCase();
  const visibleTabs = useMemo(
    () =>
      TABS.filter(
        (entry) =>
          !query ||
          `${entry.label} ${entry.id} ${SEARCH_KEYWORDS[entry.id]}`.toLowerCase().includes(query)
      ),
    [query]
  );

  useEffect(() => {
    if (query && visibleTabs.length > 0 && !visibleTabs.some((entry) => entry.id === tab)) {
      setTab(visibleTabs[0].id);
    }
  }, [query, visibleTabs, tab]);

  useEffect(() => {
    if (!dirty || draft.general.confirmUnsavedLeave === false) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draft.general.confirmUnsavedLeave]);

  const validationIssues = useMemo(() => {
    const issues: Array<{ key: string; tab: SettingsTab; message: string }> = [];
    const add = (key: string, tab: SettingsTab, message: string) => issues.push({ key, tab, message });

    if (draft.general.engineerPin !== "" && !/^\d{4,8}$/.test(draft.general.engineerPin)) {
      add("pin", "general", "Engineer PIN must be empty or 4–8 digits.");
    }
    if (!isValidCrashRelayUrl(draft.general.crashRelayUrl ?? "")) {
      add("crashRelay", "general", "Crash relay endpoint must be empty or a valid https:// URL.");
    }
    if (draft.console.ipAddress.trim() && !isValidHost(draft.console.ipAddress)) {
      add("consoleIp", "console", "Enter a valid IPv4 address or hostname for the console.");
    }
    if (!isValidPort(draft.console.oscPort)) {
      add("consolePort", "console", "OSC port must be between 1 and 65535.");
    }
    if (draft.console.keepaliveIntervalSec < 1 || draft.console.keepaliveIntervalSec > 120) {
      add("keepalive", "console", "Keepalive interval must be between 1 and 120 seconds.");
    }
    if (!isValidPort(draft.aoip.conmonMeterPort)) {
      add("aoipMeterPort", "aoip", "Metering UDP port must be between 1 and 65535.");
    }
    if (!isValidPort(draft.aoip.conmonControlPort)) {
      add("aoipControlPort", "aoip", "Control UDP port must be between 1 and 65535.");
    }
    if (draft.aoip.clockSyncWarnMs < 1 || draft.aoip.clockSyncErrorMs < 1) {
      add("clockThresholds", "aoip", "Clock thresholds must be positive values.");
    }
    draft.broadcast.destinations.forEach((destination) => {
      if (destination.enabled && !isValidRtmpUrl(destination.rtmpUrl)) {
        add(
          `rtmp-${destination.id}`,
          "broadcast",
          `Use an rtmp:// or rtmps:// ingest URL for ${destination.platform || "this destination"}.`
        );
      }
    });
    if (relayMode !== "disabled") {
      if (!relay.endpointUrl.trim() || !isValidEndpoint(relay.endpointUrl)) {
        add("relayEndpoint", "broadcast", "Enter a valid http(s) or ws(s) relay endpoint URL.");
      }
      if (relay.statsWebhookUrl.trim() && !isValidEndpoint(relay.statsWebhookUrl)) {
        add("relayStats", "broadcast", "Viewer count poll URL must be a valid http(s) or ws(s) URL.");
      }
    }
    if (draft.ipVideoPtz.discoveryRangeStart.trim() && !isValidHost(draft.ipVideoPtz.discoveryRangeStart)) {
      add("rangeStart", "ipVideo", "Discovery range start must be a valid IPv4 address or hostname.");
    }
    if (draft.ipVideoPtz.discoveryRangeEnd.trim() && !isValidHost(draft.ipVideoPtz.discoveryRangeEnd)) {
      add("rangeEnd", "ipVideo", "Discovery range end must be a valid IPv4 address or hostname.");
    }
    if (!isValidPort(draft.ipVideoPtz.ptzIpPort)) {
      add("ptzPort", "ipVideo", "Camera control port must be between 1 and 65535.");
    }
    cameras.forEach((camera) => {
      if (!camera.name.trim()) add(`camera-name-${camera.id}`, "ipVideo", "Camera name is required.");
      if (!isValidHost(camera.ipAddress)) {
        add(`camera-ip-${camera.id}`, "ipVideo", `Enter a valid IP or hostname for ${camera.name || "a camera"}.`);
      }
      if (!isValidPort(camera.port)) add(`camera-port-${camera.id}`, "ipVideo", "Camera port must be between 1 and 65535.");
    });
    if (!isValidEndpoint(draft.sync.hubAddress)) {
      add("hubAddress", "station", "Hub address must be a valid ws:// or wss:// URL.");
    }
    if (!isValidPort(draft.sync.syncPort)) {
      add("syncPort", "station", "Sync port must be between 1 and 65535.");
    }
    if (
      draft.sync.cloudSyncEnabled &&
      draft.sync.accountEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.sync.accountEmail)
    ) {
      add("accountEmail", "station", "Enter a valid account email address.");
    }
    return issues;
  }, [draft, cameras, relay, relayMode]);

  const validation = useMemo(
    () => Object.fromEntries(validationIssues.map((issue) => [issue.key, issue.message])) as Record<string, string>,
    [validationIssues]
  );

  const isValid = validationIssues.length === 0;

  const validationGroups = useMemo(() => {
    const groups = new Map<SettingsTab, string[]>();
    for (const issue of validationIssues) {
      const list = groups.get(issue.tab) ?? [];
      list.push(issue.message);
      groups.set(issue.tab, list);
    }
    return Array.from(groups.entries()).map(([tabId, messages]) => ({
      tabId,
      label: TABS.find((entry) => entry.id === tabId)?.label ?? tabId,
      messages,
    }));
  }, [validationIssues]);

  function toggleSecret(key: string) {
    setShowSecrets((previous) => ({ ...previous, [key]: !previous[key] }));
  }

  function patchSection<K extends keyof AppSettings>(key: K, patch: Partial<AppSettings[K]>) {
    setDraft((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }));
    setSaveNote(null);
    setSaveError(null);
  }

  const handleSave = async (): Promise<boolean> => {
    if (!dirty || !isValid) return false;
    const payload = cloneSettings(draft);
    try {
      await Promise.resolve(onSave(payload));
      lastSavedSettingsRef.current = JSON.stringify(payload);
      setSaveNote("Settings saved — the runtime configuration has been refreshed.");
      setSaveError(null);
      return true;
    } catch (error) {
      setSaveError(`Could not save settings: ${String(error)}`);
      setSaveNote(null);
      return false;
    }
  };

  const handleRevert = () => {
    setDraft(cloneSettings(state.settings));
    setPendingTab(null);
    setSaveNote(null);
    setSaveError(null);
  };

  const requestTab = (next: SettingsTab) => {
    if (next === tab) return;
    if (dirty) {
      setPendingTab(next);
      return;
    }
    setTab(next);
  };

  const resolvePendingTab = async (saveCurrent: boolean) => {
    if (!pendingTab) return;
    if (saveCurrent) {
      const ok = await handleSave();
      if (!ok) return;
    } else {
      setDraft(cloneSettings(state.settings));
      setSaveError(null);
      setSaveNote(null);
    }
    setTab(pendingTab);
    setPendingTab(null);
  };

  const updateDestination = (
    id: string,
    patch: Partial<AppSettings["broadcast"]["destinations"][number]>
  ) => {
    patchSection("broadcast", {
      destinations: draft.broadcast.destinations.map((destination) =>
        destination.id === id ? { ...destination, ...patch } : destination
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
      destinations: draft.broadcast.destinations.filter((destination) => destination.id !== id),
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

  const persistRoster = (roster: PtzCameraEntry[]) => {
    setCameraRoster(roster);
    try {
      localStorage.setItem(CAMERA_ROSTER_KEY, JSON.stringify(roster));
    } catch {
      // Local persistence is best-effort.
    }
    patchSection("ipVideoPtz", { cameras: roster });
  };

  const updateCamera = (id: string, patch: Partial<PtzCameraEntry>) => {
    persistRoster(
      cameras.map((camera) => (camera.id === id ? { ...camera, ...patch } : camera))
    );
  };

  const addCamera = () => {
    persistRoster([
      ...cameras,
      {
        id: `camera-${Date.now().toString(36)}`,
        name: `Camera ${cameras.length + 1}`,
        ipAddress: "192.0.2.20",
        port: draft.ipVideoPtz.ptzIpPort,
      },
    ]);
  };

  const removeCamera = (id: string) => {
    persistRoster(cameras.filter((camera) => camera.id !== id));
  };

  const healthLevelForTab = (id: SettingsTab): HealthLevel => {
    const test = testResults[id];
    if (test) return test.ok ? "ok" : "error";
    if (id === "general") {
      if (state.health.length === 0) return "none";
      if (state.health.some((entry) => entry.status === "error")) return "error";
      if (state.health.some((entry) => entry.status === "warn")) return "warn";
      return "ok";
    }
    const ids = HEALTH_IDS[id];
    const labels = HEALTH_LABELS[id];
    if (ids.length === 0 && labels.length === 0) return "none";
    const matches = state.health.filter(
      (entry) =>
        ids.some((key) => entry.id === key || entry.id.startsWith(key)) ||
        labels.some((key) => entry.label.toLowerCase().includes(key))
    );
    if (matches.length === 0) return "none";
    if (matches.some((entry) => entry.status === "error")) return "error";
    if (matches.some((entry) => entry.status === "warn")) return "warn";
    return "ok";
  };

  const statusColor: Record<HealthLevel, string> = {
    ok: "#10B981",
    warn: "#F59E0B",
    error: "#EF4444",
    none: "#4B5563",
  };

  const targetForTab = (id: SettingsTab): { host: string; port: number; label: string } => {
    switch (id) {
      case "console":
        return {
          host: draft.console.ipAddress.trim() || "192.0.2.50",
          port: draft.console.oscPort,
          label: "Console control",
        };
      case "aoip": {
        const match = draft.aoip.subnetInterface.match(IPV4_SCAN_RE);
        const host = match && IPV4_RE.test(match[0]) ? match[0] : "127.0.0.1";
        return { host, port: draft.aoip.conmonMeterPort, label: "Audio network" };
      }
      case "broadcast": {
        const destination =
          draft.broadcast.destinations.find((entry) => entry.enabled) ??
          draft.broadcast.destinations[0];
        let host = "ingest.example.com";
        let port = 443;
        if (destination?.rtmpUrl) {
          try {
            const parsed = new URL(destination.rtmpUrl);
            host = parsed.hostname || host;
            port = parsed.port ? Number(parsed.port) : parsed.protocol === "rtmp:" ? 1935 : 443;
          } catch {
            // Keep the neutral defaults when the operator URL is incomplete.
          }
        }
        return { host, port, label: "Stream ingest" };
      }
      case "slides":
        return { host: "127.0.0.1", port: 80, label: "Presentation controller" };
      case "ipVideo":
        return {
          host: draft.ipVideoPtz.discoveryRangeStart.trim() || "192.0.2.10",
          port: draft.ipVideoPtz.ptzIpPort,
          label: "Camera control",
        };
      case "station": {
        let host = "127.0.0.1";
        try {
          host = new URL(draft.sync.hubAddress).hostname || host;
        } catch {
          // Keep the loopback placeholder while the operator types.
        }
        return { host, port: draft.sync.syncPort, label: "Station hub" };
      }
      default:
        return { host: "127.0.0.1", port: 1, label: "Subsystem" };
    }
  };

  const runConnectionTest = async (id: SettingsTab) => {
    const target = targetForTab(id);
    setTestingTab(id);
    setTestResults((previous) => ({ ...previous, [id]: undefined }));
    try {
      const result = await testSubsystemConnection(id, target.host, target.port);
      setTestResults((previous) => ({ ...previous, [id]: result }));
    } catch (error) {
      setTestResults((previous) => ({
        ...previous,
        [id]: {
          ok: false,
          subsystem: id,
          host: target.host,
          port: target.port,
          latencyMs: 0,
          summary: "Connection probe failed",
          detail: String(error),
        },
      }));
    } finally {
      setTestingTab(null);
    }
  };

  const discoveryKind = (id: SettingsTab): string => {
    const kinds: Partial<Record<SettingsTab, string>> = {
      aoip: "aoip",
      slides: "slides",
      ipVideo: "ipvideo",
      station: "station",
    };
    return kinds[id] ?? id;
  };

  const runDiscovery = async (id: SettingsTab) => {
    setDiscoveringTab(id);
    setDiscoverNotes((previous) => ({ ...previous, [id]: undefined }));
    try {
      const devices = await discoverLanDevices(discoveryKind(id));
      setDiscoveredByTab((previous) => ({ ...previous, [id]: devices }));
      setDiscoverNotes((previous) => ({
        ...previous,
        [id]:
          devices.length === 0
            ? "No devices responded on the local network."
            : `${devices.length} device(s) found.`,
      }));
    } catch (error) {
      setDiscoverNotes((previous) => ({
        ...previous,
        [id]: `Discovery failed: ${String(error)}`,
      }));
    } finally {
      setDiscoveringTab(null);
    }
  };

  const applyDiscovered = (id: SettingsTab, value: string) => {
    if (value === "") return;
    const device = discoveredByTab[id]?.[Number(value)];
    if (!device) return;
    if (id === "aoip") {
      patchSection("aoip", {
        subnetInterface: device.host,
        conmonMeterPort: isValidPort(device.port) ? device.port : draft.aoip.conmonMeterPort,
      });
    } else if (id === "slides") {
      patchSection("slides", {
        displayAssignments: {
          ...draft.slides.displayAssignments,
          fohWindow: device.name || device.host,
        },
      });
    } else if (id === "ipVideo") {
      patchSection("ipVideoPtz", {
        discoveryRangeStart: device.host,
        ptzIpPort: isValidPort(device.port) ? device.port : draft.ipVideoPtz.ptzIpPort,
      });
    } else if (id === "station") {
      patchSection("sync", {
        hubAddress: `ws://${device.host}:${device.port}`,
        syncPort: isValidPort(device.port) ? device.port : draft.sync.syncPort,
      });
    }
    setDiscoverNotes((previous) => ({
      ...previous,
      [id]: `Applied ${device.name} — review the values, then save.`,
    }));
  };

  const resetTab = async (id: SettingsTab) => {
    let next = cloneSettings(draft);
    for (const section of TAB_SECTIONS[id]) {
      if (section === "sync") {
        // Sync rides alongside Station; the backend resets only named settings sections.
        const replacement = { ...next } as unknown as Record<string, unknown>;
        replacement.sync = structuredClone(DEFAULT_SECTIONS.sync);
        next = replacement as unknown as AppSettings;
        continue;
      }
      try {
        const result = await resetSettingsSection(section);
        if (result) {
          next = { ...next, ...result.settings };
          continue;
        }
      } catch {
        // Use local defaults when the section reset is unavailable.
      }
      const replacement = { ...next } as unknown as Record<string, unknown>;
      replacement[section] = structuredClone(DEFAULT_SECTIONS[section]);
      next = replacement as unknown as AppSettings;
    }
    if (id === "ipVideo") {
      setCameraRoster([]);
      try {
        localStorage.removeItem(CAMERA_ROSTER_KEY);
      } catch {
        // Local persistence is best-effort.
      }
    }
    setDraft(next);
    setSaveNote(`${TABS.find((entry) => entry.id === id)?.label ?? "Tab"} restored to defaults — save to apply.`);
  };

  const applyRelay = async () => {
    if (relayMode !== "disabled" && (!isValidEndpoint(relay.endpointUrl) || (relay.statsWebhookUrl && !isValidEndpoint(relay.statsWebhookUrl)))) {
      setRelayNote("Fix the relay endpoint URLs before applying the configuration.");
      return;
    }
    const config: AudienceRelayConfig = {
      ...relay,
      enabled: relayMode !== "disabled",
      mode: relayMode === "disabled" ? "websocket" : relayMode,
    };
    setRelayBusy(true);
    try {
      const note = await configureAudienceRelay(config);
      setRelay(config);
      try {
        persistRelayConfig(config);
      } catch {
        // Local persistence is best-effort.
      }
      setRelayNote(note);
    } catch (error) {
      setRelayNote(`Relay configuration could not be applied: ${String(error)}`);
    } finally {
      setRelayBusy(false);
    }
  };

  const exportDiagnostics = async () => {
    try {
      const bundle = await exportDiagnosticBundle();
      downloadJson("onering-diagnostics.json", bundle);
      setBundleNote("Sanitized diagnostics exported. Credentials and file paths were redacted.");
    } catch (error) {
      setBundleNote(`Diagnostics export failed: ${String(error)}`);
    }
  };

  const exportProfile = async () => {
    try {
      const bundle = await exportSettingsBundle();
      downloadJson("onering-settings-profile.json", bundle);
      setBundleNote("Settings profile exported. Profile files may contain credentials.");
    } catch (error) {
      setBundleNote(`Settings export failed: ${String(error)}`);
    }
  };

  const importProfile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = await file.text();
      const result = await importSettingsBundle(payload);
      if (!result) {
        setBundleNote("Import failed: the selected file is not a settings profile.");
        return;
      }
      const applyNow = window.confirm(
        "Import and apply this settings profile now? This will replace your current saved settings. Choose Cancel to load it into the draft for review instead."
      );
      if (applyNow) {
        try {
          await Promise.resolve(onSave(cloneSettings(result.settings)));
          setBundleNote("Settings profile imported and saved.");
          setSaveError(null);
        } catch (error) {
          setBundleNote(`Settings profile was read, but could not be saved: ${String(error)}`);
          setDraft(cloneSettings(result.settings));
        }
      } else {
        setDraft(cloneSettings(result.settings));
        setBundleNote("Imported into draft — review the changes, then save when ready.");
      }
    } catch (error) {
      setBundleNote(`Import failed: ${String(error)}`);
    } finally {
      event.target.value = "";
    }
  };

  const renderDisplaySelect = (
    value: string,
    onChange: (next: string) => void,
    ariaLabel: string
  ) => {
    const options = [...hostDisplays];
    const hasCurrent = Boolean(value) && !options.some((display) => display.id === value || display.name === value);
    return (
      <select
        aria-label={ariaLabel}
        style={inputStyle}
        className="mono"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Unassigned</option>
        {hasCurrent && <option value={value}>{value} (current)</option>}
        {options.map((display) => {
          const label = `${display.name}${display.primary ? " (Primary)" : ""} — ${display.width}x${display.height} @ ${display.x},${display.y}`;
          const optionValue = display.id || display.name;
          return (
            <option key={display.id || `${display.name}-${display.x}-${display.y}`} value={optionValue}>
              {label}
            </option>
          );
        })}
      </select>
    );
  };

  const renderToolbar = (id: SettingsTab) => {
    const result = testResults[id];
    const devices = discoveredByTab[id] ?? [];
    const level = healthLevelForTab(id);
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {HARDWARE_TABS.includes(id) && (
            <button
              type="button"
              className="btn"
              onClick={() => void runConnectionTest(id)}
              disabled={testingTab === id}
              style={{ height: 34, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
            >
              <Wifi size={14} /> {testingTab === id ? "Testing…" : "Test Connection"}
            </button>
          )}
          {result && (
            <span
              className="mono"
              title={result.detail}
              style={{
                fontSize: 11,
                padding: "4px 9px",
                borderRadius: 999,
                border: `1px solid ${result.ok ? "#10B981" : "#EF4444"}`,
                background: result.ok ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                color: result.ok ? "#34D399" : "#F87171",
              }}
            >
              {result.ok ? `${result.latencyMs} ms` : result.summary}
            </span>
          )}
          {!result && level !== "none" && (
            <span className="mono" style={{ fontSize: 11, color: "#6B7280" }}>
              Live status: {level}
            </span>
          )}
          {DISCOVERY_TABS.includes(id) && (
            <button
              type="button"
              className="btn"
              onClick={() => void runDiscovery(id)}
              disabled={discoveringTab === id}
              style={{ height: 34, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
            >
              <RefreshCw size={14} /> {discoveringTab === id ? "Discovering…" : "Auto-Discover LAN"}
            </button>
          )}
          {devices.length > 0 && (
            <select
              aria-label="Discovered device"
              style={{ ...inputStyle, width: "auto", minWidth: 230, height: 34 }}
              value=""
              onChange={(event) => applyDiscovered(id, event.target.value)}
            >
              <option value="">Select a discovered device…</option>
              {devices.map((device, index) => (
                <option key={`${device.host}:${device.port}:${index}`} value={index}>
                  {device.name} — {device.host}:{device.port}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => void resetTab(id)}
            style={{
              height: 34,
              padding: "0 12px",
              fontSize: 12,
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <RotateCcw size={14} /> Reset This Tab to Defaults
          </button>
        </div>
        {discoverNotes[id] && DISCOVERY_TABS.includes(id) && (
          <div style={{ fontSize: 11, color: "#9CA3AF" }}>{discoverNotes[id]}</div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: 20, maxWidth: 1220, margin: "0 auto" }}>
      {/* Desktop: Remote Pairing card inside SettingsView; mobile uses MobileAppShell */}
      {isDesktop && (
        <RemoteControlView state={state} setState={() => {}} />
      )}

      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 0 12px",
          marginBottom: 14,
          background: "rgba(11,13,16,0.97)",
          borderBottom: "1px solid #252C38",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>Settings &amp; Device Configuration</h2>
          <p style={{ margin: "4px 0 0", color: "#9CA3AF", fontSize: 13 }}>
            Configure every production domain, verify links, and maintain the booth installation.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
            onClick={() => void handleSave()}
            disabled={!dirty || !isValid}
            title={!isValid ? "Resolve validation errors before saving." : undefined}
            style={{
              height: 38,
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: dirty && isValid ? "#2563EB" : "#1C222D",
              borderColor: dirty && isValid ? "#60A5FA" : "#2E3746",
            }}
          >
            <Save size={14} /> Save Configuration
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void installNativeUpdate((pct) => setUpdateProgress(pct))}
            disabled={updateInstalling || (!updateAvailable && !updateChecking)}
            style={{
              height: 38,
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: updateInstalling ? "#6B46C1" : updateAvailable || updateChecking ? "#3B82F6" : "#1C222D",
              borderColor: updateInstalling ? "#9F7AFF" : updateAvailable || updateChecking ? "#60A5FA" : "#2E3746",
              color: updateInstalling ? "#FACDCD" : undefined,
            }}
          >
            {updateInstalling
              ? `Installing... ${updateProgress ? updateProgress + "%" : ""}`
              : updateAvailable || updateChecking
              ? `Update & Restart ${updateProgress ? `(${updateProgress}%)` : ""}`
              : "Update & Restart"}
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, position: "relative" }}>
        <Search size={15} color="#9CA3AF" />
        <input
          aria-label="Search settings"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search settings, sections, endpoints…"
          style={{ ...inputStyle, paddingLeft: 12 }}
        />
        {search && (
          <button
            type="button"
            aria-label="Clear settings search"
            onClick={() => setSearch("")}
            style={{ background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer" }}
          >
            <X size={15} />
          </button>
        )}
        {query && (
          <span className="mono" style={{ fontSize: 11, color: "#9CA3AF", whiteSpace: "nowrap" }}>
            {visibleTabs.length} tab(s) match
          </span>
        )}
      </div>

      {pendingTab && (
        <div
          style={{
            marginBottom: 14,
            padding: "12px 14px",
            borderRadius: 8,
            background: "rgba(245,158,11,0.12)",
            border: "1px solid #F59E0B",
            color: "#FBBF24",
            fontSize: 12,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>
            You have unsaved changes. Save them, discard them, or stay on this tab before switching to{" "}
            <strong>{TABS.find((entry) => entry.id === pendingTab)?.label}</strong>.
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => void resolvePendingTab(true)}
            disabled={!isValid}
            style={{ height: 30, padding: "0 10px", fontSize: 11 }}
          >
            Save &amp; switch
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void resolvePendingTab(false)}
            style={{ height: 30, padding: "0 10px", fontSize: 11 }}
          >
            Discard &amp; switch
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setPendingTab(null)}
            style={{ height: 30, padding: "0 10px", fontSize: 11 }}
          >
            Stay here
          </button>
        </div>
      )}

      {dirty && !pendingTab && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(245,158,11,0.10)",
            border: "1px solid #92400E",
            color: "#FBBF24",
            fontSize: 12,
          }}
        >
          Unsaved changes in:{" "}
          {dirtyTabs.length > 0
            ? dirtyTabs.map((id) => TABS.find((entry) => entry.id === id)?.label).join(", ")
            : "this tab"}
          . Save or revert before leaving this page.
        </div>
      )}

      {validationGroups.length > 0 && (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: "12px 14px",
            borderRadius: 8,
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#FCA5A5",
            fontSize: 12,
            display: "grid",
            gap: 10,
          }}
        >
          <strong>Fix these settings before saving:</strong>
          {validationGroups.map((group) => (
            <div
              key={group.tabId}
              style={{
                display: "grid",
                gap: 6,
                paddingTop: 8,
                borderTop: "1px solid rgba(239,68,68,0.35)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 700 }}>
                  {group.label} — {group.messages.length} issue{group.messages.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => requestTab(group.tabId)}
                  style={{ height: 28, padding: "0 10px", fontSize: 11 }}
                >
                  Go to {group.label}
                </button>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                {group.messages.map((message, index) => (
                  <li key={`${group.tabId}-${index}`}>{message}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#FCA5A5",
            fontSize: 12,
          }}
        >
          {saveError}
        </div>
      )}

      {saveNote && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(16,185,129,0.12)",
            border: "1px solid #10B981",
            color: "#34D399",
            fontSize: 12,
          }}
        >
          {saveNote}
        </div>
      )}

      {bundleNote && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(37,99,235,0.12)",
            border: "1px solid #60A5FA",
            color: "#93C5FD",
            fontSize: 12,
          }}
        >
          {bundleNote}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {visibleTabs.map((entry) => {
          const level = healthLevelForTab(entry.id);
          const matched =
            query.length > 0 &&
            `${entry.label} ${entry.id} ${SEARCH_KEYWORDS[entry.id]}`.toLowerCase().includes(query);
          const isDirty = dirtyTabs.includes(entry.id);
          const healthText =
            level === "ok" ? "OK" : level === "warn" ? "Warn" : level === "error" ? "Error" : "—";
          return (
            <button
              key={entry.id}
              type="button"
              className="btn"
              aria-pressed={tab === entry.id}
              onClick={() => requestTab(entry.id)}
              style={{
                minHeight: 40,
                padding: "6px 12px",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                background: tab === entry.id ? "#2563EB" : "#1C222D",
                borderColor: matched ? "#FBBF24" : tab === entry.id ? "#60A5FA" : "#2E3746",
              }}
            >
              {entry.icon}
              {entry.label}
              {isDirty && (
                <span
                  title="Unsaved changes in this tab"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#92400E",
                    background: "#FBBF24",
                    borderRadius: 999,
                    padding: "1px 6px",
                  }}
                >
                  <span aria-hidden="true">●</span> Unsaved
                </span>
              )}
              <span
                title={`Connection status: ${level}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#E5E7EB",
                  border: `1px solid ${statusColor[level]}`,
                  borderRadius: 999,
                  padding: "1px 6px",
                }}
              >
                <span aria-hidden="true" style={{ color: statusColor[level] }}>
                  {level === "ok" ? "✓" : level === "warn" ? "!" : level === "error" ? "×" : "•"}
                </span>
                {healthText}
              </span>
            </button>
          );
        })}
        {visibleTabs.length === 0 && (
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>
            No settings tabs match “{search}”.{" "}
            <button
              type="button"
              onClick={() => setSearch("")}
              style={{ background: "transparent", border: "none", color: "#60A5FA", cursor: "pointer" }}
            >
              Clear search
            </button>
          </div>
        )}
      </div>

      {tab === "console" && visibleTabs.some((entry) => entry.id === "console") && (
        <div className="card" style={cardStyle}>
          {renderToolbar("console")}
          <h3 style={{ margin: 0 }}>Audio Mixing — Console Control</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="Mixer IP address" hint="IPv4 address or hostname of the mixing console on the control VLAN." error={validation.consoleIp}>
              <input
                style={inputWithError(validation.consoleIp)}
                className="mono"
                value={draft.console.ipAddress}
                onChange={(event) => patchSection("console", { ipAddress: event.target.value })}
                placeholder="192.0.2.50"
              />
            </Field>
            <Field label="OSC port" hint="UDP control port. Console default is 10023." error={validation.consolePort}>
              <NumericInput
                style={inputWithError(validation.consolePort)}
                className="mono"
                min={1}
                max={65535}
                value={draft.console.oscPort}
                onCommit={(oscPort) => patchSection("console", { oscPort })}
              />
            </Field>
            <Field label="Keepalive interval (s)" hint="Keepalive subscription refresh cadence." error={validation.keepalive}>
              <NumericInput
                style={inputWithError(validation.keepalive)}
                className="mono"
                min={1}
                max={120}
                value={draft.console.keepaliveIntervalSec}
                onCommit={(keepaliveIntervalSec) => patchSection("console", { keepaliveIntervalSec })}
              />
            </Field>
          </div>

          <SubSection
            title="Channel → DCA mappings"
            description="Bind the source channels that feed each show DCA used by the cue engine."
            keywords="channel dca mapping source"
            search={search}
          >
            <div style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={importShowChannels}
                disabled={state.dcas.length === 0}
                style={{ height: 32, padding: "0 11px", fontSize: 12 }}
              >
                Import channels from show file
              </button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {draft.console.dcaMappings.map((mapping) => (
                <div
                  key={mapping.dcaId}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "center" }}
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
                    onChange={(event) => updateDcaMapping(mapping.dcaId, event.target.value)}
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

      {tab === "aoip" && visibleTabs.some((entry) => entry.id === "aoip") && (
        <div className="card" style={cardStyle}>
          {renderToolbar("aoip")}
          <h3 style={{ margin: 0 }}>Audio Network</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="Network interface" hint="NIC used for audio-network discovery and metering traffic.">
              <input
                style={inputStyle}
                className="mono"
                list="aoip-interfaces"
                value={draft.aoip.subnetInterface}
                onChange={(event) => patchSection("aoip", { subnetInterface: event.target.value })}
                placeholder="Auto (default route)"
              />
              <datalist id="aoip-interfaces">
                <option value="Auto (default route)" />
                <option value="en0 — Audio VLAN" />
                <option value="en1 — Wi-Fi" />
                <option value="eth0 — Audio VLAN" />
                <option value="192.0.2.0/24" />
              </datalist>
            </Field>
            <Field label="Metering UDP port" hint="Peak metering UDP port. Default 8751." error={validation.aoipMeterPort}>
              <NumericInput
                style={inputWithError(validation.aoipMeterPort)}
                className="mono"
                min={1}
                max={65535}
                value={draft.aoip.conmonMeterPort}
                onCommit={(conmonMeterPort) => patchSection("aoip", { conmonMeterPort })}
              />
            </Field>
            <Field label="Control UDP port" hint="Device control / identify channel. Default 8700." error={validation.aoipControlPort}>
              <NumericInput
                style={inputWithError(validation.aoipControlPort)}
                className="mono"
                min={1}
                max={65535}
                value={draft.aoip.conmonControlPort}
                onCommit={(conmonControlPort) => patchSection("aoip", { conmonControlPort })}
              />
            </Field>
          </div>

          <SubSection
            title="Clock Sync Warning Thresholds"
            description="Raise a warning or error when timing offset exceeds these millisecond thresholds."
            keywords="clock timing ptp threshold warning error"
            search={search}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="Warning at (ms)" hint="Amber health status." error={validation.clockThresholds}>
                <NumericInput
                  style={inputWithError(validation.clockThresholds)}
                  className="mono"
                  min={1}
                  value={draft.aoip.clockSyncWarnMs}
                  onCommit={(clockSyncWarnMs) => patchSection("aoip", { clockSyncWarnMs })}
                />
              </Field>
              <Field label="Error at (ms)" hint="Red health status / preflight failure." error={validation.clockThresholds}>
                <NumericInput
                  style={inputWithError(validation.clockThresholds)}
                  className="mono"
                  min={1}
                  value={draft.aoip.clockSyncErrorMs}
                  onCommit={(clockSyncErrorMs) => patchSection("aoip", { clockSyncErrorMs })}
                />
              </Field>
            </div>
          </SubSection>
        </div>
      )}

      {tab === "broadcast" && visibleTabs.some((entry) => entry.id === "broadcast") && (
        <div className="card" style={cardStyle}>
          {renderToolbar("broadcast")}
          <h3 style={{ margin: 0 }}>Multi-Destination Streaming</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn" onClick={() => addDestination("videoPlatform")} style={{ height: 32, padding: "0 11px", fontSize: 12 }}>
              <Plus size={13} /> Add Live Destination
            </button>
            <button type="button" className="btn" onClick={() => addDestination("socialPlatform")} style={{ height: 32, padding: "0 11px", fontSize: 12 }}>
              <Plus size={13} /> Add Social Destination
            </button>
            <button type="button" className="btn" onClick={() => addDestination("custom")} style={{ height: 32, padding: "0 11px", fontSize: 12 }}>
              <Plus size={13} /> Add Custom Destination
            </button>
          </div>

          {draft.broadcast.destinations.map((destination) => (
            <SubSection
              key={destination.id}
              title={destination.platform}
              description={`Destination ID: ${destination.id}`}
              keywords="stream destination rtmp key ingest"
              search={search}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "end" }}>
                <Field label="Platform label">
                  <input
                    style={inputStyle}
                    value={destination.platform}
                    onChange={(event) => updateDestination(destination.id, { platform: event.target.value })}
                    placeholder="Primary stream"
                  />
                </Field>
                <Field label="Ingest URL" error={validation[`rtmp-${destination.id}`]}>
                  <input
                    style={inputWithError(validation[`rtmp-${destination.id}`])}
                    className="mono"
                    value={destination.rtmpUrl}
                    onChange={(event) => updateDestination(destination.id, { rtmpUrl: event.target.value })}
                    placeholder="rtmps://ingest.example.com/live2"
                  />
                </Field>
                <Field label="Stream key">
                  <SecretInput
                    ariaLabel={`Stream key for ${destination.platform}`}
                    value={destination.streamKey}
                    onChange={(value) => updateDestination(destination.id, { streamKey: value })}
                    visible={Boolean(showSecrets[`stream-${destination.id}`])}
                    onToggle={() => toggleSecret(`stream-${destination.id}`)}
                    placeholder="Paste stream key"
                  />
                </Field>
                <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      height: 38,
                      fontSize: 12,
                      fontWeight: 700,
                      color: destination.enabled ? "#34D399" : "#9CA3AF",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={destination.enabled}
                      onChange={(event) => updateDestination(destination.id, { enabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => removeDestination(destination.id)}
                    title="Remove destination"
                    style={{ height: 30, padding: "0 9px", fontSize: 11, color: "#F87171" }}
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              </div>
            </SubSection>
          ))}

          {draft.broadcast.destinations.length === 0 && (
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>
              No destinations configured. Add one above, then supply an rtmp:// or rtmps:// ingest URL.
            </div>
          )}

          <SubSection
            title="Local recording"
            description="Applied to recording outputs and chapter marks."
            keywords="recording path container encoder"
            search={search}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="Recording path" hint="Folder or filename stem for service recordings.">
                <input
                  style={inputStyle}
                  className="mono"
                  value={draft.broadcast.recordingPath}
                  onChange={(event) => patchSection("broadcast", { recordingPath: event.target.value })}
                  placeholder="/recordings/service"
                />
              </Field>
              <Field label="Container format">
                <select
                  style={inputStyle}
                  value={draft.broadcast.recordingFormat}
                  onChange={(event) =>
                    patchSection("broadcast", {
                      recordingFormat: event.target.value as RecordingFormat,
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
                  onChange={(event) =>
                    patchSection("broadcast", { encoder: event.target.value as VideoEncoder })
                  }
                >
                  <option value="HardwareGpu">Hardware GPU</option>
                  <option value="HardwareMedia">Hardware Media</option>
                  <option value="Software">Software encoder</option>
                </select>
              </Field>
            </div>
          </SubSection>

          <SubSection
            title="Live Audience Chat & Telemetry Relay"
            description="Relay moderated chat and viewer telemetry into the production control surface."
            keywords="audience chat telemetry relay websocket webhook irc viewer token endpoint"
            search={search}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="Relay mode">
                <select
                  style={inputStyle}
                  value={relayMode}
                  onChange={(event) => setRelayMode(event.target.value as RelayMode)}
                >
                  <option value="disabled">Disabled</option>
                  <option value="websocket">WebSocket</option>
                  <option value="webhook">Webhook</option>
                  <option value="irc">IRC bridge</option>
                </select>
              </Field>
              <Field label="Endpoint URL" error={relayMode !== "disabled" ? validation.relayEndpoint : undefined}>
                <input
                  style={inputWithError(relayMode !== "disabled" ? validation.relayEndpoint : undefined)}
                  className="mono"
                  value={relay.endpointUrl}
                  onChange={(event) => setRelay({ ...relay, endpointUrl: event.target.value })}
                  placeholder="wss://relay.example.com/socket"
                  disabled={relayMode === "disabled"}
                />
              </Field>
              <Field label="Channel">
                <input
                  style={inputStyle}
                  className="mono"
                  value={relay.channelName}
                  onChange={(event) => setRelay({ ...relay, channelName: event.target.value })}
                  placeholder="Program"
                  disabled={relayMode === "disabled"}
                />
              </Field>
              <Field label="Auth token">
                <SecretInput
                  ariaLabel="Relay auth token"
                  value={relay.authToken}
                  onChange={(value) => setRelay({ ...relay, authToken: value })}
                  visible={Boolean(showSecrets["relay-token"])}
                  onToggle={() => toggleSecret("relay-token")}
                  placeholder="Paste relay token"
                />
              </Field>
              <Field label="Viewer count poll URL" error={relayMode !== "disabled" ? validation.relayStats : undefined}>
                <input
                  style={inputWithError(relayMode !== "disabled" ? validation.relayStats : undefined)}
                  className="mono"
                  value={relay.statsWebhookUrl}
                  onChange={(event) => setRelay({ ...relay, statsWebhookUrl: event.target.value })}
                  placeholder="https://stats.example.com/viewers"
                  disabled={relayMode === "disabled"}
                />
              </Field>
              <Field label="Host display name">
                <input
                  style={inputStyle}
                  value={relay.hostDisplayName}
                  onChange={(event) => setRelay({ ...relay, hostDisplayName: event.target.value })}
                  placeholder="Host"
                  disabled={relayMode === "disabled"}
                />
              </Field>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 12 }}>
              <button
                type="button"
                className="btn"
                onClick={() => void applyRelay()}
                disabled={relayBusy}
                style={{ height: 34, padding: "0 13px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                <Radio size={14} /> {relayBusy ? "Applying…" : "Apply Relay Config"}
              </button>
              {relayNote && <span style={{ fontSize: 11, color: "#9CA3AF" }}>{relayNote}</span>}
            </div>
          </SubSection>

          <button
            type="button"
            className="btn"
            onClick={() => onOpenBroadcastSettings?.()}
            style={{ height: 38, padding: "0 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 8, justifySelf: "start" }}
          >
            <Zap size={14} /> Open Advanced Broadcast &amp; Hardware Encoder Settings
          </button>
        </div>
      )}

      {tab === "slides" && visibleTabs.some((entry) => entry.id === "slides") && (
        <div className="card" style={cardStyle}>
          {renderToolbar("slides")}
          <h3 style={{ margin: 0 }}>Slides & Presentation</h3>
          <SubSection
            title="Song Library Credentials"
            description="OAuth credentials for song search & import. Stored locally on the production machine."
            keywords="song library credentials oauth client secret"
            search={search}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="OAuth client ID">
                <input
                  style={inputStyle}
                  className="mono"
                  value={draft.slides.songLibraryClientId}
                  onChange={(event) =>
                    patchSection("slides", { songLibraryClientId: event.target.value })
                  }
                  placeholder="Library client ID"
                />
              </Field>
              <Field label="OAuth client secret">
                <SecretInput
                  ariaLabel="Song library client secret"
                  value={draft.slides.songLibraryClientSecret}
                  onChange={(value) => patchSection("slides", { songLibraryClientSecret: value })}
                  visible={Boolean(showSecrets["song-secret"])}
                  onToggle={() => toggleSecret("song-secret")}
                  placeholder="Library client secret"
                />
              </Field>
            </div>
          </SubSection>

          <SubSection
            title="Physical Display Assignment"
            description="Choose which output surface receives each presentation role."
            keywords="display assignment foh stage multiview output"
            search={search}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="FOH Display" hint="Operator preview / FOH output window.">
                {renderDisplaySelect(
                  draft.slides.displayAssignments.fohWindow,
                  (next) =>
                    patchSection("slides", {
                      displayAssignments: { ...draft.slides.displayAssignments, fohWindow: next },
                    }),
                  "FOH Display"
                )}
              </Field>
              <Field label="Stage Display" hint="Confidence lyrics / clock output.">
                {renderDisplaySelect(
                  draft.slides.displayAssignments.stageDisplayWindow,
                  (next) =>
                    patchSection("slides", {
                      displayAssignments: {
                        ...draft.slides.displayAssignments,
                        stageDisplayWindow: next,
                      },
                    }),
                  "Stage Display"
                )}
              </Field>
              <Field label="Multiview Output" hint="Multiview / alpha key or secondary output window.">
                {renderDisplaySelect(
                  draft.slides.displayAssignments.ipVideoAlphaOutput,
                  (next) =>
                    patchSection("slides", {
                      displayAssignments: {
                        ...draft.slides.displayAssignments,
                        ipVideoAlphaOutput: next,
                      },
                    }),
                  "Multiview Output"
                )}
              </Field>
            </div>
          </SubSection>
        </div>
      )}

      {tab === "ipVideo" && visibleTabs.some((entry) => entry.id === "ipVideo") && (
        <div className="card" style={cardStyle}>
          {renderToolbar("ipVideo")}
          <h3 style={{ margin: 0 }}>Cameras & Discovery</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="Discovery range start" hint="First IPv4 address swept for cameras." error={validation.rangeStart}>
              <input
                style={inputWithError(validation.rangeStart)}
                className="mono"
                value={draft.ipVideoPtz.discoveryRangeStart}
                onChange={(event) =>
                  patchSection("ipVideoPtz", { discoveryRangeStart: event.target.value })
                }
                placeholder="192.0.2.1"
              />
            </Field>
            <Field label="Discovery range end" hint="Last IPv4 address in the sweep." error={validation.rangeEnd}>
              <input
                style={inputWithError(validation.rangeEnd)}
                className="mono"
                value={draft.ipVideoPtz.discoveryRangeEnd}
                onChange={(event) =>
                  patchSection("ipVideoPtz", { discoveryRangeEnd: event.target.value })
                }
                placeholder="192.0.2.254"
              />
            </Field>
            <Field label="Camera control UDP port" hint="Camera control UDP port. Default 52381." error={validation.ptzPort}>
              <NumericInput
                style={inputWithError(validation.ptzPort)}
                className="mono"
                min={1}
                max={65535}
                value={draft.ipVideoPtz.ptzIpPort}
                onCommit={(ptzIpPort) => patchSection("ipVideoPtz", { ptzIpPort })}
              />
            </Field>
          </div>

          <SubSection
            title="PTZ Camera Roster"
            description="Maintain the camera endpoints available to the camera operator."
            keywords="camera roster ptz name ip port"
            search={search}
          >
            <div style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={addCamera}
                style={{ height: 32, padding: "0 11px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                <Plus size={13} /> Add Camera
              </button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {cameras.map((camera) => (
                <div
                  key={camera.id}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, alignItems: "start" }}
                >
                  <Field label="Name" error={validation[`camera-name-${camera.id}`]}>
                    <input
                      style={inputWithError(validation[`camera-name-${camera.id}`])}
                      value={camera.name}
                      onChange={(event) => updateCamera(camera.id, { name: event.target.value })}
                      placeholder="Stage Wide"
                    />
                  </Field>
                  <Field label="IP address" error={validation[`camera-ip-${camera.id}`]}>
                    <input
                      style={inputWithError(validation[`camera-ip-${camera.id}`])}
                      className="mono"
                      value={camera.ipAddress}
                      onChange={(event) => updateCamera(camera.id, { ipAddress: event.target.value })}
                      placeholder="192.0.2.21"
                    />
                  </Field>
                  <Field label="Port" error={validation[`camera-port-${camera.id}`]}>
                    <NumericInput
                      style={inputWithError(validation[`camera-port-${camera.id}`])}
                      className="mono"
                      min={1}
                      max={65535}
                      value={camera.port}
                      onCommit={(port) => updateCamera(camera.id, { port })}
                    />
                  </Field>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => removeCamera(camera.id)}
                    title="Remove camera"
                    style={{ height: 38, padding: "0 9px", color: "#F87171" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {cameras.length === 0 && (
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                  No cameras in the roster yet. Add one manually or use Auto-Discover LAN.
                </div>
              )}
            </div>
          </SubSection>

          <SubSection
            title="Camera Preset Naming"
            description="Friendly labels shown on Show Mode preset buttons."
            keywords="preset naming label camera"
            search={search}
          >
            <div style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={importShowPresets}
                disabled={state.cameras.length === 0}
                style={{ height: 32, padding: "0 11px", fontSize: 12 }}
              >
                Import names from show file
              </button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {draft.ipVideoPtz.presetNames.map((preset) => (
                <div
                  key={preset.presetId}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "center" }}
                >
                  <div className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                    {preset.cameraId} / {preset.presetId}
                  </div>
                  <input
                    style={inputStyle}
                    value={preset.label}
                    onChange={(event) => updatePresetName(preset.presetId, event.target.value)}
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

      {tab === "station" && visibleTabs.some((entry) => entry.id === "station") && (
        <div className="card" style={cardStyle}>
          {renderToolbar("station")}
          <h3 style={{ margin: 0 }}>Station & Sync</h3>
          <SubSection
            title="Station Identity"
            description="Describe this physical workstation and how far its navigation should be locked."
            keywords="station role name lock booth"
            search={search}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "end" }}>
              <Field label="Station role">
                <select
                  style={inputStyle}
                  value={draft.station.role}
                  onChange={(event) => patchSection("station", { role: event.target.value as StationRole })}
                >
                  <option value="slides">Slides operator</option>
                  <option value="audio">Audio operator</option>
                  <option value="broadcast">Broadcast operator</option>
                  <option value="director">Director</option>
                  <option value="master">Master control</option>
                </select>
              </Field>
              <Field label="Station name">
                <input
                  style={inputStyle}
                  value={draft.station.stationName}
                  onChange={(event) => patchSection("station", { stationName: event.target.value })}
                  placeholder="Booth A"
                />
              </Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38, fontSize: 12, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={draft.station.lockToRole}
                  onChange={(event) => patchSection("station", { lockToRole: event.target.checked })}
                />
                Lock to role
              </label>
            </div>
          </SubSection>

          <SubSection
            title="LAN & Cloud Sync"
            description="Peer discovery, hub transport, and optional cloud profile synchronization."
            keywords="sync lan hub cloud profile token email venue auto sync"
            search={search}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="Hub address" error={validation.hubAddress}>
                <input
                  style={inputWithError(validation.hubAddress)}
                  className="mono"
                  value={draft.sync.hubAddress}
                  onChange={(event) => patchSection("sync", { hubAddress: event.target.value })}
                  placeholder="ws://192.0.2.1:47800"
                />
              </Field>
              <Field label="Sync port" error={validation.syncPort}>
                <NumericInput
                  style={inputWithError(validation.syncPort)}
                  className="mono"
                  min={1}
                  max={65535}
                  value={draft.sync.syncPort}
                  onCommit={(syncPort) => patchSection("sync", { syncPort })}
                />
              </Field>
              <Field label="Profile name">
                <input
                  style={inputStyle}
                  value={draft.sync.profileName}
                  onChange={(event) => patchSection("sync", { profileName: event.target.value })}
                  placeholder="Main venue"
                />
              </Field>
              <Field label="Account email" error={validation.accountEmail}>
                <input
                  style={inputWithError(validation.accountEmail)}
                  value={draft.sync.accountEmail}
                  onChange={(event) => patchSection("sync", { accountEmail: event.target.value })}
                  placeholder="operator@example.com"
                  disabled={!draft.sync.cloudSyncEnabled}
                />
              </Field>
              <Field label="Venue ID">
                <input
                  style={inputStyle}
                  className="mono"
                  value={draft.sync.venueId}
                  onChange={(event) => patchSection("sync", { venueId: event.target.value })}
                  placeholder="venue-id"
                  disabled={!draft.sync.cloudSyncEnabled}
                />
              </Field>
              <Field label="Sync token">
                <SecretInput
                  ariaLabel="Sync token"
                  value={draft.sync.syncToken}
                  onChange={(value) => patchSection("sync", { syncToken: value })}
                  visible={Boolean(showSecrets["sync-token"])}
                  onToggle={() => toggleSecret("sync-token")}
                  placeholder="Paste sync token"
                />
              </Field>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={draft.sync.lanDiscoveryEnabled}
                  onChange={(event) => patchSection("sync", { lanDiscoveryEnabled: event.target.checked })}
                />
                LAN peer discovery
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={draft.sync.autoSyncOnLaunch}
                  onChange={(event) => patchSection("sync", { autoSyncOnLaunch: event.target.checked })}
                />
                Sync on launch
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={draft.sync.cloudSyncEnabled}
                  onChange={(event) => patchSection("sync", { cloudSyncEnabled: event.target.checked })}
                />
                Cloud profile sync
              </label>
              <span className="mono" style={{ fontSize: 11, color: "#6B7280", alignSelf: "center" }}>
                Last synced: {draft.sync.lastSyncedAt || "never"}
              </span>
            </div>
          </SubSection>
        </div>
      )}

      {tab === "general" && visibleTabs.some((entry) => entry.id === "general") && (
        <div className="card" style={cardStyle}>
          {renderToolbar("general")}
          <h3 style={{ margin: 0 }}>General</h3>
          <SubSection
            title="Engineer Mode PIN"
            description="Volunteer Show Mode stays locked to cue execution. Enter this PIN to unlock Engineer Mode."
            keywords="pin engineer mode unlock security"
            search={search}
          >
            <div style={{ maxWidth: 320 }}>
              <Field
                label="Unlock PIN"
                hint={validation.pin ? validation.pin : "4–8 digits. Stored in the local settings file."}
                error={validation.pin}
              >
                <SecretInput
                  ariaLabel="Engineer unlock PIN"
                  value={draft.general.engineerPin}
                  onChange={(value) => patchSection("general", { engineerPin: value.replace(/\D/g, "") })}
                  visible={Boolean(showSecrets["engineer-pin"])}
                  onToggle={() => toggleSecret("engineer-pin")}
                  placeholder="••••"
                  invalid={Boolean(validation.pin)}
                />
              </Field>
            </div>
          </SubSection>

          <SubSection
            title="Booth Display & Accessibility"
            description="Scale the interface and increase contrast for the booth environment. Changes apply after saving."
            keywords="booth display accessibility scale zoom contrast high ui"
            search={search}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="UI scale" hint="Applied to the document root after save.">
                <select
                  style={inputStyle}
                  value={normalizedUiScale(draft.general.uiScale)}
                  onChange={(event) => patchSection("general", { uiScale: Number(event.target.value) })}
                >
                  <option value={90}>90%</option>
                  <option value={100}>100%</option>
                  <option value={110}>110%</option>
                  <option value={125}>125%</option>
                </select>
              </Field>
              <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(draft.general.highContrast)}
                    onChange={(event) => patchSection("general", { highContrast: event.target.checked })}
                  />
                  High-Contrast Booth Mode
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={draft.general.confirmUnsavedLeave !== false}
                    onChange={(event) =>
                      patchSection("general", { confirmUnsavedLeave: event.target.checked })
                    }
                  />
                  Confirm before leaving with unsaved edits
                </label>
              </div>
            </div>
          </SubSection>

                    <SubSection
            title="AI Production Assistant"
            description="Power the built-in AI slide & service assistant using free OpenCode CLI models, local Ollama, or any HTTPS OpenAI-compatible endpoint."
          >
            {!aiStatus?.opencodeInstalled && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #1E3A5F",
                  background: "#131A26",
                }}
              >
                <div style={{ flex: 1, minWidth: 220, fontSize: 12, color: "#9CA3AF" }}>
                  OpenCode CLI is not installed yet. Install it in one click to use the free local models.
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={installingOpenCode || !aiStatus}
                  aria-busy={installingOpenCode}
                  onClick={() => void installOpenCode()}
                >
                  {installingOpenCode ? "Installing OpenCode CLI…" : "Install OpenCode CLI (Free)"}
                </button>
              </div>
            )}
            {aiStatus?.opencodeInstalled && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 12,
                  fontSize: 12,
                  color: aiStatus.available ? "#34D399" : "#FBBF24",
                }}
              >
                <Check size={13} /> OpenCode CLI detected{aiStatus.available ? " · ready" : ""}
              </div>
            )}
            {openCodeNote && (
              <div
                role="status"
                style={{
                  marginBottom: 12,
                  fontSize: 12,
                  color: aiStatus?.available ? "#34D399" : "#FBBF24",
                }}
              >
                {openCodeNote}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="AI provider" hint="OpenCode CLI uses free models locally with zero API keys.">
                <select
                  style={inputStyle}
                  value={draft.general.aiProvider ?? "opencode_cli"}
                  onChange={(e) => patchSection("general", { aiProvider: e.target.value })}
                >
                  <option value="opencode_cli">OpenCode CLI (Free Local Models)</option>
                  <option value="ollama">Ollama (Local Loopback)</option>
                  <option value="openai_compatible">OpenAI-Compatible HTTPS API</option>
                </select>
              </Field>
              <Field label="Model" hint="e.g. opencode/big-pickle or llama3.2">
                <input
                  style={inputStyle}
                  className="mono"
                  value={draft.general.aiModel ?? "opencode/big-pickle"}
                  onChange={(e) => patchSection("general", { aiModel: e.target.value })}
                  placeholder="opencode/big-pickle"
                />
              </Field>
              {(draft.general.aiProvider === "ollama" || draft.general.aiProvider === "openai_compatible") && (
                <Field label="Endpoint URL" hint="HTTPS URL or http://127.0.0.1:11434/v1/chat/completions">
                  <input
                    style={inputStyle}
                    className="mono"
                    value={draft.general.aiEndpoint ?? ""}
                    onChange={(e) => patchSection("general", { aiEndpoint: e.target.value })}
                    placeholder="http://127.0.0.1:11434/v1/chat/completions"
                  />
                </Field>
              )}
              {draft.general.aiProvider === "openai_compatible" && (
                <Field label="API key" hint="Stored in local settings.json (0600); redacted from diagnostics.">
                  <input
                    style={inputStyle}
                    className="mono"
                    type="password"
                    value={draft.general.aiApiKey ?? ""}
                    onChange={(e) => patchSection("general", { aiApiKey: e.target.value })}
                    placeholder="••••••••"
                  />
                </Field>
              )}
            </div>
          </SubSection>

<SubSection
            title="Crash Reporting"
            description="Opt in to sharing sanitized crash logs recorded during a previous session."
            keywords="crash reporting relay https privacy sanitized issue"
            search={search}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#D1D5DB",
                }}
              >
                <input
                  type="checkbox"
                  checked={draft.general.autoCrashReporting ?? false}
                  onChange={(event) =>
                    patchSection("general", { autoCrashReporting: event.target.checked })
                  }
                />
                Automatically send sanitized crash reports on startup
              </label>
              <Field label="Crash Relay Endpoint (HTTPS)" error={validation.crashRelay}>
                <input
                  style={inputWithError(validation.crashRelay)}
                  className="mono"
                  value={draft.general.crashRelayUrl ?? ""}
                  onChange={(event) =>
                    patchSection("general", { crashRelayUrl: event.target.value })
                  }
                  placeholder="https://your-crash-relay.workers.dev/crash"
                />
              </Field>
              <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.5 }}>
                Crash reports strip user paths, PINs, stream keys, and tokens. Leave relay blank to
                use one-click GitHub Issue reporting.
              </div>
            </div>
          </SubSection>

          <SubSection
            title="Operator & Maintenance"
            description="Installed build details, diagnostics, profiles, and local configuration access."
            keywords="version updates diagnostics profile export import config folder maintenance"
            search={search}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                App version
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "#0B0D10",
                  border: "1px solid #2E3746",
                  color: "#93C5FD",
                }}
              >
                v{APP_VERSION}
              </span>
              <Check size={14} color="#34D399" />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => onCheckUpdates?.()}
                style={{ height: 34, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                <Activity size={14} /> Check for Updates
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void openConfigDirectory()
                    .then((path) => setBundleNote(`Configuration folder: ${path}`))
                    .catch((error) => setBundleNote(`Could not open configuration folder: ${String(error)}`));
                }}
                style={{ height: 34, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                <FolderOpen size={14} /> Open Config Folder
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void exportDiagnostics()}
                style={{ height: 34, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                <Download size={14} /> Export Sanitized Diagnostics (.json)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void exportProfile()}
                style={{ height: 34, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                <Download size={14} /> Export Settings Profile (.json)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => importInputRef.current?.click()}
                style={{ height: 34, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                <Upload size={14} /> Import Settings Profile (.json)
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={(event) => void importProfile(event)}
              />
            </div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 10 }}>
              Diagnostics omit credentials, tokens, and local file paths. Settings profiles may contain
              credentials — store them securely.
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
