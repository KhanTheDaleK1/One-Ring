import React, { useEffect, useState } from "react";
import { Monitor, Radio, Tv } from "lucide-react";
import type { AudienceChatMessage, SceneSourceItem, SlideCue, SlideState, SlideTheme } from "../types";
import { isTrustedSyncPayload, stampSyncPayload } from "../bridge";
import { ProgramCanvasRenderer, type BroadcastSceneDefinition } from "./ProgramCanvasRenderer";
import {
  editableSlideTextStyle,
  isVideoBackground,
  slideTransitionMs,
  toEditableSlides,
  type EditableSlide,
} from "./SlideEditorModal";

type StageLayoutMode = "classic" | "clock_focus" | "notes_focus";

const STAGE_LAYOUT_KEY = "onering_stage_layout";
const SLIDE_EXTRAS_KEY = "onering_slide_editor_extras";
const AUDIENCE_OVERLAY_KEY = "onering_audience_overlay";
const STAGE_LAYOUT_MODES: StageLayoutMode[] = ["classic", "clock_focus", "notes_focus"];

interface StoredSlideExtras {
  slides?: EditableSlide[];
  theme?: SlideTheme;
  stageLayout?: StageLayoutMode;
}

function readStoredSlideExtras(): StoredSlideExtras {
  try {
    const raw = localStorage.getItem(SLIDE_EXTRAS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isTrustedSyncPayload(parsed, "SLIDE_EXTRAS_STATE") ? (parsed as StoredSlideExtras) : {};
  } catch {
    return {};
  }
}

function readStageLayout(): StageLayoutMode {
  try {
    const raw = localStorage.getItem(STAGE_LAYOUT_KEY);
    if (raw && STAGE_LAYOUT_MODES.includes(raw as StageLayoutMode)) return raw as StageLayoutMode;
  } catch {}
  return "classic";
}

function readStoredAudienceOverlay(): AudienceChatMessage | null {
  try {
    const raw = localStorage.getItem(AUDIENCE_OVERLAY_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isTrustedSyncPayload(parsed, "AUDIENCE_OVERLAY")) return null;
    const message = (parsed as Record<string, unknown>).message as AudienceChatMessage | null;
    if (!message || typeof message.id !== "string" || typeof message.text !== "string") return null;
    return message;
  } catch {
    return null;
  }
}

const AUDIENCE_ROLE_COLOR: Record<string, string> = {
  HOST: "#FBBF24",
  MOD: "#A78BFA",
  VIEWER: "#60A5FA",
};

/** Broadcast-grade lower-third plate for a pinned audience message. */
function AudienceLowerThirdCard({ message }: { message: AudienceChatMessage }) {
  const role = (message.role || "VIEWER").toUpperCase();
  const accent = AUDIENCE_ROLE_COLOR[role] || "#3B82F6";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        width: "100%",
        background: "linear-gradient(100deg, rgba(8,12,20,0.96) 0%, rgba(16,23,36,0.94) 100%)",
        border: "1px solid rgba(148,163,184,0.35)",
        borderRadius: "0.9vh",
        boxShadow: "0 1.8vh 5vh rgba(0,0,0,0.7)",
        overflow: "hidden",
        textAlign: "left",
      }}
    >
      <div style={{ width: "0.9vh", minWidth: 5, flexShrink: 0, background: accent }} />
      <div style={{ padding: "1.8vh 2.6vw", minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1vw",
            flexWrap: "wrap",
            marginBottom: "0.7vh",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: "1.5vh",
              fontWeight: 900,
              letterSpacing: "0.1em",
              padding: "0.35vh 0.8vw",
              borderRadius: "0.4vh",
              color: accent,
              background: "rgba(2,6,23,0.85)",
              border: `1px solid ${accent}`,
            }}
          >
            {role}
          </span>
          <strong
            style={{
              fontSize: "2.4vh",
              color: "#FFFFFF",
              letterSpacing: "0.01em",
              textShadow: "0 2px 8px rgba(0,0,0,0.9)",
            }}
          >
            {message.author}
          </strong>
          {message.channel && (
            <span className="mono" style={{ fontSize: "1.5vh", color: "#94A3B8" }}>
              #{message.channel}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: "3vh",
            lineHeight: 1.25,
            fontWeight: 700,
            color: "#F8FAFC",
            whiteSpace: "pre-wrap",
            textShadow: "0 2px 10px rgba(0,0,0,0.9)",
          }}
        >
          {message.text}
        </div>
      </div>
    </div>
  );
}

