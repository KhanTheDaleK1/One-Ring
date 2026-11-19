import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Radio,
  Settings,
  Plus,
  Play,
  Square,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Layers,
  Sliders,
  Download,
  Upload,
  Save,
  Monitor,
  Projector,
  Captions,
  Send,
  Maximize2,
  X,
} from "lucide-react";
import type {
  AppStateSnapshot,
  BroadcastProfileSettings,
  SceneSourceItem,
  SourceFilter,
  SourceTransform,
} from "../types";
import { AddSourceModal } from "./AddSourceModal";
import { BroadcastAudioMixerPanel } from "./BroadcastAudioMixerPanel";
import {
  getMediaEngineStatus,
  probeHardwareEncoders,
  remuxRecordingToMp4,
  saveReplayBuffer,
  startDirectFfmpegStream,
  startHeadlessMediaDaemon,
  startReplayBuffer,
  startStudioCompositor,
  stopDirectFfmpegStream,
  stopReplayBuffer,
  stopStudioCompositor,
  type EncoderCapability,
  type MediaEngineStatus,
} from "../bridge";
import { ProgramCanvasRenderer } from "./ProgramCanvasRenderer";
import { SourceSettingsModal } from "./SourceSettingsModal";
import { SourceFiltersModal } from "./SourceFiltersModal";
import { SourceTransformModal, DEFAULT_TRANSFORM } from "./SourceTransformModal";
import { SourceContextMenu } from "./SourceContextMenu";
import {
  BroadcastSettingsModal,
  DEFAULT_BROADCAST_HOTKEYS,
  formatHotkeyFromEvent,
} from "./BroadcastSettingsModal";

interface BroadcastCanvasViewProps {
  state: AppStateSnapshot;
  onBroadcastToggle: (id: string, live: boolean) => void;
  onAddSource: (source: SceneSourceItem) => void;
  onRemoveSource: (id: string) => void;
  onToggleSourceVisibility: (id: string) => void;
  onToggleSourceLock: (id: string) => void;
  onUpdateSourceSettings: (id: string, settings: Record<string, unknown>, name: string) => void;
  onSetAllSources: (sources: SceneSourceItem[]) => void;
}

interface BroadcastScene {
  id: string;
  name: string;
  sources: SceneSourceItem[];
}

const SCENES_STORAGE_KEY = "onering_broadcast_scenes";
const PROFILE_STORAGE_KEY = "onering_broadcast_profile";
const STREAM_CONFIG_STORAGE_KEY = "onering_broadcast_stream_config";
const HOTKEYS_STORAGE_KEY = "onering_broadcast_hotkeys";

function createDefaultScenes(initialSources: SceneSourceItem[]): BroadcastScene[] {
  return [
    { id: "scene_1", name: "Main Broadcast Scene", sources: initialSources },
    { id: "scene_2", name: "Worship Lyrics + Camera", sources: [] },
    { id: "scene_3", name: "Sermon Fullscreen Cam", sources: [] },
  ];
}

function loadSavedScenes(initialSources: SceneSourceItem[]): {
  scenes: BroadcastScene[];
  activeSceneId: string;
  previewSceneId: string;
  restoredFromStorage: boolean;
} {
  try {
    const raw = localStorage.getItem(SCENES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const listRaw = Array.isArray(parsed) ? parsed : parsed?.scenes;
      if (Array.isArray(listRaw) && listRaw.length > 0) {
        const scenes: BroadcastScene[] = listRaw
          .filter((sc: any) => sc && typeof sc.name === "string")
          .map((sc: any, idx: number) => ({
            id: typeof sc.id === "string" && sc.id ? sc.id : `scene_restored_${idx}`,
            name: sc.name,
            sources: Array.isArray(sc.sources) ? sc.sources : [],
          }));
        if (scenes.length > 0) {
          const activeId =
            typeof parsed?.activeSceneId === "string" &&
            scenes.some((s) => s.id === parsed.activeSceneId)
              ? parsed.activeSceneId
              : scenes[0].id;
          const previewId =
            typeof parsed?.previewSceneId === "string" &&
            scenes.some((s) => s.id === parsed.previewSceneId)
              ? parsed.previewSceneId
              : scenes[Math.min(1, scenes.length - 1)].id;
          return {
            scenes,
            activeSceneId: activeId,
            previewSceneId: previewId,
            restoredFromStorage: true,
          };
        }
      }
    }
  } catch {
    // ignore corrupted storage and fall back to defaults
  }
  const defaults = createDefaultScenes(initialSources);
  return {
    scenes: defaults,
    activeSceneId: defaults[0].id,
    previewSceneId: defaults[1]?.id || defaults[0].id,
    restoredFromStorage: false,
  };
}

function loadSavedProfile(state: AppStateSnapshot): BroadcastProfileSettings {
  const mappedEncoder: BroadcastProfileSettings["videoEncoder"] =
    state.settings?.broadcast?.encoder === "HardwareGpu"
      ? "h264_hardware_gpu"
      : state.settings?.broadcast?.encoder === "Software"
      ? "libx264"
      : "h264_hardware_media";
  const mappedFormat: BroadcastProfileSettings["recordingFormat"] =
    state.settings?.broadcast?.recordingFormat === "MP4" ? "mp4" : "mkv";

  const defaults: BroadcastProfileSettings = {
    name: "Church Broadcast (1080p60)",
    baseResolution: "1920x1080",
    outputResolution: "1920x1080",
    fps: 60,
    videoEncoder: mappedEncoder,
    rateControl: "CBR",
    bitrateKbps: 6000,
    keyframeIntervalSec: 2,
    audioSampleRate: 48000,
    audioBitrateKbps: 192,
    recordingFormat: mappedFormat,
    autoRemuxToMp4: true,
  };

  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...defaults, ...parsed };
      }
    }
  } catch {
    // fallback to defaults
  }
  return defaults;
}

function loadSavedStreamConfig(state: AppStateSnapshot): { rtmpUrl: string; streamKey: string } {
  try {
    const raw = localStorage.getItem(STREAM_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.rtmpUrl === "string" && typeof parsed.streamKey === "string") {
        return { rtmpUrl: parsed.rtmpUrl, streamKey: parsed.streamKey };
      }
    }
  } catch {
    // fallback
  }
  const dest =
    state.settings?.broadcast?.destinations?.find((d) => d.enabled) ||
    state.settings?.broadcast?.destinations?.[0];
  return {
    rtmpUrl: dest?.rtmpUrl || "rtmps://ingest.example.com/live2",
    streamKey: dest?.streamKey || "",
  };
}

function loadSavedHotkeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(HOTKEYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...DEFAULT_BROADCAST_HOTKEYS, ...parsed };
      }
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_BROADCAST_HOTKEYS };
}

