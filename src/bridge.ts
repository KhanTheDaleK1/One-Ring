import type {
  AppSettings,
  UpdateInfo,
  AppStateSnapshot,
  AudienceChatMessage,
  AudienceRelayConfig,
  BroadcastTarget,
  CapturableDisplay,
  CapturableWindow,
  ConnectionTestResult,
  CrashReportSummary,
  CueVerificationStep,
  DiscoveredLanDevice,
  NativeCaptureFrame,
  NativeCaptureSessionInfo,
  PreflightCheck,
  SceneSourceItem,
  SlideState,
  StreamStatsSnapshot,
} from "./types";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { applyShowFileToSnapshot } from "./showFile";
import type { RingShowFile } from "./types";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Public guard so UI components can keep native-only paths out of browser preview mode. */
export const isTauriRuntime = isTauri;

/** Update repository configured at build time; neutral fallback keeps the UI private. */
export const UPDATE_REPO_URL =
  (import.meta.env.VITE_UPDATE_REPO as string | undefined)?.trim() ||
  "https://example.com/one-ring";

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------------------------
// Engineer-mode lock — native command first, in-memory preview fallback stays fail-closed
// ---------------------------------------------------------------------------------------------

let simEngineerUnlocked = false;

/** Unlock engineer controls. The browser preview validates against the locally configured PIN. */
export async function unlockEngineerMode(pin: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const unlocked = await invokeTauri<boolean>("unlock_engineer_mode", { pin });
      simEngineerUnlocked = unlocked === true;
    } catch {
      simEngineerUnlocked = false;
    }
    return simEngineerUnlocked;
  }
  const trimmedPin = pin.trim();
  const configuredPin = simState.settings.general.engineerPin.trim();
  if (configuredPin.length === 0) {
    if (/^\d{4,8}$/.test(trimmedPin)) {
      simState = {
        ...simState,
        settings: {
          ...simState.settings,
          general: { ...simState.settings.general, engineerPin: trimmedPin },
        },
      };
      simEngineerUnlocked = true;
    } else {
      simEngineerUnlocked = false;
    }
  } else {
    simEngineerUnlocked = trimmedPin === configuredPin;
  }
  return simEngineerUnlocked;
}

/** Return to the volunteer-only surface and drop any in-memory unlock. */
export async function lockEngineerMode(): Promise<void> {
  simEngineerUnlocked = false;
  if (isTauri()) {
    try {
      await invokeTauri<void>("lock_engineer_mode");
    } catch {
      // The local lock is already applied; a missing host command must not reopen access.
    }
  }
}

/** Mirrors the native status command: true means engineer controls are currently unlocked. */
export async function getEngineerLockStatus(): Promise<boolean> {
  if (isTauri()) {
    try {
      return (await invokeTauri<boolean>("get_engineer_lock_status")) === true;
    } catch {
      return simEngineerUnlocked;
    }
  }
  return simEngineerUnlocked;
}

// ---------------------------------------------------------------------------------------------
// Cross-window sync validation — session nonce + strict payload/URL checks
// ---------------------------------------------------------------------------------------------

const SYNC_NONCE_KEY = "onering_sync_nonce";
let fallbackNonce: string | null = null;

