import type { AppStateSnapshot } from "./types";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const initialSimState = (): AppStateSnapshot => ({
  mockMode: true,
  serviceName: "Sunday 10:30 AM Service",
  activeCueIndex: 0,
  canUndo: false,
  danteClock: "48 kHz / 24-bit • Primary Locked (X32-Dante)",
  health: [
    { id: "x32", label: "X32", status: "ok", detail: "OSC 10.1.24.50:10023" },
    { id: "dante", label: "Dante", status: "ok", detail: "48kHz Locked" },
    { id: "yt", label: "YT Live", status: "ok", detail: "Standby (RTMPS Ready)" },
    { id: "fb", label: "FB Live", status: "ok", detail: "Standby (RTMPS Ready)" },
    { id: "slides", label: "Slides", status: "ok", detail: "ProPresenter Connected" },
    { id: "cams", label: "Cams/NDI", status: "ok", detail: "3 PTZ Online" },
  ],
  preflight: [
    { id: "chk-x32", domain: "Behringer X32", title: "OSC reachable on :10023 & /xremote active", status: "pass", detail: "Simulated X32 Producer (FW 4.09)" },
    { id: "chk-dante", domain: "Dante Network", title: "Grandmaster Clock 48kHz locked, 0 sync errors", status: "pass", detail: "DVS + X-Dante Rx/Tx subscribed" },
    { id: "chk-yt", domain: "YouTube Live", title: "RTMPS key loaded & ingest reachable", status: "pass", detail: "rtmps://a.rtmp.youtube.com/live2" },
    { id: "chk-fb", domain: "Facebook Live", title: "RTMPS key loaded & ingest reachable", status: "pass", detail: "rtmps://live-api-s.facebook.com:443/rtmp" },
    { id: "chk-slides", domain: "FOH Slides", title: "ProPresenter API connected, Sunday playlist loaded", status: "pass", detail: "24 slides ready, Stage Display active" },
    { id: "chk-cams", domain: "NDI & PTZ Cameras", title: "3 PTZ cameras online, Home presets verified", status: "pass", detail: "VISCA-over-IP :52381 + NDI PTZ" },
  ],
  dcas: [
    { id: "dca-1", number: 1, name: "Pastor", muted: true, levelDb: 0, minDb: -6, maxDb: 6, guardMute: false },
    { id: "dca-2", number: 2, name: "Band", muted: true, levelDb: -2, minDb: -9, maxDb: 3, guardMute: false },
    { id: "dca-3", number: 3, name: "Media / Video", muted: false, levelDb: 0, minDb: -12, maxDb: 3, guardMute: false },
    { id: "dca-4", number: 4, name: "Main LR", muted: false, levelDb: 0, minDb: -3, maxDb: 0, guardMute: true },
  ],
  cameras: [
    { id: "cam-wide", cameraId: "cam1", name: "1: Stage Wide", presetIndex: 1 },
    { id: "cam-pulpit", cameraId: "cam1", name: "2: Pulpit Tight", presetIndex: 2 },
    { id: "cam-worship", cameraId: "cam2", name: "3: Worship Ctr", presetIndex: 1 },
    { id: "cam-crowd", cameraId: "cam3", name: "4: Crowd / Keys", presetIndex: 1 },
  ],
  activeCameraPresetId: "cam-wide",
  obsScene: "Pre-Service Loop",
  broadcasts: [
    { id: "youtube", platform: "YouTube Live", live: false, bitrateKbps: 0, droppedFrames: 0, elapsedSec: 0, endpoint: "rtmps://a.rtmp.youtube.com/live2" },
    { id: "facebook", platform: "Facebook Live", live: false, bitrateKbps: 0, droppedFrames: 0, elapsedSec: 0, endpoint: "rtmps://live-api-s.facebook.com:443/rtmp" },
    { id: "record", platform: "Local Recording", live: false, bitrateKbps: 0, droppedFrames: 0, elapsedSec: 0, endpoint: "NAS /Recordings/Sunday.mkv" },
  ],
  slides: {
    app: "ProPresenter",
    playlistName: "Sunday 10:30 AM",
    presentationName: "Pre-Service Announcements",
    currentSlide: 1,
    totalSlides: 8,
    currentText: "Welcome! Service begins in 5 minutes.",
    nextText: "5-Minute Countdown Video",
    cleared: false,
  },
  cues: [
    {
      id: "cue-1", index: 1, title: "Pre-Service Loop",
      actions: ["Slides: Pre-Service", "X32: Media Unmuted", "OBS: Pre-Service Loop", "Cam: Stage Wide"],
      obsScene: "Pre-Service Loop", cameraPresetId: "cam-wide", slideLabel: "Pre-Service Announcements",
      unmuteDcas: ["dca-3"], muteDcas: ["dca-1", "dca-2"],
    },
    {
      id: "cue-2", index: 2, title: "Countdown & Go Live (YT + FB)",
      actions: ["Slides: Countdown", "OBS: Countdown", "Broadcast: YT + FB Live"],
      obsScene: "Countdown", cameraPresetId: "cam-wide", slideLabel: "5-Minute Countdown",
      unmuteDcas: ["dca-3"], muteDcas: ["dca-1", "dca-2"],
    },
    {
      id: "cue-3", index: 3, title: "Worship Set",
      actions: ["Slides: Worship Lyrics", "X32: Band Unmuted", "OBS: Band Wide", "Cam: Worship Ctr"],
      obsScene: "Band Wide", cameraPresetId: "cam-worship", slideLabel: "Praise (Song 1)",
      unmuteDcas: ["dca-2"], muteDcas: ["dca-1"],
    },
    {
      id: "cue-4", index: 4, title: "Welcome & Announcements",
      actions: ["Slides: Announcements", "X32: Pastor Unmuted", "OBS: Stage", "Cam: Stage Wide"],
      obsScene: "Stage", cameraPresetId: "cam-wide", slideLabel: "Welcome & Next Steps",
      unmuteDcas: ["dca-1", "dca-3"], muteDcas: ["dca-2"],
    },
    {
      id: "cue-5", index: 5, title: "Sermon",
      actions: ["Slides: Sermon Notes", "X32: Pastor Unmuted", "OBS: Pulpit", "Cam: Pulpit Tight"],
      obsScene: "Pulpit", cameraPresetId: "cam-pulpit", slideLabel: "Sermon: Hope Anchored",
      unmuteDcas: ["dca-1", "dca-3"], muteDcas: ["dca-2"],
    },
    {
      id: "cue-6", index: 6, title: "Closing & Benediction",
      actions: ["Slides: Closing", "X32: Band + Pastor", "OBS: Stage Wide", "Cam: Crowd / Keys"],
      obsScene: "Stage Wide", cameraPresetId: "cam-crowd", slideLabel: "Benediction & Dismissal",
      unmuteDcas: ["dca-1", "dca-2"], muteDcas: [],
    },
  ],
});