export const BroadcastCanvasView: React.FC<BroadcastCanvasViewProps> = ({
  state,
  onBroadcastToggle,
  onAddSource,
  onRemoveSource,
  onToggleSourceVisibility,
  onToggleSourceLock,
  onUpdateSourceSettings,
  onSetAllSources,
}) => {
  const initialSceneLoadRef = useRef<ReturnType<typeof loadSavedScenes> | null>(null);
  if (!initialSceneLoadRef.current) {
    initialSceneLoadRef.current = loadSavedScenes(state.sources || []);
  }

  const [settingsModalSource, setSettingsModalSource] = useState<SceneSourceItem | null>(null);
  const [filtersModalSource, setFiltersModalSource] = useState<SceneSourceItem | null>(null);
  const [transformModalSource, setTransformModalSource] = useState<SceneSourceItem | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [encoderProfile, setEncoderProfile] = useState<
    "1080p60 Hardware" | "1080p30 Church Stream" | "720p30 Low Bandwidth"
  >("1080p60 Hardware");
  const [contextMenu, setContextMenu] = useState<{
    source: SceneSourceItem;
    x: number;
    y: number;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [showAddSource, setShowAddSource] = useState(false);
  const [showBroadcastSettings, setShowBroadcastSettings] = useState(false);
  const [hardwareEncoders, setHardwareEncoders] = useState<EncoderCapability[]>([]);
  const [encodersLoading, setEncodersLoading] = useState(false);
  const [nativeCompositorRunning, setNativeCompositorRunning] = useState(false);
  const [nativeCompositorBusy, setNativeCompositorBusy] = useState(false);
  const [studioMode, setStudioMode] = useState(false);

  const refreshHardwareEncoders = useCallback(async () => {
    setEncodersLoading(true);
    try {
      const encoders = await probeHardwareEncoders();
      setHardwareEncoders(Array.isArray(encoders) ? encoders : []);
    } catch {
      setHardwareEncoders([]);
    } finally {
      setEncodersLoading(false);
    }
  }, []);

  const handleOpenBroadcastSettings = useCallback(() => {
    setShowBroadcastSettings(true);
    void refreshHardwareEncoders();
  }, [refreshHardwareEncoders]);

  // (moved below after profile/stream state and notify are initialized)
  const [tBarValue, setTBarValue] = useState(0);
  const [transitionType, setTransitionType] = useState<"Cut" | "Fade" | "Slide" | "Stinger">("Fade");
  const [stingerPath, setStingerPath] = useState("");
  const [mediaEngine, setMediaEngine] = useState<MediaEngineStatus | null>(null);
  const [virtualCamActive, setVirtualCamActive] = useState(false);
  const [dualCanvasEnabled, setDualCanvasEnabled] = useState(false);
  const [transportProtocol, setTransportProtocol] = useState<"RTMPS" | "WebRTC WHIP" | "SRT">(
    "RTMPS"
  );
  const [sidecarProbe, setSidecarProbe] = useState<{ ready: boolean; label: string }>({
    ready: false,
    label: "Metal/DX11 · VST3/AU · Virtual Cam",
  });
  const [replayBufferActive, setReplayBufferActive] = useState(false);
  const [recordPaused, setRecordPaused] = useState(false);
  const lastRecordingPathRef = useRef<string | null>(null);

  // Broadcast Settings state (Profile, Stream Config, Hotkeys)
  const [broadcastProfile, setBroadcastProfile] = useState<BroadcastProfileSettings>(() => loadSavedProfile(state));
  const [streamConfig, setStreamConfig] = useState<{ rtmpUrl: string; streamKey: string }>(() =>
    loadSavedStreamConfig(state)
  );
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(() => loadSavedHotkeys());

  // Persistent Scenes & Studio Mode Preview Scene
  const [sceneList, setSceneList] = useState<BroadcastScene[]>(
    () => initialSceneLoadRef.current!.scenes
  );
  const [activeSceneId, setActiveSceneId] = useState<string>(
    () => initialSceneLoadRef.current!.activeSceneId
  );
  const [previewSceneId, setPreviewSceneId] = useState<string>(
    () => initialSceneLoadRef.current!.previewSceneId
  );

  // Projectors & Closed Captions
  const [projectorModal, setProjectorModal] = useState<
    null | { mode: "multiview" } | { mode: "source"; sourceId: string }
  >(null);
  const [ccInput, setCcInput] = useState("");
  const [lastCaption, setLastCaption] = useState<string | null>(null);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectorBodyRef = useRef<HTMLDivElement | null>(null);
  const didHydrateFromStorageRef = useRef(false);

  // Broadcast-style clipboards
  const [clipboardSource, setClipboardSource] = useState<SceneSourceItem | null>(null);
  const [clipboardFilters, setClipboardFilters] = useState<SourceFilter[] | null>(null);
  const [clipboardTransform, setClipboardTransform] = useState<SourceTransform | null>(null);

  const sources = state.sources || [];
  const broadcasts = state.broadcasts || [];
  const anyLive = broadcasts.some((b) => b.live);
  const isRecording = broadcasts.some((b) => b.id === "record" && b.live);

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  const handleToggleNativeCompositor = useCallback(async () => {
    if (nativeCompositorBusy) return;
    setNativeCompositorBusy(true);
    try {
      const [wStr, hStr] = (broadcastProfile.outputResolution || "1920x1080").split("x");
      const width = Number.parseInt(wStr || "1920", 10) || 1920;
      const height = Number.parseInt(hStr || "1080", 10) || 1080;
      if (nativeCompositorRunning) {
        const msg = await stopStudioCompositor();
        setNativeCompositorRunning(false);
        notify(msg || "Native compositor worker stopped");
      } else {
        const dest =
          state.settings?.broadcast?.destinations?.find((d) => d.enabled) ||
          state.settings?.broadcast?.destinations?.[0];
        const effectiveUrl = streamConfig.rtmpUrl || dest?.rtmpUrl || "";
        const effectiveKey = streamConfig.streamKey || dest?.streamKey || "";
        const rtmpUrl = effectiveUrl
          ? effectiveKey
            ? `${effectiveUrl.replace(/\/$/, "")}/${effectiveKey}`
            : effectiveUrl
          : null;
        const recExt = broadcastProfile.recordingFormat || "mp4";
        const recordPath = state.settings?.broadcast?.recordingPath
          ? `${state.settings.broadcast.recordingPath.replace(/[\/]+$/, "")}/compositor_${Date.now()}.${recExt}`
          : null;
        const msg = await startStudioCompositor({
          rtmpUrl,
          recordPath,
          width,
          height,
          fps: broadcastProfile.fps || 30,
          videoBitrateKbps: broadcastProfile.bitrateKbps || 6000,
        });
        setNativeCompositorRunning(true);
        notify(msg || "Native compositor worker started");
      }
    } catch (err) {
      notify(`Native compositor worker error: ${String(err)}`);
    } finally {
      setNativeCompositorBusy(false);
    }
  }, [
    nativeCompositorBusy,
    nativeCompositorRunning,
    broadcastProfile.outputResolution,
    broadcastProfile.recordingFormat,
    broadcastProfile.fps,
    broadcastProfile.bitrateKbps,
    state.settings?.broadcast?.destinations,
    state.settings?.broadcast?.recordingPath,
    streamConfig.rtmpUrl,
    streamConfig.streamKey,
    notify,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    invoke<{
      mediaEngineFound?: boolean;
      mediaEnginePath?: string | null;
      virtualCamSupported?: boolean;
      vstNativeSupported?: boolean;
    }>("probe_media_engine_sidecar")
      .then((res) => {
        if (!active) return;
        const found = Boolean(res?.mediaEngineFound);
        setSidecarProbe({
          ready: found,
          label: found
            ? "mediaEngine Ready · VST3/AU · Virtual Cam"
            : "Standalone FFmpeg Mode (mediaEngine not installed)",
        });
      })
      .catch(() => {
        if (!active) return;
        setSidecarProbe({
          ready: false,
          label: "Metal/DX11 · VST3/AU · Virtual Cam",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    getMediaEngineStatus().then(setMediaEngine).catch(() => {});
  }, []);

  // Hydrate App sources once on mount if scenes were restored from localStorage
  useEffect(() => {
    if (didHydrateFromStorageRef.current) return;
    didHydrateFromStorageRef.current = true;
    if (initialSceneLoadRef.current?.restoredFromStorage) {
      const savedActive = initialSceneLoadRef.current.scenes.find(
        (sc) => sc.id === initialSceneLoadRef.current!.activeSceneId
      );
      if (savedActive) {
        onSetAllSources(savedActive.sources);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistScenesToStorage = useCallback(
    (scenesToSave: BroadcastScene[], nextActiveId: string, nextPreviewId: string) => {
      try {
        localStorage.setItem(
          SCENES_STORAGE_KEY,
          JSON.stringify({
            version: 1,
            activeSceneId: nextActiveId,
            previewSceneId: nextPreviewId,
            scenes: scenesToSave,
          })
        );
      } catch {
        // ignore storage quota errors
      }
    },
    []
  );

  // Keep active Program scene sources synced into sceneList and persisted to localStorage
  useEffect(() => {
    setSceneList((prev) => {
      const next = prev.map((sc) => (sc.id === activeSceneId ? { ...sc, sources } : sc));
      persistScenesToStorage(next, activeSceneId, previewSceneId);
      return next;
    });
  }, [sources, activeSceneId, previewSceneId, persistScenesToStorage]);

  const activeScene = sceneList.find((sc) => sc.id === activeSceneId) || sceneList[0];
  const previewScene =
    sceneList.find((sc) => sc.id === previewSceneId) || activeScene || sceneList[0];
  const previewSources =
    previewScene && previewScene.id !== activeSceneId ? previewScene.sources : sources;

  const patchSource = (id: string, patchFn: (s: SceneSourceItem) => SceneSourceItem) => {
    onSetAllSources(sources.map((s) => (s.id === id ? patchFn(s) : s)));
  };

  const patchPreviewSource = (id: string, patchFn: (s: SceneSourceItem) => SceneSourceItem) => {
    if (previewSceneId === activeSceneId) {
      patchSource(id, patchFn);
      return;
    }
    setSceneList((prev) => {
      const next = prev.map((sc) =>
        sc.id === previewSceneId
          ? { ...sc, sources: sc.sources.map((s) => (s.id === id ? patchFn(s) : s)) }
          : sc
      );
      persistScenesToStorage(next, activeSceneId, previewSceneId);
      return next;
    });
  };

  const handleSelectScene = (sceneId: string) => {
    const target = sceneList.find((sc) => sc.id === sceneId);
    if (!target) return;

    if (studioMode) {
      setPreviewSceneId(sceneId);
      notify(`Staged in Preview: ${target.name}`);
      return;
    }

    const updated = sceneList.map((sc) =>
      sc.id === activeSceneId ? { ...sc, sources } : sc
    );
    setSceneList(updated);
    setActiveSceneId(sceneId);
    setPreviewSceneId(sceneId);
    onSetAllSources(target.sources);
    persistScenesToStorage(updated, sceneId, sceneId);
    invoke("dispatch_broadcast_studio_command", {
      action: "set_current_program_scene",
      arg: target.name,
    }).catch(() => {});
  };

  // Keep the multiview output window in sync and let its tiles switch Program.
  const handleSelectSceneRef = useRef<(sceneId: string) => void>(() => {});
  handleSelectSceneRef.current = handleSelectScene;

  useEffect(() => {
    const channel = new BroadcastChannel("onering_display_sync");
    channel.onmessage = (event) => {
      const data = event.data;
      if (data?.type === "SELECT_SCENE" && typeof data.sceneId === "string") {
        handleSelectSceneRef.current(data.sceneId);
      }
    };
    return () => {
      channel.onmessage = null;
      channel.close();
    };
  }, []);

  useEffect(() => {
    try {
      const channel = new BroadcastChannel("onering_display_sync");
      channel.postMessage({
        type: "BROADCAST_SCENES_UPDATE",
        payload: { scenes: sceneList, activeSceneId, previewSceneId },
      });
      channel.postMessage({ type: "ACTIVE_SCENE_UPDATE", sceneId: activeSceneId });
      channel.close();
    } catch {
      // BroadcastChannel is optional in constrained webviews.
    }
  }, [sceneList, activeSceneId, previewSceneId]);

  const handleAddScene = () => {
    const num = sceneList.length + 1;
    const newScene: BroadcastScene = {
      id: "scene_" + Date.now(),
      name: `Scene ${num}`,
      sources: [],
    };
    const nextList = sceneList
      .map((sc) => (sc.id === activeSceneId ? { ...sc, sources } : sc))
      .concat(newScene);
    setSceneList(nextList);

    if (studioMode) {
      setPreviewSceneId(newScene.id);
      persistScenesToStorage(nextList, activeSceneId, newScene.id);
      notify(`Created ${newScene.name} (staged in Preview)`);
    } else {
      setActiveSceneId(newScene.id);
      setPreviewSceneId(newScene.id);
      onSetAllSources([]);
      persistScenesToStorage(nextList, newScene.id, newScene.id);
      notify(`Created ${newScene.name}`);
    }
    invoke("dispatch_broadcast_studio_command", { action: "create_scene", arg: newScene.name }).catch(
      () => {}
    );
  };

  const handleRemoveScene = (sceneId: string) => {
    if (sceneList.length <= 1) return;
    const removed = sceneList.find((sc) => sc.id === sceneId);
    const merged = sceneList.map((sc) => (sc.id === activeSceneId ? { ...sc, sources } : sc));
    const filtered = merged.filter((sc) => sc.id !== sceneId);
    const nextActive = activeSceneId === sceneId ? filtered[0].id : activeSceneId;
    const nextPreview = previewSceneId === sceneId ? filtered[0].id : previewSceneId;

    setSceneList(filtered);
    setActiveSceneId(nextActive);
    setPreviewSceneId(nextPreview);
    if (activeSceneId === sceneId) {
      onSetAllSources(filtered[0].sources);
    }
    persistScenesToStorage(filtered, nextActive, nextPreview);
    if (removed) {
      notify(`Removed scene: ${removed.name}`);
      invoke("dispatch_broadcast_studio_command", {
        action: "remove_scene",
        arg: removed.name,
      }).catch(() => {});
    }
  };

  const handleSaveScenesExplicit = () => {
    const merged = sceneList.map((sc) => (sc.id === activeSceneId ? { ...sc, sources } : sc));
    setSceneList(merged);
    persistScenesToStorage(merged, activeSceneId, previewSceneId);
    notify(`Saved ${merged.length} scenes to browser storage`);
  };

  const handleExportSceneCollection = () => {
    const merged = sceneList.map((sc) => (sc.id === activeSceneId ? { ...sc, sources } : sc));
    const payload = {
      format: "one-ring-broadcast-scene-collection",
      version: 1,
      exportedAt: new Date().toISOString(),
      activeSceneId,
      previewSceneId,
      scenes: merged,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `onering-scene-collection-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    notify(`Exported ${merged.length} scenes to JSON`);
  };

  const handleImportSceneCollection = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawScenes = Array.isArray(parsed) ? parsed : parsed?.scenes;
      if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
        notify("Invalid Scene Collection JSON: no scenes array found");
        return;
      }

      const imported: BroadcastScene[] = rawScenes
        .filter((sc: any) => sc && typeof sc.name === "string")
        .map((sc: any, idx: number) => ({
          id: typeof sc.id === "string" && sc.id ? sc.id : `scene_imp_${Date.now()}_${idx}`,
          name: sc.name,
          sources: Array.isArray(sc.sources) ? sc.sources : [],
        }));

      if (imported.length === 0) {
        notify("Invalid Scene Collection JSON: scenes are empty");
        return;
      }

      const nextActiveId =
        typeof parsed?.activeSceneId === "string" &&
        imported.some((s) => s.id === parsed.activeSceneId)
          ? parsed.activeSceneId
          : imported[0].id;
      const nextPreviewId =
        typeof parsed?.previewSceneId === "string" &&
        imported.some((s) => s.id === parsed.previewSceneId)
          ? parsed.previewSceneId
          : imported[Math.min(1, imported.length - 1)].id;

      const activeImported = imported.find((s) => s.id === nextActiveId) || imported[0];
      setSceneList(imported);
      setActiveSceneId(activeImported.id);
      setPreviewSceneId(nextPreviewId);
      onSetAllSources(activeImported.sources);
      persistScenesToStorage(imported, activeImported.id, nextPreviewId);
      notify(`Imported ${imported.length} scenes from ${file.name}`);
    } catch {
      notify("Failed to import JSON: invalid file format");
    }
  };

  const executeTransition = useCallback(() => {
    const merged = sceneList.map((sc) => (sc.id === activeSceneId ? { ...sc, sources } : sc));
    const staged = merged.find((sc) => sc.id === previewSceneId);

    if (staged && staged.id !== activeSceneId) {
      const prevProgramId = activeSceneId;
      setSceneList(merged);
      setActiveSceneId(staged.id);
      setPreviewSceneId(prevProgramId);
      onSetAllSources(staged.sources);
      persistScenesToStorage(merged, staged.id, prevProgramId);
      notify(`Executed ${transitionType} Transition: ${staged.name} → Program`);
    } else {
      notify(`Executed ${transitionType} Transition to Program`);
    }

    setTBarValue(0);
    invoke("dispatch_broadcast_studio_command", { action: "trigger_transition" }).catch(() => {});
  }, [
    sceneList,
    activeSceneId,
    previewSceneId,
    sources,
    transitionType,
    onSetAllSources,
    persistScenesToStorage,
    notify,
  ]);

  const handleToggleStream = useCallback(() => {
    const broadcastConnected =
      !state.mockMode && state.health.some((h) => h.id === "yt" && h.status === "ok");
    onBroadcastToggle("all", !anyLive);
    if (!anyLive) {
      if (broadcastConnected) {
        notify("Live stream & recording started via connected Broadcast engine");
        return;
      }
      const dest = state.settings?.broadcast?.destinations?.find((d) => d.enabled);
      const effectiveUrl = streamConfig.rtmpUrl || dest?.rtmpUrl || "";
      const effectiveKey = streamConfig.streamKey || dest?.streamKey || "";
      const fullRtmp = effectiveUrl
        ? effectiveKey
          ? `${effectiveUrl.replace(/\/$/, "")}/${effectiveKey}`
          : effectiveUrl
        : "";
      const recExt = broadcastProfile.recordingFormat || "mp4";
      const recPath = state.settings?.broadcast?.recordingPath
        ? `${state.settings.broadcast.recordingPath.replace(/[\/]+$/, "")}/recording_${Date.now()}.${recExt}`
        : undefined;
      lastRecordingPathRef.current = recPath ?? null;
      if (fullRtmp || recPath) {
        startDirectFfmpegStream(fullRtmp, recPath)
          .then((m) => notify(m))
          .catch((e) => notify(`FFmpeg start error: ${String(e)}`));
      }
    } else {
      const recordedFile = lastRecordingPathRef.current;
      stopDirectFfmpegStream()
        .then((m) => {
          notify(m);
          if (
            broadcastProfile.autoRemuxToMp4 &&
            broadcastProfile.recordingFormat !== "mp4" &&
            recordedFile
          ) {
            remuxRecordingToMp4(recordedFile)
              .then((rm) => notify(rm))
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
  }, [
    anyLive,
    onBroadcastToggle,
    state.settings?.broadcast,
    streamConfig,
    broadcastProfile.recordingFormat,
    broadcastProfile.autoRemuxToMp4,
    notify,
  ]);

  const handleSaveReplay = useCallback(() => {
    if (!replayBufferActive) {
      startReplayBuffer()
        .then((msg) => {
          setReplayBufferActive(true);
          notify(msg);
        })
        .catch((e) => {
          setReplayBufferActive(false);
          notify(String(e));
        });
    } else {
      saveReplayBuffer().then(notify).catch((e) => notify(String(e)));
    }
  }, [replayBufferActive, notify]);

  const handleStopReplay = useCallback(() => {
    stopReplayBuffer()
      .then((msg) => {
        setReplayBufferActive(false);
        notify(msg);
      })
      .catch((e) => notify(String(e)));
  }, [notify]);

  const handleToggleRecordPause = useCallback(() => {
    const nextPaused = !recordPaused;
    setRecordPaused(nextPaused);
    invoke("dispatch_broadcast_studio_command", {
      action: nextPaused ? "pause_record" : "resume_record",
    }).catch(() => {});
    notify(nextPaused ? "Recording Paused" : "Recording Resumed");
  }, [recordPaused, notify]);

  const handleMutePrimaryMic = useCallback(() => {
    const micSource =
      sources.find((s) => s.type === "audio_input_capture") ||
      sources.find((s) => /mic/i.test(s.name)) ||
      sources.find(
        (s) =>
          s.type === "audio_output_capture" ||
          s.type === "app_audio_capture" ||
          s.type === "media" ||
          typeof s.muted === "boolean"
      );

    if (!micSource) {
      notify("No microphone / audio source found in current scene");
      return;
    }

    const nextMuted = !micSource.muted;
    onSetAllSources(
      sources.map((s) => (s.id === micSource.id ? { ...s, muted: nextMuted } : s))
    );
    notify(`${micSource.name}: ${nextMuted ? "Muted" : "Unmuted"}`);
  }, [sources, onSetAllSources, notify]);

  // Global Hotkeys listener
  const hotkeyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  hotkeyHandlerRef.current = (e: KeyboardEvent) => {
    if (projectorModal && e.key === "Escape") {
      e.preventDefault();
      setProjectorModal(null);
      return;
    }
    if (
      showBroadcastSettings ||
      showAddSource ||
      settingsModalSource ||
      filtersModalSource ||
      transformModalSource ||
      projectorModal
    ) {
      return;
    }
    if (e.repeat) return;

    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    const pressed = formatHotkeyFromEvent(e);
    if (!pressed) return;
    const normalizedPressed = pressed.toLowerCase();

    const matchHotkey = (...keys: string[]): boolean =>
      keys.some((k) => (hotkeys[k] || "").trim().toLowerCase() === normalizedPressed);

    if (matchHotkey("Studio Transition", "Transition")) {
      e.preventDefault();
      executeTransition();
    } else if (matchHotkey("Save Replay")) {
      e.preventDefault();
      handleSaveReplay();
    } else if (matchHotkey("Start/Stop Stream", "Toggle Stream")) {
      e.preventDefault();
      handleToggleStream();
    } else if (matchHotkey("Start/Stop Recording")) {
      e.preventDefault();
      onBroadcastToggle("record", !isRecording);
    } else if (matchHotkey("Mute Mic")) {
      e.preventDefault();
      handleMutePrimaryMic();
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => hotkeyHandlerRef.current(e);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSendCaption = async (overrideText?: string) => {
    const text = (overrideText !== undefined ? overrideText : ccInput).trim();
    if (!text && overrideText === undefined) return;
    try {
      const res = await invoke<string>("send_broadcast_stream_caption", { text });
      setLastCaption(text || null);
      if (overrideText === undefined) setCcInput("");
      notify(res || (text ? `CC sent: ${text}` : "Cleared stream captions"));
    } catch {
      setLastCaption(text || null);
      if (overrideText === undefined) setCcInput("");
      notify(text ? `CC sent (local fallback): "${text}"` : "Cleared stream captions");
    }
  };

  const handleOrder = (id: string, action: "up" | "down" | "top" | "bottom") => {
    const idx = sources.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const copy = [...sources];
    const [item] = copy.splice(idx, 1);
    if (action === "up") copy.splice(Math.max(0, idx - 1), 0, item);
    if (action === "down") copy.splice(Math.min(copy.length, idx + 1), 0, item);
    if (action === "top") copy.unshift(item);
    if (action === "bottom") copy.push(item);
    onSetAllSources(copy);
  };

  const handleDuplicate = (source: SceneSourceItem) => {
    const clone: SceneSourceItem = {
      ...JSON.parse(JSON.stringify(source)),
      id: "src_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      name: source.name + " (Copy)",
    };
    onAddSource(clone);
    notify("Duplicated " + source.name);
  };

  const handleSaveBroadcastProfile = (nextProfile: BroadcastProfileSettings) => {
    setBroadcastProfile(nextProfile);
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
    } catch {
      // ignore
    }
    notify(`Saved Broadcast profile: ${nextProfile.name}`);
  };

  const handleSaveBroadcastStreamConfig = (url: string, key: string) => {
    const nextCfg = { rtmpUrl: url, streamKey: key };
    setStreamConfig(nextCfg);
    try {
      localStorage.setItem(STREAM_CONFIG_STORAGE_KEY, JSON.stringify(nextCfg));
    } catch {
      // ignore
    }
    notify("Saved stream ingest configuration");
  };

  const handleSaveBroadcastHotkeys = (nextHotkeys: Record<string, string>) => {
    setHotkeys(nextHotkeys);
    try {
      localStorage.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(nextHotkeys));
    } catch {
      // ignore
    }
    notify("Updated Broadcast global hotkeys");
  };

  const mergedScenesForMultiview = sceneList.map((sc) =>
    sc.id === activeSceneId ? { ...sc, sources } : sc
  );

  const projectedSource =
    projectorModal?.mode === "source"
      ? sources.find((s) => s.id === projectorModal.sourceId) || sources[0] || null
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "calc(100vh - 64px)",
        background: "#080B10",
        color: "#F3F4F6",
        padding: 16,
        gap: 14,
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {toastMsg && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "#1E293B",
            border: "1px solid #3B82F6",
            color: "#FFFFFF",
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 10100,
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          padding: "10px 16px",
          background: "#12161F",
          border: "1px solid #1E2533",
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Radio size={18} color="#EF4444" />
            <strong style={{ fontSize: 16 }}>Broadcast Studio & Broadcast Sources</strong>
          </div>
          <span style={{ fontSize: 12, color: "#64748B" }}>•</span>
          <span style={{ fontSize: 13, color: anyLive ? "#F87171" : "#9CA3AF", fontWeight: 700 }}>
            {anyLive ? "LIVE ON AIR" : "STREAM STANDBY"}
          </span>
          <span
            style={{
              fontSize: 11,
              background: "#1E2533",
              padding: "2px 8px",
              borderRadius: 10,
              color: "#94A3B8",
            }}
          >
            {sources.length} active sources (right-click any source for Filters, Transform, Order & Color)
          </span>
          <span
            title="Native mediaEngine Sidecar Readiness"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              background: sidecarProbe.ready
                ? "rgba(16, 185, 129, 0.14)"
                : "rgba(100, 116, 139, 0.16)",
              border: `1px solid ${sidecarProbe.ready ? "#10B981" : "#334155"}`,
              color: sidecarProbe.ready ? "#6EE7B7" : "#94A3B8",
            }}
          >
            Native mediaEngine Sidecar: {sidecarProbe.label}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {/* Projectors Group: Multiview & Source Projector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "#0B0E14",
              border: "1px solid #283344",
              borderRadius: 7,
              padding: 2,
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={() => setProjectorModal({ mode: "multiview" })}
              title="Open Broadcast Multiview Projector"
              style={{
                height: 30,
                padding: "0 10px",
                background: projectorModal?.mode === "multiview" ? "#1E3A8A" : "#1C222D",
                border: "1px solid #334155",
                color: "#E2E8F0",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Monitor size={13} />
              Multiview
            </button>
            <button
              type="button"
              onClick={() => {
                const targetId = selectedSourceId || sources[0]?.id || "";
                setProjectorModal({ mode: "source", sourceId: targetId });
              }}
              title="Open Isolated Source Projector"
              style={{
                height: 30,
                padding: "0 10px",
                background: projectorModal?.mode === "source" ? "#1E3A8A" : "#1C222D",
                border: "1px solid #334155",
                color: "#E2E8F0",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Projector size={13} />
              Source Projector
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              invoke("split_recording_file")
                .then(() => notify("Split Record File triggered"))
                .catch(() => notify("Split Record File triggered"));
            }}
            style={{
              height: 36,
              padding: "0 10px",
              background: "#1C222D",
              border: "1px solid #334155",
              color: "#E2E8F0",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            Split Record File
          </button>

          <button
            type="button"
            onClick={() => {
              const recommended: BroadcastProfileSettings = {
                ...broadcastProfile,
                baseResolution: "1920x1080",
                outputResolution: "1920x1080",
                fps: 60,
                bitrateKbps: 6000,
                keyframeIntervalSec: 2,
                rateControl: "CBR",
              };
              handleSaveBroadcastProfile(recommended);
              notify("Auto-Config Wizard: Applied 1080p60 CBR 6000 kbps");
            }}
            style={{
              height: 36,
              padding: "0 10px",
              background: "#1C222D",
              border: "1px solid #334155",
              color: "#E2E8F0",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            Auto-Config Wizard
          </button>

          <select
            aria-label="Encoder Profile"
            value={encoderProfile}
            onChange={(e) => {
              const next = e.target.value as
                | "1080p60 Hardware"
                | "1080p30 Church Stream"
                | "720p30 Low Bandwidth";
              setEncoderProfile(next);
              const mapped: Partial<BroadcastProfileSettings> =
                next === "1080p60 Hardware"
                  ? { baseResolution: "1920x1080", outputResolution: "1920x1080", fps: 60, bitrateKbps: 6000 }
                  : next === "1080p30 Church Stream"
                  ? { baseResolution: "1920x1080", outputResolution: "1920x1080", fps: 30, bitrateKbps: 4500 }
                  : { baseResolution: "1920x1080", outputResolution: "1280x720", fps: 30, bitrateKbps: 2500 };
              setBroadcastProfile((prev) => {
                const updated = { ...prev, ...mapped };
                try {
                  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(updated));
                } catch {}
                return updated;
              });
              notify(`Encoder profile: ${next}`);
            }}
            style={{
              height: 36,
              padding: "0 10px",
              background: "#1C222D",
              border: "1px solid #334155",
              color: "#E2E8F0",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            <option value="1080p60 Hardware">1080p60 Hardware</option>
            <option value="1080p30 Church Stream">1080p30 Church Stream</option>
            <option value="720p30 Low Bandwidth">720p30 Low Bandwidth</option>
          </select>

          <button
            type="button"
            onClick={() => {
              startHeadlessMediaDaemon()
                .then((msg) => {
                  notify(msg);
                  getMediaEngineStatus().then(setMediaEngine);
                })
                .catch((err) => notify(String(err)));
            }}
            style={{
              height: 36,
              padding: "0 12px",
              background: mediaEngine?.daemonRunning ? "#065F46" : "#1C222D",
              border: `1px solid ${mediaEngine?.daemonRunning ? "#10B981" : "#334155"}`,
              color: "#E2E8F0",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            {mediaEngine?.daemonRunning ? "● Media Engine Active" : "Start Media Engine"}
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !studioMode;
              setStudioMode(next);
              if (next && previewSceneId === activeSceneId && sceneList.length > 1) {
                const other = sceneList.find((sc) => sc.id !== activeSceneId);
                if (other) setPreviewSceneId(other.id);
              }
              invoke("dispatch_broadcast_studio_command", {
                action: next ? "studio_mode_on" : "studio_mode_off",
              }).catch(() => {});
            }}
            style={{
              height: 36,
              padding: "0 12px",
              background: studioMode ? "#4C1D95" : "#1C222D",
              border: `1px solid ${studioMode ? "#A855F7" : "#334155"}`,
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            {studioMode ? "Studio Mode: ON" : "Studio Mode"}
          </button>

          <button
            type="button"
            onClick={handleOpenBroadcastSettings}
            title="Open Broadcast Settings (Stream, Output, Video, Hotkeys)"
            style={{
              height: 36,
              padding: "0 12px",
              background: "#1C222D",
              border: "1px solid #334155",
              color: "#E2E8F0",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <Settings size={14} /> Broadcast Settings ⚙️
          </button>

          <button
            type="button"
            onClick={() => setShowAddSource(true)}
            style={{
              height: 36,
              padding: "0 14px",
              background: "#2563EB",
              border: "1px solid #3B82F6",
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <Plus size={15} /> + Add Source (All 15 Broadcast Types)
          </button>
        </div>
      </div>

      {/* Main Broadcast Work Area */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px", gap: 14, flex: 1, minHeight: 0 }}>
        {/* Left: Program / Studio Dual Video Canvas & Live CC Bar */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E2533",
            borderRadius: 10,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#94A3B8",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {studioMode
                ? `Studio Mode — Preview | Program (${broadcastProfile.baseResolution} @ ${broadcastProfile.fps}fps)`
                : `Program Canvas (${broadcastProfile.baseResolution} @ ${broadcastProfile.fps}fps)`}
            </span>
            <span style={{ fontSize: 11, color: "#10B981", fontWeight: 700 }}>
              Hardware Accelerated • {broadcastProfile.videoEncoder}
            </span>
          </div>

          {studioMode && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "#161B24",
                border: "1px solid #3B2D63",
                borderRadius: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "#C4B5FD", textTransform: "uppercase" }}>
                Transition
              </span>
              <select
                aria-label="Studio Transition Type"
                value={transitionType}
                onChange={(e) => {
                  const next = e.target.value as "Cut" | "Fade" | "Slide" | "Stinger";
                  setTransitionType(next);
                  invoke("dispatch_broadcast_studio_command", {
                    action: "set_transition",
                    arg: next,
                  }).catch(() => {});
                }}
                style={{
                  background: "#0B0E14",
                  border: "1px solid #334155",
                  color: "#FFFFFF",
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 5,
                }}
              >
                <option value="Cut">Cut (0ms)</option>
                <option value="Fade">Fade (300ms)</option>
                <option value="Slide">Slide</option>
                <option value="Stinger">Stinger</option>
              </select>
              {transitionType === "Stinger" && (
                <input
                  type="text"
                  value={stingerPath}
                  onChange={(e) => setStingerPath(e.target.value)}
                  placeholder="Stinger .webm / .mov path"
                  style={{
                    width: 160,
                    background: "#0B0E14",
                    border: "1px solid #334155",
                    color: "#FFFFFF",
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 5,
                  }}
                />
              )}
              <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>T-Bar</span>
              <input
                type="range"
                aria-label="Studio Mode T-Bar"
                min={0}
                max={100}
                value={tBarValue}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val >= 100) {
                    executeTransition();
                  } else {
                    setTBarValue(val);
                  }
                }}
                onPointerUp={() => {
                  if (tBarValue >= 95) {
                    executeTransition();
                  }
                }}
                style={{ flex: 1, minWidth: 100 }}
              />
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "#CBD5E1", minWidth: 34 }}>
                {tBarValue}%
              </span>
              <button
                type="button"
                onClick={executeTransition}
                style={{
                  background: "#7C3AED",
                  border: "1px solid #A855F7",
                  color: "#FFFFFF",
                  padding: "5px 12px",
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Transition →
              </button>
            </div>
          )}

          {studioMode ? (
            /* True Side-by-Side Preview | Program Dual Canvases */
            <div
              style={{
                flex: 1,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                alignItems: "center",
                minHeight: 0,
              }}
            >
              {/* Left: PREVIEW Canvas */}
              <div
                data-testid="studio-preview-pane"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  background: "#000000",
                  border: "2px solid #10B981",
                  borderRadius: 8,
                  overflow: "hidden",
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    background: "rgba(6, 78, 59, 0.55)",
                    borderBottom: "1px solid #065F46",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: "#6EE7B7", display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#10B981",
                        display: "inline-block",
                      }}
                    />
                    PREVIEW: {previewScene?.name || "Staged"}
                  </span>
                  <span style={{ color: "#A7F3D0", fontSize: 10 }}>
                    {previewSources.length} src
                  </span>
                </div>
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: broadcastProfile.baseResolution === "1080x1920" ? "9 / 16" : "16 / 9",
                    minHeight: 220,
                    background: "#000000",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ProgramCanvasRenderer
                    sources={previewSources}
                    selectedSourceId={selectedSourceId}
                    onSelectSource={setSelectedSourceId}
                    onUpdateTransform={(sourceId, transform) => {
                      patchPreviewSource(sourceId, (s) => ({ ...s, transform }));
                    }}
                  />
                </div>
              </div>

              {/* Right: PROGRAM Canvas */}
              <div
                data-testid="studio-program-pane"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  background: "#000000",
                  border: "2px solid #EF4444",
                  borderRadius: 8,
                  overflow: "hidden",
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    background: "rgba(127, 29, 29, 0.6)",
                    borderBottom: "1px solid #991B1B",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: "#FCA5A5", display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#EF4444",
                        display: "inline-block",
                      }}
                    />
                    PROGRAM: {activeScene?.name || "On Air"}
                  </span>
                  <span style={{ color: anyLive ? "#FECACA" : "#94A3B8", fontSize: 10 }}>
                    {anyLive ? "● ON AIR" : "STANDBY"} • {sources.length} src
                  </span>
                </div>
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: broadcastProfile.baseResolution === "1080x1920" ? "9 / 16" : "16 / 9",
                    minHeight: 220,
                    background: "#000000",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ProgramCanvasRenderer
                    sources={sources}
                    selectedSourceId={selectedSourceId}
                    onSelectSource={setSelectedSourceId}
                    onUpdateTransform={(sourceId, transform) => {
                      patchSource(sourceId, (s) => ({ ...s, transform }));
                    }}
                  />
                  {tBarValue > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        opacity: transitionType === "Slide" ? 1 : tBarValue / 100,
                        transform:
                          transitionType === "Slide"
                            ? `translateX(${tBarValue - 100}%)`
                            : undefined,
                        transition: "none",
                      }}
                    >
                      <ProgramCanvasRenderer sources={previewSources} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Standard Single Program Canvas */
            <div
              style={{
                flex: 1,
                background: "#000000",
                border: "2px solid #1F2937",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                overflow: "hidden",
                minHeight: 320,
              }}
            >
              <ProgramCanvasRenderer
                sources={sources}
                selectedSourceId={selectedSourceId}
                onSelectSource={setSelectedSourceId}
                onUpdateTransform={(sourceId, transform) => {
                  patchSource(sourceId, (s) => ({ ...s, transform }));
                }}
              />
            </div>
          )}

          {/* Quick Closed Captions (CC) Strip */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendCaption();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              background: "#0B0E14",
              border: "1px solid #1E2533",
              borderRadius: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                fontWeight: 800,
                color: "#93C5FD",
                background: "#1E3A8A",
                padding: "4px 8px",
                borderRadius: 5,
                flexShrink: 0,
              }}
            >
              <Captions size={13} /> CC
            </span>
            <input
              type="text"
              aria-label="Live Closed Captions Input"
              value={ccInput}
              onChange={(e) => setCcInput(e.target.value)}
              placeholder="Send live closed caption (CEA-608/708) & press Enter..."
              style={{
                flex: 1,
                minWidth: 180,
                height: 32,
                padding: "0 10px",
                background: "#12161F",
                border: "1px solid #283344",
                borderRadius: 6,
                color: "#FFFFFF",
                fontSize: 12,
              }}
            />
            <button
              type="submit"
              style={{
                height: 32,
                padding: "0 12px",
                background: "#2563EB",
                border: "1px solid #3B82F6",
                color: "#FFFFFF",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Send size={12} /> Send CC
            </button>
            <button
              type="button"
              onClick={() => handleSendCaption("")}
              style={{
                height: 32,
                padding: "0 10px",
                background: "#161B24",
                border: "1px solid #283344",
                color: "#94A3B8",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Clear
            </button>
            {lastCaption && (
              <span
                style={{
                  fontSize: 11,
                  color: "#6EE7B7",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={lastCaption}
              >
                Last CC: &ldquo;{lastCaption}&rdquo;
              </span>
            )}
          </form>
        </div>

        {/* Right: Broadcast Scenes, Sources Stack & Stream Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          {/* Broadcast Scenes Switcher & Collections Dock */}
          <div style={{ background: "#0D1117", border: "1px solid #1E2533", borderRadius: 10, padding: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
                Broadcast Scenes
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <button
                  type="button"
                  title="Save Scenes"
                  onClick={handleSaveScenesExplicit}
                  style={sceneActionBtnStyle}
                >
                  <Save size={11} /> Save
                </button>
                <button
                  type="button"
                  title="Export Scene Collection JSON"
                  onClick={handleExportSceneCollection}
                  style={sceneActionBtnStyle}
                >
                  <Download size={11} /> Export JSON
                </button>
                <button
                  type="button"
                  title="Import Scene Collection JSON"
                  onClick={() => importFileInputRef.current?.click()}
                  style={sceneActionBtnStyle}
                >
                  <Upload size={11} /> Import JSON
                </button>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportSceneCollection}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  onClick={handleAddScene}
                  style={{
                    background: "#1E293B",
                    border: "1px solid #334155",
                    color: "#93C5FD",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  + Scene
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gap: 4, maxHeight: 130, overflowY: "auto" }}>
              {sceneList.map((sc) => {
                const isProgram = sc.id === activeSceneId;
                const isPreview = studioMode && sc.id === previewSceneId;
                const srcCount = isProgram ? sources.length : sc.sources.length;
                return (
                  <div key={sc.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => handleSelectScene(sc.id)}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: isProgram
                          ? studioMode
                            ? "rgba(127, 29, 29, 0.45)"
                            : "#1E3A8A"
                          : isPreview
                          ? "rgba(6, 78, 59, 0.45)"
                          : "#161B24",
                        border: `1px solid ${
                          isProgram
                            ? studioMode
                              ? "#EF4444"
                              : "#3B82F6"
                            : isPreview
                            ? "#10B981"
                            : "#283344"
                        }`,
                        color: isProgram || isPreview ? "#FFFFFF" : "#CBD5E1",
                        fontSize: 12,
                        fontWeight: isProgram || isPreview ? 700 : 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 6,
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sc.name}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                        {studioMode && isPreview && (
                          <span
                            style={{
                              fontSize: 9.5,
                              padding: "1px 5px",
                              borderRadius: 4,
                              background: "#065F46",
                              color: "#6EE7B7",
                              fontWeight: 800,
                            }}
                          >
                            PRV
                          </span>
                        )}
                        {studioMode && isProgram && (
                          <span
                            style={{
                              fontSize: 9.5,
                              padding: "1px 5px",
                              borderRadius: 4,
                              background: "#991B1B",
                              color: "#FCA5A5",
                              fontWeight: 800,
                            }}
                          >
                            PGM
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: "#94A3B8" }}>{srcCount} src</span>
                      </span>
                    </button>
                    {sceneList.length > 1 && (
                      <button
                        type="button"
                        title={`Delete ${sc.name}`}
                        onClick={() => handleRemoveScene(sc.id)}
                        style={{
                          background: "transparent",
                          border: "1px solid #283344",
                          color: "#64748B",
                          borderRadius: 5,
                          padding: "5px 6px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sources Stack */}
          <div
            style={{
              background: "#0D1117",
              border: "1px solid #1E2533",
              borderRadius: 10,
              padding: 14,
              flex: 1,
              overflowY: "auto",
            }}
            onContextMenu={(e) => {
              if (e.target === e.currentTarget) {
                e.preventDefault();
                setShowAddSource(true);
              }
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#94A3B8",
                  textTransform: "uppercase",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Layers size={14} /> Sources Stack
              </span>
              <span style={{ fontSize: 10.5, color: "#64748B" }}>Right-click item for menu</span>
            </div>

            {sources.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#475569", fontSize: 12 }}>
                No sources in scene.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {sources.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSourceId(s.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ source: s, x: e.clientX, y: e.clientY });
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      background: s.colorTag
                        ? `linear-gradient(90deg, ${s.colorTag}26 0%, #161B24 35%)`
                        : selectedSourceId === s.id
                        ? "#1B2433"
                        : "#161B24",
                      border: selectedSourceId === s.id ? "1px solid #3B82F6" : "1px solid #283344",
                      borderLeft: s.colorTag
                        ? `4px solid ${s.colorTag}`
                        : selectedSourceId === s.id
                        ? "1px solid #3B82F6"
                        : "1px solid #283344",
                      borderRadius: 6,
                      cursor: "context-menu",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                      {renamingId === s.id ? (
                        <input
                          type="text"
                          autoFocus
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          onBlur={() => {
                            if (renameText.trim()) {
                              patchSource(s.id, (prev) => ({ ...prev, name: renameText.trim() }));
                            }
                            setRenamingId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              if (renameText.trim()) {
                                patchSource(s.id, (prev) => ({ ...prev, name: renameText.trim() }));
                              }
                              setRenamingId(null);
                            } else if (e.key === "Escape") {
                              setRenamingId(null);
                            }
                          }}
                          style={{
                            width: "100%",
                            background: "#0B0E14",
                            border: "1px solid #3B82F6",
                            color: "#FFFFFF",
                            fontSize: 13,
                            padding: "2px 6px",
                            borderRadius: 4,
                          }}
                        />
                      ) : (
                        <>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: s.enabled ? "#FFFFFF" : "#64748B",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {s.name}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "#64748B",
                              textTransform: "uppercase",
                              display: "flex",
                              gap: 6,
                            }}
                          >
                            <span>{s.type.replace(/_/g, " ")}</span>
                            {s.filters && s.filters.length > 0 && (
                              <span style={{ color: "#A855F7", fontWeight: 700 }}>
                                • {s.filters.length} filter{s.filters.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <button
                        type="button"
                        title="Filters & VST Plug-ins"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFiltersModalSource(s);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: s.filters && s.filters.length > 0 ? "#A855F7" : "#64748B",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        <Sliders size={14} />
                      </button>
                      <button
                        type="button"
                        title="Source Properties & Settings"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettingsModalSource(s);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#94A3B8",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        <Settings size={15} />
                      </button>
                      <button
                        type="button"
                        title={s.enabled ? "Hide Source" : "Show Source"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSourceVisibility(s.id);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: s.enabled ? "#60A5FA" : "#475569",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        {s.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
                      </button>
                      <button
                        type="button"
                        title={s.locked ? "Unlock Source" : "Lock Source"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSourceLock(s.id);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: s.locked ? "#F59E0B" : "#475569",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        {s.locked ? <Lock size={14} /> : <Unlock size={14} />}
                      </button>
                      <button
                        type="button"
                        title="Remove Source"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveSource(s.id);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#EF4444",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stream Destinations Output Strip */}
          <div
            style={{
              background: "#0D1117",
              border: "1px solid #1E2533",
              borderRadius: 10,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
                Outputs
              </span>
              <span style={{ fontSize: 10, color: anyLive ? "#F87171" : "#64748B", fontWeight: 700 }}>
                {anyLive ? "STREAMING" : "OFFLINE"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  const next = !dualCanvasEnabled;
                  setDualCanvasEnabled(next);
                  notify(
                    next
                      ? "Dual-Canvas (16:9 + 9:16 Vertical) enabled"
                      : "Dual-Canvas disabled"
                  );
                }}
                style={{
                  flex: 1,
                  height: 28,
                  padding: "0 8px",
                  background: dualCanvasEnabled ? "#1D4ED8" : "#161B24",
                  border: `1px solid ${dualCanvasEnabled ? "#60A5FA" : "#283344"}`,
                  color: "#E2E8F0",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {dualCanvasEnabled ? "Dual-Canvas: 16:9 + 9:16 ON" : "Dual-Canvas (16:9 + 9:16 Vertical)"}
              </button>

              <select
                aria-label="Output Transport Protocol"
                value={transportProtocol}
                onChange={(e) => {
                  const next = e.target.value as "RTMPS" | "WebRTC WHIP" | "SRT";
                  setTransportProtocol(next);
                  notify(`Transport set to ${next}`);
                }}
                style={{
                  height: 28,
                  padding: "0 6px",
                  background: "#161B24",
                  border: "1px solid #283344",
                  color: "#E2E8F0",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <option value="RTMPS">RTMPS</option>
                <option value="WebRTC WHIP">WebRTC WHIP</option>
                <option value="SRT">SRT</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleToggleStream}
              style={{
                height: 42,
                background: anyLive ? "#7F1D1D" : "#059669",
                border: `1px solid ${anyLive ? "#EF4444" : "#10B981"}`,
                color: "#FFFFFF",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {anyLive ? <Square size={15} /> : <Play size={15} />}
              {anyLive ? "Stop All Streams" : "Start Live Stream & Recording"}
            </button>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  const next = !virtualCamActive;
                  setVirtualCamActive(next);
                  invoke("dispatch_broadcast_studio_command", {
                    action: next ? "start_virtual_cam" : "stop_virtual_cam",
                  }).catch(() => {});
                  notify(next ? "Virtual Camera Output Started" : "Virtual Camera Stopped");
                }}
                style={{
                  height: 32,
                  background: virtualCamActive ? "#1D4ED8" : "#161B24",
                  border: `1px solid ${virtualCamActive ? "#60A5FA" : "#283344"}`,
                  color: "#FFFFFF",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                {virtualCamActive ? "● Virtual Cam ON" : "Start Virtual Cam"}
              </button>

              <button
                type="button"
                onClick={handleSaveReplay}
                style={{
                  height: 32,
                  background: replayBufferActive ? "#6D28D9" : "#161B24",
                  border: `1px solid ${replayBufferActive ? "#A78BFA" : "#283344"}`,
                  color: "#FFFFFF",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                {replayBufferActive ? "Save Instant Replay" : "Start Replay Buffer"}
              </button>

              {replayBufferActive && (
                <button
                  type="button"
                  onClick={handleStopReplay}
                  style={{
                    height: 32,
                    background: "#161B24",
                    border: "1px solid #7F1D1D",
                    color: "#FCA5A5",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  Stop Replay Buffer
                </button>
              )}
            </div>

            {anyLive && (
              <button
                type="button"
                onClick={handleToggleRecordPause}
                style={{
                  height: 30,
                  background: recordPaused ? "#B45309" : "#1E2533",
                  border: "1px solid #334155",
                  color: "#FFFFFF",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {recordPaused ? "▶ Resume Recording" : "⏸ Pause Recording"}
              </button>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                color: "#64748B",
                paddingTop: 4,
                borderTop: "1px solid #1E2533",
              }}
            >
              <span>
                {broadcastProfile.fps}.0 fps • {broadcastProfile.bitrateKbps} kbps • {broadcastProfile.recordingFormat.toUpperCase()}
              </span>
              <span>Dropped: 0 (0.0%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Broadcast 6-Track Audio Mixer Panel */}
      <BroadcastAudioMixerPanel
        sources={sources}
        onToggleMute={(id) => patchSource(id, (s) => ({ ...s, muted: !s.muted }))}
        onVolumeChange={(id, db) => patchSource(id, (s) => ({ ...s, volumeDb: db }))}
        onOpenFilters={(src) => setFiltersModalSource(src)}
        onUpdateTrackRouting={(id, tracks) =>
          patchSource(id, (s) => ({
            ...s,
            settings: { ...s.settings, audioTracks: tracks, tracks },
          }))
        }
        onUpdateSyncOffset={(id, offsetMs) =>
          patchSource(id, (s) => ({
            ...s,
            settings: { ...s.settings, syncOffsetMs: offsetMs },
          }))
        }
      />

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <SourceContextMenu
          source={contextMenu.source}
          x={contextMenu.x}
          y={contextMenu.y}
          hasClipboardSource={!!clipboardSource}
          hasClipboardFilters={!!clipboardFilters}
          hasClipboardTransform={!!clipboardTransform}
          onClose={() => setContextMenu(null)}
          onOpenAdd={() => setShowAddSource(true)}
          onOpenProperties={(src) => setSettingsModalSource(src)}
          onOpenFilters={(src) => setFiltersModalSource(src)}
          onOpenTransform={(src) => setTransformModalSource(src)}
          onRename={(src) => {
            setRenamingId(src.id);
            setRenameText(src.name);
          }}
          onRemove={onRemoveSource}
          onDuplicate={handleDuplicate}
          onCopySource={(src) => {
            setClipboardSource(src);
            notify("Copied source: " + src.name);
          }}
          onPasteDuplicate={() => {
            if (clipboardSource) handleDuplicate(clipboardSource);
          }}
          onCopyFilters={(src) => {
            setClipboardFilters(src.filters || []);
            notify("Copied filters from " + src.name);
          }}
          onPasteFilters={(id) => {
            if (clipboardFilters) {
              patchSource(id, (s) => ({
                ...s,
                filters: JSON.parse(JSON.stringify(clipboardFilters)),
              }));
              notify("Pasted filters");
            }
          }}
          onCopyTransform={(src) => {
            setClipboardTransform(src.transform || DEFAULT_TRANSFORM);
            notify("Copied transform from " + src.name);
          }}
          onPasteTransform={(id) => {
            if (clipboardTransform) {
              patchSource(id, (s) => ({ ...s, transform: { ...clipboardTransform } }));
              notify("Pasted transform");
            }
          }}
          onResetTransform={(id) => {
            patchSource(id, (s) => ({ ...s, transform: { ...DEFAULT_TRANSFORM } }));
            notify("Transform reset to 1920x1080");
          }}
          onFitToScreen={(id) => {
            patchSource(id, (s) => ({
              ...s,
              transform: {
                ...(s.transform || DEFAULT_TRANSFORM),
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
              },
            }));
            notify("Fit source to 1920x1080 canvas");
          }}
          onOrderAction={handleOrder}
          onSetColorTag={(id, color) => patchSource(id, (s) => ({ ...s, colorTag: color }))}
          onToggleVisibility={onToggleSourceVisibility}
          onToggleLock={onToggleSourceLock}
          onToggleHideInMixer={(id) =>
            patchSource(id, (s) => ({ ...s, hideInMixer: !s.hideInMixer }))
          }
          onSetScaleFilter={(id, filter) =>
            patchSource(id, (s) => ({
              ...s,
              transform: { ...(s.transform || DEFAULT_TRANSFORM), scaleFilter: filter },
            }))
          }
          onSetBlendingMode={(id, mode) =>
            patchSource(id, (s) => ({
              ...s,
              transform: { ...(s.transform || DEFAULT_TRANSFORM), blendingMode: mode },
            }))
          }
          onSetDeinterlacing={(id, mode) =>
            patchSource(id, (s) => ({
              ...s,
              transform: { ...(s.transform || DEFAULT_TRANSFORM), deinterlacing: mode },
            }))
          }
          onScreenshotSource={(src) => notify("Saved screenshot frame of " + src.name)}
        />
      )}

      {/* Multiview & Source Projector Overlay */}
      {projectorModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={projectorModal.mode === "multiview" ? "Multiview Projector" : "Source Projector"}
          onClick={(e) => {
            if (e.target === e.currentTarget) setProjectorModal(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(5, 7, 11, 0.92)",
            backdropFilter: "blur(6px)",
            zIndex: 10006,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            ref={projectorBodyRef}
            style={{
              width: "100%",
              maxWidth: 1180,
              maxHeight: "90vh",
              background: "#0B0E14",
              border: "1px solid #3B82F6",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 60px rgba(0,0,0,0.75)",
            }}
          >
            {/* Projector Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: "#12161F",
                borderBottom: "1px solid #1E2533",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {projectorModal.mode === "multiview" ? (
                  <Monitor size={18} color="#60A5FA" />
                ) : (
                  <Projector size={18} color="#60A5FA" />
                )}
                <strong style={{ fontSize: 15, color: "#FFFFFF" }}>
                  {projectorModal.mode === "multiview"
                    ? "Broadcast Multiview Projector"
                    : `Source Projector${projectedSource ? ` — ${projectedSource.name}` : ""}`}
                </strong>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {projectorModal.mode === "source" && sources.length > 0 && (
                  <select
                    aria-label="Projector Source"
                    value={projectedSource?.id || ""}
                    onChange={(e) =>
                      setProjectorModal({ mode: "source", sourceId: e.target.value })
                    }
                    style={{
                      height: 32,
                      padding: "0 10px",
                      background: "#0B0E14",
                      border: "1px solid #334155",
                      color: "#FFFFFF",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    {sources.map((src) => (
                      <option key={src.id} value={src.id}>
                        {src.name} ({src.type.replace(/_/g, " ")})
                      </option>
                    ))}
                  </select>
                )}

                {projectorModal.mode === "multiview" && (
                  <button
                    type="button"
                    onClick={() => {
                      window.open("/?output=foh", "multiview_foh", "width=1280,height=720");
                      notify("Opened Multiview pop-out (/?output=foh)");
                    }}
                    style={sceneActionBtnStyle}
                  >
                    Pop Out Window
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    projectorBodyRef.current?.requestFullscreen?.().catch(() => {});
                  }}
                  style={sceneActionBtnStyle}
                >
                  <Maximize2 size={12} /> Fullscreen
                </button>

                <button
                  type="button"
                  aria-label="Close Projector"
                  onClick={() => setProjectorModal(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#94A3B8",
                    cursor: "pointer",
                    padding: 4,
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Projector Content */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
              {projectorModal.mode === "multiview" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div
                      style={{
                        border: "2px solid #10B981",
                        borderRadius: 8,
                        overflow: "hidden",
                        background: "#000000",
                      }}
                    >
                      <div
                        style={{
                          padding: "4px 10px",
                          background: "rgba(6, 78, 59, 0.7)",
                          color: "#6EE7B7",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        PREVIEW — {previewScene?.name}
                      </div>
                      <div style={{ width: "100%", aspectRatio: "16 / 9" }}>
                        <ProgramCanvasRenderer sources={previewSources} />
                      </div>
                    </div>

                    <div
                      style={{
                        border: "2px solid #EF4444",
                        borderRadius: 8,
                        overflow: "hidden",
                        background: "#000000",
                      }}
                    >
                      <div
                        style={{
                          padding: "4px 10px",
                          background: "rgba(127, 29, 29, 0.75)",
                          color: "#FCA5A5",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        PROGRAM — {activeScene?.name} {anyLive ? "• ON AIR" : ""}
                      </div>
                      <div style={{ width: "100%", aspectRatio: "16 / 9" }}>
                        <ProgramCanvasRenderer sources={sources} />
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: 10,
                    }}
                  >
                    {mergedScenesForMultiview.map((sc) => {
                      const isPgm = sc.id === activeSceneId;
                      const isPrv = sc.id === previewSceneId;
                      return (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => handleSelectScene(sc.id)}
                          style={{
                            padding: 0,
                            background: "#000000",
                            border: `2px solid ${
                              isPgm ? "#EF4444" : isPrv ? "#10B981" : "#1E2533"
                            }`,
                            borderRadius: 8,
                            overflow: "hidden",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <div style={{ width: "100%", aspectRatio: "16 / 9", pointerEvents: "none" }}>
                            <ProgramCanvasRenderer sources={sc.sources} />
                          </div>
                          <div
                            style={{
                              padding: "6px 8px",
                              background: "#12161F",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              fontSize: 11.5,
                              fontWeight: 700,
                              color: "#E2E8F0",
                            }}
                          >
                            <span>{sc.name}</span>
                            <span
                              style={{
                                fontSize: 10,
                                color: isPgm ? "#FCA5A5" : isPrv ? "#6EE7B7" : "#64748B",
                              }}
                            >
                              {isPgm ? "PGM" : isPrv ? "PRV" : `${sc.sources.length} src`}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : projectedSource ? (
                <div
                  style={{
                    width: "100%",
                    maxWidth: 960,
                    margin: "0 auto",
                    aspectRatio: "16 / 9",
                    background: "#000000",
                    border: "2px solid #2563EB",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <ProgramCanvasRenderer
                    sources={[{ ...projectedSource, enabled: true }]}
                  />
                </div>
              ) : (
                <div style={{ padding: 48, textAlign: "center", color: "#64748B", fontSize: 13 }}>
                  No sources available in active scene to project. Add a source first.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Broadcast Settings Modal */}
      <BroadcastSettingsModal
        isOpen={showBroadcastSettings}
        onClose={() => setShowBroadcastSettings(false)}
        profile={broadcastProfile}
        onSaveProfile={handleSaveBroadcastProfile}
        streamKey={streamConfig.streamKey}
        rtmpUrl={streamConfig.rtmpUrl}
        onSaveStreamConfig={handleSaveBroadcastStreamConfig}
        hotkeys={hotkeys}
        onSaveHotkeys={handleSaveBroadcastHotkeys}
        hardwareEncoders={hardwareEncoders}
        encodersLoading={encodersLoading}
        nativeCompositorRunning={nativeCompositorRunning}
        nativeCompositorBusy={nativeCompositorBusy}
        onToggleNativeCompositor={handleToggleNativeCompositor}
      />

      {/* Source Settings & Properties Modal */}
      <SourceSettingsModal
        source={settingsModalSource}
        isOpen={!!settingsModalSource}
        onClose={() => setSettingsModalSource(null)}
        onSave={(id, newSettings, newName) => {
          onUpdateSourceSettings(id, newSettings, newName);
          setSettingsModalSource(null);
        }}
      />

      {/* Source Filters & VST/AU Modal */}
      <SourceFiltersModal
        source={filtersModalSource}
        isOpen={!!filtersModalSource}
        onClose={() => setFiltersModalSource(null)}
        onSaveFilters={(sourceId, filters) => {
          patchSource(sourceId, (s) => ({ ...s, filters }));
          notify("Updated filter chain");
        }}
      />

      {/* Source Transform Modal */}
      <SourceTransformModal
        source={transformModalSource}
        isOpen={!!transformModalSource}
        onClose={() => setTransformModalSource(null)}
        onSaveTransform={(sourceId, transform) => {
          patchSource(sourceId, (s) => ({ ...s, transform }));
          notify("Updated source transform");
        }}
      />

      {/* Add Source Modal */}
      <AddSourceModal
        isOpen={showAddSource}
        onClose={() => setShowAddSource(false)}
        onAddSource={(source) => {
          onAddSource(source);
          setSettingsModalSource(source);
        }}
      />
    </div>
  );
};

const sceneActionBtnStyle: React.CSSProperties = {
  background: "#161B24",
  border: "1px solid #283344",
  color: "#CBD5E1",
  borderRadius: 4,
  padding: "2px 7px",
  fontSize: 10.5,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
};
