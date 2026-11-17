import React, { useEffect, useRef, useState } from "react";
import { Monitor, Video, Tv } from "lucide-react";
import type { SceneSourceItem } from "../types";

interface ProgramCanvasRendererProps {
  sources: SceneSourceItem[];
}

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

  const startCapture = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
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

export const ProgramCanvasRenderer: React.FC<ProgramCanvasRendererProps> = ({ sources }) => {
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
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000000", overflow: "hidden" }}>
      {visibleSources.map((s) => {
        const tr = s.transform;
        const style: React.CSSProperties = {
          position: "absolute",
          inset: 0,
          mixBlendMode: (tr?.blendingMode === "additive" ? "screen" : tr?.blendingMode || "normal") as any,
          transform: tr?.rotation ? `rotate(${tr.rotation}deg)` : undefined,
        };

        if (s.type === "video_capture_device") {
          return (
            <div key={s.id} style={style}>
              <LiveCameraLayer source={s} />
            </div>
          );
        }

        if (s.type === "window_capture" || s.type === "display_capture") {
          return (
            <div key={s.id} style={style}>
              <LiveDisplayOrWindowLayer source={s} />
            </div>
          );
        }

        if (s.type === "browser" && s.settings?.url) {
          return (
            <div key={s.id} style={style}>
              <iframe
                src={String(s.settings.url)}
                title={s.name}
                style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }}
              />
            </div>
          );
        }

        if (s.type === "color") {
          return (
            <div
              key={s.id}
              style={{
                ...style,
                background: String(s.settings?.color || "#1E3A8A"),
              }}
            />
          );
        }

        if (s.type === "image" && s.settings?.file) {
          return (
            <div key={s.id} style={style}>
              <img
                src={String(s.settings.file)}
                alt={s.name}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>
          );
        }

        if (s.type === "media" && s.settings?.file) {
          return (
            <div key={s.id} style={style}>
              <video
                src={String(s.settings.file)}
                autoPlay
                loop={Boolean(s.settings?.loop ?? true)}
                muted
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>
          );
        }

        if (s.type === "text") {
          return (
            <div
              key={s.id}
              style={{
                ...style,
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
              }}
            >
              {String(s.settings?.text || s.name)}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};