/** Overlay editor-authored overrides onto the live slide list by id, number, or exact text. */
function withSlideExtras(
  live: SlideCue[] | undefined,
  extras: StoredSlideExtras
): EditableSlide[] {
  const authored = extras.slides || [];
  if (!live || live.length === 0) return toEditableSlides(authored);
  const byId = new Map(authored.map((slide) => [slide.id, slide]));
  const byNumber = new Map(authored.map((slide) => [slide.number, slide]));
  return toEditableSlides(live).map((slide) => {
    const candidate = byId.get(slide.id) || byNumber.get(slide.number);
    return candidate && candidate.text === slide.text ? { ...slide, ...candidate } : slide;
  });
}

interface BroadcastScenesState {
  scenes: BroadcastSceneDefinition[];
  activeSceneId: string | null;
  previewSceneId: string | null;
}

function parseBroadcastScenesPayload(raw: unknown): BroadcastScenesState {
  if (!raw) {
    return { scenes: [], activeSceneId: null, previewSceneId: null };
  }
  if (Array.isArray(raw)) {
    const scenes = raw.filter(
      (sc): sc is BroadcastSceneDefinition =>
        Boolean(sc && typeof sc === "object" && typeof (sc as any).id === "string" && Array.isArray((sc as any).sources))
    );
    return {
      scenes,
      activeSceneId: scenes[0]?.id ?? null,
      previewSceneId: null,
    };
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const rawScenes = Array.isArray(obj.scenes) ? obj.scenes : [];
    const scenes = rawScenes.filter(
      (sc): sc is BroadcastSceneDefinition =>
        Boolean(sc && typeof sc === "object" && typeof (sc as any).id === "string" && Array.isArray((sc as any).sources))
    );
    const activeId =
      typeof obj.activeSceneId === "string"
        ? obj.activeSceneId
        : typeof obj.programSceneId === "string"
        ? obj.programSceneId
        : scenes[0]?.id ?? null;
    const previewId =
      typeof obj.previewSceneId === "string" ? obj.previewSceneId : null;
    return {
      scenes,
      activeSceneId: activeId,
      previewSceneId: previewId,
    };
  }
  return { scenes: [], activeSceneId: null, previewSceneId: null };
}

function readStoredBroadcastScenes(): BroadcastScenesState {
  try {
    const saved = localStorage.getItem("onering_broadcast_scenes");
    if (!saved) return { scenes: [], activeSceneId: null, previewSceneId: null };
    const parsed: unknown = JSON.parse(saved);
    if (!isTrustedSyncPayload(parsed, "BROADCAST_SCENES_UPDATE")) {
      return { scenes: [], activeSceneId: null, previewSceneId: null };
    }
    return parseBroadcastScenesPayload(parsed);
  } catch {
    return { scenes: [], activeSceneId: null, previewSceneId: null };
  }
}

function readStoredWorkspaceSources(): SceneSourceItem[] {
  try {
    const saved = localStorage.getItem("onering_workspace_autosave_v1");
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!isTrustedSyncPayload(parsed, "WORKSPACE_AUTOSAVE")) return [];
    const stored = parsed as Record<string, unknown>;
    return Array.isArray(stored.sources) ? (stored.sources as SceneSourceItem[]) : [];
  } catch {
    return [];
  }
}

