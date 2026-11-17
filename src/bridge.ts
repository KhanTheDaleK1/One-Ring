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
  cleared: false,
  stageMessage: "",
  transportLayer: "local",
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
      // The native command surface only exposes relative slide actions today.
      // Drive it to the requested index so Show Mode remains functional.
      const current = await invokeTauri<AppStateSnapshot>("get_app_state");
      const delta = slideNumber - current.slides.currentSlide;
      if (delta === 0 && current.slides.cleared) {
        return invokeTauri<AppStateSnapshot>("trigger_slide_action", { action: "clear" });
      }
      const action = delta >= 0 ? "next" : "prev";
      let result = current;
      for (let i = 0; i < Math.abs(delta); i += 1) {
        result = await invokeTauri<AppStateSnapshot>("trigger_slide_action", { action });
      }
      return result;
    }
    applySlidePosition(simState, slideNumber);
    simState.eventLog.unshift(
      `[propresenter] Direct slide select -> ${simState.slides.currentSlide}/${simState.slides.totalSlides} '${simState.slides.presentationName}'`
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
      const currentVersion = "0.1.5";
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
