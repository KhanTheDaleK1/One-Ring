export type ViewMode =
  | "engineer"
  | "preflight"
  | "show"
  | "audio"
  | "slides"
  | "broadcast"
  | "cameras"
  | "settings";

export interface DomainHealth {
  id: string;
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
  protocol: string;
  latencyMs: number;
}

export interface PreflightCheck {
  id: string;
  domain: string;
  title: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  evidence: string;
  fixLabel?: string | null;
}

export interface TopologyIssue {
  id: string;
  cueId: string;
  severity: "warn" | "error";
  domain: string;
  message: string;
  autoFixable: boolean;
}

export interface DcaChannel {
  id: string;
  number: number;
  name: string;
  muted: boolean;
  levelDb: number;
  minDb: number;
  maxDb: number;
  guardMute: boolean;
  signalDb: number;
  signalPresent: boolean;
  danteTxChannel: string;
}

export interface CameraPreset {
  id: string;
  cameraId: string;
  name: string;
  presetIndex: number;
  protocol: string;
  tally: "program" | "preview" | "idle";
}

export interface BroadcastTarget {
  id: string;
  platform: string;
  live: boolean;
  bitrateKbps: number;
  droppedFrames: number;
  elapsedSec: number;
  endpoint: string;
  canvas: string;
}

export interface BroadcastCanvas {
  uuid: string;
  name: string;
  aspect: string;
  resolution: string;
  activeScene: string;
  engine: string;
}

export interface DanteRoute {
  id: string;
  rxDevice: string;
  rxChannel: string;
  txDevice: string;
  txChannel: string;
  rxStatus: "UNICAST" | "MULTICAST" | "PREPARING" | "UNRESOLVED";
  signalDbfs: number;
  identifyFlashing: boolean;
}

export interface NdiReceiver {
  id: string;
  receiverName: string;
  ip: string;
  subscribedSource: string;
  expectedSource: string;
  status: "CONNECTED" | "DRIFT" | "OFFLINE";
  tallyProgram: boolean;
}

export type SlideKind = "title" | "lyrics" | "scripture" | "media" | "blank";

export interface SlideCue {
  id: string;
  number: number;
  section: string;
  title: string;
  text: string;
  kind: SlideKind;
}

export interface SlideState {
  app: string;
  playlistName: string;
  presentationName: string;
  currentSlide: number;
  totalSlides: number;
  currentText: string;
  nextText: string;
  cleared: boolean;
  stageMessage: string;
  transportLayer: string;
  /**
   * Live slide list for the active presentation. Optional so older native
   * backends still hydrate; the Show Mode grid synthesises placeholders when
   * this is absent.
   */
  slides?: SlideCue[];
}

export interface ServiceCue {
  id: string;
  index: number;
  title: string;
  actions: string[];
  obsScene: string;
  verticalScene: string;
  cameraPresetId: string;
  slideLabel: string;
  unmuteDcas: string[];
  muteDcas: string[];
  recordChapter: string;
  riskTier: number;
}

export interface CueVerificationStep {
  domain: string;
  expected: string;
  observed: string;
  status: "APPLIED" | "REHEARSAL" | "DRIFT";
  latencyMs: number;
}

export interface CueVerificationReport {
  cueTitle: string;
  rehearsal: boolean;
  timestamp: string;
  steps: CueVerificationStep[];
}

// ---------------------------------------------------------------------------------------------
// Settings & Device Configuration — persisted by src-tauri/src/state.rs
// ---------------------------------------------------------------------------------------------

export interface DcaMapping {
  dcaId: string;
  dcaNumber: number;
  dcaName: string;
  /** Source channel routed into the DCA, e.g. "Ch 09 — Pastor Wireless". */
  sourceChannel: string;
}

export interface X32Settings {
  ipAddress: string;
  oscPort: number;
  keepaliveIntervalSec: number;
  dcaMappings: DcaMapping[];
}

export interface DanteSettings {
  subnetInterface: string;
  conmonMeterPort: number;
  conmonControlPort: number;
  clockSyncWarnMs: number;
  clockSyncErrorMs: number;
}

