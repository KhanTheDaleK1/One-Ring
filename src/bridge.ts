import type {
  AppStateSnapshot,
  CueVerificationStep,
  SlideCue,
  SlideKind,
} from "./types";
import type { UnlistenFn } from "@tauri-apps/api/event";

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

function recomputeDerived(s: AppStateSnapshot) {
  const pastor = s.dcas.find((d) => d.id === "dca-1");
  if (pastor) {
    if (s.beltpackFaultSimulated) {
      pastor.signalDb = -90;
      pastor.signalPresent = false;
    } else if (!pastor.muted) {
      pastor.signalDb = -11.5;
      pastor.signalPresent = true;
    } else {
      pastor.signalDb = -58;
      pastor.signalPresent = false;
    }
  }
  if (pastor && !pastor.muted && !pastor.signalPresent) {
    s.silentMicAlert =
      "SILENT PASTOR MIC: DCA 1 (Pastor) is LIVE/UNMUTED, but Dante Conmon UDP :8751 reports 0xFE (<-90 dBFS) on ULXD4-Pastor-Tx1. Check beltpack power/mute switch!";
  } else {
    s.silentMicAlert = null;
  }
  s.cameras = s.cameras.map((c) => ({
    ...c,
    tally: c.id === s.activeCameraPresetId ? "program" : "idle",
  }));
}

type SlideSeed = [section: string, title: string, text: string, kind?: SlideKind];

const makeSlideSet = (prefix: string, seeds: SlideSeed[]): SlideCue[] =>
  seeds.map(([section, title, text, kind = "lyrics"], index) => ({
    id: `${prefix}-${index + 1}`,
    number: index + 1,
    section,
    title,
    text,
    kind,
  }));

/**
 * Clean-room placeholder slide decks used by the built-in simulator. The
 * visual grid mirrors the live presentation payload shape, so replacing this
 * with ProPresenter / EasyWorship data later requires no Show Mode changes.
 */