function createNonce(): string {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** A random value shared only by windows in this session (never written to disk). */
export function getSessionNonce(): string {
  try {
    if (typeof sessionStorage !== "undefined") {
      const existing = sessionStorage.getItem(SYNC_NONCE_KEY);
      if (existing) return existing;
      const nonce = createNonce();
      sessionStorage.setItem(SYNC_NONCE_KEY, nonce);
      return nonce;
    }
  } catch {
    // Restricted webviews fall back to a per-document value.
  }
  if (!fallbackNonce) fallbackNonce = createNonce();
  return fallbackNonce;
}

/** Attach the session nonce to every payload we broadcast or persist for output windows. */
export function stampSyncPayload<T extends object>(payload: T): T & { nonce: string } {
  return { ...payload, nonce: getSessionNonce() };
}

/** Only `http(s)` and inline image data URLs may be used as cross-window media sources. */
export function isSafeMediaUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return false;
  const raw = value.trim();
  if (/[\u0000-\u001f\u007f"'\(\)\\<>]/.test(raw)) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return true;
  return parsed.protocol === "data:" && /^data:image\//i.test(raw);
}

const URL_FIELDS = new Set(["backgroundImage", "motionBackground", "url"]);

function containsUnsafeUrl(value: unknown, depth: number, seen: WeakSet<object>): boolean {
  if (depth > 12 || value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsUnsafeUrl(item, depth + 1, seen));
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (URL_FIELDS.has(key) && child !== undefined && child !== null && child !== "" && !isSafeMediaUrl(child)) {
      return true;
    }
    if (typeof child === "object" && containsUnsafeUrl(child, depth + 1, seen)) return true;
  }
  return false;
}

export type SyncPayloadKind =
  | "SLIDES_UPDATE"
  | "SLIDES_STATE"
  | "BROADCAST_SCENES_UPDATE"
  | "SOURCES_UPDATE"
  | "ACTIVE_SCENE_UPDATE"
  | "AUDIENCE_OVERLAY"
  | "STAGE_LAYOUT_UPDATE"
  | "SLIDE_EXTRAS_UPDATE"
  | "SLIDE_EXTRAS_STATE"
  | "SELECT_SCENE"
  | "WORKSPACE_AUTOSAVE";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSlideLike = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.currentSlide === "number" &&
  Number.isFinite(value.currentSlide) &&
  (value.slides === undefined || Array.isArray(value.slides));

const isSourceLike = (value: unknown): boolean =>
  isRecord(value) && typeof value.id === "string" && typeof value.type === "string" && isRecord(value.settings);

const isMessageLike = (value: unknown): boolean =>
  isRecord(value) && typeof value.id === "string" && typeof value.text === "string";

const isSceneLike = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === "string" &&
  Array.isArray(value.sources) &&
  value.sources.every(isSourceLike);

const STAGE_LAYOUTS = new Set(["classic", "clock_focus", "notes_focus"]);

/**
 * Strict gate for cross-window data. A nonce, when present, must belong to this session;
 * legacy producers without a nonce still get shape and media-URL validation.
 */
export function isTrustedSyncPayload(value: unknown, kind: SyncPayloadKind): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.nonce === "string" && value.nonce !== getSessionNonce()) return false;
  if (containsUnsafeUrl(value, 0, new WeakSet())) return false;

  switch (kind) {
    case "SLIDES_UPDATE":
      return isSlideLike(value.slides);
    case "SLIDES_STATE":
      return isSlideLike(value);
    case "BROADCAST_SCENES_UPDATE":
      return Array.isArray(value.scenes) && value.scenes.every(isSceneLike);
    case "SOURCES_UPDATE":
      return Array.isArray(value.sources) && value.sources.every(isSourceLike);
    case "ACTIVE_SCENE_UPDATE":
    case "SELECT_SCENE":
      return typeof value.sceneId === "string";
    case "AUDIENCE_OVERLAY":
      return value.message === null || isMessageLike(value.message);
    case "STAGE_LAYOUT_UPDATE":
      return STAGE_LAYOUTS.has(value.layout as string);
    case "SLIDE_EXTRAS_UPDATE":
      return Array.isArray(value.slides) && (value.theme === undefined || isRecord(value.theme));
    case "SLIDE_EXTRAS_STATE":
      return (
        (value.slides === undefined || Array.isArray(value.slides)) &&
        (value.theme === undefined || isRecord(value.theme))
      );
    case "WORKSPACE_AUTOSAVE":
      return (
        (value.slides === undefined || isSlideLike(value.slides)) &&
        (value.sources === undefined || (Array.isArray(value.sources) && value.sources.every(isSourceLike)))
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Event contract — mirrors src-tauri/src/runtime/events.rs
// ---------------------------------------------------------------------------------------------

export interface HealthEvent {
  deviceId: string;
  kind: string;
  label: string;
  status: "ok" | "warn" | "error" | "connecting" | "offline";
  detail: string;
  protocol: string;
  latencyMs: number;
}

export interface MeterChannel {
  key: string;
  label: string;
  db: number | null;
  peak: boolean;
  muted: boolean;
}

export interface MeterEvent {
  deviceId: string;
  domain: string;
  sequence: number;
  capturedAtMs: number;
  channels: MeterChannel[];
}

export interface StatePatchEvent {
  domain: string;
  revision: number;
  patch: Record<string, unknown>;
}

export interface CueProgressEvent {
  cueIndex: number;
  stepIndex: number;
  totalSteps: number;
  domain: string;
  status: "pending" | "running" | "applied" | "rehearsal" | "drift" | "failed";
  elapsedMs: number;
  error?: string | null;
}

const STATE_DOMAINS = [
  "console",
  "broadcast",
  "slides",
  "ip_video",
  "aoip",
  "log",
] as const;

const METER_DOMAINS = ["console", "aoip"] as const;

/** Apply a `device://health` transition, adding a row for a device we have not seen yet. */
export function applyHealthEvent(state: AppStateSnapshot, event: HealthEvent): AppStateSnapshot {
  const status: AppStateSnapshot["health"][number]["status"] =
    event.status === "ok" ? "ok" : event.status === "error" ? "error" : "warn";

  const existing = state.health.find((h) => h.id === event.deviceId);
  if (!existing) {
    return {
      ...state,
      health: [
        ...state.health,
        {
          id: event.deviceId,
          label: event.label,
          status,
          detail: event.detail,
          protocol: event.protocol,
          latencyMs: event.latencyMs,
        },
      ],
    };
  }

  return {
    ...state,
    health: state.health.map((h) =>
      h.id === event.deviceId
        ? {
            ...h,
            label: event.label,
            status,
            detail: event.detail,
            protocol: event.protocol,
            latencyMs: event.latencyMs,
          }
        : h
    ),
  };
}

/**
 * Apply a domain patch. Patches are partial (`{ dcas }`, `{ broadcasts }`, …) so they are merged
 * onto the hydrated snapshot; `state://log` appends a single operator log line.
 */
export function applyStatePatch(state: AppStateSnapshot, event: StatePatchEvent): AppStateSnapshot {
  if (event.domain === "log") {
    const line = event.patch.eventLogEntry;
    if (typeof line !== "string") return state;
    return { ...state, eventLog: [line, ...state.eventLog].slice(0, 200) };
  }
  return { ...state, ...(event.patch as Partial<AppStateSnapshot>) };
}

/** Merge a `meter://` frame into DCA signal strength and derive the silent-pastor alert. */
export function applyMeterEvent(state: AppStateSnapshot, event: MeterEvent): AppStateSnapshot {
  if (!event.channels.length) return state;

  const dcaMeters = new Map<number, MeterChannel>();
  for (const channel of event.channels) {
    const match = /^dca(\d+)$/.exec(channel.key);
    if (match) dcaMeters.set(Number(match[1]), channel);
  }
  if (dcaMeters.size === 0) return state;

  const dcas = state.dcas.map((dca) => {
    const meter = dcaMeters.get(dca.number);
    if (!meter) return dca;
    return {
      ...dca,
      signalDb: meter.db ?? -90,
      signalPresent: meter.db !== null && meter.db > -60,
    };
  });

  // Simulator keeps its own fault model; live meters are authoritative.
  let silentMicAlert = state.silentMicAlert;
  if (!state.mockMode) {
    const pastor = dcas.find((d) => d.id === "dca-1");
    silentMicAlert =
      pastor && !pastor.muted && !pastor.signalPresent
        ? "SILENT PASTOR MIC: DCA 1 (Pastor) is LIVE/UNMUTED, but the live Console/Aoip meter reports no signal. Check beltpack power/mute switch!"
        : null;
  }

  return { ...state, dcas, silentMicAlert };
}

/** Fold `cue://progress` telemetry into the active verification report. */
export function applyCueProgress(
  state: AppStateSnapshot,
  event: CueProgressEvent
): AppStateSnapshot {
  if (!state.lastVerification || event.cueIndex !== state.activeCueIndex) return state;
  if (event.status === "running" || event.status === "pending") return state;

  const status: CueVerificationStep["status"] =
    event.status === "failed" || event.status === "drift"
      ? "DRIFT"
      : event.status === "rehearsal"
        ? "REHEARSAL"
        : "APPLIED";

  return {
    ...state,
    lastVerification: {
      ...state.lastVerification,
      steps: state.lastVerification.steps.map((step, index) =>
        index === event.stepIndex
          ? { ...step, status, latencyMs: Math.round(event.elapsedMs) }
          : step
      ),
    },
  };
}

export interface BridgeSubscriptionHandlers {
  onHealth?: (event: HealthEvent) => void;
  onMeter?: (event: MeterEvent) => void;
  onStatePatch?: (event: StatePatchEvent) => void;
  onCueProgress?: (event: CueProgressEvent) => void;
}

/** Subscribe to backend pushes. No-op outside Tauri (browser simulator mode). */
export async function subscribeEvents(
  handlers: BridgeSubscriptionHandlers
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};

  const { listen } = await import("@tauri-apps/api/event");
  const unlisteners: UnlistenFn[] = [];

  if (handlers.onHealth) {
    unlisteners.push(
      await listen<HealthEvent>("device://health", (event) =>
        handlers.onHealth!(event.payload)
      )
    );
  }
  if (handlers.onMeter) {
    for (const domain of METER_DOMAINS) {
      unlisteners.push(
        await listen<MeterEvent>(`meter://${domain}`, (event) =>
          handlers.onMeter!(event.payload)
        )
      );
    }
  }
  if (handlers.onStatePatch) {
    for (const domain of STATE_DOMAINS) {
      unlisteners.push(
        await listen<StatePatchEvent>(`state://${domain}`, (event) =>
          handlers.onStatePatch!(event.payload)
        )
      );
    }
  }
  if (handlers.onCueProgress) {
    unlisteners.push(
      await listen<CueProgressEvent>("cue://progress", (event) =>
        handlers.onCueProgress!(event.payload)
      )
    );
  }

  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

const looksLikePastor = (name: string) => /pastor|speaker|preach/i.test(name);

/** Simulator-only meter synthesis. Never invents show content, only animates configured DCAs. */
function recomputeDerived(s: AppStateSnapshot) {
  if (s.mockMode) {
    const faultId = (s.dcas.find((d) => looksLikePastor(d.name)) ?? s.dcas[0])?.id;
    s.dcas = s.dcas.map((dca) => {
      if (dca.id === faultId && s.beltpackFaultSimulated) {
        return { ...dca, signalDb: -90, signalPresent: false };
      }
      if (dca.muted) {
        return { ...dca, signalDb: -90, signalPresent: false };
      }
      return {
        ...dca,
        signalDb: dca.signalDb < -60 ? -12 : dca.signalDb,
        signalPresent: true,
      };
    });
  }

  const silent = s.dcas.find(
    (dca) => looksLikePastor(dca.name) && !dca.muted && !dca.signalPresent
  );
  s.silentMicAlert = silent
    ? `SILENT INPUT: '${silent.name}' is live/unmuted, but the audio meter reports no signal. Check the beltpack, cable, or input patch.`
    : null;

  s.cameras = s.cameras.map((camera) => ({
    ...camera,
    tally: camera.id === s.activeCameraPresetId ? "program" : "idle",
  }));
}

function applySlidePosition(s: AppStateSnapshot, slideNumber: number) {
  const slides = s.slides.slides ?? [];
  const total = Math.max(1, slides.length || s.slides.totalSlides);
  const target = Math.max(1, Math.min(total, slideNumber));
  s.slides.currentSlide = target;
  s.slides.totalSlides = total;
  s.slides.cleared = false;
  s.slides.currentText = slides[target - 1]?.text ?? s.slides.currentText;
  s.slides.nextText = slides[target]?.text ?? "";
}

const blankSlides = (): SlideState => ({
  app: "Slides",
  playlistName: "",
  presentationName: "",
  currentSlide: 0,
  totalSlides: 0,
  currentText: "",
  nextText: "",
  currentNotes: "",
  nextNotes: "",
  cleared: false,
  stageMessage: "",
  stageMessageVisible: false,
  stageMessageFlash: false,
  transportLayer: "local",
  transportTime: 0,
  timers: [],
  activeLayers: [],
  screens: [],
  screen: { black: false, clear: false, logo: false },
  image: null,
  playback: null,
  connected: false,
  lastUpdateMs: 0,
  adapter: "local",
  slides: [],
});

/** Defaults mirror `AppSettings::default()` in src-tauri/src/state.rs. */
const initialSettings = (): AppSettings => ({
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
  },
  general: {
    engineerPin: "",
    canvasTitle: "Main Sanctuary",
    canvasTabs: [
      { id: "mixing", label: "Mixing", enabled: true },
      { id: "video", label: "Video", enabled: true },
      { id: "slides", label: "Slides", enabled: true },
      { id: "broadcast", label: "Broadcast", enabled: true },
      { id: "master", label: "Master", enabled: true },
    ],
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
});

/** Derive Show Mode outputs from user-configured Settings. */
function broadcastsFromSettings(settings: AppSettings): BroadcastTarget[] {
  const targets: BroadcastTarget[] = settings.broadcast.destinations
    .filter((dest) => dest.enabled)
    .map((dest) => ({
      id: dest.id,
      platform: dest.platform,
      live: false,
      bitrateKbps: 0,
      droppedFrames: 0,
      elapsedSec: 0,
      endpoint: dest.rtmpUrl,
      canvas: "Program",
    }));

  if (settings.broadcast.recordingPath.trim()) {
    targets.push({
      id: "record",
      platform: `Local Recording (${settings.broadcast.recordingFormat})`,
      live: false,
      bitrateKbps: 0,
      droppedFrames: 0,
      elapsedSec: 0,
      endpoint: `${settings.broadcast.recordingPath.replace(/\.$/, "")}.${settings.broadcast.recordingFormat.toLowerCase()}`,
      canvas: "Program",
    });
  }
  return targets;
}

/** Rebuild readiness checks from the current authored content (no demo checks). */
function rebuildPreflight(s: AppStateSnapshot) {
  const slideCount = s.slides.slides?.length ?? 0;
  const check = (
    id: string,
    domain: string,
    title: string,
    ok: boolean,
    detail: string
  ): PreflightCheck => ({
    id,
    domain,
    title,
    status: ok ? "pass" : "warn",
    detail,
    evidence: detail,
    fixLabel: ok ? null : "Open Show Builder",
  });

  s.preflight = [
    check("chk-cues", "Show File", "Service cue stack is populated", s.cues.length > 0, `${s.cues.length} cue(s) in the current show file`),
    check(
      "chk-audio",
      "Audio Mixing",
      "Mixer endpoint and DCA layout are configured",
      s.dcas.length > 0 && s.settings.console.ipAddress.trim().length > 0,
      s.settings.console.ipAddress.trim().length === 0
        ? "Set the mixer IP address in Settings → Audio Mixing"
        : `${s.dcas.length} DCA(s) mapped to ${s.settings.console.ipAddress}`
    ),
    check("chk-routing", "Audio Network", "Audio network routes are defined", s.aoipRoutes.length > 0, `${s.aoipRoutes.length} route(s) configured`),
    check("chk-broadcast", "Broadcasting", "Broadcast and recording outputs are configured", s.broadcasts.length > 0, `${s.broadcasts.length} output(s) configured`),
    check("chk-slides", "Slides", "Slide deck is loaded", slideCount > 0, `${slideCount} slide(s) in '${s.slides.presentationName}'`),
    check("chk-cameras", "Cameras", "Camera presets are defined", s.cameras.length > 0, `${s.cameras.length} preset(s) configured`),
  ];
  s.topologyIssues = [];
}

const initialSimState = (): AppStateSnapshot => ({
  mockMode: false,
  rehearsalMode: false,
  serviceName: "Untitled Show",
  activeCueIndex: 0,
  canUndo: false,
  undoDepth: 0,
  lastUndoLabel: null,
  silentMicAlert: null,
  beltpackFaultSimulated: false,
  health: [],
  preflight: [],
  topologyIssues: [],
  dcas: [],
  cameras: [],
  activeCameraPresetId: "",
  broadcastScene: "",
  verticalScene: "",
  canvases: [],
  broadcasts: [],
  recordChapters: [],
  sources: [],
  aoipClock: "",
  aoipRoutes: [],
  ipVideoReceivers: [],
  ipVideoSources: [],
  slides: blankSlides(),
  cues: [],
  lastVerification: null,
  settings: initialSettings(),
  connectedStations: [],
  syncStatus: "local",
  eventLog: [],
});

let simState: AppStateSnapshot = initialSimState();
let undoStack: Array<{ label: string; snapshot: AppStateSnapshot }> = [];

/** Neutral defaults for the browser simulator; no real endpoint or credential is stored. */
export const DEFAULT_AUDIENCE_RELAY_CONFIG: AudienceRelayConfig = {
  enabled: false,
  mode: "websocket",
  endpointUrl: "",
  authToken: "",
  channelName: "",
  hostDisplayName: "Host",
  statsWebhookUrl: "",
};

let simAudienceRelay: AudienceRelayConfig = { ...DEFAULT_AUDIENCE_RELAY_CONFIG };
let simAudienceChat: AudienceChatMessage[] = [];

function syncSimUndo() {
  simState.undoDepth = undoStack.length;
  simState.canUndo = undoStack.length > 0;
  simState.lastUndoLabel = undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null;
}

export const bridge = {
  unlockEngineerMode,
  lockEngineerMode,
  getEngineerLockStatus,
  searchSongLyrics,

  async getAppState(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("get_app_state");
    return structuredClone(simState);
  },

  async triggerCue(cueIndex: number): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("trigger_cue", { cueIndex });
    if (cueIndex < 0 || cueIndex >= simState.cues.length) return structuredClone(simState);
    const cue = simState.cues[cueIndex];
    const modeTag = simState.rehearsalMode ? "REHEARSAL" : "APPLIED";

    if (!simState.rehearsalMode) {
      undoStack.push({ label: `Cue ${cue.index}: ${cue.title}`, snapshot: structuredClone(simState) });
      if (undoStack.length > 16) undoStack.shift();
      simState.activeCueIndex = cueIndex;
      simState.broadcastScene = cue.broadcastScene;
      simState.verticalScene = cue.verticalScene;
      if (simState.canvases[0]) simState.canvases[0].activeScene = cue.broadcastScene;
      if (simState.canvases[1]) simState.canvases[1].activeScene = cue.verticalScene;
      simState.activeCameraPresetId = cue.cameraPresetId;
      if (cue.slideLabel.trim()) {
        simState.slides.presentationName = cue.slideLabel;
      }
      simState.slides.cleared = false;
      simState.dcas = simState.dcas.map((d) => ({
        ...d,
        muted: cue.unmuteDcas.includes(d.id) ? false : cue.muteDcas.includes(d.id) ? true : d.muted,
      }));
      if (cue.index === 2) {
        simState.broadcasts = simState.broadcasts.map((b) => ({
          ...b,
          live: true,
          bitrateKbps: b.id === "record" ? 12000 : 5800,
        }));
      }
      const ch = `Cue 0${cue.index} — ${cue.recordChapter}`;
      if (!simState.recordChapters.includes(ch)) {
        simState.recordChapters.push(ch);
      }
    }

    simState.lastVerification = {
      cueTitle: `${cue.index}. ${cue.title}`,
      rehearsal: simState.rehearsalMode,
      timestamp: "Just now",
      steps: [
        { domain: "Slides", expected: `Presentation == '${cue.slideLabel}'`, observed: `Slide transport confirmed '${cue.slideLabel}'`, status: modeTag, latencyMs: 4 },
        { domain: "Audio Mixing", expected: `Unmute [${cue.unmuteDcas.join(", ")}]`, observed: "DCA mute states verified", status: modeTag, latencyMs: 2 },
        { domain: "Broadcasting", expected: `16:9='${cue.broadcastScene}', 9:16='${cue.verticalScene}'`, observed: `Program + record chapter '${cue.recordChapter}' acknowledged`, status: modeTag, latencyMs: 5 },
        { domain: "Cameras", expected: `Preset == '${cue.cameraPresetId}'`, observed: "Tally + preset settled", status: modeTag, latencyMs: 3 },
      ],
    };
    simState.eventLog.unshift(
      `[cue-engine] ${simState.rehearsalMode ? "DRY-RUN" : "EXECUTED"} Cue ${cue.index}. '${cue.title}' (4/4 post-conditions verified)`
    );
    recomputeDerived(simState);
    syncSimUndo();
    return structuredClone(simState);
  },

  async undoLastCue(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("undo_last_cue");
    const entry = undoStack.pop();
    if (entry) {
      simState = entry.snapshot;
      simState.eventLog.unshift(`[cue-engine] COMPENSATING UNDO: Reverted '${entry.label}'`);
      recomputeDerived(simState);
      syncSimUndo();
    }
    return structuredClone(simState);
  },

  async toggleRehearsalMode(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("toggle_rehearsal_mode");
    simState.rehearsalMode = !simState.rehearsalMode;
    simState.eventLog.unshift(
      `[rehearsal] Rehearsal Mode ${simState.rehearsalMode ? "ENABLED (Ghost / Dry-Run Only)" : "DISABLED (Live Hardware Execution)"}`
    );
    return structuredClone(simState);
  },

  async toggleBeltpackFault(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("toggle_beltpack_fault");
    simState.beltpackFaultSimulated = !simState.beltpackFaultSimulated;
    simState.eventLog.unshift(
      `[aoip-conmon] Pastor Beltpack Fault ${simState.beltpackFaultSimulated ? "SIMULATED (0xFE mute on Wireless-Pastor-Tx1)" : "CLEARED (-11.5 dBFS signal)"}`
    );
    recomputeDerived(simState);
    return structuredClone(simState);
  },

  async toggleDcaMute(dcaId: string): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("toggle_dca_mute", { dcaId });
    simState.dcas = simState.dcas.map((d) => (d.id === dcaId ? { ...d, muted: !d.muted } : d));
    recomputeDerived(simState);
    return structuredClone(simState);
  },

  async nudgeDcaLevel(dcaId: string, deltaDb: number): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("nudge_dca_level", { dcaId, deltaDb });
    simState.dcas = simState.dcas.map((d) =>
      d.id === dcaId
        ? { ...d, levelDb: Math.max(d.minDb, Math.min(d.maxDb, d.levelDb + deltaDb)) }
        : d
    );
    return structuredClone(simState);
  },

  async recallCameraPreset(presetId: string): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("recall_camera_preset", { presetId });
    simState.activeCameraPresetId = presetId;
    recomputeDerived(simState);
    return structuredClone(simState);
  },

  async triggerSlideAction(action: "prev" | "next" | "clear"): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("trigger_slide_action", { action });
    if (action === "next") {
      applySlidePosition(simState, simState.slides.currentSlide + 1);
    } else if (action === "prev") {
      applySlidePosition(simState, simState.slides.currentSlide - 1);
    } else {
      simState.slides.cleared = !simState.slides.cleared;
      simState.eventLog.unshift(
        `[slideHttp] ${simState.slides.cleared ? "CLEAR" : "RESTORE"} layer requested for '${simState.slides.presentationName}'`
      );
    }
    return structuredClone(simState);
  },

  async goToSlide(slideNumber: number): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("go_to_slide", { slideNumber });
    }
    applySlidePosition(simState, slideNumber);
    simState.eventLog.unshift(
      `[slideHttp] Direct slide select -> ${simState.slides.currentSlide}/${simState.slides.totalSlides} '${simState.slides.presentationName}'`
    );
    return structuredClone(simState);
  },

  async controlPresentationTimer(operation: "start" | "stop" | "reset"): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("control_presentation_timer", { operation });
    }
    if (simState.slides.timers.length) {
      const timer = simState.slides.timers[0];
      timer.state = operation === "start" ? "running" : "stopped";
      if (operation === "reset") {
        timer.time = 0;
        timer.formatted = "00:00";
      }
    }
    simState.eventLog.unshift(`[slides] local timer ${operation}`);
    return structuredClone(simState);
  },

  async setStageMessage(message: string | null): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("set_stage_message", { message });
    }
    const text = message ?? "";
    simState.slides.stageMessage = text;
    simState.slides.stageMessageVisible = text.trim().length > 0;
    simState.eventLog.unshift(
      `[slides] stage message ${text.trim() ? "set" : "cleared"} (local)`
    );
    return structuredClone(simState);
  },

  async setStageMessageFlag(field: "visible" | "flash", value: boolean): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("set_stage_message_flag", { field, value });
    }
    if (field === "visible") simState.slides.stageMessageVisible = value;
    if (field === "flash") simState.slides.stageMessageFlash = value;
    return structuredClone(simState);
  },

  async controlSlideHttpPlaylist(
    kind: "media" | "audio",
    direction: "next" | "previous"
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_http_playlist_control", { kind, direction });
    }
    simState.eventLog.unshift(`[slideHttp] ${kind} playlist ${direction} (simulated)`);
    return structuredClone(simState);
  },

  async controlSlideHttpTransport(
    layer: string,
    operation: "play" | "pause" | "go_to_end"
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_http_transport_control", { layer, operation });
    }
    if (layer === "presentation" && simState.slides.playback) {
      simState.slides.playback.isPlaying = operation === "play";
    }
    simState.eventLog.unshift(`[slideHttp] ${layer} transport ${operation} (simulated)`);
    return structuredClone(simState);
  },

  async seekSlideHttpTransport(layer: string, seconds: number): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_http_transport_seek", { layer, seconds });
    }
    if (layer === "presentation" && simState.slides.playback) {
      simState.slides.playback.positionMs = Math.max(0, seconds * 1000);
    }
    simState.eventLog.unshift(`[slideHttp] ${layer} seek -> ${seconds.toFixed(1)}s (simulated)`);
    return structuredClone(simState);
  },

  async triggerSlideHttpClearGroup(id: string): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_http_clear_group", { id });
    }
    simState.eventLog.unshift(`[slideHttp] clear group '${id}' (simulated)`);
    return structuredClone(simState);
  },

  async refreshSlideHttpCatalog(
    kind:
      | "looks"
      | "look_current"
      | "props"
      | "macros"
      | "prop_collections"
      | "macro_collections"
      | "clear_groups"
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_http_catalog", { kind });
    }
    simState.eventLog.unshift(`[slideHttp] refresh ${kind} catalog (simulated)`);
    return structuredClone(simState);
  },

  async triggerSlideHttpResource(
    action:
      | "trigger_look"
      | "trigger_prop"
      | "clear_prop"
      | "trigger_macro"
      | "prop_auto_clear_pause"
      | "prop_auto_clear_resume",
    id: string
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_http_resource", { action, id });
    }
    simState.eventLog.unshift(`[slideHttp] ${action} '${id}' (simulated)`);
    return structuredClone(simState);
  },

  async controlSlideTcp(
    action:
      | "nextSlide"
      | "prevSlide"
      | "nextBuild"
      | "prevBuild"
      | "nextSchedule"
      | "prevSchedule"
      | "gotoStartSlide"
      | "gotoStartPresentation"
      | "Toggle"
      | "Play"
      | "Pause"
      | "GetScheduleData"
      | "GetLiveData"
      | "GetCurrentImage"
      | "Refresh"
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_tcp_control", { action });
    }
    simState.eventLog.unshift(`[slideTcp] action ${action} (simulated)`);
    if (action === "gotoStartSlide" || action === "gotoStartPresentation") {
      applySlidePosition(simState, 1);
    }
    return structuredClone(simState);
  },

  async getSlideTcpSlideImage(
    rectype: string,
    presRowid: string,
    slideRowid: string,
    revision: string
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_tcp_get_slide_image", {
        rectype,
        presRowid,
        slideRowid,
        revision,
      });
    }
    simState.eventLog.unshift(
      `[slideTcp] getSlideImage ${rectype}/${presRowid}/${slideRowid} (simulated)`
    );
    return structuredClone(simState);
  },

  /** Raw JPEG bytes for the key in `state.slides.image`; null when no image is cached. */
  async getSlideTcpImage(key: string): Promise<Uint8Array | null> {
    if (!isTauri() || !key) return null;
    const bytes = await invokeTauri<number[] | null>("slide_tcp_image", { key });
    return bytes ? new Uint8Array(bytes) : null;
  },

  /** Local display override only: the documented TCP catalog has no black/clear/logo toggle. */
  async setSlideTcpScreenFlag(
    field: "black" | "clear" | "logo",
    value: boolean
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("slide_tcp_screen_flag", { field, value });
    }
    simState.slides.screen[field] = value;
    if (field === "clear") simState.slides.cleared = value;
    simState.eventLog.unshift(
      `[slideTcp] local-only ${field} override set to ${value} (simulated)`
    );
    return structuredClone(simState);
  },

  async setBroadcastState(targetId: string, live: boolean): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("set_broadcast_state", { targetId, live });
    simState.broadcasts = simState.broadcasts.map((b) =>
      targetId === "all" || b.id === targetId
        ? { ...b, live, bitrateKbps: live ? (b.id === "record" ? 12000 : 5800) : 0, elapsedSec: live ? b.elapsedSec : 0 }
        : b
    );
    return structuredClone(simState);
  },

  async switchIpVideoReceiver(receiverId: string, sourceName: string): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("switch_ip_video_receiver", { receiverId, sourceName });
    simState.ipVideoReceivers = simState.ipVideoReceivers.map((r) =>
      r.id === receiverId
        ? { ...r, subscribedSource: sourceName, status: sourceName === r.expectedSource ? "CONNECTED" : "DRIFT" }
        : r
    );
    simState.eventLog.unshift(
      `[ip-video-discovery-5959] Sent <control_receiver><command>connect</command> to ${receiverId} -> '${sourceName}'`
    );
    return structuredClone(simState);
  },

  async autoHealIpVideoReceivers(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("auto_heal_ip_video_receivers");
    simState.ipVideoReceivers = simState.ipVideoReceivers.map((r) => ({
      ...r,
      subscribedSource: r.expectedSource,
      status: "CONNECTED",
    }));
    simState.eventLog.unshift("[ip-video-discovery-5959] Auto-healed all IP Video 6 receivers to expected show sources");
    return structuredClone(simState);
  },

  async flashAoipIdentify(routeId: string): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("flash_aoip_identify", { routeId });
    simState.aoipRoutes = simState.aoipRoutes.map((r) =>
      r.id === routeId ? { ...r, identifyFlashing: !r.identifyFlashing } : r
    );
    simState.eventLog.unshift(`[aoip-conmon] Sent IDENTIFY_QUERY (0x0063) for route ${routeId} on UDP :8700`);
    return structuredClone(simState);
  },

  async runPreflightProbes(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("run_preflight_probes");
    rebuildPreflight(simState);
    const passed = simState.preflight.filter((check) => check.status === "pass").length;
    simState.eventLog.unshift(
      `[preflight] Readiness sweep complete: ${passed}/${simState.preflight.length} checks passing`
    );
    return structuredClone(simState);
  },

  async saveSettings(settings: AppSettings): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("update_settings", { settings });
    simState.settings = structuredClone(settings);
    simState.broadcasts = broadcastsFromSettings(simState.settings).map((target) => {
      const existing = simState.broadcasts.find((b) => b.id === target.id);
      return existing
        ? {
            ...target,
            live: existing.live,
            bitrateKbps: existing.bitrateKbps,
            droppedFrames: existing.droppedFrames,
            elapsedSec: existing.elapsedSec,
          }
        : target;
    });
    rebuildPreflight(simState);
    simState.eventLog.unshift(
      "[settings] Configuration saved (audio, network, broadcasting, slides, cameras, station, sync)"
    );
    return structuredClone(simState);
  },

  async syncWorkspaceState(payload: {
    serviceName?: string;
    sources?: SceneSourceItem[];
    slides?: SlideState;
  }): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri("sync_workspace_state", {
        serviceName: payload.serviceName ?? null,
        sources: payload.sources ?? null,
        slides: payload.slides ?? null,
      });
    }
    if (payload.serviceName && payload.serviceName.trim()) {
      simState.serviceName = payload.serviceName.trim();
    }
    if (payload.sources) {
      simState.sources = structuredClone(payload.sources);
    }
    if (payload.slides) {
      simState.slides = structuredClone(payload.slides);
    }
    return structuredClone(simState);
  },

  async applyShowFile(show: RingShowFile): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("import_show_file", { show });
    simState = applyShowFileToSnapshot(simState, show);
    undoStack = [];
    syncSimUndo();
    return structuredClone(simState);
  },

  tickSimulator(): AppStateSnapshot {
    simState.broadcasts = simState.broadcasts.map((b) =>
      b.live
        ? {
            ...b,
            elapsedSec: b.elapsedSec + 1,
            bitrateKbps: b.id === "record" ? 12000 : 5750 + Math.floor(Math.random() * 140),
          }
        : b
    );
    return structuredClone(simState);
  },
};

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) {
    try {
      const repoSlug = (import.meta.env.VITE_UPDATE_REPO as string | undefined)?.trim();
      if (!repoSlug) return null;
      const resp = await fetch(`https://api.github.com/repos/${repoSlug}/releases`);
      if (!resp.ok) return null;
      const releases = await resp.json();
      if (!releases || releases.length === 0) return null;
      const latest = releases[0];
      const currentVersion = "0.3.6";
      const latestTag: string = latest.tag_name || "";
      const updateAvailable = latestTag.replace(/^v/, "") !== currentVersion.replace(/^v/, "");
      return {
        current_version: currentVersion,
        latest_version: latestTag,
        release_name: latest.name || latestTag,
        release_notes: latest.body || "",
        published_at: latest.published_at || "",
        html_url: latest.html_url || "",
        download_url: latest.assets?.[0]?.browser_download_url || latest.html_url,
        update_available: updateAvailable,
        assets: latest.assets || [],
      };
    } catch {
      return null;
    }
  }
  return invokeTauri<UpdateInfo | null>("check_update");
}


