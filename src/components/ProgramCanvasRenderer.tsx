import React, { useEffect, useRef, useState } from "react";
import { Monitor, Video, Tv } from "lucide-react";
import type { SceneSourceItem, SourceTransform } from "../types";

interface ProgramCanvasRendererProps {
  sources: SceneSourceItem[];
  selectedSourceId?: string | null;
  onSelectSource?: (id: string | null) => void;
  onUpdateTransform?: (id: string, transform: SourceTransform) => void;
}

const DEFAULT_TRANSFORM: SourceTransform = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  rotation: 0,
  scaleFilter: "bilinear",
  blendingMode: "normal",
  deinterlacing: "disable",
};

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLE_POSITIONS: Array<{ id: ResizeHandle; style: React.CSSProperties; cursor: string }> = [
  { id: "nw", cursor: "nwse-resize", style: { top: -5, left: -5 } },
  { id: "n", cursor: "ns-resize", style: { top: -5, left: "50%", transform: "translateX(-50%)" } },
  { id: "ne", cursor: "nesw-resize", style: { top: -5, right: -5 } },
  { id: "e", cursor: "ew-resize", style: { top: "50%", right: -5, transform: "translateY(-50%)" } },
  { id: "se", cursor: "nwse-resize", style: { bottom: -5, right: -5 } },
  { id: "s", cursor: "ns-resize", style: { bottom: -5, left: "50%", transform: "translateX(-50%)" } },
  { id: "sw", cursor: "nesw-resize", style: { bottom: -5, left: -5 } },
  { id: "w", cursor: "ew-resize", style: { top: "50%", left: -5, transform: "translateY(-50%)" } },
];

const LiveCameraLayer: React.FC<{ source: SceneSourceItem }> = ({ source }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Camera permission required");
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [source.id]);

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#94A3B8", fontSize: 12, gap: 6 }}>
        <Video size={28} color="#EF4444" />
        <span>{source.name}: {error}</span>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
};

const LiveDisplayOrWindowLayer: React.FC<{ source: SceneSourceItem }> = ({ source }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCapture = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      setStream(s);
    } catch (err: any) {
      setError(err?.message || "Capture cancelled or permission denied");
    }
  };

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  if (!stream) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#CBD5E1", gap: 10, background: "rgba(15, 23, 42, 0.75)" }}>
        <Monitor size={32} color="#60A5FA" />
        <div style={{ fontSize: 13, fontWeight: 700 }}>{source.name}</div>
        {source.settings?.window ? (
          <div style={{ fontSize: 11, color: "#94A3B8" }}>Target: {String(source.settings.window)}</div>
        ) : null}
        <button
          type="button"
          onClick={startCapture}
          style={{
            padding: "8px 16px",
            background: "#2563EB",
            border: "1px solid #60A5FA",
            color: "#FFFFFF",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Click to Share / Preview Window
        </button>
        {error && <span style={{ fontSize: 11, color: "#F87171" }}>{error}</span>}
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  );
};