const SLIDE_SETS: Record<string, SlideCue[]> = {
  "Pre-Service Announcements": makeSlideSet("preservice", [
    ["Welcome", "Welcome", "Welcome! Service begins in 5 minutes.", "title"],
    ["Announcements", "Kids Check-In", "Kids check-in is open in the lobby.", "media"],
    ["Announcements", "Tonight", "Youth group meets tonight at 6:00 PM.", "media"],
    ["Next Steps", "New Here?", "Stop by the Welcome Desk for a gift.", "media"],
    ["Giving", "Give Online", "Give online or at the giving boxes.", "media"],
    ["Community", "Small Groups", "Join a small group this fall.", "media"],
    ["Prayer", "Prayer Team", "Prayer team is available after service.", "media"],
    ["Countdown", "2 Minutes", "Worship begins in 2 minutes.", "title"],
  ]),
  "5-Minute Countdown": makeSlideSet("countdown", [
    ["Countdown", "5:00", "Worship begins in 5 minutes.", "title"],
    ["Countdown", "4:00", "Worship begins in 4 minutes.", "title"],
    ["Countdown", "3:00", "Worship begins in 3 minutes.", "title"],
    ["Countdown", "2:00", "Worship begins in 2 minutes.", "title"],
    ["Countdown", "1:00", "Worship begins in 1 minute.", "title"],
  ]),
  "Praise (Song 1)": makeSlideSet("worship", [
    ["Verse 1", "Verse 1", "We lift our eyes to the morning light", "lyrics"],
    ["Verse 1", "Verse 1 (cont.)", "Your faithfulness carries us through the night", "lyrics"],
    ["Chorus", "Chorus", "Holy, holy, You are worthy", "lyrics"],
    ["Chorus", "Chorus (cont.)", "All the earth will sing Your praise", "lyrics"],
    ["Verse 2", "Verse 2", "We fix our hearts on the hope You bring", "lyrics"],
    ["Verse 2", "Verse 2 (cont.)", "Every fear is quieted when we sing", "lyrics"],
    ["Bridge", "Bridge", "You are the King of glory", "lyrics"],
    ["Bridge", "Bridge (repeat)", "You are the King of glory", "lyrics"],
    ["Chorus", "Final Chorus", "Holy, holy, You are worthy", "lyrics"],
    ["Tag", "Tag", "Jesus, You are worthy", "lyrics"],
  ]),
  "Welcome & Next Steps": makeSlideSet("welcome", [
    ["Welcome", "Welcome Home", "We are glad you are here today.", "title"],
    ["Announcements", "Announcements", "Take a moment to review this week's news.", "media"],
    ["Next Steps", "Next Steps", "Find community, serve, and grow with us.", "media"],
    ["Giving", "Generosity", "Thank you for supporting the mission.", "media"],
    ["Prayer", "Prayer", "Prayer team is available at the front.", "media"],
    ["Closing", "See You Soon", "Join us again next Sunday.", "title"],
  ]),
  "Sermon: Hope Anchored": makeSlideSet("sermon", [
    ["Sermon", "Hope Anchored", "A living hope for every season.", "title"],
    ["Scripture", "Hebrews 6:19", "We have this hope as an anchor for the soul.", "scripture"],
    ["Point 1", "Hope Holds", "Hope holds us steady when the storm comes.", "lyrics"],
    ["Point 2", "Hope Looks Up", "Hope looks beyond today's circumstance.", "lyrics"],
    ["Point 3", "Hope Is Anchored", "Hope is anchored in the person of Christ.", "lyrics"],
    ["Application", "Respond", "Where is God inviting you to trust Him?", "media"],
    ["Prayer", "Prayer", "Pray for hope in the waiting.", "media"],
    ["Closing", "Hope Anchored", "Go from here anchored in hope.", "title"],
  ]),
  "Benediction & Dismissal": makeSlideSet("benediction", [
    ["Benediction", "Benediction", "May the God of hope fill you with all joy.", "scripture"],
    ["Blessing", "Blessing", "Go in peace, rooted and grounded in love.", "scripture"],
    ["Sending", "Sending", "You are sent to carry hope to the world.", "media"],
    ["Dismissal", "Dismissal", "Thank you for worshiping with us today.", "title"],
  ]),
};