export async function openUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await invokeTauri("open_in_browser", { url });
      return;
    } catch {
      // fallback
    }
  }
  window.open(url, "_blank");
}

// ---------------------------------------------------------------------------------------------
// Crash reporting — sanitized, shareable summaries with inert browser-preview fallbacks
// ---------------------------------------------------------------------------------------------

/**
 * Remove folder paths, addresses, credentials and token-bearing query values from any text
 * that may be copied into a report. Applied before a crash summary leaves the renderer.
 */
export function sanitizeCrashText(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  let text = input;
  // URLs can carry identities and short-lived credentials; keep only the scheme marker.
  text = text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[url]");
  // Folder paths with at least one segment (POSIX or drive-letter rooted).
  text = text.replace(/(?:[A-Za-z]:\\|\/)(?:[A-Za-z0-9._~ -]+[\\/])+[A-Za-z0-9._~ -]+/g, "[path]");
  // Email-like and address-like fragments.
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]");
  // Credential assignments such as token=..., pin: ..., api_key: ...
  text = text.replace(
    /\b(token|secret|password|passphrase|authorization|bearer|pin|api[_-]?key|stream[_-]?key)(["'\s]*[:=]\s*)([^\s,;"')\]]+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`
  );
  // Secret-bearing query parameters in URLs.
  text = text.replace(/([?&](?:token|key|sig|signature|access_token)=)[^&\s"']+/gi, "$1[REDACTED]");
  return text.slice(0, 8000);
}

function crashFingerprint(parts: string[]): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Browser preview keeps a short-lived, in-memory queue; nothing is written to disk. */
let simPendingCrashReports: CrashReportSummary[] = [];

export interface CrashUploadResult {
  ok: boolean;
  issueUrl?: string;
  deduplicated?: boolean;
}

/** Crash summaries recorded during this session or restored from the previous session. */
export async function listPendingCrashReports(): Promise<CrashReportSummary[]> {
  if (isTauri()) {
    try {
      const reports = await invokeTauri<CrashReportSummary[]>("list_pending_crash_reports");
      return Array.isArray(reports) ? reports : [];
    } catch {
      return [];
    }
  }
  return simPendingCrashReports.map((report) => ({ ...report }));
}

/** Persist a sanitized frontend crash; returns the recorded summary when a store is available. */
export async function recordFrontendCrash(
  message: string,
  stack: string,
  componentStack?: string
): Promise<CrashReportSummary | null> {
  const safeMessage = sanitizeCrashText(message).slice(0, 500) || "Frontend error";
  const safeStack = sanitizeCrashText(stack).slice(0, 6000);
  const safeComponentStack = sanitizeCrashText(componentStack ?? "").slice(0, 2000);

  if (isTauri()) {
    try {
      const report = await invokeTauri<CrashReportSummary | null>("record_frontend_crash", {
        message: safeMessage,
        stack: safeStack,
        componentStack: safeComponentStack,
      });
      return report ?? null;
    } catch {
      return null;
    }
  }

  const report: CrashReportSummary = {
    id: `frontend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestampUtc: new Date().toISOString(),
    appVersion: "0.3.6",
    os: "preview",
    arch: "preview",
    kind: "frontend",
    message: safeMessage,
    location: safeComponentStack ? "React component tree" : "frontend",
    stack: [safeStack, safeComponentStack ? `component stack:\n${safeComponentStack}` : ""]
      .filter(Boolean)
      .join("\n\n"),
    fingerprint: crashFingerprint([safeMessage, safeComponentStack]),
  };
  simPendingCrashReports = [report, ...simPendingCrashReports].slice(0, 8);
  return { ...report };
}

/** Send a stored crash summary through the configured HTTPS relay. */
export async function uploadCrashReport(crashId: string): Promise<CrashUploadResult> {
  if (!crashId) return { ok: false };
  if (isTauri()) {
    try {
      const result = await invokeTauri<CrashUploadResult>("upload_crash_report", { crashId });
      return result ?? { ok: false };
    } catch {
      return { ok: false };
    }
  }
  // Browser preview has no relay transport; issue reporting remains available in the UI.
  return { ok: false };
}

/** Remove a crash summary once it has been shared or dismissed by the operator. */
export async function dismissCrashReport(crashId: string): Promise<boolean> {
  if (isTauri()) {
    try {
      return (await invokeTauri<boolean>("dismiss_crash_report", { crashId })) === true;
    } catch {
      return false;
    }
  }
  const before = simPendingCrashReports.length;
  simPendingCrashReports = simPendingCrashReports.filter((report) => report.id !== crashId);
  return simPendingCrashReports.length !== before;
}


export interface DiscoveredPeer {
  instanceId: string;
  stationName: string;
  canvasTitle: string;
  ipAddress: string;
  wsSyncPort: number;
  version: string;
}

export async function getDiscoveredPeers(): Promise<DiscoveredPeer[]> {
  if (isTauri()) {
    try {
      return await invokeTauri<DiscoveredPeer[]>("get_discovered_peers");
    } catch {
      return [];
    }
  }
  return [];
}

export async function listOpenWindows(): Promise<string[]> {
  if (isTauri()) {
    try {
      return await invokeTauri<string[]>("list_open_windows");
    } catch {
      return [];
    }
  }
  return ["SlideHttp — Main Presentation", "Web Browser — Video Studio", "Presentation — Sunday Announcements"];
}

// ---------------------------------------------------------------------------------------------
// Native Window & Display Capture — zero-popup IPC with inert browser fallbacks
// ---------------------------------------------------------------------------------------------

/** Enumerate OS windows available to the zero-popup native capture backend. */
export async function listCapturableWindows(): Promise<CapturableWindow[]> {
  if (!isTauri()) return [];
  try {
    const windows = await invokeTauri<CapturableWindow[]>("list_capturable_windows");
    return Array.isArray(windows) ? windows : [];
  } catch {
    return [];
  }
}

/** Enumerate physical displays available to the zero-popup native capture backend. */
export async function listCapturableDisplays(): Promise<CapturableDisplay[]> {
  if (!isTauri()) return [];
  try {
    const displays = await invokeTauri<CapturableDisplay[]>("list_capturable_displays");
    return Array.isArray(displays) ? displays : [];
  } catch {
    return [];
  }
}

/** Pull one encoded frame on demand (event-driven preview normally uses `capture://frame`). */
export async function captureNativeFrame(
  sourceId: string,
  targetKind: "window" | "display",
  targetId: number
): Promise<NativeCaptureFrame | null> {
  if (!isTauri()) return null;
  try {
    const frame = await invokeTauri<NativeCaptureFrame | null>("capture_native_frame", {
      sourceId,
      targetKind,
      targetId,
    });
    return frame ?? null;
  } catch {
    return null;
  }
}

/** Begin pushing native frames for a source; the runtime emits them on `capture://frame`. */
export async function startNativeCaptureStream(
  sourceId: string,
  targetKind: "window" | "display",
  targetId: number,
  fps?: number
): Promise<NativeCaptureSessionInfo | null> {
  if (!isTauri()) return null;
  try {
    const session = await invokeTauri<NativeCaptureSessionInfo | null>("start_native_capture_stream", {
      sourceId,
      targetKind,
      targetId,
      fps: fps ?? 5,
    });
    return session ?? null;
  } catch {
    return null;
  }
}

/** Stop a native stream. Never throws — teardown must not block a scene change. */
export async function stopNativeCaptureStream(sourceId: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return (await invokeTauri<boolean>("stop_native_capture_stream", { sourceId })) === true;
  } catch {
    return false;
  }
}

export interface InstalledAudioPlugin {
  name: string;
  format: string;
  path: string;
}

export interface MediaEngineStatus {
  broadcastBinaryPath?: string | null;
  ffmpegBinaryPath?: string | null;
  vstPluginCount: number;
  auPluginCount: number;
  daemonRunning: boolean;
}

export async function scanInstalledAudioPlugins(): Promise<InstalledAudioPlugin[]> {
  if (isTauri()) {
    try {
      return await invokeTauri<InstalledAudioPlugin[]>("scan_installed_audio_plugins");
    } catch {
      return [];
    }
  }
  return [
    { name: "StudioReverb", format: "VST3", path: "/Library/Audio/Plug-Ins/VST3/StudioReverb.vst3" },
    { name: "AUDelay", format: "AU", path: "/Library/Audio/Plug-Ins/Components/AUDelay.component" },
  ];
}

export async function getMediaEngineStatus(): Promise<MediaEngineStatus | null> {
  if (isTauri()) {
    try {
      return await invokeTauri<MediaEngineStatus>("get_media_engine_status");
    } catch {
      return null;
    }
  }
  return { broadcastBinaryPath: null, ffmpegBinaryPath: "/opt/homebrew/bin/ffmpeg", vstPluginCount: 1, auPluginCount: 1, daemonRunning: false };
}

export async function startHeadlessMediaDaemon(): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("start_headless_media_daemon");
  }
  return "Daemon simulated in browser";
}

export async function routeAoipCrosspoint(rxIp: string, rxChanId: number, txChan: string, txDev: string): Promise<AppStateSnapshot> {
  if (isTauri()) {
    return invokeTauri<AppStateSnapshot>("route_aoip_crosspoint", { rxIp, rxChanId, txChan, txDev });
  }
  return structuredClone(simState);
}

export async function triggerIpVideoPtz(sourceId: string, presetIndex?: number, pan?: number, tilt?: number): Promise<AppStateSnapshot> {
  if (isTauri()) {
    return invokeTauri<AppStateSnapshot>("trigger_ip_video_ptz", { sourceId, presetIndex: presetIndex ?? null, pan: pan ?? null, tilt: tilt ?? null });
  }
  return structuredClone(simState);
}

export async function sendConsoleOsc(address: string, value: number): Promise<AppStateSnapshot> {
  if (isTauri()) {
    return invokeTauri<AppStateSnapshot>("send_console_osc", { address, value });
  }
  return structuredClone(simState);
}

export interface HostMediaDevice {
  name: string;
  kind: "audio_input" | "audio_output" | "video_input";
}

export async function listHostMediaDevices(): Promise<HostMediaDevice[]> {
  let results: HostMediaDevice[] = [];
  if (isTauri()) {
    try {
      const [aud, vid] = await Promise.all([
        invokeTauri<HostMediaDevice[]>("list_audio_devices"),
        invokeTauri<HostMediaDevice[]>("list_video_devices"),
      ]);
      results = [...aud, ...vid];
    } catch {}
  }
  if (results.length === 0 && typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      results = devs.map((d) => ({
        name: d.label || `${d.kind} (${d.deviceId.slice(0, 6)})`,
        kind: d.kind === "videoinput" ? "video_input" : d.kind === "audiooutput" ? "audio_output" : "audio_input",
      }));
    } catch {}
  }
  return results;
}

export async function startDirectFfmpegStream(rtmpUrl: string, recordPath?: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("start_direct_ffmpeg_stream", { rtmpUrl, recordPath: recordPath ?? null });
  }
  return "Direct FFmpeg RTMP/MP4 encoder started (browser mode simulated)";
}