let simState: AppStateSnapshot = initialSimState();
let undoSnapshot: AppStateSnapshot | null = null;

export const bridge = {
  async getAppState(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("get_app_state");
    return structuredClone(simState);
  },

  async triggerCue(cueIndex: number): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("trigger_cue", { cueIndex });
    if (cueIndex < 0 || cueIndex >= simState.cues.length) return structuredClone(simState);
    undoSnapshot = structuredClone(simState);
    const cue = simState.cues[cueIndex];
    simState.activeCueIndex = cueIndex;
    simState.obsScene = cue.obsScene;
    simState.activeCameraPresetId = cue.cameraPresetId;
    simState.slides.presentationName = cue.slideLabel;
    simState.slides.currentSlide = 1;
    simState.slides.cleared = false;
    simState.canUndo = true;
    simState.dcas = simState.dcas.map((d) => ({
      ...d,
      muted: cue.unmuteDcas.includes(d.id) ? false : cue.muteDcas.includes(d.id) ? true : d.muted,
    }));
    return structuredClone(simState);
  },

  async undoLastCue(): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("undo_last_cue");
    if (undoSnapshot) {
      simState = { ...undoSnapshot, canUndo: false };
      undoSnapshot = null;
    }
    return structuredClone(simState);
  },

  async toggleDcaMute(dcaId: string): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("toggle_dca_mute", { dcaId });
    simState.dcas = simState.dcas.map((d) => (d.id === dcaId ? { ...d, muted: !d.muted } : d));
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
    return structuredClone(simState);
  },

  async triggerSlideAction(action: "prev" | "next" | "clear"): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("trigger_slide_action", { action });
    if (action === "next") {
      simState.slides.cleared = false;
      simState.slides.currentSlide = Math.min(simState.slides.totalSlides, simState.slides.currentSlide + 1);
    } else if (action === "prev") {
      simState.slides.cleared = false;
      simState.slides.currentSlide = Math.max(1, simState.slides.currentSlide - 1);
    } else {
      simState.slides.cleared = !simState.slides.cleared;
    }
    return structuredClone(simState);
  },

  async setBroadcastState(targetId: string, live: boolean): Promise<AppStateSnapshot> {
    if (isTauri()) return invokeTauri("set_broadcast_state", { targetId, live });
    simState.broadcasts = simState.broadcasts.map((b) =>
      targetId === "all" || b.id === targetId
        ? { ...b, live, bitrateKbps: live ? 5800 : 0, elapsedSec: live ? b.elapsedSec : 0 }
        : b
    );
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