export const ProgramCanvasRenderer: React.FC<ProgramCanvasRendererProps> = ({
  sources,
  selectedSourceId,
  onSelectSource,
  onUpdateTransform,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{
    mode: "move" | "resize";
    handle?: ResizeHandle;
    sourceId: string;
    startX: number;
    startY: number;
    initialTransform: SourceTransform;
  } | null>(null);

  useEffect(() => {
    if (!dragState || !onUpdateTransform) return;

    const handlePointerMove = (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dxCanvas = ((e.clientX - dragState.startX) / rect.width) * 1920;
      const dyCanvas = ((e.clientY - dragState.startY) / rect.height) * 1080;
      const init = dragState.initialTransform;

      if (dragState.mode === "move") {
        onUpdateTransform(dragState.sourceId, {
          ...init,
          x: Math.round(init.x + dxCanvas),
          y: Math.round(init.y + dyCanvas),
        });
        return;
      }

      const handle = dragState.handle!;
      let nextX = init.x;
      let nextY = init.y;
      let nextW = init.width;
      let nextH = init.height;
      const minSize = 40;

      if (handle.includes("e")) {
        nextW = Math.max(minSize, init.width + dxCanvas);
      }
      if (handle.includes("s")) {
        nextH = Math.max(minSize, init.height + dyCanvas);
      }
      if (handle.includes("w")) {
        const clampedDx = Math.min(dxCanvas, init.width - minSize);
        nextX = init.x + clampedDx;
        nextW = init.width - clampedDx;
      }
      if (handle.includes("n")) {
        const clampedDy = Math.min(dyCanvas, init.height - minSize);
        nextY = init.y + clampedDy;
        nextH = init.height - clampedDy;
      }

      onUpdateTransform(dragState.sourceId, {
        ...init,
        x: Math.round(nextX),
        y: Math.round(nextY),
        width: Math.round(nextW),
        height: Math.round(nextH),
      });
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, onUpdateTransform]);

  const visibleSources = [...sources].filter((s) => s.enabled).reverse();

  if (sources.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 24, color: "#64748B" }}>
        <Tv size={48} color="#374151" style={{ marginBottom: 12 }} />
        <h4 style={{ margin: 0, color: "#94A3B8" }}>No Broadcast Sources Added</h4>
        <p style={{ fontSize: 13, marginTop: 6 }}>
          Click &quot;+ Add Source&quot; or right-click to add cameras, browser graphics, screen captures, or media.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={() => onSelectSource?.(null)}
      style={{ position: "relative", width: "100%", height: "100%", background: "#000000", overflow: "hidden", userSelect: "none" }}
    >
      {visibleSources.map((s) => {
        const tr: SourceTransform = { ...DEFAULT_TRANSFORM, ...s.transform };
        const isSelected = selectedSourceId === s.id;

        const layerStyle: React.CSSProperties = {
          position: "absolute",
          left: `${(tr.x / 1920) * 100}%`,
          top: `${(tr.y / 1080) * 100}%`,
          width: `${(tr.width / 1920) * 100}%`,
          height: `${(tr.height / 1080) * 100}%`,
          mixBlendMode: (tr.blendingMode === "additive" ? "screen" : tr.blendingMode || "normal") as any,
          transform: tr.rotation ? `rotate(${tr.rotation}deg)` : undefined,
          cursor: onUpdateTransform && !s.locked ? "move" : onSelectSource ? "pointer" : "default",
          outline: isSelected ? "2px solid #3B82F6" : undefined,
          outlineOffset: isSelected ? -1 : undefined,
          boxSizing: "border-box",
        };

        let content: React.ReactNode = null;
        if (s.type === "video_capture_device") {
          content = <LiveCameraLayer source={s} />;
        } else if (s.type === "window_capture" || s.type === "display_capture") {
          content = <LiveDisplayOrWindowLayer source={s} />;
        } else if (s.type === "browser" && s.settings?.url) {
          content = (
            <iframe
              src={String(s.settings.url)}
              title={s.name}
              style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }}
            />
          );
        } else if (s.type === "color") {
          content = (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: String(s.settings?.color || "#1E3A8A"),
              }}
            />
          );
        } else if (s.type === "image" && s.settings?.file) {
          content = (
            <img
              src={String(s.settings.file)}
              alt={s.name}
              style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
            />
          );
        } else if (s.type === "media" && s.settings?.file) {
          content = (
            <video
              src={String(s.settings.file)}
              autoPlay
              loop={Boolean(s.settings?.loop ?? true)}
              muted
              style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
            />
          );
        } else if (s.type === "text") {
          content = (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: String(s.settings?.color || "#FFFFFF"),
                fontSize: Number(s.settings?.fontSize || 36),
                fontWeight: 800,
                textShadow: "0 2px 10px rgba(0,0,0,0.8)",
                padding: 24,
                textAlign: "center",
                whiteSpace: "pre-line",
                boxSizing: "border-box",
              }}
            >
              {String(s.settings?.text || s.name)}
            </div>
          );
        }

        if (!content) return null;

        return (
          <div
            key={s.id}
            style={layerStyle}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelectSource?.(s.id);
              if (onUpdateTransform && !s.locked) {
                setDragState({
                  mode: "move",
                  sourceId: s.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  initialTransform: tr,
                });
              }
            }}
          >
            {content}
            {isSelected &&
              HANDLE_POSITIONS.map((h) => (
                <div
                  key={h.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (onUpdateTransform && !s.locked) {
                      setDragState({
                        mode: "resize",
                        handle: h.id,
                        sourceId: s.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        initialTransform: tr,
                      });
                    }
                  }}
                  style={{
                    position: "absolute",
                    width: 10,
                    height: 10,
                    background: "#3B82F6",
                    border: "1.5px solid #FFFFFF",
                    borderRadius: 2,
                    cursor: h.cursor,
                    zIndex: 20,
                    ...h.style,
                  }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
};
