import React, { useEffect, useMemo } from "react";
import { Download, Sparkles, X, ExternalLink } from "lucide-react";
import type { UpdateInfo } from "../types";
import { openUrl } from "../bridge";

interface UpdateModalProps {
  update: UpdateInfo;
  onDismiss: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ update, onDismiss }) => {
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
  // Determine user OS platform from userAgent
  const platform = useMemo(() => {
    if (typeof navigator === "undefined") return "unknown";
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac") || ua.includes("darwin")) return "mac";
    if (ua.includes("win")) return "windows";
    if (ua.includes("linux")) return "linux";
    return "unknown";
  }, []);

  // Filter installers to only show platform-relevant assets
  const filteredAssets = useMemo(() => {
    if (!update.assets || update.assets.length === 0) return [];
    if (platform === "mac") {
      const macAssets = update.assets.filter(
        (a) => a.name.endsWith(".dmg") || a.name.endsWith(".app.tar.gz")
      );
      return macAssets.length > 0 ? macAssets : update.assets;
    }
    if (platform === "windows") {
      const winAssets = update.assets.filter(
        (a) => a.name.endsWith(".exe") || a.name.endsWith(".msi")
      );
      return winAssets.length > 0 ? winAssets : update.assets;
    }
    return update.assets;
  }, [update.assets, platform]);

  // Primary installer target based on current platform
  const primaryDownloadUrl = useMemo(() => {
    if (platform === "mac") {
      const dmg = update.assets.find((a) => a.name.endsWith(".dmg"));
      if (dmg) return dmg.browser_download_url;
    }
    if (platform === "windows") {
      const exe = update.assets.find((a) => a.name.endsWith("-setup.exe") || a.name.endsWith(".msi"));
      if (exe) return exe.browser_download_url;
    }
    return update.download_url || update.html_url;
  }, [update, platform]);

  const handleDownload = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    openUrl(url);
  };

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
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
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
              <div
                id="update-modal-title"
                style={{ fontSize: 18, fontWeight: 700, color: "#FFFFFF", display: "flex", alignItems: "center", gap: 8 }}
              >
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
            aria-label="Close update dialog"
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
            maxHeight: 180,
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

        {/* Filtered Platform Installer Option(s) */}
        {filteredAssets.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8", marginBottom: 8 }}>
              {platform === "mac" ? "macOS Package:" : platform === "windows" ? "Windows Package:" : "Available Installers:"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredAssets.map((asset) => (
                <button
                  key={asset.name}
                  type="button"
                  onClick={(e) => handleDownload(e, asset.browser_download_url)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "#1E2533",
                    border: "1px solid #2E3748",
                    borderRadius: 6,
                    color: "#60A5FA",
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Download size={15} color="#60A5FA" />
                    <span style={{ fontWeight: 600 }}>{asset.name}</span>
                  </div>
                  <span style={{ color: "#94A3B8", fontSize: 12 }}>
                    {(asset.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </button>
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
              padding: "9px 16px",
              background: "#1E293B",
              border: "1px solid #475569",
              color: "#CBD5E1",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Later
          </button>
          {primaryDownloadUrl && (
            <button
              type="button"
              onClick={(e) => handleDownload(e, primaryDownloadUrl)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 18px",
                background: "#2563EB",
                border: "1px solid #3B82F6",
                color: "#FFFFFF",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              <Download size={15} />
              {platform === "mac" ? "Download .dmg" : platform === "windows" ? "Download .exe" : "Download Update"}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => handleDownload(e, update.html_url)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "9px 12px",
              background: "transparent",
              border: "1px solid #475569",
              color: "#94A3B8",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <ExternalLink size={14} />
            Release page
          </button>
        </div>
      </div>
    </div>
  );
};
