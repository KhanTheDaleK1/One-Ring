import type {
  AppSettings,
  UpdateInfo,
  AppStateSnapshot,
  BroadcastTarget,
  CueVerificationStep,
  PreflightCheck,
  SlideState,
} from "./types";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { applyShowFileToSnapshot } from "./showFile";
import type { RingShowFile } from "./types";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
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
  "x32",
  "obs",
  "slides",
  "streamlabs",
  "log",
  "cue",
  "dante",
  "ndi",
] as const;

const METER_DOMAINS = ["x32", "dante"] as const;

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
        ? "SILENT PASTOR MIC: DCA 1 (Pastor) is LIVE/UNMUTED, but the live X32/Dante meter reports no signal. Check beltpack power/mute switch!"
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
  x32: {
    ipAddress: "",
    oscPort: 10023,
    keepaliveIntervalSec: 8,
    dcaMappings: [],
  },
  dante: {
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
    songselectClientId: "",
    songselectClientSecret: "",
    displayAssignments: {
      fohWindow: "",
      stageDisplayWindow: "",
      ndiAlphaOutput: "",
    },
  },
  ndiPtz: {
    discoveryRangeStart: "",
    discoveryRangeEnd: "",
    viscaPort: 52381,
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
      s.dcas.length > 0 && s.settings.x32.ipAddress.trim().length > 0,
      s.settings.x32.ipAddress.trim().length === 0
        ? "Set the mixer IP address in Settings → Audio Mixing"
        : `${s.dcas.length} DCA(s) mapped to ${s.settings.x32.ipAddress}`
    ),
    check("chk-routing", "Audio Network", "Audio network routes are defined", s.danteRoutes.length > 0, `${s.danteRoutes.length} route(s) configured`),
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
  obsScene: "",
  verticalScene: "",
  canvases: [],
  broadcasts: [],
  recordChapters: [],
  sources: [],
  danteClock: "",
  danteRoutes: [],
  ndiReceivers: [],
  ndiSources: [],
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

function syncSimUndo() {
  simState.undoDepth = undoStack.length;
  simState.canUndo = undoStack.length > 0;
  simState.lastUndoLabel = undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null;
}

export const bridge = {
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
      simState.obsScene = cue.obsScene;
      simState.verticalScene = cue.verticalScene;
      if (simState.canvases[0]) simState.canvases[0].activeScene = cue.obsScene;
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
        { domain: "Broadcasting", expected: `16:9='${cue.obsScene}', 9:16='${cue.verticalScene}'`, observed: `Program + record chapter '${cue.recordChapter}' acknowledged`, status: modeTag, latencyMs: 5 },
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
      `[dante-conmon] Pastor Beltpack Fault ${simState.beltpackFaultSimulated ? "SIMULATED (0xFE mute on ULXD4-Pastor-Tx1)" : "CLEARED (-11.5 dBFS signal)"}`
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
        `[propresenter] ${simState.slides.cleared ? "CLEAR" : "RESTORE"} layer requested for '${simState.slides.presentationName}'`
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
      `[propresenter] Direct slide select -> ${simState.slides.currentSlide}/${simState.slides.totalSlides} '${simState.slides.presentationName}'`
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

  async controlProPresenterPlaylist(
    kind: "media" | "audio",
    direction: "next" | "previous"
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("propresenter_playlist_control", { kind, direction });
    }
    simState.eventLog.unshift(`[propresenter] ${kind} playlist ${direction} (simulated)`);
    return structuredClone(simState);
  },

  async controlProPresenterTransport(
    layer: string,
    operation: "play" | "pause" | "go_to_end"
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("propresenter_transport_control", { layer, operation });
    }
    if (layer === "presentation" && simState.slides.playback) {
      simState.slides.playback.isPlaying = operation === "play";
    }
    simState.eventLog.unshift(`[propresenter] ${layer} transport ${operation} (simulated)`);
    return structuredClone(simState);
  },

  async seekProPresenterTransport(layer: string, seconds: number): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("propresenter_transport_seek", { layer, seconds });
    }
    if (layer === "presentation" && simState.slides.playback) {
      simState.slides.playback.positionMs = Math.max(0, seconds * 1000);
    }
    simState.eventLog.unshift(`[propresenter] ${layer} seek -> ${seconds.toFixed(1)}s (simulated)`);
    return structuredClone(simState);
  },

  async triggerProPresenterClearGroup(id: string): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("propresenter_clear_group", { id });
    }
    simState.eventLog.unshift(`[propresenter] clear group '${id}' (simulated)`);
    return structuredClone(simState);
  },

  async refreshProPresenterCatalog(
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
      return invokeTauri<AppStateSnapshot>("propresenter_catalog", { kind });
    }
    simState.eventLog.unshift(`[propresenter] refresh ${kind} catalog (simulated)`);
    return structuredClone(simState);
  },

  async triggerProPresenterResource(
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
      return invokeTauri<AppStateSnapshot>("propresenter_resource", { action, id });
    }
    simState.eventLog.unshift(`[propresenter] ${action} '${id}' (simulated)`);
    return structuredClone(simState);
  },

  async controlEasyWorship(
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
      return invokeTauri<AppStateSnapshot>("easyworship_control", { action });
    }
    simState.eventLog.unshift(`[easyworship] action ${action} (simulated)`);
    if (action === "gotoStartSlide" || action === "gotoStartPresentation") {
      applySlidePosition(simState, 1);
    }
    return structuredClone(simState);
  },

  async getEasyWorshipSlideImage(
    rectype: string,
    presRowid: string,
    slideRowid: string,
    revision: string
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("easyworship_get_slide_image", {
        rectype,
        presRowid,
        slideRowid,
        revision,
      });
    }
    simState.eventLog.unshift(
      `[easyworship] getSlideImage ${rectype}/${presRowid}/${slideRowid} (simulated)`
    );
    return structuredClone(simState);
  },

  /** Raw JPEG bytes for the key in `state.slides.image`; null when no image is cached. */
  async getEasyWorshipImage(key: string): Promise<Uint8Array | null> {
    if (!isTauri() || !key) return null;
    const bytes = await invokeTauri<number[] | null>("easyworship_image", { key });
    return bytes ? new Uint8Array(bytes) : null;
  },

  /** Local display override only: the documented TCP catalog has no black/clear/logo toggle. */
  async setEasyWorshipScreenFlag(
    field: "black" | "clear" | "logo",
    value: boolean
  ): Promise<AppStateSnapshot> {
    if (isTauri()) {
      return invokeTauri<AppStateSnapshot>("easyworship_screen_flag", { field, value });
    }
    simState.slides.screen[field] = value;
    if (field === "clear") simState.slides.cleared = value;
    simState.eventLog.unshift(
      `[easyworship] local-only ${field} override set to ${value} (simulated)`
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

  async switchNdiReceiver(receiverId: string, sourceName: string): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("switch_ndi_receiver", { receiverId, sourceName });
    simState.ndiReceivers = simState.ndiReceivers.map((r) =>
      r.id === receiverId
        ? { ...r, subscribedSource: sourceName, status: sourceName === r.expectedSource ? "CONNECTED" : "DRIFT" }
        : r
    );
    simState.eventLog.unshift(
      `[ndi-discovery-5959] Sent <control_receiver><command>connect</command> to ${receiverId} -> '${sourceName}'`
    );
    return structuredClone(simState);
  },

  async autoHealNdiReceivers(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("auto_heal_ndi_receivers");
    simState.ndiReceivers = simState.ndiReceivers.map((r) => ({
      ...r,
      subscribedSource: r.expectedSource,
      status: "CONNECTED",
    }));
    simState.eventLog.unshift("[ndi-discovery-5959] Auto-healed all NDI 6 receivers to expected show sources");
    return structuredClone(simState);
  },

  async flashDanteIdentify(routeId: string): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("flash_dante_identify", { routeId });
    simState.danteRoutes = simState.danteRoutes.map((r) =>
      r.id === routeId ? { ...r, identifyFlashing: !r.identifyFlashing } : r
    );
    simState.eventLog.unshift(`[dante-conmon] Sent IDENTIFY_QUERY (0x0063) for route ${routeId} on UDP :8700`);
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
      const resp = await fetch("https://api.github.com/repos/KhanTheDaleK1/One-Ring/releases");
      if (!resp.ok) return null;
      const releases = await resp.json();
      if (!releases || releases.length === 0) return null;
      const latest = releases[0];
      const currentVersion = "0.1.6";
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
  return ["ProPresenter — Main Presentation", "Google Chrome — YouTube Studio", "PowerPoint — Sunday Announcements"];
}

