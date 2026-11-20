import React, { useEffect, useRef, useState } from "react";
import { Monitor, Video, Tv, Layers } from "lucide-react";
import type { NativeCaptureFrame, SceneSourceItem, SourceFilter, SourceTransform } from "../types";
import { isTauriRuntime, startNativeCaptureStream, stopNativeCaptureStream } from "../bridge";

export interface BroadcastSceneDefinition {
  id: string;
  name: string;
  sources: SceneSourceItem[];
}

interface ProgramCanvasRendererProps {
  sources: SceneSourceItem[];
  allScenes?: BroadcastSceneDefinition[];
  selectedSourceId?: string | null;
  onSelectSource?: (id: string | null) => void;
  onUpdateTransform?: (id: string, transform: SourceTransform) => void;
  compact?: boolean;
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

const DEFAULT_SLIDESHOW_CARDS: Array<{ title: string; subtitle: string; gradient: string; accent: string }> = [
  {
    title: "Welcome to Worship",
    subtitle: "Sunday Service • Live Broadcast",
    gradient: "linear-gradient(135deg, #0F172A 0%, #1E3A8A 55%, #312E81 100%)",
    accent: "#60A5FA",
  },
  {
    title: "Community Groups",
    subtitle: "Wednesdays at 7:00 PM • Fellowship Hall",
    gradient: "linear-gradient(135deg, #064E3B 0%, #0F766E 55%, #115E59 100%)",
    accent: "#34D399",
  },
  {
    title: "Next Steps & Prayer",
    subtitle: "Connect with our pastoral team after service",
    gradient: "linear-gradient(135deg, #3B0764 0%, #581C87 55%, #1E1B4B 100%)",
    accent: "#C084FC",
  },
];

/** Browser sources may only point at ordinary web pages — never file, script, or custom schemes. */
function isSafeHttpUrl(url: unknown): boolean {
  if (typeof url !== "string" || url.trim().length === 0) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = value >>> 0;
    const a = ((n >>> 24) & 0xff) / 255;
    const b = (n >>> 16) & 0xff;
    const g = (n >>> 8) & 0xff;
    const r = n & 0xff;
    if (a >= 0.999) {
      return `rgb(${r}, ${g}, ${b})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  return fallback;
}

function parseKeyColorRgb(keyColor: unknown): [number, number, number] {
  if (typeof keyColor !== "string" || !keyColor.trim()) {
    return [0, 255, 0];
  }
  const raw = keyColor.trim().toLowerCase();
  if (raw === "green") return [0, 255, 0];
  if (raw === "blue") return [0, 0, 255];
  if (raw === "magenta") return [255, 0, 255];
  if (raw === "red") return [255, 0, 0];
  if (raw === "cyan") return [0, 255, 255];

  const hex6 = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex6) {
    const num = parseInt(hex6[1], 16);
    return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
  }
  const hex3 = /^#([0-9a-f]{3})$/i.exec(raw);
  if (hex3) {
    const s = hex3[1];
    return [
      parseInt(s[0] + s[0], 16),
      parseInt(s[1] + s[1], 16),
      parseInt(s[2] + s[2], 16),
    ];
  }
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (rgbMatch) {
    return [
      Math.min(255, Number(rgbMatch[1])),
      Math.min(255, Number(rgbMatch[2])),
      Math.min(255, Number(rgbMatch[3])),
    ];
  }
  return [0, 255, 0];
}

function normalizeChromaThreshold(val: unknown, fallback: number): number {
  if (val === undefined || val === null || val === "") return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  if (n >= 1) return Math.min(1, Math.max(0, n / 1000));
  return Math.min(1, Math.max(0, n));
}

function applyChromaKeyToImageData(
  imageData: ImageData,
  keyRgb: [number, number, number],
  similarityRaw: unknown,
  smoothnessRaw: unknown
): void {
  const sim = normalizeChromaThreshold(similarityRaw, 0.4);
  const smooth = normalizeChromaThreshold(smoothnessRaw, 0.08);
  const krN = keyRgb[0] / 255;
  const kgN = keyRgb[1] / 255;
  const kbN = keyRgb[2] / 255;
  const keyY = 0.299 * krN + 0.587 * kgN + 0.114 * kbN;
  const keyCb = -0.168736 * krN - 0.331264 * kgN + 0.5 * kbN;
  const keyCr = 0.5 * krN - 0.418688 * kgN - 0.081312 * kbN;

  const data = imageData.data;
  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
    const dCb = cb - keyCb;
    const dCr = cr - keyCr;
    const dist = Math.sqrt(dCb * dCb + dCr * dCr) + 0.08 * Math.abs(y - keyY);

    if (dist <= sim) {
      data[i + 3] = 0;
    } else if (smooth > 0 && dist < sim + smooth) {
      const t = (dist - sim) / smooth;
      const smoothAlpha = t * t * (3 - 2 * t);
      data[i + 3] = Math.round(data[i + 3] * smoothAlpha);
    }
  }
}

function renderVideoChromaKeyFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  keyRgb: [number, number, number],
  similarity: unknown,
  smoothness: unknown
): "ok" | "skip" | "tainted" {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return "skip";
  }
  const scale = Math.min(1, 960 / video.videoWidth, 540 / video.videoHeight);
  const targetW = Math.max(2, Math.round(video.videoWidth * scale));
  const targetH = Math.max(2, Math.round(video.videoHeight * scale));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "skip";

  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(video, 0, 0, targetW, targetH);
  try {
    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    applyChromaKeyToImageData(imgData, keyRgb, similarity, smoothness);
    ctx.putImageData(imgData, 0, 0);
    return "ok";
  } catch (err) {
    if (err instanceof DOMException && err.name === "SecurityError") {
      return "tainted";
    }
    return "skip";
  }
}

function buildColorCorrectionFilter(filters?: SourceFilter[]): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  const parts: string[] = [];
  for (const f of filters) {
    if (!f.enabled || f.type !== "color_correction") continue;
    const s = f.settings || {};
    const brightness = Math.max(0, 1 + Number(s.brightness ?? 0) + Number(s.gamma ?? 0) * 0.25);
    const contrast = Math.max(0, 1 + Number(s.contrast ?? 0));
    const saturate = Math.max(0, 1 + Number(s.saturation ?? 0));
    const hue = Number(s.hue ?? s.hueShift ?? s.hue_shift ?? 0);
    parts.push(
      `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) hue-rotate(${Number.isFinite(hue) ? hue : 0}deg)`
    );
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function computeCropInsets(tr: SourceTransform, filters?: SourceFilter[]) {
  let cropLeft = Number(tr.cropLeft ?? 0) || 0;
  let cropRight = Number(tr.cropRight ?? 0) || 0;
  let cropTop = Number(tr.cropTop ?? 0) || 0;
  let cropBottom = Number(tr.cropBottom ?? 0) || 0;

  if (filters) {
    for (const f of filters) {
      if (!f.enabled || f.type !== "crop_pad") continue;
      const s = f.settings || {};
      cropLeft += Number(s.left ?? s.cropLeft ?? 0) || 0;
      cropRight += Number(s.right ?? s.cropRight ?? 0) || 0;
      cropTop += Number(s.top ?? s.cropTop ?? 0) || 0;
      cropBottom += Number(s.bottom ?? s.cropBottom ?? 0) || 0;
    }
  }

  cropLeft = Math.max(0, cropLeft);
  cropRight = Math.max(0, cropRight);
  cropTop = Math.max(0, cropTop);
  cropBottom = Math.max(0, cropBottom);

  const hasCrop = cropLeft > 0 || cropRight > 0 || cropTop > 0 || cropBottom > 0;
  const w = Math.max(1, tr.width);
  const h = Math.max(1, tr.height);
  const leftPct = Math.min(98, (cropLeft / w) * 100);
  const rightPct = Math.min(98 - leftPct, (cropRight / w) * 100);
  const topPct = Math.min(98, (cropTop / h) * 100);
  const bottomPct = Math.min(98 - topPct, (cropBottom / h) * 100);

  return {
    hasCrop,
    cropLeft,
    cropRight,
    cropTop,
    cropBottom,
    leftPct,
    rightPct,
    topPct,
    bottomPct,
    clipPath: hasCrop
      ? `inset(${topPct.toFixed(2)}% ${rightPct.toFixed(2)}% ${bottomPct.toFixed(2)}% ${leftPct.toFixed(2)}%)`
      : undefined,
  };
}

function resolveOpacity(tr: SourceTransform, source: SceneSourceItem): number {
  const raw =
    tr.opacity !== undefined
      ? tr.opacity
      : source.type === "color" && source.settings?.opacity !== undefined
      ? Number(source.settings.opacity)
      : 1;
  if (!Number.isFinite(raw)) return 1;
  const norm = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, norm));
}

const LiveCameraLayer: React.FC<{ source: SceneSourceItem; chromaKey?: SourceFilter }> = ({
  source,
  chromaKey,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  const keyColor = chromaKey?.settings?.keyColor ?? chromaKey?.settings?.key_color ?? "#00FF00";
  const similarity = chromaKey?.settings?.similarity;
  const smoothness = chromaKey?.settings?.smoothness;

  useEffect(() => {
    if (!chromaKey || error) return;
    let rafId = 0;
    let active = true;
    const keyRgb = parseKeyColorRgb(keyColor);

    const tick = () => {
      if (!active) return;
      if (videoRef.current && canvasRef.current) {
        renderVideoChromaKeyFrame(videoRef.current, canvasRef.current, keyRgb, similarity, smoothness);
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [chromaKey, error, keyColor, similarity, smoothness]);

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#94A3B8", fontSize: 12, gap: 6 }}>
        <Video size={28} color="#EF4444" />
        <span>{source.name}: {error}</span>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={
          chromaKey
            ? { position: "absolute", width: 2, height: 2, opacity: 0, pointerEvents: "none" }
            : { width: "100%", height: "100%", objectFit: "cover" }
        }
      />
      {chromaKey && (
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
        />
      )}
    </div>
  );
};

const ChromaKeyMediaLayer: React.FC<{
  src: string;
  loop: boolean;
  chromaKey: SourceFilter;
}> = ({ src, loop, chromaKey }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);

  const keyColor = chromaKey.settings?.keyColor ?? chromaKey.settings?.key_color ?? "#00FF00";
  const similarity = chromaKey.settings?.similarity;
  const smoothness = chromaKey.settings?.smoothness;

  useEffect(() => {
    setCorsBlocked(false);
  }, [src]);

  useEffect(() => {
    if (corsBlocked) return;
    let rafId = 0;
    let active = true;
    const keyRgb = parseKeyColorRgb(keyColor);

    const tick = () => {
      if (!active) return;
      if (videoRef.current && canvasRef.current) {
        const status = renderVideoChromaKeyFrame(
          videoRef.current,
          canvasRef.current,
          keyRgb,
          similarity,
          smoothness
        );
        if (status === "tainted") {
          setCorsBlocked(true);
          return;
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [src, corsBlocked, keyColor, similarity, smoothness]);

  if (corsBlocked) {
    return (
      <video
        src={src}
        autoPlay
        loop={loop}
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
      />
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <video
        ref={videoRef}
        src={src}
        crossOrigin="anonymous"
        autoPlay
        loop={loop}
        muted
        playsInline
        style={{ position: "absolute", width: 2, height: 2, opacity: 0, pointerEvents: "none" }}
      />
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
      />
    </div>
  );
};

const ChromaKeyImageLayer: React.FC<{
  src: string;
  alt: string;
  chromaKey: SourceFilter;
}> = ({ src, alt, chromaKey }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rawFrameRef = useRef<{ width: number; height: number; data: Uint8ClampedArray } | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);

  const keyColor = chromaKey.settings?.keyColor ?? chromaKey.settings?.key_color ?? "#00FF00";
  const similarity = chromaKey.settings?.similarity;
  const smoothness = chromaKey.settings?.smoothness;

  const paramsRef = useRef({ keyColor, similarity, smoothness });
  paramsRef.current = { keyColor, similarity, smoothness };

  useEffect(() => {
    let cancelled = false;
    setCorsBlocked(false);
    rawFrameRef.current = null;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
      const scale = Math.min(1, 1280 / img.naturalWidth, 720 / img.naturalHeight);
      const targetW = Math.max(2, Math.round(img.naturalWidth * scale));
      const targetH = Math.max(2, Math.round(img.naturalHeight * scale));
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);
      try {
        const raw = ctx.getImageData(0, 0, targetW, targetH);
        rawFrameRef.current = {
          width: targetW,
          height: targetH,
          data: new Uint8ClampedArray(raw.data),
        };
        const latest = paramsRef.current;
        const out = new ImageData(new Uint8ClampedArray(raw.data), targetW, targetH);
        applyChromaKeyToImageData(
          out,
          parseKeyColorRgb(latest.keyColor),
          latest.similarity,
          latest.smoothness
        );
        ctx.putImageData(out, 0, 0);
      } catch {
        setCorsBlocked(true);
      }
    };
    img.onerror = () => {
      if (!cancelled) setCorsBlocked(true);
    };
    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (corsBlocked) return;
    const raw = rawFrameRef.current;
    const canvas = canvasRef.current;
    if (!raw || !canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const rafId = window.requestAnimationFrame(() => {
      const out = new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height);
      applyChromaKeyToImageData(out, parseKeyColorRgb(keyColor), similarity, smoothness);
      ctx.putImageData(out, 0, 0);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [corsBlocked, keyColor, similarity, smoothness]);

  if (corsBlocked) {
    return (
      <img
        src={src}
        alt={alt}
        style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label={alt}
      style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
    />
  );
};

const ImageSlideShowLayer: React.FC<{ source: SceneSourceItem }> = ({ source }) => {
  const rawFiles = Array.isArray(source.settings?.files) ? source.settings.files : [];
  const slideItems =
    rawFiles.length > 0
      ? rawFiles.map((item, idx) => {
          if (typeof item === "string") {
            return { kind: "image" as const, src: item, key: `${idx}_${item}` };
          }
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const fileUrl = String(obj.file || obj.src || obj.url || "");
            if (fileUrl) {
              return { kind: "image" as const, src: fileUrl, key: `${idx}_${fileUrl}` };
            }
            return {
              kind: "card" as const,
              title: String(obj.title || source.name),
              subtitle: String(obj.subtitle || obj.text || ""),
              gradient: String(obj.bg || DEFAULT_SLIDESHOW_CARDS[idx % DEFAULT_SLIDESHOW_CARDS.length].gradient),
              accent: "#60A5FA",
              key: `${idx}_card`,
            };
          }
          return {
            kind: "card" as const,
            ...DEFAULT_SLIDESHOW_CARDS[idx % DEFAULT_SLIDESHOW_CARDS.length],
            key: `${idx}_default`,
          };
        })
      : DEFAULT_SLIDESHOW_CARDS.map((card, idx) => ({
          kind: "card" as const,
          ...card,
          key: `default_${idx}`,
        }));

  const intervalMs = Math.max(500, Number(source.settings?.slideTimeMs || 4000));
  const transitionMs = Math.max(0, Number(source.settings?.transitionTimeMs ?? 600));
  const loop = source.settings?.loop !== false;

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [source.id, slideItems.length]);

  useEffect(() => {
    if (slideItems.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => {
        const next = prev + 1;
        if (next >= slideItems.length) {
          return loop ? 0 : prev;
        }
        return next;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [slideItems.length, intervalMs, loop]);

  const safeIndex = slideItems.length > 0 ? activeIndex % slideItems.length : 0;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", pointerEvents: "none" }}>
      {slideItems.map((slide, idx) => {
        const isActive = idx === safeIndex;
        const transitionStyle: React.CSSProperties = {
          position: "absolute",
          inset: 0,
          opacity: isActive ? 1 : 0,
          transition: `opacity ${transitionMs}ms ease-in-out`,
          pointerEvents: "none",
        };

        if (slide.kind === "image") {
          return (
            <img
              key={slide.key}
              src={slide.src}
              alt={`${source.name} slide ${idx + 1}`}
              style={{ ...transitionStyle, width: "100%", height: "100%", objectFit: "contain" }}
            />
          );
        }

        return (
          <div
            key={slide.key}
            style={{
              ...transitionStyle,
              background: slide.gradient,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "8%",
              textAlign: "center",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: slide.accent,
                marginBottom: 10,
              }}
            >
              {source.name} • Slide {idx + 1}/{slideItems.length}
            </div>
            <div style={{ fontSize: 38, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.15 }}>
              {slide.title}
            </div>
            {slide.subtitle && (
              <div style={{ fontSize: 20, fontWeight: 500, color: "#CBD5E1", marginTop: 10 }}>
                {slide.subtitle}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Native capture frames — one shared store fed by the `capture://frame` event channel
// ---------------------------------------------------------------------------------------------

const nativeFrameUrls = new Map<string, string>();
const nativeFrameListeners = new Set<() => void>();

function notifyNativeFrameListeners() {
  nativeFrameListeners.forEach((listener) => listener());
}

function publishNativeFrame(frame: NativeCaptureFrame) {
  if (!frame || typeof frame.sourceId !== "string" || frame.sourceId.length === 0) return;
  if (typeof frame.base64Data !== "string" || frame.base64Data.length === 0) return;
  if (typeof frame.mimeType !== "string" || !/^[a-z][\w.+-]*\/[\w.+-]+$/i.test(frame.mimeType)) return;
  const url = `data:${frame.mimeType};base64,${frame.base64Data}`;
  if (nativeFrameUrls.get(frame.sourceId) === url) return;
  nativeFrameUrls.set(frame.sourceId, url);
  notifyNativeFrameListeners();
}

function clearNativeFrame(sourceId: string) {
  if (!nativeFrameUrls.delete(sourceId)) return;
  notifyNativeFrameListeners();
}

function useNativeFrameUrl(sourceId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    sourceId ? nativeFrameUrls.get(sourceId) ?? null : null
  );
  useEffect(() => {
    setUrl(sourceId ? nativeFrameUrls.get(sourceId) ?? null : null);
    if (!sourceId) return;
    const listener = () => {
      const next = nativeFrameUrls.get(sourceId) ?? null;
      setUrl((prev) => (prev === next ? prev : next));
    };
    nativeFrameListeners.add(listener);
    return () => {
      nativeFrameListeners.delete(listener);
    };
  }, [sourceId]);
  return url;
}

/** Best-effort global event subscription; browser preview and older runtimes simply stay idle. */
function useNativeCaptureFrameEvents() {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stop = await listen<NativeCaptureFrame>("capture://frame", (event) => {
          publishNativeFrame(event.payload);
        });
        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        // The event channel is optional: the explicit browser picker remains available.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

const nativeBadgeStyle: React.CSSProperties = {
  position: "absolute",
  top: 6,
  left: 6,
  padding: "2px 7px",
  borderRadius: 4,
  background: "rgba(6, 78, 59, 0.9)",
  border: "1px solid #10B981",
  color: "#A7F3D0",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.04em",
  pointerEvents: "none",
  zIndex: 30,
};

const LiveDisplayOrWindowLayer: React.FC<{ source: SceneSourceItem }> = ({ source }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isWindow = source.type === "window_capture";
  const kind: "window" | "display" = isWindow ? "window" : "display";
  const settings = source.settings ?? {};
  const rawTargetId = isWindow ? settings.nativeWindowId : settings.nativeDisplayId;
  const targetId = typeof rawTargetId === "number" ? rawTargetId : Number(rawTargetId);
  const hasNativeTarget = Number.isFinite(targetId) && targetId >= 0;
  const captureMethod = typeof settings.captureMethod === "string" ? settings.captureMethod : "native";
  const useNative = isTauriRuntime() && captureMethod !== "browser" && hasNativeTarget;
  const frameUrl = useNativeFrameUrl(useNative ? source.id : null);
  const fpsRaw = Number(settings.fps ?? 5);
  const fps = Number.isFinite(fpsRaw) ? Math.max(2, Math.min(15, fpsRaw)) : 5;

  useEffect(() => {
    if (!useNative) return;
    clearNativeFrame(source.id);
    let stopped = false;
    void startNativeCaptureStream(source.id, kind, targetId, fps)
      .then(() => {
        // If the source changed while startup was in flight, stop the late session too.
        if (stopped) void stopNativeCaptureStream(source.id).catch(() => {});
      })
      .catch(() => null);
    return () => {
      stopped = true;
      clearNativeFrame(source.id);
      void stopNativeCaptureStream(source.id).catch(() => {});
    };
  }, [source.id, useNative, kind, targetId, fps]);

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

  if (useNative) {
    const targetLabel = isWindow
      ? String(settings.windowTitle ?? settings.window ?? settings.appName ?? "")
      : String(settings.displayName ?? "");
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", background: "#05070B", overflow: "hidden" }}>
        {frameUrl ? (
          <img
            src={frameUrl}
            alt={`${source.name} native capture`}
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              padding: 16,
              textAlign: "center",
              color: "#CBD5E1",
            }}
          >
            <Monitor size={28} color="#34D399" />
            <div style={{ fontSize: 12, fontWeight: 700 }}>{source.name}</div>
            {targetLabel && <div style={{ fontSize: 11, color: "#94A3B8" }}>{targetLabel}</div>}
            <div style={{ fontSize: 10.5, color: "#6EE7B7" }}>Waiting for first native frame…</div>
          </div>
        )}
        <div style={nativeBadgeStyle}>Native · Zero-Popup</div>
      </div>
    );
  }

  if (!stream) {
    const targetLabel = isWindow
      ? String(settings.windowTitle ?? settings.window ?? "")
      : String(settings.displayName ?? "");
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#CBD5E1", gap: 10, background: "rgba(15, 23, 42, 0.75)" }}>
        <Monitor size={32} color="#60A5FA" />
        <div style={{ fontSize: 13, fontWeight: 700 }}>{source.name}</div>
        {targetLabel ? (
          <div style={{ fontSize: 11, color: "#94A3B8" }}>Target: {targetLabel}</div>
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

interface DragState {
  mode: "move" | "resize" | "crop";
  handle?: ResizeHandle;
  sourceId: string;
  startX: number;
  startY: number;
  initialTransform: SourceTransform;
}

interface SceneLayersRendererProps {
  sources: SceneSourceItem[];
  allScenes?: BroadcastSceneDefinition[];
  visitedSceneIds: Set<string>;
  interactive: boolean;
  selectedSourceId?: string | null;
  activeDragState?: DragState | null;
  onSelectSource?: (id: string | null) => void;
  onStartDrag?: (drag: DragState) => void;
}

function detectEdgeCropHandle(
  e: React.PointerEvent<HTMLDivElement>
): ResizeHandle | null {
  const rect = e.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const relX = (e.clientX - rect.left) / rect.width;
  const relY = (e.clientY - rect.top) / rect.height;
  const v = relY < 0.25 ? "n" : relY > 0.75 ? "s" : "";
  const h = relX < 0.25 ? "w" : relX > 0.75 ? "e" : "";
  const combined = `${v}${h}` as ResizeHandle | "";
  return combined || null;
}

const SceneLayersRenderer: React.FC<SceneLayersRendererProps> = ({
  sources,
  allScenes,
  visitedSceneIds,
  interactive,
  selectedSourceId,
  activeDragState,
  onSelectSource,
  onStartDrag,
}) => {
  const visibleSources = [...sources].filter((s) => s.enabled).reverse();

  return (
    <>
      {visibleSources.map((s) => {
        const tr: SourceTransform = { ...DEFAULT_TRANSFORM, ...s.transform };
        const isSelected = interactive && selectedSourceId === s.id;
        const chromaKeyFilter = s.filters?.find((f) => f.enabled && f.type === "chroma_key");
        const colorCorrectionCss = buildColorCorrectionFilter(s.filters);
        const crop = computeCropInsets(tr, s.filters);
        const opacity = resolveOpacity(tr, s);

        let content: React.ReactNode = null;
        if (s.type === "video_capture_device") {
          content = <LiveCameraLayer source={s} chromaKey={chromaKeyFilter} />;
        } else if (s.type === "window_capture" || s.type === "display_capture") {
          content = <LiveDisplayOrWindowLayer source={s} />;
        } else if (s.type === "browser") {
          content = isSafeHttpUrl(s.settings?.url) ? (
            <iframe
              src={String(s.settings.url)}
              title={s.name}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                textAlign: "center",
                background: "#111827",
                color: "#FCA5A5",
                border: "1px dashed #7F1D1D",
                boxSizing: "border-box",
                padding: 16,
              }}
            >
              <Monitor size={28} color="#FCA5A5" />
              <strong style={{ fontSize: 14 }}>Browser source unavailable</strong>
              <span style={{ fontSize: 12, color: "#CBD5E1" }}>
                A valid web address (http or https) is required for this source.
              </span>
            </div>
          );
        } else if (s.type === "color") {
          content = (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: resolveColor(s.settings?.colorHex ?? s.settings?.color, "#1E3A8A"),
              }}
            />
          );
        } else if (s.type === "image" && s.settings?.file) {
          const imgSrc = String(s.settings.file);
          content = chromaKeyFilter ? (
            <ChromaKeyImageLayer src={imgSrc} alt={s.name} chromaKey={chromaKeyFilter} />
          ) : (
            <img
              src={imgSrc}
              alt={s.name}
              style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
            />
          );
        } else if (s.type === "image_slide_show") {
          content = <ImageSlideShowLayer source={s} />;
        } else if (s.type === "media" && (s.settings?.file || s.settings?.localFile)) {
          const mediaSrc = String(s.settings?.file || s.settings?.localFile);
          const loop = Boolean(s.settings?.loop ?? true);
          content = chromaKeyFilter ? (
            <ChromaKeyMediaLayer src={mediaSrc} loop={loop} chromaKey={chromaKeyFilter} />
          ) : (
            <video
              src={mediaSrc}
              autoPlay
              loop={loop}
              muted
              playsInline
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
                color: resolveColor(s.settings?.colorHex ?? s.settings?.color, "#FFFFFF"),
                fontFamily: s.settings?.font ? String(s.settings.font) : undefined,
                fontSize: Number(s.settings?.fontSize ?? s.settings?.size ?? 36),
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
        } else if (s.type === "scene") {
          const targetId = s.settings?.sceneId ? String(s.settings.sceneId) : "";
          const targetName = s.settings?.sceneName ? String(s.settings.sceneName) : "";
          const referencedScene = allScenes?.find(
            (sc) =>
              (targetId && sc.id === targetId) ||
              (targetName && (sc.name === targetName || sc.id === targetName)) ||
              (!targetId && !targetName && sc.name === s.name)
          );

          if (referencedScene && visitedSceneIds.has(referencedScene.id)) {
            content = (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(15, 23, 42, 0.7)",
                  color: "#F87171",
                  fontSize: 12,
                  fontWeight: 700,
                  gap: 6,
                }}
              >
                <Layers size={16} />
                <span>Scene Cycle Detected ({referencedScene.name})</span>
              </div>
            );
          } else if (referencedScene && referencedScene.sources.some((child) => child.enabled)) {
            const nextVisited = new Set(visitedSceneIds);
            nextVisited.add(referencedScene.id);
            content = (
              <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", pointerEvents: "none" }}>
                <SceneLayersRenderer
                  sources={referencedScene.sources}
                  allScenes={allScenes}
                  visitedSceneIds={nextVisited}
                  interactive={false}
                />
              </div>
            );
          } else {
            content = (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(15, 23, 42, 0.45)",
                  border: "1px dashed #334155",
                  color: "#94A3B8",
                  fontSize: 12,
                  gap: 6,
                  boxSizing: "border-box",
                }}
              >
                <Layers size={22} color="#818CF8" />
                <span style={{ fontWeight: 700, color: "#CBD5E1" }}>
                  {referencedScene ? referencedScene.name : targetName || s.name}
                </span>
                <span style={{ fontSize: 10.5, color: "#64748B" }}>
                  {referencedScene ? "No active layers in nested scene" : "Nested scene not matched"}
                </span>
              </div>
            );
          }
        }

        if (!content) return null;

        const layerStyle: React.CSSProperties = {
          position: "absolute",
          left: `${(tr.x / 1920) * 100}%`,
          top: `${(tr.y / 1080) * 100}%`,
          width: `${(tr.width / 1920) * 100}%`,
          height: `${(tr.height / 1080) * 100}%`,
          mixBlendMode: (tr.blendingMode === "additive" ? "screen" : tr.blendingMode || "normal") as any,
          transform: tr.rotation ? `rotate(${tr.rotation}deg)` : undefined,
          opacity,
          cursor: interactive && !s.locked ? "move" : onSelectSource ? "pointer" : "default",
          outline: isSelected ? "2px solid #3B82F6" : undefined,
          outlineOffset: isSelected ? -1 : undefined,
          boxSizing: "border-box",
        };

        const flipTransform =
          tr.flipH || tr.flipV
            ? `scaleX(${tr.flipH ? -1 : 1}) scaleY(${tr.flipV ? -1 : 1})`
            : undefined;

        const isCroppingThis = activeDragState?.mode === "crop" && activeDragState.sourceId === s.id;

        return (
          <div
            key={s.id}
            style={layerStyle}
            onPointerDown={
              interactive || onSelectSource
                ? (e) => {
                    e.stopPropagation();
                    onSelectSource?.(s.id);
                    if (interactive && onStartDrag && !s.locked) {
                      const edgeHandle = e.altKey ? detectEdgeCropHandle(e) : null;
                      onStartDrag({
                        mode: edgeHandle ? "crop" : "move",
                        handle: edgeHandle || undefined,
                        sourceId: s.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        initialTransform: tr,
                      });
                    }
                  }
                : undefined
            }
          >
            {/* Outer clip + color filter wrapper */}
            <div
              style={{
                width: "100%",
                height: "100%",
                clipPath: crop.clipPath,
                filter: colorCorrectionCss,
                imageRendering: tr.scaleFilter === "point" ? "pixelated" : undefined,
              }}
            >
              {/* Inner flip wrapper so crop sides remain fixed in screen coordinates */}
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  transform: flipTransform,
                }}
              >
                {content}
              </div>
            </div>

            {/* Crop boundary visual indicator when selected and cropped */}
            {isSelected && crop.hasCrop && (
              <div
                style={{
                  position: "absolute",
                  top: `${crop.topPct}%`,
                  right: `${crop.rightPct}%`,
                  bottom: `${crop.bottomPct}%`,
                  left: `${crop.leftPct}%`,
                  border: "1.5px dashed #10B981",
                  pointerEvents: "none",
                  boxSizing: "border-box",
                }}
              />
            )}

            {/* Live crop telemetry pill while Alt-cropping */}
            {isCroppingThis && (
              <div
                style={{
                  position: "absolute",
                  top: 6,
                  left: 6,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "rgba(6, 78, 59, 0.9)",
                  border: "1px solid #10B981",
                  color: "#A7F3D0",
                  fontSize: 10.5,
                  fontWeight: 700,
                  pointerEvents: "none",
                  zIndex: 30,
                }}
              >
                Crop L:{Math.round(crop.cropLeft)} R:{Math.round(crop.cropRight)} T:{Math.round(crop.cropTop)} B:{Math.round(crop.cropBottom)}
              </div>
            )}

            {isSelected &&
              HANDLE_POSITIONS.map((h) => {
                const isCroppedEdge =
                  (h.id.includes("w") && crop.cropLeft > 0) ||
                  (h.id.includes("e") && crop.cropRight > 0) ||
                  (h.id.includes("n") && crop.cropTop > 0) ||
                  (h.id.includes("s") && crop.cropBottom > 0);
                return (
                  <div
                    key={h.id}
                    title="Drag to resize • Hold Alt + drag to crop edge"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (interactive && onStartDrag && !s.locked) {
                        onStartDrag({
                          mode: e.altKey ? "crop" : "resize",
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
                      background: isCroppedEdge ? "#10B981" : "#3B82F6",
                      border: "1.5px solid #FFFFFF",
                      borderRadius: 2,
                      cursor: h.cursor,
                      zIndex: 20,
                      ...h.style,
                    }}
                  />
                );
              })}
          </div>
        );
      })}
    </>
  );
};