export async function stopDirectFfmpegStream(): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("stop_direct_ffmpeg_stream");
  }
  return "Direct FFmpeg stopped";
}

export async function startReplayBuffer(): Promise<string> {
  if (isTauri()) return invokeTauri<string>("start_replay_buffer");
  return "Replay Buffer armed (30s rolling ring)";
}

export async function saveReplayBuffer(): Promise<string> {
  if (isTauri()) return invokeTauri<string>("save_replay_buffer");
  return "Saved 30s Instant Replay clip!";
}

export async function stopReplayBuffer(): Promise<string> {
  if (isTauri()) return invokeTauri<string>("stop_replay_buffer");
  return "Stopped Replay Buffer";
}

export interface ImportedSlideSong {
  title: string;
  rawLyrics: string;
}

export async function importSlideArchive(filePath: string): Promise<ImportedSlideSong[]> {
  if (isTauri()) {
    return invokeTauri<ImportedSlideSong[]>("import_slide_archive", { filePath });
  }
  return [];
}

export async function remuxRecordingToMp4(filePath: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("remux_recording_to_mp4", { filePath });
  }
  return `Remuxed cleanly to ${filePath.replace(/\.[^/.]+$/, "")}.mp4 (browser mode simulated)`;
}

export async function sendBroadcastStreamCaption(text: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("send_broadcast_stream_caption", { text });
  }
  return text ? `CC sent (local fallback): "${text}"` : "Cleared stream captions";
}