export interface RtmpDestination {
  id: string;
  platform: string;
  rtmpUrl: string;
  streamKey: string;
  enabled: boolean;
}

export type RecordingFormat = "MKV" | "MP4";
export type VideoEncoder = "NVENC" | "VideoToolbox" | "Software";

export interface BroadcastSettings {
  destinations: RtmpDestination[];
  recordingPath: string;
  recordingFormat: RecordingFormat;
  encoder: VideoEncoder;
}

export interface DisplayAssignments {
  fohWindow: string;
  stageDisplayWindow: string;
  ndiAlphaOutput: string;
}

export interface SlidesSettings {
  songselectClientId: string;
  songselectClientSecret: string;
  displayAssignments: DisplayAssignments;
}

export interface CameraPresetName {
  presetId: string;
  cameraId: string;
  label: string;
}

export interface NdiPtzSettings {
  discoveryRangeStart: string;
  discoveryRangeEnd: string;
  viscaPort: number;
  presetNames: CameraPresetName[];
}

export interface GeneralSettings {
  /** PIN required to unlock Engineer Mode from Volunteer Show Mode. */
  engineerPin: string;
}

export type StationRole = "slides" | "audio" | "broadcast" | "director" | "master";

export interface StationSettings {
  /** The position this physical machine is dedicated to. */
  role: StationRole;
  stationName: string;
  /** Lock the navigation to the tabs relevant to this role. */
  lockToRole: boolean;
}

export interface SyncSettings {
  /** Discover other One Ring nodes on the LAN (mDNS + WebSocket hub). */
  lanDiscoveryEnabled: boolean;
  hubAddress: string;
  syncPort: number;
  /** Cloud profile sync for show files, cues, endpoints and preferences. */
  cloudSyncEnabled: boolean;
  accountEmail: string;
  profileName: string;
  venueId: string;
  syncToken: string;
  autoSyncOnLaunch: boolean;
  lastSyncedAt: string;
}

export interface ConnectedStation {
  id: string;
  name: string;
  role: StationRole;
  online: boolean;
  latencyMs: number;
}

export interface AppSettings {
  x32: X32Settings;
  dante: DanteSettings;
  broadcast: BroadcastSettings;
  slides: SlidesSettings;
  ndiPtz: NdiPtzSettings;
  general: GeneralSettings;
  station: StationSettings;
  sync: SyncSettings;
}

/** Portable, user-authored show file (`*.ring.json`). */
export interface RingShowFile {
  format: "one-ring-show";
  version: 1;
  exportedAt: string;
  serviceName: string;
  cues: ServiceCue[];
  dcas: DcaChannel[];
  cameras: CameraPreset[];
  canvases: BroadcastCanvas[];
  broadcasts: BroadcastTarget[];
  recordChapters: string[];
  danteRoutes: DanteRoute[];
  ndiReceivers: NdiReceiver[];
  ndiSources: string[];
  slides: SlideState;
}

export interface AppStateSnapshot {
  mockMode: boolean;
  rehearsalMode: boolean;
  serviceName: string;
  activeCueIndex: number;
  canUndo: boolean;
  undoDepth: number;
  lastUndoLabel?: string | null;
  silentMicAlert?: string | null;
  beltpackFaultSimulated: boolean;
  health: DomainHealth[];
  preflight: PreflightCheck[];
  topologyIssues: TopologyIssue[];
  dcas: DcaChannel[];
  cameras: CameraPreset[];
  activeCameraPresetId: string;
  obsScene: string;
  verticalScene: string;
  canvases: BroadcastCanvas[];
  broadcasts: BroadcastTarget[];
  recordChapters: string[];
  danteClock: string;
  danteRoutes: DanteRoute[];
  ndiReceivers: NdiReceiver[];
  ndiSources: string[];
  slides: SlideState;
  cues: ServiceCue[];
  lastVerification?: CueVerificationReport | null;
  eventLog: string[];
  settings: AppSettings;
  /** Other One Ring nodes visible on the LAN. */
  connectedStations: ConnectedStation[];
  syncStatus: string;
}