export interface InstalledAudioPlugin {
  name: string;
  format: string;
  path: string;
}

export interface MediaEngineStatus {
  obsBinaryPath?: string | null;
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
    { name: "ValhallaSupermassive", format: "VST3", path: "/Library/Audio/Plug-Ins/VST3/ValhallaSupermassive.vst3" },
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
  return { obsBinaryPath: null, ffmpegBinaryPath: "/opt/homebrew/bin/ffmpeg", vstPluginCount: 1, auPluginCount: 1, daemonRunning: false };
}

export async function startHeadlessMediaDaemon(): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("start_headless_media_daemon");
  }
  return "Daemon simulated in browser";
}

export async function routeDanteCrosspoint(rxIp: string, rxChanId: number, txChan: string, txDev: string): Promise<AppStateSnapshot> {
  if (isTauri()) {
    return invokeTauri<AppStateSnapshot>("route_dante_crosspoint", { rxIp, rxChanId, txChan, txDev });
  }
  return structuredClone(simState);
}

export async function triggerNdiPtz(sourceId: string, presetIndex?: number, pan?: number, tilt?: number): Promise<AppStateSnapshot> {
  if (isTauri()) {
    return invokeTauri<AppStateSnapshot>("trigger_ndi_ptz", { sourceId, presetIndex: presetIndex ?? null, pan: pan ?? null, tilt: tilt ?? null });
  }
  return structuredClone(simState);
}

export async function sendX32Osc(address: string, value: number): Promise<AppStateSnapshot> {
  if (isTauri()) {
    return invokeTauri<AppStateSnapshot>("send_x32_osc", { address, value });
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

export async function remuxRecordingToMp4(filePath: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("remux_recording_to_mp4", { filePath });
  }
  return `Remuxed cleanly to ${filePath.replace(/\.[^/.]+$/, "")}.mp4 (browser mode simulated)`;
}

export async function sendObsStreamCaption(text: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("send_obs_stream_caption", { text });
  }
  return text ? `CC sent (local fallback): "${text}"` : "Cleared stream captions";
}

export async function dispatchObsStudioCommand(action: string, arg?: string): Promise<string> {
  if (isTauri()) {
    return invokeTauri<string>("dispatch_obs_studio_command", { action, arg: arg ?? null });
  }
  return `Dispatched ${action}`;
}
