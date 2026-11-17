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
} from "lucide-react";
import type { AppStateSnapshot, SceneSourceItem } from "../types";
import { AddSourceModal, OBS_SOURCE_DEFINITIONS } from "./AddSourceModal";
import { SourceSettingsModal } from "./SourceSettingsModal";

interface BroadcastCanvasViewProps {
  state: AppStateSnapshot;
  onBroadcastToggle: (id: string, live: boolean) => void;
  onAddSource: (source: SceneSourceItem) => void;
  onRemoveSource: (id: string) => void;
  onToggleSourceVisibility: (id: string) => void;
  onToggleSourceLock: (id: string) => void;
  onUpdateSourceSettings: (id: string, settings: Record<string, unknown>, name: string) => void;
}

export const BroadcastCanvasView: React.FC<BroadcastCanvasViewProps> = ({
  state,
  onBroadcastToggle,
  onAddSource,
  onRemoveSource,
  onToggleSourceVisibility,
  onToggleSourceLock,
  onUpdateSourceSettings,
}) => {
  const [settingsModalSource, setSettingsModalSource] = useState<SceneSourceItem | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);

  const sources = state.sources || [];
  const broadcasts = state.broadcasts || [];
  const anyLive = broadcasts.some((b) => b.live);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 64px)",
        background: "#080B10",
        color: "#F3F4F6",
        padding: 16,
        gap: 14,
        boxSizing: "border-box",
      }}
    >
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
            {sources.length} active sources
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 14, flex: 1, minHeight: 0 }}>
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
            {sources.length === 0 ? (
              <div style={{ textAlign: "center", padding: 24, color: "#64748B" }}>
                <Tv size={48} color="#374151" style={{ marginBottom: 12 }} />
                <h4 style={{ margin: 0, color: "#94A3B8" }}>No Broadcast Sources Added</h4>
                <p style={{ margin: "4px 0 0", fontSize: 13, maxWidth: 320 }}>
                  Click "+ Add Source" to add cameras, display captures, media, window capture, or browsers.
                </p>
              </div>
            ) : (
              <div style={{ textAlign: "center", color: "#60A5FA" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Active Program Output</div>
                <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>
                  Compositing {sources.filter((s) => s.enabled).length} active layers
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Sources Hierarchy & Stream Output Control */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          {/* Sources Stack */}
          <div
            style={{
              background: "#0D1117",
              border: "1px solid #1E2533",
              borderRadius: 10,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
                Sources ({sources.length})
              </span>
              <button
                type="button"
                onClick={() => setShowAddSource(true)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#60A5FA",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Plus size={13} /> Add
              </button>
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
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      background: "#161B24",
                      border: "1px solid #283344",
                      borderRadius: 6,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: s.enabled ? "#FFFFFF" : "#64748B" }}>
                        {s.name}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748B", textTransform: "uppercase" }}>
                        {s.type.replace(/_/g, " ")}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