export async function dispatchBroadcastStudioCommand(action: string, arg?: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("dispatch_broadcast_studio_command", { action, arg: arg ?? null });
  }
  return `Dispatched ${action}`;
}

export async function ptzDriveCamera(
  ip: string,
  port: number,
  panSpeed: number,
  tiltSpeed: number,
  zoomSpeed: number
): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("ptz_drive_camera", {
      ip,
      port,
      panSpeed,
      tiltSpeed,
      zoomSpeed,
    });
  }
  return `PTZ-IP Pan(${panSpeed})/Tilt(${tiltSpeed})/Zoom(${zoomSpeed}) dispatched to ${ip}:${port}`;
}

export async function ptzRecallPreset(
  ip: string,
  port: number,
  preset: number
): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("ptz_recall_preset", { ip, port, preset });
  }
  return `PTZ-IP Preset ${preset} recalled on ${ip}:${port}`;
}

export async function ptzStorePreset(
  ip: string,
  port: number,
  preset: number
): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("ptz_store_preset", { ip, port, preset });
  }
  return `PTZ-IP Preset ${preset} saved on ${ip}:${port}`;
}

export interface EncoderCapability {
  id: string;
  name: string;
  codec: string;
  kind: "gpu" | "cpu" | "hardware" | "software";
  available: boolean;
  vendor?: string;
  description?: string;
}

