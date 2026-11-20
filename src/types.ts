
// ---------------------------------------------------------------------------------------------
// Source Pipeline — Mirrors Broadcast Source Registry & Scene Graph
// ---------------------------------------------------------------------------------------------

export type SourceType =
  | "app_audio_capture"
  | "audio_input_capture"
  | "audio_output_capture"
  | "browser"
  | "color"
  | "display_capture"
  | "game_capture"
  | "image"
  | "image_slide_show"
  | "media"
  | "scene"
  | "text"
  | "video_capture_device"
  | "window_capture"
  | "group";

export interface SourceDefinition {
  type: SourceType;
  label: string;
  category: "audio" | "video" | "graphic" | "utility";
  description: string;
  defaultSettings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Native Window & Display Capture — camelCase mirrors of the desktop runtime IPC structs
// ---------------------------------------------------------------------------------------------

/** One OS window reported by the native screen-capture backend. */
export interface CapturableWindow {
  id: number;
  title: string;
  appName: string;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  backend: string;
}

/** One physical display reported by the native screen-capture backend. */
export interface CapturableDisplay {
  id: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
  isPrimary: boolean;
  backend: string;
}

/** A single encoded frame pushed on the `capture://frame` event channel. */
export interface NativeCaptureFrame {
  sourceId: string;
  targetKind: "window" | "display" | string;
  targetId: number;
  width: number;
  height: number;
  mimeType: string;
  base64Data: string;
  timestampMs: number;
  backend: string;
}

/** Acknowledgement returned when a native capture stream is started. */
export interface NativeCaptureSessionInfo {
  sourceId: string;
  targetKind: string;
  targetId: number;
  fps: number;
  active: boolean;
  backend: string;
}

export interface SourceFilter {
  id: string;
  name: string;
  type: "vst" | "au" | "gain" | "noise_suppress" | "noise_gate" | "expander" | "compressor" | "basic_eq" | "invert_polarity" | "async_delay" | "chroma_key" | "luma_key" | "color_correction" | "lut" | "crop_pad" | "sharpness" | "scroll";
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface SourceTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleFilter: "disable" | "point" | "bilinear" | "bicubic" | "lanczos" | "area";
  blendingMode: "normal" | "additive" | "subtract" | "screen" | "multiply" | "lighten" | "darken";
  deinterlacing: "disable" | "discard" | "retro" | "blend" | "linear" | "yadif";
  flipH?: boolean;
  flipV?: boolean;
  cropLeft?: number;
  cropRight?: number;
  cropTop?: number;
  cropBottom?: number;
  opacity?: number;
}

export interface BroadcastProfileSettings {
  name: string;
  baseResolution: string;
  outputResolution: string;
  fps: number;
  videoEncoder: "h264_hardware_gpu" | "h264_hardware_media" | "libx264" | "av1_hardware_gpu";
  rateControl: "CBR" | "VBR" | "CQP";
  bitrateKbps: number;
  keyframeIntervalSec: number;
  audioSampleRate: 44100 | 48000;
  audioBitrateKbps: 128 | 160 | 192 | 320;
  recordingFormat: "mkv" | "mp4" | "flv";
  autoRemuxToMp4: boolean;
}

export interface SceneSourceItem {
  id: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  locked: boolean;
  volumeDb?: number;
  muted?: boolean;
  colorTag?: string;
  hideInMixer?: boolean;
  groupId?: string;
  filters?: SourceFilter[];
  transform?: SourceTransform;
  settings: Record<string, unknown>;
}

export type CanvasId = "mixing" | "video" | "slides" | "broadcast" | "master";

export type ViewMode = CanvasId | "settings";

export interface CanvasTabConfig {
  id: CanvasId;
  label: string;
  enabled: boolean;
}

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
  aoipTxChannel: string;
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

export interface AoipRoute {
  id: string;
  rxDevice: string;
  rxChannel: string;
  txDevice: string;
  txChannel: string;
  rxStatus: "UNICAST" | "MULTICAST" | "PREPARING" | "UNRESOLVED";
  signalDbfs: number;
  identifyFlashing: boolean;
}

export interface IpVideoReceiver {
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


export interface SlideTheme {
  backgroundType: "solid" | "gradient" | "image";
  backgroundColor: string;
  gradientTo?: string;
  backgroundImage?: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  lowerThirdBg: string;
  lowerThirdAccent: string;
  lowerThirdPosition: "bottom" | "lower-bar";
}


export interface ServiceSong {
  id: string;
  title: string;
  slides: SlideCue[];
}

export interface PresentationTimer {
  id: string;
  name: string;
  state: string;
  time: number;
  formatted: string;
  countdown: boolean;
}

export interface ScreenOutput {
  id: string;
  name: string;
  screenType: string;
  width: number;
  height: number;
  enabled: boolean;
}

/** SlideTcp `status` output flags. These are reported state, not remote actions. */
export interface ScreenFlags {
  black: boolean;
  clear: boolean;
  logo: boolean;
}

/** Metadata for a cached JPEG preview; raw bytes are fetched separately by key. */
export interface PresentationImage {
  key: string;
  source: "slide" | "current";
  imagehash: string;
  rectype: string;
  presRowid: string;
  slideRowid: string;
  revision: string;
  size: number;
  updatedMs: number;
}

export interface PlaybackState {
  layer: string;
  isPlaying: boolean;
  itemId: string;
  name: string;
  artist: string;
  audioOnly: boolean;
  durationMs: number;
  positionMs: number;
}

export interface SlideState {
  app: string;
  playlistName: string;
  presentationName: string;
  currentSlide: number;
  totalSlides: number;
  currentText: string;
  nextText: string;
  currentNotes: string;
  nextNotes: string;
  cleared: boolean;
  stageMessage: string;
  stageMessageVisible: boolean;
  stageMessageFlash: boolean;
  transportLayer: string;
  transportTime: number;
  timers: PresentationTimer[];
  activeLayers: string[];
  screens: ScreenOutput[];
  screen: ScreenFlags;
  image?: PresentationImage | null;
  playback?: PlaybackState | null;
  connected: boolean;
  lastUpdateMs: number;
  adapter: string;
  /**
   * Live slide list for the active presentation. Optional so older native
   * backends still hydrate; the Show Mode grid synthesises placeholders when
   * this is absent.
   */
  slides?: SlideCue[];
  songs?: ServiceSong[];
  activeSongId?: string;
  theme?: SlideTheme;
}

export interface ServiceCue {
  id: string;
  index: number;
  title: string;
  actions: string[];
  broadcastScene: string;
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

export interface ConsoleSettings {
  ipAddress: string;
  oscPort: number;
  keepaliveIntervalSec: number;
  dcaMappings: DcaMapping[];
}

export interface AoipSettings {
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
export type VideoEncoder = "HardwareGpu" | "HardwareMedia" | "Software";

export interface BroadcastSettings {
  destinations: RtmpDestination[];
  recordingPath: string;
  recordingFormat: RecordingFormat;
  encoder: VideoEncoder;
}

export interface DisplayAssignments {
  fohWindow: string;
  stageDisplayWindow: string;
  ipVideoAlphaOutput: string;
}

export interface SlidesSettings {
  songLibraryClientId: string;
  songLibraryClientSecret: string;
  displayAssignments: DisplayAssignments;
  esvApiKey?: string;
  apiBibleKey?: string;
  localBiblesDir?: string;
}

export interface CameraPresetName {
  presetId: string;
  cameraId: string;
  label: string;
}

/** Operator-managed PTZ camera endpoint in the Settings roster. */
export interface PtzCameraEntry {
  id: string;
  name: string;
  ipAddress: string;
  port: number;
  detail?: string;
}

export interface IpVideoPtzSettings {
  discoveryRangeStart: string;
  discoveryRangeEnd: string;
  ptzIpPort: number;
  presetNames: CameraPresetName[];
  /** Frontend-managed camera roster; persisted when the backend supports it. */
  cameras?: PtzCameraEntry[];
}

export interface GeneralSettings {
  canvasTitle: string;
  canvasTabs: CanvasTabConfig[];
  /** PIN required to unlock Engineer Mode from Volunteer Show Mode. */
  engineerPin: string;
  /** Booth display scaling percentage applied to the document root. */
  uiScale?: number;
  /** High-contrast operating mode for challenging booth lighting. */
  highContrast?: boolean;
  /** Warn before navigating away from the Settings page with unsaved edits. */
  confirmUnsavedLeave?: boolean;
  /** Send sanitized crash logs automatically when a previous-session report is found. */
  autoCrashReporting?: boolean;
  /** HTTPS relay that accepts sanitized crash reports. Empty means one-click issue reporting. */
  crashRelayUrl?: string;
  aiProvider?: string;
  aiModel?: string;
  aiEndpoint?: string;
  aiApiKey?: string;
}

/** Sanitized, shareable summary of a recorded frontend or runtime crash. */
export interface CrashReportSummary {
  id: string;
  timestampUtc: string;
  appVersion: string;
  os: string;
  arch: string;
  kind: string;
  message: string;
  location: string;
  stack: string;
  fingerprint: string;
}

/** Result of an operator-triggered subsystem connectivity probe. */
export interface ConnectionTestResult {
  ok: boolean;
  subsystem: string;
  host: string;
  port: number;
  latencyMs: number;
  summary: string;
  detail: string;
}

/** A device surfaced by a local-network discovery sweep. */
export interface DiscoveredLanDevice {
  name: string;
  host: string;
  port: number;
  kind: string;
  detail?: string;
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
  console: ConsoleSettings;
  aoip: AoipSettings;
  broadcast: BroadcastSettings;
  slides: SlidesSettings;
  ipVideoPtz: IpVideoPtzSettings;
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
  sources: SceneSourceItem[];
  aoipRoutes: AoipRoute[];
  ipVideoReceivers: IpVideoReceiver[];
  ipVideoSources: string[];
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
  broadcastScene: string;
  verticalScene: string;
  canvases: BroadcastCanvas[];
  broadcasts: BroadcastTarget[];
  recordChapters: string[];
  sources: SceneSourceItem[];
  aoipClock: string;
  aoipRoutes: AoipRoute[];
  ipVideoReceivers: IpVideoReceiver[];
  ipVideoSources: string[];
  slides: SlideState;
  cues: ServiceCue[];
  lastVerification?: CueVerificationReport | null;
  eventLog: string[];
  settings: AppSettings;
  /** Other One Ring nodes visible on the LAN. */
  connectedStations: ConnectedStation[];
  syncStatus: string;
}
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  release_name: string;
  release_notes: string;
  published_at: string;
  html_url: string;
  download_url?: string | null;
  update_available: boolean;
  assets: ReleaseAsset[];
}

// ---------------------------------------------------------------------------------------------
// Live Stream Telemetry, Audience Relay & On-Air Overlay
// ---------------------------------------------------------------------------------------------

/** Point-in-time encoder and audience health sample published by the broadcast domain. */
export interface StreamStatsSnapshot {
  live: boolean;
  recording: boolean;
  source: string;
  fps: number;
  bitrateKbps: number;
  droppedFrames: number;
  totalFrames: number;
  droppedPct: number;
  congestion: number;
  cpuUsagePct: number;
  renderFrameTimeMs: number;
  elapsedSec: number;
  bytesSent: number;
  viewerCount: number;
  peakViewers: number;
  updatedAtMs: number;
}

export type AudienceChatRole = "HOST" | "MOD" | "VIEWER";

/** A relayed audience chat entry that can be promoted to the on-air lower-third. */
export interface AudienceChatMessage {
  id: string;
  author: string;
  role: AudienceChatRole;
  text: string;
  channel: string;
  timestampMs: number;
  pinnedOnAir: boolean;
}

/** Operator-authored connection settings for the chat and viewer-statistics relay. */
export interface AudienceRelayConfig {
  enabled: boolean;
  mode: "websocket" | "webhook" | "irc";
  endpointUrl: string;
  authToken: string;
  channelName: string;
  hostDisplayName: string;
  statsWebhookUrl: string;
}
