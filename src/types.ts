
// ---------------------------------------------------------------------------------------------
// Source Pipeline — Mirrors OBS Source Registry & Scene Graph
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

export interface ObsProfileSettings {
  name: string;
  baseResolution: string;
  outputResolution: string;
  fps: number;
  videoEncoder: "h264_nvenc" | "h264_videotoolbox" | "libx264" | "av1_nvenc";
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

/** EasyWorship `status` output flags. These are reported state, not remote actions. */
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
  canvasTitle: string;
  canvasTabs: CanvasTabConfig[];
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
  sources: SceneSourceItem[];
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
  sources: SceneSourceItem[];
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