export interface HostDisplayInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor?: number;
  primary: boolean;
}

export async function ptzOpticsCommand(
  ip: string,
  port: number,
  action:
    | "home"
    | "focus_auto"
    | "focus_manual"
    | "focus_near"
    | "focus_far"
    | "focus_stop"
    | "iris_up"
    | "iris_down"
    | "iris_reset"
    | "wb_mode"
    | "exposure_mode",
  value?: number
): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("ptz_optics_command", { ip, port, action, value });
  }
  return `PTZ optics ${action} @ ${ip}:${port} (browser simulator)`;
}

export async function aoipControlCommand(
  targetIp: string,
  action: "sample_rate" | "latency_ms" | "device_lock" | "clock_leader",
  value: number
): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("aoip_control_command", { targetIp, action, value });
  }
  return `Audio network ${action}=${value} -> ${targetIp} (browser simulator)`;
}

export async function probeHardwareEncoders(): Promise<EncoderCapability[]> {
  if (isTauri()) {
    return invokeTauri<EncoderCapability[]>("probe_hardware_encoders");
  }
  return [
    {
      id: "sim-gpu-h264",
      name: "Simulated GPU H.264",
      codec: "h264",
      kind: "gpu",
      available: true,
      vendor: "Simulator",
      description: "Browser preview encoder",
    },
    {
      id: "sim-cpu-x264",
      name: "Simulated CPU x264",
      codec: "h264",
      kind: "cpu",
      available: true,
      vendor: "Simulator",
      description: "Software fallback encoder",
    },
  ];
}

