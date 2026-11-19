import React, { useEffect, useState } from "react";
import { Monitor, Radio, Tv } from "lucide-react";
import type { SceneSourceItem, SlideState } from "../types";
import { ProgramCanvasRenderer, type BroadcastSceneDefinition } from "./ProgramCanvasRenderer";

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
    return parseBroadcastScenesPayload(JSON.parse(saved));
  } catch {
    return { scenes: [], activeSceneId: null, previewSceneId: null };
  }
}

function readStoredWorkspaceSources(): SceneSourceItem[] {
  try {
    const saved = localStorage.getItem("onering_workspace_autosave_v1");
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed?.sources) ? parsed.sources : [];
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
      return saved ? JSON.parse(saved) : null;
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

  useEffect(() => {
    const handleMessage = (data: any) => {
      if (!data) return;
      if (data.type === "SLIDES_UPDATE" && data.slides) {
        setSlides(data.slides);
      }
      if (
        data.type === "BROADCAST_SCENES_UPDATE" ||
        data.type === "SCENES_UPDATE" ||
        Array.isArray(data.scenes)
      ) {
        setBroadcastScenes(parseBroadcastScenesPayload(data.payload ?? data));
      }
      if (data.type === "SOURCES_UPDATE" && Array.isArray(data.sources)) {
        setWorkspaceSources(data.sources);
      }
      if (data.type === "ACTIVE_SCENE_UPDATE" && typeof data.sceneId === "string") {
        setBroadcastScenes((prev) => ({ ...prev, activeSceneId: data.sceneId }));
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
          setSlides(JSON.parse(ev.newValue));
        } catch {}
      } else if (ev.key === "onering_broadcast_scenes") {
        if (ev.newValue) {
          try {
            setBroadcastScenes(parseBroadcastScenesPayload(JSON.parse(ev.newValue)));
          } catch {}
        } else {
          setBroadcastScenes({ scenes: [], activeSceneId: null, previewSceneId: null });
        }
      } else if (ev.key === "onering_workspace_autosave_v1" && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue);
          if (Array.isArray(parsed?.sources)) {
            setWorkspaceSources(parsed.sources);
          }
          if (parsed?.slides) {
            setSlides((prev) => prev || parsed.slides);
          }
        } catch {}
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
        ch.postMessage({ type: "SELECT_SCENE", sceneId });
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
                    opacity: 0.65,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#334155",
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
                      color: "#475569",
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
                onClick={() => handleSelectSceneTile(scene.id)}
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
          <div style={{ opacity: 0.2, display: "flex", alignItems: "center", gap: 8, color: "#FFFFFF", fontSize: 13 }}>
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

  const currentArr = slides?.slides || [];
  const currentSlide =
    currentArr.find((s) => s.number === slides?.currentSlide) || currentArr[0];
  const theme = slides?.theme;

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
          <span>ONE RING STAGE CONFIDENCE • {slides?.presentationName || "Standby"}</span>
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

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ color: "#EAB308", fontSize: "2.4vh", fontWeight: 800, textTransform: "uppercase", marginBottom: "1vh" }}>
            CURRENT LYRIC
          </div>
          <div style={{ fontSize: "6.5vh", fontWeight: 800, lineHeight: 1.25, whiteSpace: "pre-line" }}>
            {slides?.cleared ? "[CLEARED]" : currentSlide?.text || slides?.currentText || "—"}
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
      </div>
    );
  }

  // Default: FOH Fullscreen Congregation Display Output
  const fohBg =
    theme?.backgroundType === "image" && theme.backgroundImage
      ? `url(${theme.backgroundImage}) center/cover no-repeat`
      : theme?.backgroundType === "gradient"
      ? `linear-gradient(135deg, ${theme.backgroundColor} 0%, ${theme.gradientTo || "#1E1B4B"} 100%)`
      : theme?.backgroundColor || "#05070B";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: fohBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6vw",
        textAlign: "center",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {!slides?.cleared && (currentSlide?.text || slides?.currentText) ? (
        <div
          style={{
            fontFamily: theme?.fontFamily || "Inter, system-ui, sans-serif",
            fontSize: `${Math.round((theme?.fontSize || 22) * 3.1)}px`,
            fontWeight: 800,
            color: theme?.textColor || "#FFFFFF",
            lineHeight: 1.35,
            whiteSpace: "pre-line",
            textShadow: "0 4px 20px rgba(0,0,0,0.85)",
          }}
        >
          {currentSlide?.text || slides?.currentText}
        </div>
      ) : (
        <div style={{ opacity: 0.12, display: "flex", alignItems: "center", gap: 8, color: "#FFFFFF", fontSize: 13 }}>
          <Monitor size={16} /> <Radio size={14} /> FOH Output Standby
        </div>
      )}
    </div>
  );
};
