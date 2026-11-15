export type ViewMode = "preflight" | "show" | "engineer";

export interface DomainHealth {
  id: string;
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

export interface PreflightCheck {
  id: string;
  domain: string;
  title: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fixLabel?: string | null;
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
}

export interface CameraPreset {
  id: string;
  cameraId: string;
  name: string;
  presetIndex: number;
}

export interface BroadcastTarget {
  id: string;
  platform: string;
  live: boolean;
  bitrateKbps: number;
  droppedFrames: number;
  elapsedSec: number;
  endpoint: string;
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
}

export interface ServiceCue {
  id: string;
  index: number;
  title: string;
  actions: string[];
  obsScene: string;
  cameraPresetId: string;
  slideLabel: string;
  unmuteDcas: string[];
  muteDcas: string[];
}

export interface AppStateSnapshot {
  mockMode: boolean;
  serviceName: string;
  activeCueIndex: number;
  canUndo: boolean;
  health: DomainHealth[];
  preflight: PreflightCheck[];
  dcas: DcaChannel[];
  cameras: CameraPreset[];
  activeCameraPresetId: string;
  obsScene: string;
  broadcasts: BroadcastTarget[];
  slides: SlideState;
  cues: ServiceCue[];
  danteClock: string;
}