export async function listHostDisplays(): Promise<HostDisplayInfo[]> {
  if (isTauri()) {
    return invokeTauri<HostDisplayInfo[]>("list_host_displays");
  }
  const w = typeof window !== "undefined" ? window.screen.width : 1920;
  const h = typeof window !== "undefined" ? window.screen.height : 1080;
  const availLeft = typeof window !== "undefined" ? (window.screen as any).availLeft ?? 0 : 0;
  const availTop = typeof window !== "undefined" ? (window.screen as any).availTop ?? 0 : 0;
  return [
    {
      id: "browser-primary",
      name: `Primary Display (${w}x${h})`,
      width: w,
      height: h,
      x: availLeft,
      y: availTop,
      scaleFactor: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      primary: true,
    },
  ];
}

export async function startStudioCompositor(opts: {
  rtmpUrl?: string | null;
  recordPath?: string | null;
  width?: number;
  height?: number;
  fps?: number;
  videoBitrateKbps?: number;
}): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("start_studio_compositor", { opts });
  }
  return "Native compositor worker started (browser simulator)";
}

export async function stopStudioCompositor(): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("stop_studio_compositor");
  }
  return "Native compositor worker stopped (browser simulator)";
}

export async function broadcastLanSyncEvent(kind: string, payload: unknown): Promise<void> {
  if (isTauri()) {
    await invokeTauri<void>("broadcast_lan_sync_event", { kind, payload });
  }
}

// ---------------------------------------------------------------------------------------------
// Live stream telemetry + audience relay — browser simulator fallbacks stay intentionally neutral
// ---------------------------------------------------------------------------------------------

function simulatorStreamStats(): StreamStatsSnapshot {
  const onAir = simState.broadcasts.filter((b) => b.live);
  const primary = onAir.find((b) => b.id !== "record") ?? onAir[0] ?? null;
  const elapsedSec = onAir.reduce((max, b) => Math.max(max, b.elapsedSec), 0);
  const bitrateKbps = primary?.bitrateKbps ?? 0;
  return {
    live: onAir.length > 0,
    recording: onAir.some((b) => b.id === "record"),
    source: primary?.canvas || primary?.platform || "Standby",
    fps: onAir.length > 0 ? 60 : 0,
    bitrateKbps,
    droppedFrames: 0,
    totalFrames: elapsedSec * 60,
    droppedPct: 0,
    congestion: 0,
    cpuUsagePct: 0,
    renderFrameTimeMs: 0,
    elapsedSec,
    bytesSent: Math.round((bitrateKbps * 1000 * elapsedSec) / 8),
    viewerCount: 0,
    peakViewers: 0,
    updatedAtMs: Date.now(),
  };
}

/** Current encoder / audience health snapshot. */
export async function getStreamStats(): Promise<StreamStatsSnapshot> {
  if (isTauri()) {
    try {
      return await invokeTauri<StreamStatsSnapshot>("get_stream_stats");
    } catch {
      return simulatorStreamStats();
    }
  }
  return simulatorStreamStats();
}