export const ProgramCanvasRenderer: React.FC<ProgramCanvasRendererProps> = ({
  sources,
  allScenes,
  selectedSourceId,
  onSelectSource,
  onUpdateTransform,
  compact = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useNativeCaptureFrameEvents();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });

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
        let nextX = Math.round(init.x + dxCanvas);
        let nextY = Math.round(init.y + dyCanvas);
        const centerX = nextX + init.width / 2;
        const centerY = nextY + init.height / 2;
        const snapX = Math.abs(centerX - 960) <= 24;
        const snapY = Math.abs(centerY - 540) <= 24;

        if (snapX) {
          nextX = Math.round(960 - init.width / 2);
        }
        if (snapY) {
          nextY = Math.round(540 - init.height / 2);
        }

        setSnapGuides((prev) =>
          prev.x === snapX && prev.y === snapY ? prev : { x: snapX, y: snapY }
        );

        onUpdateTransform(dragState.sourceId, {
          ...init,
          x: nextX,
          y: nextY,
        });
        return;
      }

      setSnapGuides((prev) => (prev.x || prev.y ? { x: false, y: false } : prev));
      const handle = dragState.handle!;

      // Alt-drag edge cropping
      if (dragState.mode === "crop" || (dragState.mode === "resize" && e.altKey)) {
        const minVisible = 40;
        let nextCropL = init.cropLeft || 0;
        let nextCropR = init.cropRight || 0;
        let nextCropT = init.cropTop || 0;
        let nextCropB = init.cropBottom || 0;

        if (handle.includes("w")) {
          const maxL = Math.max(0, init.width - nextCropR - minVisible);
          nextCropL = Math.round(Math.max(0, Math.min(maxL, (init.cropLeft || 0) + dxCanvas)));
        }
        if (handle.includes("e")) {
          const maxR = Math.max(0, init.width - nextCropL - minVisible);
          nextCropR = Math.round(Math.max(0, Math.min(maxR, (init.cropRight || 0) - dxCanvas)));
        }
        if (handle.includes("n")) {
          const maxT = Math.max(0, init.height - nextCropB - minVisible);
          nextCropT = Math.round(Math.max(0, Math.min(maxT, (init.cropTop || 0) + dyCanvas)));
        }
        if (handle.includes("s")) {
          const maxB = Math.max(0, init.height - nextCropT - minVisible);
          nextCropB = Math.round(Math.max(0, Math.min(maxB, (init.cropBottom || 0) - dyCanvas)));
        }

        onUpdateTransform(dragState.sourceId, {
          ...init,
          cropLeft: nextCropL,
          cropRight: nextCropR,
          cropTop: nextCropT,
          cropBottom: nextCropB,
        });
        return;
      }

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
      setSnapGuides({ x: false, y: false });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, onUpdateTransform]);

  if (sources.length === 0) {
    if (compact) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#05070B",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#334155",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Standby
        </div>
      );
    }
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
      <SceneLayersRenderer
        sources={sources}
        allScenes={allScenes}
        visitedSceneIds={new Set()}
        interactive={Boolean(onUpdateTransform)}
        selectedSourceId={selectedSourceId}
        activeDragState={dragState}
        onSelectSource={onSelectSource}
        onStartDrag={setDragState}
      />

      {/* Alignment Center-Snap Guides */}
      {snapGuides.x && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 0,
            borderLeft: "1.5px dashed #EC4899",
            boxShadow: "0 0 8px rgba(236, 72, 153, 0.75)",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      )}
      {snapGuides.y && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: 0,
            borderTop: "1.5px dashed #22D3EE",
            boxShadow: "0 0 8px rgba(34, 211, 238, 0.75)",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      )}
      {(snapGuides.x || snapGuides.y) && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 8,
            height: 8,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: snapGuides.x && snapGuides.y ? "#F0ABFC" : snapGuides.x ? "#EC4899" : "#22D3EE",
            boxShadow: "0 0 10px rgba(255, 255, 255, 0.85)",
            pointerEvents: "none",
            zIndex: 51,
          }}
        />
      )}
    </div>
  );
};