export const SecondaryOutputWindow: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const outputType = params.get("output") || "foh"; // "foh" | "stage" | "lower_third" | "multiview" | "source"
  const sourceIdParam = params.get("sourceId");

  const [slides, setSlides] = useState<SlideState | null>(() => {
    try {
      const saved = localStorage.getItem("onering_live_slides_state");
      if (!saved) return null;
      const parsed: unknown = JSON.parse(saved);
      return isTrustedSyncPayload(parsed, "SLIDES_STATE") ? (parsed as SlideState) : null;
    } catch {
      return null;
    }
  });

  const [broadcastScenes, setBroadcastScenes] = useState<BroadcastScenesState>(() =>
    readStoredBroadcastScenes()
  );
  const [workspaceSources, setWorkspaceSources] = useState<SceneSourceItem[]>(() =>
    readStoredWorkspaceSources()
  );
  const [clockText, setClockText] = useState<string>(() =>
    new Date().toLocaleTimeString([], { hour12: false })
  );
  const [slideExtras, setSlideExtras] = useState<StoredSlideExtras>(() => readStoredSlideExtras());
  const [stageLayout, setStageLayout] = useState<StageLayoutMode>(() => readStageLayout());
  const [audienceOverlay, setAudienceOverlay] = useState<AudienceChatMessage | null>(() =>
    readStoredAudienceOverlay()
  );

  useEffect(() => {
    const handleMessage = (data: unknown) => {
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      const payload = data as Record<string, unknown>;
      if (typeof payload.type !== "string") return;

      if (payload.type === "SLIDES_UPDATE" && isTrustedSyncPayload(payload, "SLIDES_UPDATE")) {
        setSlides(payload.slides as SlideState);
      } else if (
        payload.type === "BROADCAST_SCENES_UPDATE" ||
        payload.type === "SCENES_UPDATE" ||
        Array.isArray(payload.scenes)
      ) {
        // Some producers wrap the scene list in `payload`; validate the actual scene envelope.
        const envelope = payload.payload ?? payload;
        if (isTrustedSyncPayload(envelope, "BROADCAST_SCENES_UPDATE")) {
          setBroadcastScenes(parseBroadcastScenesPayload(envelope));
        }
      } else if (
        payload.type === "SOURCES_UPDATE" &&
        isTrustedSyncPayload(payload, "SOURCES_UPDATE")
      ) {
        setWorkspaceSources(payload.sources as SceneSourceItem[]);
      } else if (
        payload.type === "ACTIVE_SCENE_UPDATE" &&
        isTrustedSyncPayload(payload, "ACTIVE_SCENE_UPDATE")
      ) {
        setBroadcastScenes((prev) => ({ ...prev, activeSceneId: payload.sceneId as string }));
      } else if (
        payload.type === "AUDIENCE_OVERLAY" &&
        isTrustedSyncPayload(payload, "AUDIENCE_OVERLAY")
      ) {
        const message = payload.message as AudienceChatMessage | null;
        setAudienceOverlay(
          message && typeof message.id === "string" && typeof message.text === "string"
            ? message
            : null
        );
      } else if (
        payload.type === "STAGE_LAYOUT_UPDATE" &&
        isTrustedSyncPayload(payload, "STAGE_LAYOUT_UPDATE")
      ) {
        setStageLayout(payload.layout as StageLayoutMode);
      } else if (
        payload.type === "SLIDE_EXTRAS_UPDATE" &&
        isTrustedSyncPayload(payload, "SLIDE_EXTRAS_UPDATE")
      ) {
        setSlideExtras({
          slides: payload.slides as EditableSlide[],
          theme: payload.theme as SlideTheme | undefined,
          stageLayout: STAGE_LAYOUT_MODES.includes(payload.stageLayout as StageLayoutMode)
            ? (payload.stageLayout as StageLayoutMode)
            : undefined,
        });
      }
    };

    const channel = new BroadcastChannel("onering_display_sync");
    channel.onmessage = (ev) => handleMessage(ev.data);

    let broadcastChannel: BroadcastChannel | null = null;
    try {
      broadcastChannel = new BroadcastChannel("onering_broadcast_sync");
      broadcastChannel.onmessage = (ev) => handleMessage(ev.data);
    } catch {
      // Optional secondary channel
    }

    const onStorage = (ev: StorageEvent) => {
      if (ev.key === "onering_live_slides_state" && ev.newValue) {
        try {
          const parsed: unknown = JSON.parse(ev.newValue);
          if (isTrustedSyncPayload(parsed, "SLIDES_STATE")) setSlides(parsed as SlideState);
        } catch {}
      } else if (ev.key === "onering_broadcast_scenes") {
        if (ev.newValue) {
          try {
            const parsed: unknown = JSON.parse(ev.newValue);
            if (isTrustedSyncPayload(parsed, "BROADCAST_SCENES_UPDATE")) {
              setBroadcastScenes(parseBroadcastScenesPayload(parsed));
            }
          } catch {}
        } else {
          setBroadcastScenes({ scenes: [], activeSceneId: null, previewSceneId: null });
        }
      } else if (ev.key === "onering_workspace_autosave_v1" && ev.newValue) {
        try {
          const parsed: unknown = JSON.parse(ev.newValue);
          if (!isTrustedSyncPayload(parsed, "WORKSPACE_AUTOSAVE")) return;
          const saved = parsed as Record<string, unknown>;
          if (Array.isArray(saved.sources)) {
            setWorkspaceSources(saved.sources as SceneSourceItem[]);
          }
          if (saved.slides) {
            setSlides((prev) => prev || (saved.slides as SlideState));
          }
        } catch {}
      } else if (ev.key === STAGE_LAYOUT_KEY && ev.newValue) {
        if (STAGE_LAYOUT_MODES.includes(ev.newValue as StageLayoutMode)) {
          setStageLayout(ev.newValue as StageLayoutMode);
        }
      } else if (ev.key === SLIDE_EXTRAS_KEY && ev.newValue) {
        setSlideExtras(readStoredSlideExtras());
      } else if (ev.key === AUDIENCE_OVERLAY_KEY) {
        setAudienceOverlay(readStoredAudienceOverlay());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => {
      channel.close();
      broadcastChannel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (outputType !== "multiview" && outputType !== "stage") return;
    const timer = window.setInterval(() => {
      setClockText(new Date().toLocaleTimeString([], { hour12: false }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [outputType]);

  const effectiveScenes: BroadcastSceneDefinition[] =
    broadcastScenes.scenes.length > 0
      ? broadcastScenes.scenes
      : workspaceSources.length > 0
      ? [{ id: "scene_1", name: "Main Broadcast Scene", sources: workspaceSources }]
      : [];

  // 8-Scene Live Multiview Grid Output
  if (outputType === "multiview") {
    const slots: Array<BroadcastSceneDefinition | null> = Array.from(
      { length: 8 },
      (_, idx) => effectiveScenes[idx] ?? null
    );
    const activeScene =
      effectiveScenes.find((sc) => sc.id === broadcastScenes.activeSceneId) ||
      effectiveScenes[0] ||
      null;
    const previewScene =
      effectiveScenes.find(
        (sc) => sc.id === broadcastScenes.previewSceneId && sc.id !== activeScene?.id
      ) || null;

    const handleSelectSceneTile = (sceneId: string) => {
      try {
        const ch = new BroadcastChannel("onering_display_sync");
        ch.postMessage(stampSyncPayload({ type: "SELECT_SCENE", sceneId }));
        ch.close();
      } catch {}
    };

    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#070A0F",
          color: "#F8FAFC",
          display: "flex",
          flexDirection: "column",
          padding: 14,
          gap: 12,
          boxSizing: "border-box",
          fontFamily: "Inter, system-ui, sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Multiview Header Strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            background: "#0F141D",
            border: "1px solid #1E293B",
            borderRadius: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Tv size={16} color="#3B82F6" />
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              ONE RING • 8-SCENE LIVE MULTIVIEW
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(239, 68, 68, 0.16)",
                border: "1px solid rgba(239, 68, 68, 0.5)",
                color: "#FCA5A5",
              }}
            >
              PGM: {activeScene ? activeScene.name : "None"}
            </span>
            {previewScene && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "rgba(16, 185, 129, 0.16)",
                  border: "1px solid rgba(16, 185, 129, 0.5)",
                  color: "#6EE7B7",
                }}
              >
                PVW: {previewScene.name}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#94A3B8" }}>
            <span>{effectiveScenes.length} / 8 Scenes Configured</span>
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 700, color: "#E2E8F0" }}>
              {clockText}
            </span>
          </div>
        </div>

        {/* 4x2 8-Scene Multiview Grid */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gridTemplateRows: "repeat(2, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          {slots.map((scene, idx) => {
            if (!scene) {
              return (
                <div
                  key={`empty_slot_${idx}`}
                  style={{
                    background: "#0B0F17",
                    border: "1px dashed #1E293B",
                    borderRadius: 8,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#94A3B8",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                    }}
                  >
                    SLOT {String(idx + 1).padStart(2, "0")} • UNASSIGNED
                  </div>
                  <div
                    style={{
                      padding: "6px 10px",
                      background: "#0F141D",
                      borderTop: "1px solid #1E293B",
                      fontSize: 11,
                      color: "#64748B",
                      fontWeight: 600,
                    }}
                  >
                    Scene {idx + 1}
                  </div>
                </div>
              );
            }

            const isProgram = activeScene?.id === scene.id;
            const isPreview = !isProgram && previewScene?.id === scene.id;
            const enabledCount = scene.sources.filter((s) => s.enabled).length;
            const borderColor = isProgram ? "#EF4444" : isPreview ? "#10B981" : "#1E293B";

            return (
              <div
                key={scene.id}
                role="button"
                tabIndex={0}
                aria-label={`Select scene ${String(idx + 1).padStart(2, "0")}`}
                onClick={() => handleSelectSceneTile(scene.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectSceneTile(scene.id);
                  }
                }}
                style={{
                  background: "#000000",
                  border: `2px solid ${borderColor}`,
                  borderRadius: 8,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  cursor: "pointer",
                  boxShadow: isProgram
                    ? "0 0 0 1px rgba(239, 68, 68, 0.35), 0 8px 24px rgba(239, 68, 68, 0.16)"
                    : isPreview
                    ? "0 0 0 1px rgba(16, 185, 129, 0.3)"
                    : undefined,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    position: "relative",
                    background: "#000000",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      aspectRatio: "16 / 9",
                      maxHeight: "100%",
                      maxWidth: "100%",
                      pointerEvents: "none",
                      position: "relative",
                    }}
                  >
                    <ProgramCanvasRenderer
                      sources={scene.sources}
                      allScenes={effectiveScenes}
                      compact
                    />
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      left: 6,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(2, 6, 23, 0.78)",
                      border: "1px solid rgba(51, 65, 85, 0.7)",
                      color: "#CBD5E1",
                      fontSize: 10,
                      fontWeight: 800,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                  {(isProgram || isPreview) && (
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background: isProgram ? "#DC2626" : "#059669",
                        color: "#FFFFFF",
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                      }}
                    >
                      {isProgram ? "PROGRAM" : "PREVIEW"}
                    </div>
                  )}
                </div>

                {/* Scene Footer Tally Bar */}
                <div
                  style={{
                    padding: "6px 10px",
                    background: isProgram ? "#1F1215" : isPreview ? "#0B1F19" : "#0F141D",
                    borderTop: `1px solid ${borderColor}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: isProgram ? "#FFFFFF" : "#E2E8F0",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {scene.name}
                  </span>
                  <span style={{ fontSize: 10.5, color: "#94A3B8", flexShrink: 0 }}>
                    {enabledCount}/{scene.sources.length} src
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Clean Fullscreen Source Projector Output (?output=source&sourceId=...)
  if (outputType === "source") {
    const allAvailableSources: SceneSourceItem[] = [
      ...effectiveScenes.flatMap((sc) => sc.sources),
      ...workspaceSources,
    ];
    const targetSource = sourceIdParam
      ? allAvailableSources.find((s) => s.id === sourceIdParam) ||
        allAvailableSources.find((s) => s.name === sourceIdParam) ||
        null
      : null;

    if (!targetSource) {
      return (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            background: "#000000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748B", fontSize: 13 }}>
            <Monitor size={16} /> <Radio size={14} />
            <span>
              Source Projector Standby {sourceIdParam ? `• ${sourceIdParam}` : ""}
            </span>
          </div>
        </div>
      );
    }

    const origW = Math.max(1, targetSource.transform?.width ?? 1920);
    const origH = Math.max(1, targetSource.transform?.height ?? 1080);
    const scaleX = 1920 / origW;
    const scaleY = 1080 / origH;
    const projectedSource: SceneSourceItem = {
      ...targetSource,
      enabled: true,
      transform: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        rotation: targetSource.transform?.rotation ?? 0,
        scaleFilter: targetSource.transform?.scaleFilter ?? "bilinear",
        blendingMode: targetSource.transform?.blendingMode ?? "normal",
        deinterlacing: targetSource.transform?.deinterlacing ?? "disable",
        flipH: targetSource.transform?.flipH,
        flipV: targetSource.transform?.flipV,
        cropLeft: targetSource.transform?.cropLeft ? targetSource.transform.cropLeft * scaleX : undefined,
        cropRight: targetSource.transform?.cropRight ? targetSource.transform.cropRight * scaleX : undefined,
        cropTop: targetSource.transform?.cropTop ? targetSource.transform.cropTop * scaleY : undefined,
        cropBottom: targetSource.transform?.cropBottom ? targetSource.transform.cropBottom * scaleY : undefined,
        opacity: targetSource.transform?.opacity,
      },
    };

    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#000000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            maxWidth: "177.78vh",
            maxHeight: "56.25vw",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <ProgramCanvasRenderer
            sources={[projectedSource]}
            allScenes={effectiveScenes}
            compact
          />
        </div>
      </div>
    );
  }

  const currentArr = withSlideExtras(slides?.slides, slideExtras);
  const currentSlide =
    currentArr.find((s) => s.number === slides?.currentSlide) || currentArr[0];
  const theme: SlideTheme | undefined = slides?.theme
    ? { ...(slideExtras.theme || {}), ...slides.theme }
    : slideExtras.theme;
  const broadcastLayout = (slides?.theme as unknown as { stageLayout?: string } | undefined)
    ?.stageLayout;
  const effectiveStageLayout: StageLayoutMode = STAGE_LAYOUT_MODES.includes(
    broadcastLayout as StageLayoutMode
  )
    ? (broadcastLayout as StageLayoutMode)
    : slideExtras.stageLayout && STAGE_LAYOUT_MODES.includes(slideExtras.stageLayout)
    ? slideExtras.stageLayout
    : stageLayout;

  // Stage Confidence Display Layout (High Contrast Yellow / Cyan Words)
  if (outputType === "stage") {
    const linkLabel = slides?.connected
      ? "LIVE"
      : !slides || slides.adapter === "local"
      ? "LOCAL"
      : "NO LINK";
    const linkColor = slides?.connected ? "#4ADE80" : !slides || slides.adapter === "local" ? "#64748B" : "#F87171";
    const timers = slides?.timers ?? [];
    const showMessage = Boolean(slides?.stageMessageVisible && slides?.stageMessage?.trim());
    const stageCurrentText = slides?.cleared
      ? "[CLEARED]"
      : currentSlide?.text || slides?.currentText || "—";

    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#000000",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "5vh 6vw",
          boxSizing: "border-box",
          fontFamily: "Inter, system-ui, sans-serif",
          overflow: "hidden",
        }}
      >
        <style>{`@keyframes oneringStageFlash { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }`}</style>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#64748B", fontSize: "2.2vh" }}>
          <span>
            ONE RING STAGE CONFIDENCE • {slides?.presentationName || "Standby"} •{" "}
            {effectiveStageLayout.replace("_", " ").toUpperCase()}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "2vw" }}>
            <span style={{ color: linkColor, fontWeight: 800 }}>{linkLabel}</span>
            <span>Slide {slides?.currentSlide || 0} / {slides?.totalSlides || 0}</span>
            <span className="mono">{clockText}</span>
          </span>
        </div>

        {showMessage && (
          <div
            style={{
              alignSelf: "center",
              marginTop: "1vh",
              padding: "1.2vh 3vw",
              border: "0.3vh solid #F59E0B",
              borderRadius: "1vh",
              background: "rgba(245,158,11,0.14)",
              color: "#FCD34D",
              fontSize: "3.4vh",
              fontWeight: 800,
              textAlign: "center",
              animation: slides?.stageMessageFlash ? "oneringStageFlash 0.8s steps(2, end) infinite" : undefined,
            }}
          >
            {slides?.stageMessage}
          </div>
        )}

        {effectiveStageLayout === "clock_focus" ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.4vh",
              textAlign: "center",
            }}
          >
            <div className="mono" style={{ fontSize: "14vh", fontWeight: 900, lineHeight: 1, color: "#F8FAFC", letterSpacing: "0.03em" }}>
              {clockText}
            </div>
            <div style={{ color: "#EAB308", fontSize: "2vh", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              CURRENT LYRIC
            </div>
            <div style={{ fontSize: "4vh", fontWeight: 800, lineHeight: 1.25, whiteSpace: "pre-line" }}>
              {stageCurrentText}
            </div>
            {slides?.currentNotes && (
              <div style={{ color: "#A3B18A", fontSize: "2vh", whiteSpace: "pre-line" }}>
                {slides.currentNotes}
              </div>
            )}
          </div>
        ) : effectiveStageLayout === "notes_focus" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ color: "#EAB308", fontSize: "2.2vh", fontWeight: 800, textTransform: "uppercase", marginBottom: "1vh" }}>
              CURRENT LYRIC
            </div>
            <div style={{ fontSize: "4.6vh", fontWeight: 800, lineHeight: 1.25, whiteSpace: "pre-line" }}>
              {stageCurrentText}
            </div>
            <div
              style={{
                marginTop: "2.5vh",
                padding: "2vh 2.5vw",
                border: "0.2vh solid rgba(163, 177, 138, 0.65)",
                borderRadius: "1vh",
                background: "rgba(163, 177, 138, 0.08)",
              }}
            >
              <div style={{ color: "#FBBF24", fontSize: "2.1vh", fontWeight: 800, textTransform: "uppercase", marginBottom: "0.8vh" }}>
                Notes / Cues
              </div>
              <div style={{ color: "#E7E5D0", fontSize: "3.2vh", lineHeight: 1.35, whiteSpace: "pre-line" }}>
                {slides?.currentNotes || "No notes for this slide"}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ color: "#EAB308", fontSize: "2.4vh", fontWeight: 800, textTransform: "uppercase", marginBottom: "1vh" }}>
              CURRENT LYRIC
            </div>
            <div style={{ fontSize: "6.5vh", fontWeight: 800, lineHeight: 1.25, whiteSpace: "pre-line" }}>
              {stageCurrentText}
            </div>
            {slides?.currentNotes && (
              <div
                style={{
                  marginTop: "2vh",
                  color: "#A3B18A",
                  fontSize: "2.4vh",
                  lineHeight: 1.35,
                  whiteSpace: "pre-line",
                  maxWidth: "80%",
                }}
              >
                <strong style={{ color: "#FBBF24" }}>NOTES: </strong>
                {slides.currentNotes}
              </div>
            )}
          </div>
        )}

        <div style={{ borderTop: "2px solid #262626", paddingTop: "3vh" }}>
          <div style={{ color: "#38BDF8", fontSize: "2.2vh", fontWeight: 800, textTransform: "uppercase", marginBottom: "0.8vh" }}>
            NEXT UP
          </div>
          <div style={{ fontSize: "4.2vh", fontWeight: 600, color: "#94A3B8", lineHeight: 1.3, whiteSpace: "pre-line" }}>
            {slides?.nextText || "—"}
          </div>
          {slides?.nextNotes && (
            <div style={{ marginTop: "0.6vh", fontSize: "2vh", color: "#64748B", whiteSpace: "pre-line" }}>
              {slides.nextNotes}
            </div>
          )}
        </div>

        {timers.length > 0 && (
          <div
            style={{
              marginTop: "2vh",
              paddingTop: "1.6vh",
              borderTop: "1px solid #1F2937",
              display: "flex",
              gap: "3vw",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {timers.slice(0, 4).map((timer) => (
              <div key={timer.id} style={{ display: "flex", alignItems: "baseline", gap: "0.8vw" }}>
                <span className="mono" style={{ fontSize: "3.6vh", fontWeight: 800, color: timer.state === "running" ? "#34D399" : "#E5E7EB" }}>
                  {timer.formatted}
                </span>
                <span style={{ fontSize: "1.8vh", color: "#64748B", textTransform: "uppercase" }}>
                  {timer.name}{timer.countdown ? " ↓" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Livestream Lower Thirds Alpha Overlay Output
  if (outputType === "lower_third") {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#00FF00", // Chroma-key green or keyed alpha surface for capture or screen sharing
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {!slides?.cleared && (currentSlide?.text || slides?.currentText) && (
          <div
            style={{
              background: theme?.lowerThirdBg || "rgba(10, 14, 23, 0.92)",
              borderTop: `4px solid ${theme?.lowerThirdAccent || "#3B82F6"}`,
              padding: "3.5vh 6vw",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontFamily: theme?.fontFamily || "Inter, system-ui, sans-serif",
                fontSize: `${Math.round((theme?.fontSize || 22) * 2.2)}px`,
                fontWeight: 700,
                color: theme?.textColor || "#FFFFFF",
                lineHeight: 1.3,
                whiteSpace: "pre-line",
              }}
            >
              {currentSlide?.text || slides?.currentText}
            </div>
          </div>
        )}
        {audienceOverlay && (
          <div style={{ marginTop: "1.5vh" }}>
            <AudienceLowerThirdCard message={audienceOverlay} />
          </div>
        )}
      </div>
    );
  }

  // Default: FOH Fullscreen Congregation Display Output
  const fohBg =
    theme?.backgroundType === "image" && theme.backgroundImage && !isVideoBackground(theme.backgroundImage)
      ? `url(${theme.backgroundImage}) center/cover no-repeat`
      : theme?.backgroundType === "gradient"
      ? `linear-gradient(135deg, ${theme.backgroundColor} 0%, ${theme.gradientTo || "#1E1B4B"} 100%)`
      : theme?.backgroundColor || "#05070B";
  const fohVideo = isVideoBackground(currentSlide?.motionBackground)
    ? (currentSlide?.motionBackground as string)
    : isVideoBackground(theme?.backgroundImage)
    ? (theme?.backgroundImage as string)
    : "";
  const fohTheme: Pick<SlideTheme, "fontFamily" | "fontSize" | "textColor"> = {
    fontFamily: theme?.fontFamily || "Inter, system-ui, sans-serif",
    fontSize: theme?.fontSize || 22,
    textColor: theme?.textColor || "#FFFFFF",
  };
  const transition = currentSlide?.transition || "Fade";
  const transitionMs = slideTransitionMs(currentSlide);
  const animationName =
    transition === "Dissolve"
      ? "oneringSlideDissolve"
      : transition === "Push"
      ? "oneringSlidePush"
      : "oneringSlideFade";
  const fohText = currentSlide?.text || slides?.currentText || "";
  const fohKey = `${slides?.currentSlide || 0}-${currentSlide?.id || ""}-${fohText.slice(0, 48)}`;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: fohBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <style>{`
        @keyframes oneringSlideFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes oneringSlideDissolve { from { opacity: 0; filter: blur(8px); } to { opacity: 1; filter: blur(0); } }
        @keyframes oneringSlidePush { from { opacity: 0; transform: translate(-38%, -50%); } to { opacity: 1; transform: translate(-50%, -50%); } }
      `}</style>
      {fohVideo && (
        <video
          autoPlay
          loop
          muted
          playsInline
          src={fohVideo}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
        />
      )}
      {!slides?.cleared && fohText ? (
        <div
          key={fohKey}
          style={
            {
              ...editableSlideTextStyle(currentSlide, fohTheme, 1.05),
              position: "absolute",
              left: `calc(50% + ${currentSlide?.offsetX || 0}%)`,
              top: `calc(50% + ${currentSlide?.offsetY || 0}%)`,
              width: "86%",
              transform: "translate(-50%, -50%)",
              animation:
                transition === "Cut"
                  ? undefined
                  : `${animationName} ${transitionMs}ms ease-in-out both`,
            } as React.CSSProperties
          }
        >
          {fohText}
        </div>
      ) : (
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, color: "#64748B", fontSize: 13 }}>
          <Monitor size={16} /> <Radio size={14} /> FOH Output Standby
        </div>
      )}
      {audienceOverlay && (
        <div
          style={{
            position: "absolute",
            left: "3vw",
            right: "3vw",
            bottom: "3vh",
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          <AudienceLowerThirdCard message={audienceOverlay} />
        </div>
      )}
    </div>
  );
};
