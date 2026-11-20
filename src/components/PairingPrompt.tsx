import React, { useEffect } from "react";
import { Network, Link2, X } from "lucide-react";

export interface DiscoveredPeerInfo {
  instanceId: string;
  stationName: string;
  canvasTitle: string;
  ipAddress: string;
  wsSyncPort: number;
  version: string;
}

interface PairingPromptProps {
  peer: DiscoveredPeerInfo;
  onPair: (peer: DiscoveredPeerInfo) => void;
  onDismiss: () => void;
}

export const PairingPrompt: React.FC<PairingPromptProps> = ({
  peer,
  onPair,
  onDismiss,
}) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="pairing-prompt-title"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        background: "linear-gradient(135deg, #161D29 0%, #0F141D 100%)",
        border: "1px solid #3B82F6",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(59, 130, 246, 0.25)",
        borderRadius: 12,
        padding: "16px 20px",
        maxWidth: 420,
        color: "#F3F4F6",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "rgba(59, 130, 246, 0.15)",
              border: "1px solid rgba(59, 130, 246, 0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Network size={20} color="#60A5FA" />
          </div>
          <div>
            <div
              id="pairing-prompt-title"
              style={{ fontSize: 14, fontWeight: 700, color: "#FFFFFF", display: "flex", alignItems: "center", gap: 6 }}
            >
              Nearby Station Discovered
            </div>
            <div style={{ fontSize: 12, color: "#94A3B8" }}>
              Found another One Ring instance on your network
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss pairing prompt"
          style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer", padding: 2 }}
        >
          <X size={16} />
        </button>
      </div>

      <div
        style={{
          background: "#090C11",
          border: "1px solid #1E2533",
          borderRadius: 8,
          padding: "10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 12,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#94A3B8" }}>Station Name:</span>
          <strong style={{ color: "#FFFFFF" }}>{peer.stationName || "Production Node"}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#94A3B8" }}>Venue Canvas:</span>
          <span style={{ color: "#93C5FD" }}>{peer.canvasTitle || "Main Sanctuary"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#94A3B8" }}>IP Address:</span>
          <span className="mono" style={{ color: "#34D399" }}>{peer.ipAddress}:{peer.wsSyncPort}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: "7px 12px",
            background: "#1E2533",
            border: "1px solid #2E3748",
            borderRadius: 6,
            color: "#94A3B8",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Ignore
        </button>
        <button
          type="button"
          onClick={() => onPair(peer)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 16px",
            background: "#2563EB",
            border: "1px solid #3B82F6",
            borderRadius: 6,
            color: "#FFFFFF",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <Link2 size={14} /> Pair & Sync Stations
        </button>
      </div>
    </div>
  );
};
