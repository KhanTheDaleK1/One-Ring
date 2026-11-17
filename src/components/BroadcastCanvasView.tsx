import React, { useState } from "react";
import {
  Radio,
  Settings,
  Plus,
  Play,
  Square,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Tv,
  Layers,
  Sparkles,
  Sliders,
} from "lucide-react";
import type { AppStateSnapshot, SceneSourceItem, SourceFilter, SourceTransform } from "../types";
import { AddSourceModal } from "./AddSourceModal";
import { ObsAudioMixerPanel } from "./ObsAudioMixerPanel";
import { getMediaEngineStatus, startHeadlessMediaDaemon, type MediaEngineStatus } from "../bridge";
import { ProgramCanvasRenderer } from "./ProgramCanvasRenderer";
import { SourceSettingsModal } from "./SourceSettingsModal";
import { SourceFiltersModal } from "./SourceFiltersModal";
import { SourceTransformModal, DEFAULT_TRANSFORM } from "./SourceTransformModal";
import { SourceContextMenu } from "./SourceContextMenu";

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
  const [settingsModalSource, setSettingsModalSource] = useState<SceneSourceItem | null>(null);
  const [filtersModalSource, setFiltersModalSource] = useState<SceneSourceItem | null>(null);
  const [transformModalSource, setTransformModalSource] = useState<SceneSourceItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{ source: SceneSourceItem; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [showAddSource, setShowAddSource] = useState(false);
  const [studioMode, setStudioMode] = useState(false);
  const [tBarValue, setTBarValue] = useState(0);
  const [transitionType, setTransitionType] = useState<"Cut" | "Fade" | "Slide" | "Stinger">("Fade");
  const [mediaEngine, setMediaEngine] = useState<MediaEngineStatus | null>(null);

  React.useEffect(() => {
    getMediaEngineStatus().then(setMediaEngine).catch(() => {});
  }, []);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // OBS-style clipboards
  const [clipboardSource, setClipboardSource] = useState<SceneSourceItem | null>(null);
  const [clipboardFilters, setClipboardFilters] = useState<SourceFilter[] | null>(null);
  const [clipboardTransform, setClipboardTransform] = useState<SourceTransform | null>(null);

  const sources = state.sources || [];
  const broadcasts = state.broadcasts || [];
  const anyLive = broadcasts.some((b) => b.live);

  const notify = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  const patchSource = (id: string, patchFn: (s: SceneSourceItem) => SceneSourceItem) => {
    onSetAllSources(sources.map((s) => (s.id === id ? patchFn(s) : s)));
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
          padding: "10px 16px",
          background: "#12161F",
          border: "1px solid #1E2533",
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Radio size={18} color="#EF4444" />
            <strong style={{ fontSize: 16 }}>Broadcast Studio & OBS Sources</strong>
          </div>
          <span style={{ fontSize: 12, color: "#64748B" }}>•</span>
          <span style={{ fontSize: 13, color: anyLive ? "#F87171" : "#9CA3AF", fontWeight: 700 }}>
            {anyLive ? "LIVE ON AIR" : "STREAM STANDBY"}
          </span>
          <span style={{ fontSize: 11, background: "#1E2533", padding: "2px 8px", borderRadius: 10, color: "#94A3B8" }}>
            {sources.length} active sources (right-click any source for Filters, Transform, Order & Color)
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            {mediaEngine?.daemonRunning ? "● Option 2 Core Active" : "Launch Headless Media Core"}
          </button>

          <button
            type="button"
            onClick={() => setStudioMode(!studioMode)}
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
            <Plus size={15} /> + Add Source (All 15 OBS Types)
          </button>
        </div>
      </div>

      {/* Main Broadcast Work Area */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 14, flex: 1, minHeight: 0 }}>
        {/* Left: Program Video Canvas Preview & Live Output */}
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
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Program Canvas (1920×1080 @ 60fps)
            </span>
            <span style={{ fontSize: 11, color: "#10B981", fontWeight: 700 }}>
              Hardware Accelerated
            </span>
          </div>

          {studioMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#111827", border: "1px solid #4C1D95", borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#C084FC" }}>STUDIO T-BAR</span>
              <select
                value={transitionType}
                onChange={(e) => setTransitionType(e.target.value as any)}
                style={{ background: "#0B0E14", border: "1px solid #334155", color: "#FFFFFF", fontSize: 12, padding: "4px 8px", borderRadius: 5 }}
              >
                <option value="Cut">Cut (0ms)</option>
                <option value="Fade">Fade (300ms)</option>
                <option value="Slide">Slide</option>
                <option value="Stinger">Stinger</option>
              </select>
              <input
                type="range"
                min={0}
                max={100}
                value={tBarValue}
                onChange={(e) => setTBarValue(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => {
                  setTBarValue(0);
                  notify(`Executed ${transitionType} Transition to Program`);
                }}
                style={{ background: "#7C3AED", border: "none", color: "#FFFFFF", padding: "5px 12px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
              >
                Transition →
              </button>
            </div>
          )}

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
            }}
          >
            <ProgramCanvasRenderer sources={sources} />
          </div>
        </div>

        {/* Right: Sources Stack & Stream Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
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
              <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
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
                      background: s.colorTag ? `linear-gradient(90deg, ${s.colorTag}26 0%, #161B24 35%)` : "#161B24",
                      border: "1px solid #283344",
                      borderLeft: s.colorTag ? `4px solid ${s.colorTag}` : "1px solid #283344",
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
                          <div style={{ fontSize: 13, fontWeight: 600, color: s.enabled ? "#FFFFFF" : "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {s.name}
                          </div>
                          <div style={{ fontSize: 10, color: "#64748B", textTransform: "uppercase", display: "flex", gap: 6 }}>
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
                        onClick={() => setFiltersModalSource(s)}
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
                        onClick={() => setSettingsModalSource(s)}
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
                        onClick={() => onToggleSourceVisibility(s.id)}
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
                        onClick={() => onToggleSourceLock(s.id)}
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
                        onClick={() => onRemoveSource(s.id)}
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

            <button
              type="button"
              onClick={() => onBroadcastToggle("all", !anyLive)}
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
          </div>
        </div>
      </div>

      {/* OBS 6-Track Audio Mixer Panel */}
      <ObsAudioMixerPanel
        sources={sources}
        onToggleMute={(id) =>
          patchSource(id, (s) => ({ ...s, muted: !s.muted }))
        }
        onVolumeChange={(id, db) =>
          patchSource(id, (s) => ({ ...s, volumeDb: db }))
        }
        onOpenFilters={(src) => setFiltersModalSource(src)}
        onUpdateTrackRouting={(id, tracks) =>
          patchSource(id, (s) => ({
            ...s,
            settings: { ...s.settings, audioTracks: tracks },
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
              patchSource(id, (s) => ({ ...s, filters: JSON.parse(JSON.stringify(clipboardFilters)) }));
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
              transform: { ...(s.transform || DEFAULT_TRANSFORM), x: 0, y: 0, width: 1920, height: 1080 },
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