/** Recent relayed audience chat entries, oldest first. */
export async function getAudienceChatHistory(): Promise<AudienceChatMessage[]> {
  if (isTauri()) {
    try {
      const history = await invokeTauri<AudienceChatMessage[]>("get_audience_chat_history");
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  }
  return simAudienceChat.map((message) => ({ ...message }));
}

/** Apply (or disable) the operator-authored chat / viewer-statistics relay configuration. */
export async function configureAudienceRelay(config: AudienceRelayConfig): Promise<string> {
  if (isTauri()) {
    try {
      return await invokeTauri<string>("configure_audience_relay", { config });
    } catch (err) {
      return `Relay configuration could not be applied: ${String(err)}`;
    }
  }
  simAudienceRelay = { ...config };
  return config.enabled
    ? `Audience relay configured (${config.mode}, browser simulator)`
    : "Audience relay disabled (browser simulator)";
}

/** Send an operator message to the audience feed, optionally mirroring it into closed captions. */
export async function sendAudienceMessage(
  text: string,
  sendToCaption = false
): Promise<AudienceChatMessage> {
  const trimmed = text.trim();
  if (isTauri()) {
    try {
      return await invokeTauri<AudienceChatMessage>("send_audience_message", {
        text: trimmed,
        sendToCaption,
      });
    } catch {
      // fall through to the local simulator feed
    }
  }

  if (sendToCaption && trimmed) {
    try {
      await sendBroadcastStreamCaption(trimmed);
    } catch {
      // captioning is best-effort in simulator mode
    }
  }

  const message: AudienceChatMessage = {
    id: `operator_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    author: simAudienceRelay.hostDisplayName.trim() || "Host",
    role: "HOST",
    text: trimmed,
    channel: simAudienceRelay.channelName.trim() || "Program",
    timestampMs: Date.now(),
    pinnedOnAir: false,
  };
  simAudienceChat = [...simAudienceChat, message].slice(-200);
  return { ...message };
}

/** Pin a message to the on-air overlay, or pass null to clear it. */
export async function pinAudienceMessage(
  messageId: string | null
): Promise<AudienceChatMessage | null> {
  if (isTauri()) {
    try {
      return await invokeTauri<AudienceChatMessage | null>("pin_audience_message", { messageId });
    } catch {
      return null;
    }
  }
  simAudienceChat = simAudienceChat.map((message) => ({
    ...message,
    pinnedOnAir: messageId !== null && message.id === messageId,
  }));
  return messageId
    ? simAudienceChat.find((message) => message.id === messageId && message.pinnedOnAir) ?? null
    : null;
}

// ---------------------------------------------------------------------------------------------
// Settings page operations — typed IPC with explicit browser-preview fallbacks
// ---------------------------------------------------------------------------------------------

/** Probe a configured subsystem endpoint from the Settings page. */
export async function testSubsystemConnection(
  subsystem: string,
  host: string,
  port: number
): Promise<ConnectionTestResult> {
  if (isTauri()) {
    try {
      return await invokeTauri<ConnectionTestResult>("test_subsystem_connection", {
        subsystem,
        host,
        port,
      });
    } catch {
      // The preview probe below keeps the operator UI responsive if the command is unavailable.
    }
  }
  const target = host.trim() || "127.0.0.1";
  const reachable = Boolean(host.trim()) && port >= 1 && port <= 65535;
  const latencyMs = reachable ? 12 : 0;
  return {
    ok: reachable,
    subsystem,
    host: target,
    port,
    latencyMs,
    summary: reachable ? `Simulated link check — ${latencyMs} ms` : "No reachable target configured",
    detail: reachable
      ? `Preview probe for ${subsystem} at ${target}:${port}. Live verification requires the desktop runtime.`
      : `Set a valid host and port for ${subsystem} before testing.`,
  };
}

/** Sweep the local network for devices of the requested kind. */
export async function discoverLanDevices(kind: string): Promise<DiscoveredLanDevice[]> {
  if (isTauri()) {
    try {
      const devices = await invokeTauri<DiscoveredLanDevice[]>("discover_lan_devices", { kind });
      return Array.isArray(devices) ? devices : [];
    } catch {
      // Fall through to illustrative preview devices.
    }
  }
  return [
    {
      name: "Booth Control Node",
      host: "192.0.2.10",
      port: 10023,
      kind,
      detail: "Simulated device (browser preview)",
    },
    {
      name: "Stage Endpoint",
      host: "192.0.2.11",
      port: 52381,
      kind,
      detail: "Simulated device (browser preview)",
    },
    {
      name: "Presentation Node",
      host: "192.0.2.12",
      port: 8080,
      kind,
      detail: "Simulated device (browser preview)",
    },
  ];
}

/** Serialize the current settings profile for download. */
export async function exportSettingsBundle(): Promise<string> {
  if (isTauri()) {
    try {
      return await invokeTauri<string>("export_settings_bundle");
    } catch {
      // Fall through to the in-memory profile below.
    }
  }
  return JSON.stringify(
    {
      format: "one-ring-settings-profile",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: structuredClone(simState.settings),
    },
    null,
    2
  );
}

/** Replace settings from an exported profile payload. */
export async function importSettingsBundle(payload: string): Promise<AppStateSnapshot | null> {
  if (isTauri()) {
    try {
      return await invokeTauri<AppStateSnapshot | null>("import_settings_bundle", { payload });
    } catch {
      // Fall through to the local import below.
    }
  }
  try {
    const parsed = JSON.parse(payload) as ({ settings?: AppSettings } & Partial<AppSettings>) | null;
    const settings = (parsed?.settings ?? parsed) as AppSettings | undefined;
    if (!settings || typeof settings !== "object" || !settings.console || !settings.general) {
      return null;
    }
    return await bridge.saveSettings(settings);
  } catch {
    return null;
  }
}

/** Restore one settings section to its documented defaults. */
export async function resetSettingsSection(section: string): Promise<AppStateSnapshot | null> {
  if (isTauri()) {
    try {
      return await invokeTauri<AppStateSnapshot | null>("reset_settings_section", { section });
    } catch {
      // Fall through to the local default section below.
    }
  }
  const defaults = initialSettings() as unknown as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(defaults, section)) return null;
  const nextSettings = { ...simState.settings } as unknown as Record<string, unknown>;
  nextSettings[section] = structuredClone(defaults[section]);
  simState.settings = nextSettings as unknown as AppSettings;
  rebuildPreflight(simState);
  simState.eventLog.unshift(`[settings] ${section} restored to defaults (browser preview)`);
  return structuredClone(simState);
}

/** Build a credential-free diagnostics snapshot as JSON. */
export async function exportDiagnosticBundle(): Promise<string> {
  if (isTauri()) {
    try {
      return await invokeTauri<string>("export_diagnostic_bundle");
    } catch {
      // Fall through to the sanitized local snapshot below.
    }
  }
  const settings = structuredClone(simState.settings) as unknown as Record<string, unknown>;
  const broadcast = settings.broadcast as
    | { destinations?: Array<{ streamKey?: string }>; recordingPath?: string }
    | undefined;
  if (broadcast?.destinations) {
    broadcast.destinations = broadcast.destinations.map((dest) => ({
      ...dest,
      streamKey: "[REDACTED]",
    }));
  }
  if (broadcast?.recordingPath) broadcast.recordingPath = "[REDACTED]";
  const slides = settings.slides as { songLibraryClientSecret?: string } | undefined;
  if (slides) slides.songLibraryClientSecret = "[REDACTED]";
  const general = settings.general as { engineerPin?: string } | undefined;
  if (general) general.engineerPin = "[REDACTED]";
  const sync = settings.sync as { syncToken?: string; accountEmail?: string } | undefined;
  if (sync) {
    sync.syncToken = "[REDACTED]";
    sync.accountEmail = "[REDACTED]";
  }
  return JSON.stringify(
    {
      format: "one-ring-diagnostics",
      version: 1,
      generatedAt: new Date().toISOString(),
      mockMode: simState.mockMode,
      syncStatus: simState.syncStatus,
      health: simState.health.map((h) => ({
        id: h.id,
        label: h.label,
        status: h.status,
        protocol: h.protocol,
        latencyMs: h.latencyMs,
      })),
      preflightStatuses: simState.preflight.map((check) => check.status),
      topologyIssueCount: simState.topologyIssues.length,
      eventCount: simState.eventLog.length,
      settings,
    },
    null,
    2
  );
}

/** Reveal the platform configuration directory in the installed runtime. */
export async function openConfigDirectory(): Promise<string> {
  if (isTauri()) {
    try {
      return await invokeTauri<string>("open_config_directory");
    } catch {
      // Fall through to the preview message below.
    }
  }
  return "Browser preview — no local configuration directory is available.";
}

// ---------------------------------------------------------------------------------------------
// Song & lyric search — native command first, open lyric index for browser preview
// ---------------------------------------------------------------------------------------------

/** Mirrors the camelCase payload emitted by the native `search_song_lyrics` command. */
export interface LyricSearchResultItem {
  id: string;
  title: string;
  artist: string;
  source: string;
  copyright: string;
  key: string;
  lyrics: string;
  themes: string[];
  filePath?: string;
}

interface OpenIndexLyricEntry {
  id?: number | string;
  trackName?: string;
  artistName?: string;
  plainLyrics?: string;
  syncedLyrics?: string;
}

/** Keep imported slides plain text: drop timestamp and field lines from timed lyric payloads. */
function normalizeIndexedLyrics(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*\[(?:\d{1,2}:|[a-z]{2,3}\s*:)/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Search online lyrics and, in the installed app, an operator-configured local song folder.
 * Browser preview only queries the open index; filesystem access stays native-only.
 */
export async function searchSongLyrics(
  query: string,
  localFolder?: string,
  includeOnline?: boolean,
  artist?: string
): Promise<LyricSearchResultItem[]> {
  const wantsOnline = includeOnline ?? true;

  if (isTauri()) {
    try {
      const results = await invokeTauri<LyricSearchResultItem[]>("search_song_lyrics", {
        query,
        localFolder: localFolder || null,
        includeOnline: wantsOnline,
      });
      return Array.isArray(results) ? results : [];
    } catch {
      return [];
    }
  }

  if (!wantsOnline || !query.trim()) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query.trim())}`,
      { signal: controller.signal }
    );
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return [];

    return (payload as OpenIndexLyricEntry[])
      .map((entry, index): LyricSearchResultItem => {
        const rawLyrics =
          typeof entry.plainLyrics === "string" && entry.plainLyrics.trim()
            ? entry.plainLyrics
            : typeof entry.syncedLyrics === "string"
              ? entry.syncedLyrics
              : "";
        return {
          id: String(entry.id ?? `online-${index}`),
          title: typeof entry.trackName === "string" ? entry.trackName.trim() : "",
          artist: typeof entry.artistName === "string" ? entry.artistName.trim() : "",
          source: "online",
          copyright: "",
          key: "",
          lyrics: normalizeIndexedLyrics(rawLyrics),
          themes: [],
        };
      })
      .filter((item) => item.title.length > 0 || item.lyrics.length > 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export interface SwitcherInputItem {
  id: number;
  longName: string;
  shortName: string;
  isExternal: boolean;
  isBusSource: boolean;
  isAuxSource: boolean;
}

export interface SwitcherStateSnapshot {
  host: string;
  port: number;
  link: "idle" | "connecting" | "online" | "offline" | string;
  detail: string;
  product: string;
  version: string;
  inputs: SwitcherInputItem[];
  program: Record<string, number>;
  preview: Record<string, number>;
  position: Record<string, number>;
  inTransition: Record<string, boolean>;
  keyOnAir: Record<string, Record<string, boolean>>;
  dskOnAir: Record<string, boolean>;
  ftbBlack: Record<string, boolean>;
  aux: Record<string, number>;
  macros: Record<string, string>;
  macroRunning: number | null;
  streaming: boolean;
  recording: boolean;
  tally: Record<string, number>;
}

export interface IpVideoBridgeStatusInfo {
  available: boolean;
  libraryPath: string | null;
  sending: boolean;
  senderName: string;
  framesSent: number;
  discoveredSources: string[];
  detail: string;
}

const DEFAULT_SWITCHER_STATE: SwitcherStateSnapshot = {
  host: "",
  port: 9910,
  link: "idle",
  detail: "Not connected",
  product: "",
  version: "",
  inputs: [],
  program: {},
  preview: {},
  position: {},
  inTransition: {},
  keyOnAir: {},
  dskOnAir: {},
  ftbBlack: {},
  aux: {},
  macros: {},
  macroRunning: null,
  streaming: false,
  recording: false,
  tally: {},
};

export async function switcherConnect(host: string, port = 9910): Promise<SwitcherStateSnapshot> {
  if (!isTauriRuntime()) {
    return { ...DEFAULT_SWITCHER_STATE, host, port, link: "offline", detail: "Requires desktop app runtime" };
  }
  return invokeTauri<SwitcherStateSnapshot>("switcher_connect", { host, port });
}

export async function switcherDisconnect(): Promise<SwitcherStateSnapshot> {
  if (!isTauriRuntime()) return DEFAULT_SWITCHER_STATE;
  return invokeTauri<SwitcherStateSnapshot>("switcher_disconnect");
}

export async function switcherGetState(): Promise<SwitcherStateSnapshot> {
  if (!isTauriRuntime()) return DEFAULT_SWITCHER_STATE;
  return invokeTauri<SwitcherStateSnapshot>("switcher_get_state");
}

export async function switcherSendCommand(action: Record<string, unknown>): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeTauri<void>("switcher_command", { action });
}

export async function getIpVideoBridgeStatus(): Promise<IpVideoBridgeStatusInfo> {
  if (!isTauriRuntime()) {
    return {
      available: false,
      libraryPath: null,
      sending: false,
      senderName: "",
      framesSent: 0,
      discoveredSources: [],
      detail: "Available in desktop app runtime",
    };
  }
  return invokeTauri<IpVideoBridgeStatusInfo>("ip_video_bridge_status");
}

export async function discoverIpVideoBridgeSources(timeoutMs = 1000): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invokeTauri<string[]>("ip_video_discover_sources", { timeoutMs });
}

export async function startIpVideoBridgeOutput(streamName: string): Promise<IpVideoBridgeStatusInfo> {
  return invokeTauri<IpVideoBridgeStatusInfo>("ip_video_start_output", { streamName });
}

export async function stopIpVideoBridgeOutput(): Promise<IpVideoBridgeStatusInfo> {
  return invokeTauri<IpVideoBridgeStatusInfo>("ip_video_stop_output");
}

export async function sendIpVideoBridgeTestFrame(width = 1280, height = 720): Promise<number> {
  return invokeTauri<number>("ip_video_send_test_frame", { width, height });
}
