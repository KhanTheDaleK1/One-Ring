import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Radio,
  Send,
  Settings,
  Users,
  X,
} from "lucide-react";
import {
  configureAudienceRelay,
  DEFAULT_AUDIENCE_RELAY_CONFIG,
  getAudienceChatHistory,
  getStreamStats,
  isTrustedSyncPayload,
  pinAudienceMessage,
  sendAudienceMessage,
  stampSyncPayload,
} from "../bridge";
import type {
  AudienceChatMessage,
  AudienceChatRole,
  AudienceRelayConfig,
  StreamStatsSnapshot,
} from "../types";

const STATS_EVENT = "broadcast://stats";
const CHAT_EVENT = "audience://chat";
const VIEWERS_EVENT = "audience://viewers";
const SYNC_CHANNEL = "onering_display_sync";
const OVERLAY_STORAGE_KEY = "onering_audience_overlay";
const RELAY_STORAGE_KEY = "onering_audience_relay_config";
const SPARK_SAMPLES = 30;
const MAX_MESSAGES = 200;

const CANNED_ANNOUNCEMENTS = [
  "Welcome to Today's Service!",
  "Need prayer? Drop your request in chat.",
  "Next service starts at 11:00 AM",
  "Connect with us using the link in the description",
];

interface ViewerEventPayload {
  viewerCount?: number;
  peakViewers?: number;
}

/** An operator action that affects the live stream and needs one explicit confirmation. */
interface PendingLiveAction {
  kind: "pin" | "unpin" | "announcement";
  id?: string;
  text?: string;
  author?: string;
  isPinned?: boolean;
}

interface StreamAudienceDockProps {
  /** `docked` renders the full panel; `compact` renders a pill with a pop-out drawer. */
  variant?: "docked" | "compact";
  /** Optional hint from the host view so the badge reacts before telemetry arrives. */
  liveHint?: boolean;
}

const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const formatElapsed = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = secs.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const formatMessageTime = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return "--:--";
  const date = new Date(ms);
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
};

const normalizeRole = (role: string): AudienceChatRole => {
  const value = (role || "").trim().toUpperCase();
  if (value === "HOST" || value === "MOD" || value === "VIEWER") return value;
  if (value === "MODERATOR") return "MOD";
  return "VIEWER";
};

const roleColor = (role: AudienceChatRole): string =>
  role === "HOST" ? "#FBBF24" : role === "MOD" ? "#A78BFA" : "#60A5FA";

/** Persist only non-secret relay settings; the auth token stays in memory / native storage. */
function persistRelayConfig(config: AudienceRelayConfig): void {
  const { authToken: _secret, ...persisted } = config;
  localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify(persisted));
}

function loadRelayConfig(): AudienceRelayConfig {
  try {
    const raw = localStorage.getItem(RELAY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudienceRelayConfig>;
      if (parsed && typeof parsed === "object") {
        const mode =
          parsed.mode === "webhook" || parsed.mode === "irc" || parsed.mode === "websocket"
            ? parsed.mode
            : DEFAULT_AUDIENCE_RELAY_CONFIG.mode;
        const config: AudienceRelayConfig = {
          enabled: Boolean(parsed.enabled),
          mode,
          endpointUrl: typeof parsed.endpointUrl === "string" ? parsed.endpointUrl : "",
          authToken: "",
          channelName: typeof parsed.channelName === "string" ? parsed.channelName : "",
          hostDisplayName:
            typeof parsed.hostDisplayName === "string" ? parsed.hostDisplayName : "Host",
          statsWebhookUrl:
            typeof parsed.statsWebhookUrl === "string" ? parsed.statsWebhookUrl : "",
        };
        if (typeof parsed.authToken === "string") {
          // Migrate an older entry that captured a token: rewrite it without the secret.
          persistRelayConfig(config);
        }
        return config;
      }
    }
  } catch {
    // corrupted local configuration falls back to neutral defaults
  }
  return { ...DEFAULT_AUDIENCE_RELAY_CONFIG };
}

