import React from "react";
import { Download, Sparkles, X, ExternalLink } from "lucide-react";
import type { UpdateInfo } from "../types";

interface UpdateModalProps {
  update: UpdateInfo;
  onDismiss: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ update, onDismiss }) => {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(10, 14, 23, 0.82)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 580,
          background: "#141923",
          border: "1px solid #3B82F6",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(59, 130, 246, 0.2)",
          borderRadius: 12,
          padding: 24,
          color: "#E2E8F0",
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                background: "rgba(59, 130, 246, 0.15)",
                border: "1px solid rgba(59, 130, 246, 0.4)",
                borderRadius: 8,
                padding: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={24} color="#60A5FA" />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#FFFFFF", display: "flex", alignItems: "center", gap: 8 }}>
                New Revision Available
                <span
                  style={{
                    background: "#2563EB",
                    color: "#FFFFFF",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 12,
                  }}
                >
                  {update.latest_version}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "#94A3B8" }}>
                Current installed version: {update.current_version}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              background: "transparent",
              border: "none",
              color: "#94A3B8",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Release Summary & Notes */}
        <div
          style={{
            background: "#0D1117",
            border: "1px solid #1E293B",
            borderRadius: 8,
            padding: 16,
            maxHeight: 220,
            overflowY: "auto",
            fontSize: 13,
            lineHeight: 1.5,
            color: "#CBD5E1",
          }}
        >
          <div style={{ fontWeight: 600, color: "#F1F5F9", marginBottom: 6 }}>
            {update.release_name}
          </div>
          <div style={{ whiteSpace: "pre-wrap", color: "#94A3B8", fontSize: 12 }}>
            {update.release_notes || "Automated release update with performance enhancements, protocol stabilization, and bug fixes."}
          </div>
        </div>

        {/* Installer Download Options */}
        {update.assets.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8", marginBottom: 8 }}>
              Available Installers:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {update.assets.map((asset) => (
                <a
                  key={asset.name}
                  href={asset.browser_download_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "#1E2533",
                    border: "1px solid #2E3748",
                    borderRadius: 6,
                    color: "#60A5FA",
                    textDecoration: "none",
                    fontSize: 12,
                  }}
                >
                  <span>{asset.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#94A3B8" }}>
                    <span>{(asset.size / (1024 * 1024)).toFixed(1)} MB</span>
                    <Download size={14} color="#60A5FA" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: "8px 16px",
              background: "#1E293B",
              border: "1px solid #334155",
              color: "#CBD5E1",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Later
          </button>
          {update.download_url && (
            <a
              href={update.download_url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 18px",
                background: "#2563EB",
                border: "1px solid #3B82F6",
                color: "#FFFFFF",
                borderRadius: 6,
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              <Download size={15} />
              Download & Install Update
            </a>
          )}
          <a
            href={update.html_url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "8px 12px",
              background: "transparent",
              border: "1px solid #334155",
              color: "#94A3B8",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            <ExternalLink size={14} />
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
};
