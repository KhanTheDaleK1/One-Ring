import type { AppStateSnapshot, RingShowFile, SlideState } from "./types";

export const RING_SHOW_FORMAT = "one-ring-show";
export const RING_SHOW_VERSION = 1;

const emptySlides = (): SlideState => ({
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

/** Snapshot only the operator-authored show content — never runtime or device settings. */
export function buildShowFile(state: AppStateSnapshot): RingShowFile {
  return {
    format: RING_SHOW_FORMAT,
    version: RING_SHOW_VERSION,
    exportedAt: new Date().toISOString(),
    serviceName: state.serviceName,
    cues: state.cues,
    dcas: state.dcas,
    cameras: state.cameras,
    canvases: state.canvases,
    broadcasts: state.broadcasts,
    recordChapters: state.recordChapters,
    sources: state.sources || [],
    danteRoutes: state.danteRoutes,
    ndiReceivers: state.ndiReceivers,
    ndiSources: state.ndiSources,
    slides: state.slides,
  };
}

/** Apply a show file onto a snapshot while preserving device settings and session state. */
export function applyShowFileToSnapshot(
  state: AppStateSnapshot,
  show: RingShowFile
): AppStateSnapshot {
  const slides = show.slides ?? emptySlides();
  const dcas = show.dcas ?? [];
  const cameras = show.cameras ?? [];
  const canvases = show.canvases ?? [];
  const cues = show.cues ?? [];

  const activeCameraPresetId = cameras[0]?.id ?? "";
  const obsScene = canvases[0]?.activeScene ?? "";
  const verticalScene = canvases[1]?.activeScene ?? "";

  const nextCameras = cameras.map((camera) => ({
    ...camera,
    tally: camera.id === activeCameraPresetId ? ("program" as const) : ("idle" as const),
  }));

  return {
    ...state,
    serviceName: show.serviceName?.trim() || "Untitled Show",
    cues,
    dcas,
    cameras: nextCameras,
    canvases,
    broadcasts: show.broadcasts ?? [],
    recordChapters: show.recordChapters ?? [],
    danteRoutes: show.danteRoutes ?? [],
    ndiReceivers: show.ndiReceivers ?? [],
    ndiSources: show.ndiSources ?? [],
    slides,
    activeCueIndex: 0,
    activeCameraPresetId,
    obsScene,
    verticalScene,
    canUndo: false,
    undoDepth: 0,
    lastUndoLabel: null,
    lastVerification: null,
    silentMicAlert: null,
    beltpackFaultSimulated: false,
    eventLog: [
      `[show-file] Loaded '${show.serviceName || "Untitled Show"}' (${cues.length} cues, ${dcas.length} DCAs, ${cameras.length} cameras, ${slides.slides?.length ?? 0} slides)`,
      ...state.eventLog,
    ].slice(0, 200),
  };
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "one-ring-show"
  );
}

/** Save a portable `*.ring.json` file through the browser/webview download path. */
export function downloadShowFile(show: RingShowFile): void {
  const filename = `${slugify(show.serviceName)}.ring.json`;
  const blob = new Blob([JSON.stringify(show, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Read and validate a user-selected show file. */
export async function readShowFile(file: File): Promise<RingShowFile> {
  const raw = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("That file does not contain a show file.");
  }
  const candidate = parsed as Partial<RingShowFile>;
  if (candidate.format !== RING_SHOW_FORMAT) {
    throw new Error("Unrecognized show file. Expected a *.ring.json file created by One Ring.");
  }
  if (!Array.isArray(candidate.cues) || !Array.isArray(candidate.dcas)) {
    throw new Error("Show file is missing its cue or audio data.");
  }
  return {
    format: RING_SHOW_FORMAT,
    version: RING_SHOW_VERSION,
    exportedAt: candidate.exportedAt ?? new Date().toISOString(),
    serviceName: candidate.serviceName ?? "Untitled Show",
    cues: candidate.cues,
    dcas: candidate.dcas,
    cameras: candidate.cameras ?? [],
    canvases: candidate.canvases ?? [],
    broadcasts: candidate.broadcasts ?? [],
    recordChapters: candidate.recordChapters ?? [],
    sources: candidate.sources ?? [],
    danteRoutes: candidate.danteRoutes ?? [],
    ndiReceivers: candidate.ndiReceivers ?? [],
    ndiSources: candidate.ndiSources ?? [],
    slides: candidate.slides ?? emptySlides(),
  };
}