function parseMessage(value: unknown): AudienceChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AudienceChatMessage>;
  if (typeof raw.id !== "string" || typeof raw.text !== "string") return null;
  return {
    id: raw.id,
    author: typeof raw.author === "string" ? raw.author : "Guest",
    role: normalizeRole(typeof raw.role === "string" ? raw.role : "VIEWER"),
    text: raw.text,
    channel: typeof raw.channel === "string" ? raw.channel : "Program",
    timestampMs: typeof raw.timestampMs === "number" ? raw.timestampMs : Date.now(),
    pinnedOnAir: Boolean(raw.pinnedOnAir),
  };
}

function BitrateSparkline({ samples }: { samples: number[] }) {
  const width = 118;
  const height = 30;
  if (samples.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Bitrate trend awaiting samples"
      >
        <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke="#263145" strokeWidth={1} />
      </svg>
    );
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = Math.max(1, max - min);
  const points = samples
    .map((value, index) => {
      const x = samples.length === 1 ? 0 : (index / (samples.length - 1)) * width;
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Recent bitrate samples"
    >
      <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke="#263145" strokeWidth={1} />
      <polygon points={area} fill="rgba(59,130,246,0.16)" />
      <polyline
        points={points}
        fill="none"
        stroke="#60A5FA"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const StreamAudienceDock: React.FC<StreamAudienceDockProps> = ({
  variant = "docked",
  liveHint,
}) => {
  const [stats, setStats] = useState<StreamStatsSnapshot | null>(null);
  const [bitrateSamples, setBitrateSamples] = useState<number[]>([]);
  const [messages, setMessages] = useState<AudienceChatMessage[]>([]);
  const [viewers, setViewers] = useState({ count: 0, peak: 0 });
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sendToCaption, setSendToCaption] = useState(false);
  const [config, setConfig] = useState<AudienceRelayConfig>(() => loadRelayConfig());
  const [configOpen, setConfigOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingLiveAction, setPendingLiveAction] = useState<PendingLiveAction | null>(null);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const liveRef = useRef<boolean>(Boolean(liveHint));
  const feedRef = useRef<HTMLDivElement | null>(null);

  const upsertMessage = useCallback((incoming: AudienceChatMessage) => {
    setMessages((previous) => {
      const index = previous.findIndex((item) => item.id === incoming.id);
      if (index >= 0) {
        const next = [...previous];
        next[index] = { ...next[index], ...incoming };
        return next;
      }
      return [...previous, incoming].slice(-MAX_MESSAGES);
    });
    if (incoming.pinnedOnAir) setPinnedId(incoming.id);
  }, []);

  const applyStats = useCallback(
    (snapshot: StreamStatsSnapshot) => {
      if (!snapshot || typeof snapshot !== "object") return;
      setStats(snapshot);
      liveRef.current = Boolean(snapshot.live) || Boolean(liveHint);
      setBitrateSamples((previous) =>
        [...previous, Number(snapshot.bitrateKbps) || 0].slice(-SPARK_SAMPLES)
      );
      const count = Number(snapshot.viewerCount) || 0;
      const peak = Number(snapshot.peakViewers) || 0;
      setViewers((previous) => ({
        count,
        peak: Math.max(previous.peak, peak, count),
      }));
    },
    [liveHint]
  );

  // Poll live encoder telemetry every 1.5s while on air (one hydration fetch while idle).
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const snapshot = await getStreamStats();
        if (active) applyStats(snapshot);
      } catch {
        // backend may be starting up; the next tick retries while live
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (liveRef.current) void refresh();
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [applyStats]);

  // Hydrate chat history and restore a previously pinned overlay.
  useEffect(() => {
    let active = true;
    getAudienceChatHistory()
      .then((history) => {
        if (!active || !Array.isArray(history)) return;
        setMessages(history.slice(-MAX_MESSAGES));
        const pinned = history.find((message) => message.pinnedOnAir);
        if (pinned) setPinnedId(pinned.id);
      })
      .catch(() => {});
    try {
      const stored = localStorage.getItem(OVERLAY_STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        const candidate = isTrustedSyncPayload(parsed, "AUDIENCE_OVERLAY")
          ? (parsed as { message?: unknown }).message
          : parsed;
        const restored = parseMessage(candidate);
        if (restored) setPinnedId(restored.id);
      }
    } catch {
      // no persisted overlay to restore
    }
    return () => {
      active = false;
    };
  }, []);

  // Native backend pushes for stats, chat and viewer counts.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisteners: Array<() => void> = [];

    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        if (disposed) return;
        const subscriptions = await Promise.all([
          listen<StreamStatsSnapshot>(STATS_EVENT, (event) => {
            if (!disposed) applyStats(event.payload);
          }),
          listen<unknown>(CHAT_EVENT, (event) => {
            if (disposed) return;
            const payload = event.payload as { message?: unknown } | null;
            const candidate =
              payload && typeof payload === "object" && "message" in payload
                ? payload.message
                : payload;
            const parsed = parseMessage(candidate);
            if (parsed) upsertMessage(parsed);
          }),
          listen<ViewerEventPayload>(VIEWERS_EVENT, (event) => {
            if (disposed) return;
            const payload = event.payload || {};
            setViewers((previous) => ({
              count:
                typeof payload.viewerCount === "number"
                  ? payload.viewerCount
                  : previous.count,
              peak: Math.max(
                previous.peak,
                typeof payload.peakViewers === "number" ? payload.peakViewers : 0
              ),
            }));
          }),
        ]);
        if (disposed) subscriptions.forEach((unlisten) => unlisten());
        else unlisteners = subscriptions;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [applyStats, upsertMessage]);

  // Cross-window overlay sync channel.
  useEffect(() => {
    try {
      channelRef.current = new BroadcastChannel(SYNC_CHANNEL);
    } catch {
      channelRef.current = null;
    }
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const element = feedRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!modalOpen && !pendingLiveAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingLiveAction) {
        setPendingLiveAction(null);
        return;
      }
      if (modalOpen) setModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, pendingLiveAction]);

  const publishOverlay = useCallback((message: AudienceChatMessage | null) => {
    const payload = stampSyncPayload({ type: "AUDIENCE_OVERLAY", message });
    try {
      channelRef.current?.postMessage(payload);
    } catch {
      // cross-window transport is optional
    }
    try {
      localStorage.setItem(OVERLAY_STORAGE_KEY, message ? JSON.stringify(payload) : "");
    } catch {
      // storage may be unavailable in a constrained webview
    }
  }, []);

  const handleTogglePin = useCallback(
    async (message: AudienceChatMessage) => {
      const isPinned = pinnedId === message.id || message.pinnedOnAir;
      setBusy(true);
      try {
        const result = await pinAudienceMessage(isPinned ? null : message.id);
        const nextMessage: AudienceChatMessage | null = isPinned
          ? null
          : result ?? { ...message, pinnedOnAir: true };
        setMessages((previous) =>
          previous.map((item) => ({
            ...item,
            pinnedOnAir: nextMessage?.id === item.id,
          }))
        );
        setPinnedId(nextMessage?.id ?? null);
        publishOverlay(nextMessage);
        setStatus(nextMessage ? `On air: ${nextMessage.author}` : "On-air overlay hidden");
      } catch {
        setStatus("Could not update the on-air overlay");
      } finally {
        setBusy(false);
      }
    },
    [pinnedId, publishOverlay]
  );

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? draft).trim();
      if (!text || busy) return;
      setBusy(true);
      try {
        const message = await sendAudienceMessage(text, sendToCaption);
        upsertMessage(message);
        if (overrideText === undefined) setDraft("");
        setStatus(sendToCaption ? "Message sent with closed caption" : "Message sent");
      } catch {
        setStatus("Could not send audience message");
      } finally {
        setBusy(false);
      }
    },
    [busy, draft, sendToCaption, upsertMessage]
  );

  const confirmPendingLiveAction = useCallback(() => {
    const action = pendingLiveAction;
    if (!action || busy) return;
    setPendingLiveAction(null);
    if (action.kind === "announcement") {
      void handleSend(action.text ?? "");
      return;
    }
    const message = messages.find((item) => item.id === action.id);
    if (!message) {
      setStatus("That message is no longer available");
      return;
    }
    const currentlyPinned = pinnedId === message.id || message.pinnedOnAir;
    if (currentlyPinned !== (action.kind === "unpin")) {
      setStatus("The lower-third changed — review the action again");
      return;
    }
    void handleTogglePin(message);
  }, [busy, handleSend, handleTogglePin, messages, pendingLiveAction, pinnedId]);

  const handleSaveRelay = useCallback(async () => {
    setBusy(true);
    try {
      const result = await configureAudienceRelay(config);
      try {
        persistRelayConfig(config);
      } catch {
        // configuration still applies to this session
      }
      setStatus(result || "Audience relay configuration saved");
    } catch {
      setStatus("Could not save audience relay configuration");
    } finally {
      setBusy(false);
    }
  }, [config]);

  const patchConfig = useCallback((patch: Partial<AudienceRelayConfig>) => {
    setConfig((previous) => ({ ...previous, ...patch }));
  }, []);

  const live = Boolean(stats?.live) || Boolean(liveHint);
  const congestion = Math.max(0, Number(stats?.congestion) || 0);
  const healthLabel = congestion < 0.2 ? "GOOD" : congestion < 0.5 ? "FAIR" : "POOR";
  const healthColor = congestion < 0.2 ? "#34D399" : congestion < 0.5 ? "#FBBF24" : "#F87171";
  const droppedPct = Number(stats?.droppedPct) || 0;
  const pinnedMessage = useMemo(
    () => messages.find((message) => message.id === pinnedId) ?? null,
    [messages, pinnedId]
  );

  const telemetryStrip = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 9,
        background: "linear-gradient(135deg, #101723 0%, #0B0E14 100%)",
        border: `1px solid ${live ? "#7F1D1D" : "#1E2533"}`,
      }}
    >
      <div style={{ display: "grid", alignContent: "center", gap: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#64748B" }}>
          STREAM
        </span>
        <span
          className="mono"
          style={{
            justifySelf: "start",
            fontSize: 11,
            fontWeight: 800,
            padding: "3px 9px",
            borderRadius: 999,
            color: live ? "#FCA5A5" : "#94A3B8",
            background: live ? "rgba(239,68,68,0.18)" : "#1C222D",
            border: `1px solid ${live ? "#EF4444" : "#334155"}`,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {live ? <Radio size={11} /> : <Activity size={11} />}
          {live ? "LIVE" : "STANDBY"}
        </span>
        {stats?.recording && (
          <span className="mono" style={{ fontSize: 9, color: "#FBBF24", fontWeight: 700 }}>
            ● REC
          </span>
        )}
      </div>

      <div style={{ display: "grid", alignContent: "center", gap: 2 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#64748B" }}>
          BITRATE (kbps)
        </span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: "#E2E8F0" }}>
          {Math.round(stats?.bitrateKbps || 0).toLocaleString()}
        </span>
        <BitrateSparkline samples={bitrateSamples} />
      </div>

      <div style={{ display: "grid", alignContent: "center", gap: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#64748B" }}>
          FRAME RATE
        </span>
        <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: "#E2E8F0" }}>
          {Math.round(stats?.fps || 0)}
          <span style={{ fontSize: 10, color: "#64748B", marginLeft: 3 }}>fps</span>
        </span>
        <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>
          {stats?.source || "No source"}
        </span>
      </div>

      <div style={{ display: "grid", alignContent: "center", gap: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#64748B" }}>
          DROPPED FRAMES
        </span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: droppedPct > 1 ? "#FCA5A5" : "#E2E8F0" }}>
          {Math.round(stats?.droppedFrames || 0)}
          <span style={{ fontSize: 10, color: "#64748B", marginLeft: 4 }}>
            / {Math.round(stats?.totalFrames || 0).toLocaleString()}
          </span>
        </span>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: droppedPct > 1 ? "#F87171" : "#94A3B8" }}>
          {droppedPct.toFixed(2)}% dropped
        </span>
      </div>

      <div style={{ display: "grid", alignContent: "center", gap: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#64748B" }}>
          CONGESTION
        </span>
        <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: healthColor, display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: healthColor,
              boxShadow: `0 0 8px ${healthColor}`,
              flexShrink: 0,
            }}
          />
          {healthLabel}
        </span>
        <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>
          {congestion.toFixed(2)} load
        </span>
      </div>

      <div style={{ display: "grid", alignContent: "center", gap: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#64748B" }}>
          CPU / RENDER
        </span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: "#E2E8F0" }}>
          {Math.round(stats?.cpuUsagePct || 0)}
          <span style={{ fontSize: 10, color: "#64748B", marginLeft: 2 }}>% CPU</span>
        </span>
        <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>
          {(stats?.renderFrameTimeMs || 0).toFixed(1)} ms/frame
        </span>
      </div>

      <div style={{ display: "grid", alignContent: "center", gap: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#64748B" }}>
          ON AIR TIME
        </span>
        <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: live ? "#FCA5A5" : "#94A3B8" }}>
          {formatElapsed(stats?.elapsedSec || 0)}
        </span>
        <span className="mono" style={{ fontSize: 9, color: "#475569" }}>
          {Math.round((stats?.bytesSent || 0) / 1048576)} MB sent
        </span>
      </div>

      <div style={{ display: "grid", alignContent: "center", gap: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#64748B" }}>
          AUDIENCE
        </span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: "#6EE7B7", display: "flex", alignItems: "center", gap: 5 }}>
          <Users size={13} /> {viewers.count.toLocaleString()}
        </span>
        <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>
          Peak {viewers.peak.toLocaleString()}
        </span>
      </div>
    </div>
  );

  const chatPanel = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "#0D1117",
        border: "1px solid #1E2533",
        borderRadius: 9,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "9px 12px",
          borderBottom: "1px solid #1E2533",
          background: "#121722",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 800, color: "#E2E8F0" }}>
          <MessageSquare size={14} color="#60A5FA" /> LIVE AUDIENCE CHAT &amp; ANNOUNCEMENTS
        </span>
        <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>
          {messages.length} messages • {live ? "receiving" : "idle"}
        </span>
      </div>

      <div
        ref={feedRef}
        style={{
          flex: 1,
          minHeight: 190,
          maxHeight: 320,
          overflowY: "auto",
          padding: "8px 10px",
          display: "grid",
          alignContent: "start",
          gap: 6,
        }}
      >
        {messages.length === 0 && (
          <div style={{ padding: "20px 12px", textAlign: "center", color: "#475569", fontSize: 11.5 }}>
            No audience messages yet. Chat relayed here will appear live.
          </div>
        )}
        {messages.map((message) => {
          const isPinned = pinnedId === message.id || message.pinnedOnAir;
          return (
            <div
              key={message.id}
              style={{
                padding: "7px 9px",
                borderRadius: 7,
                background: isPinned ? "rgba(59,130,246,0.14)" : "#151B25",
                border: `1px solid ${isPinned ? "#3B82F6" : "#232C3A"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    padding: "1px 6px",
                    borderRadius: 4,
                    color: roleColor(message.role),
                    background: "#0B0E14",
                    border: `1px solid ${roleColor(message.role)}66`,
                  }}
                >
                  {message.role}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#E2E8F0" }}>
                  {message.author}
                </span>
                <span className="mono" style={{ fontSize: 9, color: "#60A5FA" }}>
                  #{message.channel}
                </span>
                <span className="mono" style={{ fontSize: 9, color: "#64748B", marginLeft: "auto" }}>
                  {formatMessageTime(message.timestampMs)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.45, marginTop: 4, whiteSpace: "pre-wrap" }}>
                {message.text}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setPendingLiveAction({
                    kind: isPinned ? "unpin" : "pin",
                    id: message.id,
                    text: message.text,
                    author: message.author,
                    isPinned,
                  })
                }
                style={{
                  marginTop: 6,
                  height: 24,
                  padding: "0 9px",
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.6 : 1,
                  color: isPinned ? "#FCA5A5" : "#BFDBFE",
                  background: isPinned ? "rgba(239,68,68,0.14)" : "rgba(59,130,246,0.16)",
                  border: `1px solid ${isPinned ? "#EF4444" : "#3B82F6"}`,
                }}
              >
                {isPinned ? "Hide Overlay" : "Show on Lower-Third"}
              </button>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
        style={{
          padding: "9px 10px",
          borderTop: "1px solid #1E2533",
          background: "#0B0E14",
          display: "grid",
          gap: 7,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            aria-label="Operator audience message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write an announcement to the audience…"
            style={{
              flex: 1,
              minWidth: 0,
              height: 32,
              padding: "0 9px",
              borderRadius: 6,
              border: "1px solid #283344",
              background: "#121722",
              color: "#E5E7EB",
              fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            style={{
              height: 32,
              padding: "0 11px",
              borderRadius: 6,
              border: "1px solid #3B82F6",
              background: "#2563EB",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 800,
              cursor: busy || !draft.trim() ? "not-allowed" : "pointer",
              opacity: busy || !draft.trim() ? 0.55 : 1,
            }}
          >
            <Send size={12} /> Send
          </button>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10.5,
            color: "#94A3B8",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={sendToCaption}
            onChange={(event) => setSendToCaption(event.target.checked)}
            aria-label="Also send as Closed Caption (CC)"
          />
          Also send as Closed Caption (CC)
        </label>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {CANNED_ANNOUNCEMENTS.map((announcement) => (
            <button
              key={announcement}
              type="button"
              disabled={busy}
              onClick={() =>
                setPendingLiveAction({ kind: "announcement", text: announcement })
              }
              title={announcement}
              style={{
                minHeight: 25,
                padding: "4px 9px",
                borderRadius: 999,
                border: "1px solid #334155",
                background: "#161B24",
                color: "#CBD5E1",
                fontSize: 9.5,
                fontWeight: 700,
                lineHeight: 1.3,
                textAlign: "left",
                whiteSpace: "normal",
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {announcement}
            </button>
          ))}
        </div>
      </form>
    </div>
  );

  const relayDrawer = (
    <div
      style={{
        background: "#0D1117",
        border: "1px solid #1E2533",
        borderRadius: 9,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setConfigOpen((open) => !open)}
        aria-expanded={configOpen}
        style={{
          width: "100%",
          height: 38,
          padding: "0 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          border: "none",
          background: "#121722",
          color: "#E2E8F0",
          cursor: "pointer",
          fontSize: 11.5,
          fontWeight: 800,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Settings size={14} color="#A78BFA" /> CHAT &amp; STATS RELAY CONFIG
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className="mono" style={{ fontSize: 9, color: config.enabled ? "#34D399" : "#64748B" }}>
            {config.enabled ? "ENABLED" : "DISABLED"}
          </span>
          {configOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {configOpen && (
        <div style={{ padding: 12, display: "grid", gap: 9 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 3, fontSize: 10, color: "#94A3B8" }}>
              MODE
              <select
                aria-label="Relay mode"
                value={config.mode}
                onChange={(event) =>
                  patchConfig({ mode: event.target.value as AudienceRelayConfig["mode"] })
                }
                style={{
                  height: 30,
                  padding: "0 7px",
                  borderRadius: 6,
                  border: "1px solid #283344",
                  background: "#121722",
                  color: "#E5E7EB",
                  fontSize: 11,
                }}
              >
                <option value="websocket">websocket</option>
                <option value="webhook">webhook</option>
                <option value="irc">irc</option>
              </select>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 6,
                paddingBottom: 6,
                fontSize: 10.5,
                color: "#CBD5E1",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) => patchConfig({ enabled: event.target.checked })}
                aria-label="Enable audience relay"
              />
              Enable relay
            </label>
          </div>

          {(
            [
              ["endpointUrl", "ENDPOINT URL", "Relay endpoint"],
              ["authToken", "AUTH TOKEN", "Access token"],
              ["channelName", "CHANNEL / ROOM", "Room name"],
              ["hostDisplayName", "HOST DISPLAY NAME", "Host"],
              ["statsWebhookUrl", "VIEWER STATS JSON URL (OPTIONAL)", "Optional statistics URL"],
            ] as Array<[keyof AudienceRelayConfig, string, string]>
          ).map(([field, label, placeholder]) => (
            <label key={field} style={{ display: "grid", gap: 3, fontSize: 10, color: "#94A3B8" }}>
              {label}
              <input
                type={field === "authToken" ? "password" : "text"}
                aria-label={label}
                value={config[field] as string}
                onChange={(event) => patchConfig({ [field]: event.target.value })}
                placeholder={placeholder}
                autoComplete="off"
                style={{
                  height: 30,
                  padding: "0 8px",
                  borderRadius: 6,
                  border: "1px solid #283344",
                  background: "#121722",
                  color: "#E5E7EB",
                  fontSize: 11,
                }}
              />
            </label>
          ))}

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSaveRelay()}
            style={{
              height: 32,
              marginTop: 2,
              borderRadius: 6,
              border: "1px solid #8B5CF6",
              background: "#6D28D9",
              color: "#FFFFFF",
              fontSize: 11,
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Save Relay Configuration
          </button>
        </div>
      )}
    </div>
  );

  const overlayStatusCard = (
    <div
      style={{
        background: pinnedMessage ? "rgba(59,130,246,0.10)" : "#0D1117",
        border: `1px solid ${pinnedMessage ? "#3B82F6" : "#1E2533"}`,
        borderRadius: 9,
        padding: "10px 12px",
        display: "grid",
        gap: 6,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: "#94A3B8" }}>
        ON-AIR LOWER-THIRD
      </span>
      {pinnedMessage ? (
        <>
          <div style={{ fontSize: 11.5, color: "#E2E8F0", lineHeight: 1.4 }}>
            <strong style={{ color: roleColor(pinnedMessage.role) }}>{pinnedMessage.author}:</strong>{" "}
            {pinnedMessage.text}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setPendingLiveAction({
                kind: "unpin",
                id: pinnedMessage.id,
                text: pinnedMessage.text,
                author: pinnedMessage.author,
                isPinned: true,
              })
            }
            style={{
              height: 27,
              borderRadius: 5,
              border: "1px solid #EF4444",
              background: "rgba(239,68,68,0.14)",
              color: "#FCA5A5",
              fontSize: 10,
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Hide Overlay
          </button>
        </>
      ) : (
        <span style={{ fontSize: 11, color: "#64748B" }}>
          Nothing pinned — use “Show on Lower-Third” on any message.
        </span>
      )}
    </div>
  );

  const fullDock = (
    <div
      className="card"
      style={{ padding: 14, display: "grid", gap: 11, minWidth: 0 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={16} color={live ? "#F87171" : "#60A5FA"} />
          <strong style={{ fontSize: 13, color: "#F3F4F6" }}>
            LIVE STREAM TELEMETRY &amp; AUDIENCE
          </strong>
          <span className="mono" style={{ fontSize: 9.5, color: "#64748B" }}>
            {stats?.updatedAtMs ? `updated ${formatMessageTime(stats.updatedAtMs)}` : "awaiting telemetry"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          style={{
            height: 26,
            padding: "0 9px",
            display: "flex",
            alignItems: "center",
            gap: 5,
            borderRadius: 5,
            border: "1px solid #334155",
            background: "#161B24",
            color: "#CBD5E1",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {pendingLiveAction && (
        <div
          role="alertdialog"
          aria-label="Confirm live action"
          style={{
            display: "grid",
            gap: 7,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #F59E0B",
            background: "rgba(245,158,11,0.10)",
          }}
        >
          <strong style={{ fontSize: 11.5, color: "#FCD34D" }}>
            {pendingLiveAction.kind === "announcement"
              ? "Send this announcement to the audience?"
              : pendingLiveAction.kind === "pin"
              ? "Show this message on the live lower-third?"
              : "Hide the live lower-third?"}
          </strong>
          <div
            style={{ fontSize: 11.5, color: "#F3F4F6", lineHeight: 1.45, whiteSpace: "pre-wrap" }}
          >
            {pendingLiveAction.kind === "announcement"
              ? `Message: ${pendingLiveAction.text ?? ""}`
              : pendingLiveAction.kind === "pin"
              ? `${pendingLiveAction.author ?? "Message"}: ${pendingLiveAction.text ?? ""}`
              : "Nothing will appear on the lower-third once this is confirmed."}
          </div>
          {pendingLiveAction.kind === "announcement" && (
            <div style={{ fontSize: 10, color: "#94A3B8" }}>
              Delivery: audience message{sendToCaption ? " and closed caption" : ""}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setPendingLiveAction(null)}
              style={{
                height: 26,
                padding: "0 10px",
                borderRadius: 5,
                border: "1px solid #334155",
                background: "#161B24",
                color: "#CBD5E1",
                fontSize: 10.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={confirmPendingLiveAction}
              style={{
                height: 26,
                padding: "0 10px",
                borderRadius: 5,
                border: "1px solid #F59E0B",
                background: "#B45309",
                color: "#FFFFFF",
                fontSize: 10.5,
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {pendingLiveAction.kind === "announcement"
                ? "Confirm Send"
                : pendingLiveAction.kind === "pin"
                ? "Confirm Show"
                : "Confirm Hide"}
            </button>
          </div>
        </div>
      )}

      {!collapsed && (
        <>
          {telemetryStrip}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.35fr) minmax(260px, 0.65fr)",
              gap: 10,
              alignItems: "start",
            }}
          >
            {chatPanel}
            <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
              {overlayStatusCard}
              {relayDrawer}
              {status && (
                <div
                  className="mono"
                  style={{
                    padding: "7px 9px",
                    borderRadius: 6,
                    border: "1px solid #334155",
                    background: "#121722",
                    color: "#94A3B8",
                    fontSize: 10,
                  }}
                >
                  {status}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (variant === "compact") {
    return (
      <>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            flexWrap: "wrap",
            padding: "8px 11px",
            borderRadius: 9,
            background: "#101620",
            border: `1px solid ${live ? "#7F1D1D" : "#252C38"}`,
          }}
        >
          <span
            className="mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 10,
              fontWeight: 800,
              padding: "3px 8px",
              borderRadius: 999,
              color: live ? "#FCA5A5" : "#94A3B8",
              background: live ? "rgba(239,68,68,0.18)" : "#1C222D",
              border: `1px solid ${live ? "#EF4444" : "#334155"}`,
            }}
          >
            <Radio size={10} /> {live ? "LIVE" : "STANDBY"}
          </span>
          <span className="mono" style={{ fontSize: 11, fontWeight: 800, color: "#E2E8F0" }}>
            {Math.round(stats?.bitrateKbps || 0)} kbps
          </span>
          <span className="mono" style={{ fontSize: 10, color: "#6EE7B7", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Users size={11} /> {viewers.count}
          </span>
          <span className="mono" style={{ fontSize: 10, color: healthColor }}>
            ● {healthLabel}
          </span>
          <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>
            {formatElapsed(stats?.elapsedSec || 0)}
          </span>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={modalOpen}
            style={{
              marginLeft: "auto",
              height: 27,
              padding: "0 10px",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 6,
              border: "1px solid #3B82F6",
              background: "#1E3A8A",
              color: "#FFFFFF",
              fontSize: 10.5,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            <MessageSquare size={12} /> Audience Chat &amp; Stats
          </button>
        </div>

        {modalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Audience Chat and Stream Stats"
            tabIndex={-1}
            onClick={(event) => {
              if (event.target === event.currentTarget) setModalOpen(false);
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10050,
              background: "rgba(4, 7, 12, 0.86)",
              backdropFilter: "blur(4px)",
              display: "grid",
              placeItems: "center",
              padding: 16,
            }}
          >
            <div
              style={{
                width: "min(1080px, 96vw)",
                maxHeight: "90vh",
                overflowY: "auto",
                background: "#080B10",
                border: "1px solid #334155",
                borderRadius: 12,
                boxShadow: "0 24px 70px rgba(0,0,0,0.75)",
              }}
            >
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "#12161F",
                  borderBottom: "1px solid #1E2533",
                }}
              >
                <strong style={{ fontSize: 13, color: "#F3F4F6" }}>
                  Audience Chat &amp; Stream Stats
                </strong>
                <button
                  type="button"
                  aria-label="Close audience drawer"
                  onClick={() => setModalOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#94A3B8",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex",
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              <div style={{ padding: 12 }}>{fullDock}</div>
            </div>
          </div>
        )}
      </>
    );
  }

  return fullDock;
};