const slideSetFor = (label: string): SlideCue[] =>
  SLIDE_SETS[label] ??
  makeSlideSet(`adhoc-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, [
    [label, label, label, "title"],
    ["Ready", "Ready", "Slide content is waiting for the live presentation feed.", "media"],
  ]);

const INITIAL_SLIDES = slideSetFor("Pre-Service Announcements");

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

const initialSimState = (): AppStateSnapshot => ({
  mockMode: true,
  rehearsalMode: false,
  serviceName: "Sunday 10:30 AM Service",
  activeCueIndex: 0,
  canUndo: false,
  undoDepth: 0,
  lastUndoLabel: null,
  silentMicAlert: null,
  beltpackFaultSimulated: false,
  danteClock:
    "48 kHz / 24-bit • PTP Grandmaster Locked (X32-Dante 00:1D:C1:8A:44:10) • Conmon UDP :8751 Metering Active",
  health: [
    { id: "x32", label: "X32", status: "ok", detail: "OSC 10.1.24.50:10023 (/xremote 8s)", protocol: "X32 OSC UDP :10023", latencyMs: 2 },
    { id: "dante", label: "Dante", status: "ok", detail: "ARC + Conmon :8700/:8751 Locked", protocol: "Audinate ARC/Conmon UDP", latencyMs: 1 },
    { id: "yt", label: "YT + FB", status: "ok", detail: "OBS v5 :4455 + SLOBS :28194 Ready", protocol: "obswebsocket.msgpack + JSON-RPC", latencyMs: 3 },
    { id: "slides", label: "ProPresenter", status: "ok", detail: "POST /v1/status/updates Stream Active", protocol: "ProPresenter 22 control-tower v1", latencyMs: 4 },
    { id: "cams", label: "NDI 6 / PTZ", status: "ok", detail: "Discovery :5959 (3 Rx, 4 Presets)", protocol: "NDI 6 Discovery :5959 + VISCA :52381", latencyMs: 3 },
  ],
  preflight: [
    {
      id: "chk-topology",
      domain: "Show-File vs. Live Topology",
      title: "All 6 service cues verified against live OBS canvases, PTZ presets, Dante Rx & ProPresenter playlist",
      status: "pass",
      detail: "0 missing scenes, 0 missing crosspoints, 0 orphan presets",
      evidence: "6/6 cues validated against live capability graph",
      fixLabel: null,
    },
    {
      id: "chk-x32",
      domain: "Behringer X32",
      title: "OSC reachable on UDP :10023, /xremote subscription active, Main LR unmuted",
      status: "pass",
      detail: "X32 Producer (FW 4.09) • 4 DCAs mapped • /meters/1 streaming",
      evidence: "RTT 1.8 ms • Scene 01 'Pre-Service'",
      fixLabel: "Re-Sync X32 Scene",
    },
    {
      id: "chk-dante",
      domain: "Dante Network",
      title: "Single PTP Grandmaster (48 kHz), 4/4 ARC crosspoints UNICAST/MULTICAST, Conmon UDP :8751 metering active",
      status: "pass",
      detail: "X32-Dante ↔ DVS-Broadcast ↔ ULXD4-Wireless all RXSTATUS=OK",
      evidence: "0 clock sync errors • Multicast 224.0.0.232:8751",
      fixLabel: "Re-Verify Crosspoints",
    },
    {
      id: "chk-stream",
      domain: "OBS 33 / Streamlabs Dual-Canvas",
      title: "Horizontal (16:9) + Vertical (9:16) canvases verified; YouTube + Facebook RTMPS outputs ready",
      status: "pass",
      detail: "OBS v5 (:4455) + Streamlabs Local TCP (127.0.0.1:28194 auto-auth)",
      evidence: "CPU 8.4% • GPU Headroom 84% • Disk 7.9 TB free",
      fixLabel: "Test Output Handshake",
    },
    {
      id: "chk-slides",
      domain: "ProPresenter 22.0.1",
      title: "Multiplexed chunked stream (POST /v1/status/updates) active; Stage Display & ProLink ready",
      status: "pass",
      detail: "Playlist 'Sunday 10:30 AM' loaded • _proapiv1._tcp advertised",
      evidence: "Chunked stream 0 drops • ProLink 224.0.0.90:18514 synced",
      fixLabel: "Focus Active Playlist",
    },
    {
      id: "chk-ndi",
      domain: "NDI 6 & PTZ Cameras",
      title: "NDI 6 Discovery (:5959) receiver_listener active; all 3 building displays on intended sources",
      status: "pass",
      detail: "Lobby TV, Stage Confidence & Broadcast Key verified via <query_receivers/>",
      evidence: "Metadata-only PTZ (<ndi_enabled_streams video=false text=true/>)",
      fixLabel: "Auto-Heal NDI Displays",
    },
  ],
  topologyIssues: [],
  dcas: [
    { id: "dca-1", number: 1, name: "Pastor Wireless", muted: true, levelDb: 0, minDb: -6, maxDb: 6, guardMute: false, signalDb: -58, signalPresent: false, danteTxChannel: "ULXD4-Pastor-Tx1" },
    { id: "dca-2", number: 2, name: "Worship Band", muted: true, levelDb: -2, minDb: -9, maxDb: 3, guardMute: false, signalDb: -18, signalPresent: true, danteTxChannel: "X32-Band-Stem" },
    { id: "dca-3", number: 3, name: "Media / ProPresenter", muted: false, levelDb: 0, minDb: -12, maxDb: 3, guardMute: false, signalDb: -14.2, signalPresent: true, danteTxChannel: "DVS-ProPresenter-L/R" },
    { id: "dca-4", number: 4, name: "Main FOH LR", muted: false, levelDb: 0, minDb: -3, maxDb: 0, guardMute: true, signalDb: -12.8, signalPresent: true, danteTxChannel: "X32-Main-LR" },
  ],
  cameras: [
    { id: "cam-wide", cameraId: "cam1", name: "1: Stage Wide", presetIndex: 1, protocol: "NDI Metadata PTZ", tally: "program" },
    { id: "cam-pulpit", cameraId: "cam1", name: "2: Pulpit Tight", presetIndex: 2, protocol: "NDI Metadata PTZ", tally: "idle" },
    { id: "cam-worship", cameraId: "cam2", name: "3: Worship Center", presetIndex: 1, protocol: "VISCA-over-IP :52381", tally: "idle" },
    { id: "cam-crowd", cameraId: "cam3", name: "4: Crowd / Keys", presetIndex: 1, protocol: "VISCA-over-IP :52381", tally: "idle" },
  ],
  activeCameraPresetId: "cam-wide",
  obsScene: "Pre-Service Loop",
  verticalScene: "Vertical: Pre-Service Reels",
  canvases: [
    {
      uuid: "canvas-main-16x9",
      name: "Primary Broadcast (Horizontal)",
      aspect: "16:9",
      resolution: "1920x1080 @ 60fps",
      activeScene: "Pre-Service Loop",
      engine: "OBS 33 GetCanvasList (MAIN | ACTIVATE | MIX_AUDIO)",
    },
    {
      uuid: "canvas-vert-9x16",
      name: "Social / Shorts Feed (Vertical)",
      aspect: "9:16",
      resolution: "1080x1920 @ 60fps",
      activeScene: "Vertical: Pre-Service Reels",
      engine: "Streamlabs DualOutputService + OBS 33 Canvas",
    },
  ],
  broadcasts: [
    { id: "youtube", platform: "YouTube Live (16:9)", live: false, bitrateKbps: 0, droppedFrames: 0, elapsedSec: 0, endpoint: "rtmps://a.rtmp.youtube.com/live2", canvas: "Horizontal 16:9" },
    { id: "facebook", platform: "Facebook + Vertical Simulcast", live: false, bitrateKbps: 0, droppedFrames: 0, elapsedSec: 0, endpoint: "rtmps://live-api-s.facebook.com:443/rtmp", canvas: "Horizontal 16:9 + Vertical 9:16" },
    { id: "record", platform: "Local Multi-Chapter MKV", live: false, bitrateKbps: 0, droppedFrames: 0, elapsedSec: 0, endpoint: "/mnt/BCloud/Recordings/Sunday.mkv", canvas: "Horizontal 16:9" },
  ],
  recordChapters: ["00:00 — Pre-Service Loop (Ready)"],
  danteRoutes: [
    { id: "dr-1", rxDevice: "X32-FOH-Dante", rxChannel: "Rx 01 (Pastor Mic)", txDevice: "ULXD4-Rack-A", txChannel: "ULXD4-Pastor-Tx1", rxStatus: "UNICAST", signalDbfs: -12, identifyFlashing: false },
    { id: "dr-2", rxDevice: "X32-FOH-Dante", rxChannel: "Rx 17-18 (ProPresenter)", txDevice: "MacStudio-FOH (DVS)", txChannel: "DVS-ProPresenter-L/R", rxStatus: "UNICAST", signalDbfs: -14, identifyFlashing: false },
    { id: "dr-3", rxDevice: "Broadcast-OBS (Dante Studio)", rxChannel: "Rx 01-02 (Broadcast Mix)", txDevice: "X32-FOH-Dante", txChannel: "Matrix 1-2 (Stream Bus)", rxStatus: "MULTICAST", signalDbfs: -9, identifyFlashing: false },
    { id: "dr-4", rxDevice: "Lobby-Amp-PoE", rxChannel: "Rx 01 (Lobby Fill)", txDevice: "X32-FOH-Dante", txChannel: "Matrix 3 (Foyer)", rxStatus: "UNICAST", signalDbfs: -16, identifyFlashing: false },
  ],
  ndiReceivers: [
    { id: "ndi-rx-1", receiverName: "Lobby Signage Display (Studio Monitor)", ip: "10.1.24.71:5960", subscribedSource: "ONE-RING (Lobby Feed)", expectedSource: "ONE-RING (Lobby Feed)", status: "CONNECTED", tallyProgram: true },
    { id: "ndi-rx-2", receiverName: "Stage Confidence Monitor", ip: "10.1.24.72:5960", subscribedSource: "PROPRESENTER (Stage Display)", expectedSource: "PROPRESENTER (Stage Display)", status: "CONNECTED", tallyProgram: false },
    { id: "ndi-rx-3", receiverName: "OBS Lower-Third Keyer", ip: "127.0.0.1:5961", subscribedSource: "PROPRESENTER (Audience Alpha Key)", expectedSource: "PROPRESENTER (Audience Alpha Key)", status: "CONNECTED", tallyProgram: true },
  ],
  ndiSources: [
    "ONE-RING (Lobby Feed)",
    "PROPRESENTER (Stage Display)",
    "PROPRESENTER (Audience Alpha Key)",
    "CAM-1 (Stage Wide NDI|HX3)",
    "CAM-2 (Pulpit Tight NDI|HX3)",
    "OBS-PROGRAM (Main Output)",
  ],
  slides: {
    app: "ProPresenter 22.0.1",
    playlistName: "Sunday 10:30 AM",
    presentationName: "Pre-Service Announcements",
    currentSlide: 1,
    totalSlides: INITIAL_SLIDES.length,
    currentText: INITIAL_SLIDES[0]?.text ?? "",
    nextText: INITIAL_SLIDES[1]?.text ?? "",
    cleared: false,
    stageMessage: "Doors Open • Mic Check Complete",
    transportLayer: "presentation (Auto-Advance Active)",
    slides: INITIAL_SLIDES,
  },
  cues: [
    {
      id: "cue-1", index: 1, title: "Pre-Service Loop",
      actions: ["ProPresenter: Pre-Service Announcements", "X32: Media DCA ON, Pastor/Band Muted", "OBS 16:9 + 9:16: Pre-Service Loop", "PTZ Cam 1: Stage Wide"],
      obsScene: "Pre-Service Loop", verticalScene: "Vertical: Pre-Service Reels", cameraPresetId: "cam-wide", slideLabel: "Pre-Service Announcements",
      unmuteDcas: ["dca-3"], muteDcas: ["dca-1", "dca-2"], recordChapter: "Pre-Service Loop", riskTier: 1,
    },
    {
      id: "cue-2", index: 2, title: "Countdown & Go Live (YT + FB + Rec)",
      actions: ["ProPresenter: 5-Minute Countdown (ProLink Preroll)", "OBS + SLOBS: Start YT + FB + MKV Recording", "OBS 33: CreateRecordChapter('Countdown')"],
      obsScene: "Countdown", verticalScene: "Vertical: Countdown", cameraPresetId: "cam-wide", slideLabel: "5-Minute Countdown",
      unmuteDcas: ["dca-3"], muteDcas: ["dca-1", "dca-2"], recordChapter: "5-Minute Countdown", riskTier: 2,
    },
    {
      id: "cue-3", index: 3, title: "Worship Set",
      actions: ["ProPresenter: Praise (Song 1) + Stage Lyrics", "X32: Unmute Worship Band DCA 2", "OBS 16:9: Band Wide • 9:16: Lead Vocal Crop", "PTZ Cam 2: Worship Center"],
      obsScene: "Band Wide", verticalScene: "Vertical: Worship Lead", cameraPresetId: "cam-worship", slideLabel: "Praise (Song 1)",
      unmuteDcas: ["dca-2"], muteDcas: ["dca-1"], recordChapter: "Worship Set", riskTier: 1,
    },
    {
      id: "cue-4", index: 4, title: "Welcome & Announcements",
      actions: ["ProPresenter: Welcome & Next Steps", "X32: Unmute Pastor DCA 1 (Verify Dante Tx1 Signal)", "OBS 16:9 + 9:16: Stage Host", "PTZ Cam 1: Stage Wide"],
      obsScene: "Stage", verticalScene: "Vertical: Host Center", cameraPresetId: "cam-wide", slideLabel: "Welcome & Next Steps",
      unmuteDcas: ["dca-1", "dca-3"], muteDcas: ["dca-2"], recordChapter: "Welcome & Announcements", riskTier: 1,
    },
    {
      id: "cue-5", index: 5, title: "Sermon: Hope Anchored",
      actions: ["ProPresenter: Sermon Notes + Lower-Third Alpha Key", "X32: Pastor DCA 1 ON + Band Muted", "OBS 33: Cut to Pulpit + CreateRecordChapter('Sermon')", "PTZ Cam 1: Recall Preset 2 (Pulpit Tight)"],
      obsScene: "Pulpit", verticalScene: "Vertical: Pastor Tight 9:16", cameraPresetId: "cam-pulpit", slideLabel: "Sermon: Hope Anchored",
      unmuteDcas: ["dca-1", "dca-3"], muteDcas: ["dca-2"], recordChapter: "Sermon: Hope Anchored", riskTier: 1,
    },
    {
      id: "cue-6", index: 6, title: "Closing & Benediction",
      actions: ["ProPresenter: Benediction & Dismissal", "X32: Pastor + Worship Band DCAs Active", "OBS 16:9: Stage Wide • NDI Lobby: Dismissal Slide", "PTZ Cam 3: Crowd / Keys"],
      obsScene: "Stage Wide", verticalScene: "Vertical: Closing Wide", cameraPresetId: "cam-crowd", slideLabel: "Benediction & Dismissal",
      unmuteDcas: ["dca-1", "dca-2"], muteDcas: [], recordChapter: "Closing & Benediction", riskTier: 1,
    },
  ],
  lastVerification: null,
  eventLog: [
    "[22:00:01] [ring-discovery] mDNS + Multicast active: _netaudio-arc._udp, _ndi._tcp, _proapiv1._tcp, 224.0.0.90:18514",
    "[22:00:02] [propresenter] Connected to POST /v1/status/updates (chunked multiplex stream: 6 topics)",
    "[22:00:02] [streamlabs] Auto-authorized on local TCP 127.0.0.1:28194 + \\\\.\\pipe\\slobs (DualOutputService synced)",
    "[22:00:03] [obs-ws-v5] Identified on ws://127.0.0.1:4455 (obswebsocket.msgpack, 2 canvases)",
    "[22:00:03] [dante-conmon] Subscribed to UDP 224.0.0.232:8751 1-byte dBFS peak metering",
    "[22:00:04] [ndi-discovery] Connected to TCP :5959 as receiver_listener (3 active receivers verified)",
  ],
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
      const nextSlides = slideSetFor(cue.slideLabel);
      simState.slides.presentationName = cue.slideLabel;
      simState.slides.slides = nextSlides;
      simState.slides.currentSlide = 1;
      simState.slides.totalSlides = nextSlides.length;
      simState.slides.currentText = nextSlides[0]?.text ?? "";
      simState.slides.nextText = nextSlides[1]?.text ?? "";
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
        { domain: "ProPresenter v1", expected: `Presentation == '${cue.slideLabel}'`, observed: `POST /v1/status/updates confirmed '${cue.slideLabel}'`, status: modeTag, latencyMs: 4 },
        { domain: "Behringer X32 OSC", expected: `Unmute [${cue.unmuteDcas.join(", ")}]`, observed: "UDP :10023 /dca/1..4/on verified", status: modeTag, latencyMs: 2 },
        { domain: "OBS 33 + Streamlabs Dual-Canvas", expected: `16:9='${cue.obsScene}', 9:16='${cue.verticalScene}'`, observed: `SerialFrame + CreateRecordChapter('${cue.recordChapter}') acked`, status: modeTag, latencyMs: 5 },
        { domain: "NDI 6 / VISCA PTZ", expected: `Preset == '${cue.cameraPresetId}'`, observed: "Tally + PTZ preset settled", status: modeTag, latencyMs: 3 },
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
    simState.preflight = simState.preflight.map((p) => ({ ...p, status: "pass" }));
    simState.eventLog.unshift("[preflight] Executed live topology + protocol probes across all 6 domains: 6/6 PASS");
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
