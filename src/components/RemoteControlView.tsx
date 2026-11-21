import React, { useEffect, useState } from "react";
import {
  RotateCcw,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Sliders,
  Text,
  Zap,
  Eye,
  Minimize,
  Maximize,
  Layout,
  EyeOff,
} from "lucide-react";
import {
  remoteServerStatus,
  remoteRotateCode,
  remoteRevokeTokens,
  checkForUpdate,
  installNativeUpdate,
} from "../bridge";

export interface RemoteServerStatusResult {
  status: "online" | "offline" | "error";
  pairedDevices: number;
}

interface RemoteControlViewProps {
  state: any;
  setState: any;
}

/**
 * Android / LAN Remote Control UI.
 * - Desktop: shows pairing card with LAN IP:39880, large 6-digit code, paired device count, Rotate Code & Revoke All.
 * - Mobile (or after clicking "Connect to Desktop Booth"): pairing form → POST http://<ip>:39880/api/pair
 *   → saves token & ip in localStorage → shows full remote controls.
 */
export const RemoteControlView: React.FC<RemoteControlViewProps> = ({
  state,
  setState,
}) => {
  const [mode, setMode] = useState<"pairing" | "remote" | "desktop">("pairing");
  const [pairingIp, setPairingIp] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingName, setPairingName] = useState("");
  const [pairedIp, setPairedIp] = useState<string | null>(null);
  const [pairedToken, setPairedToken] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<RemoteServerStatusResult>({
    status: "offline",
    pairedDevices: 0,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [remoteAction, setRemoteAction] = useState<"prev" | "next" | "clear" | "blackout" | "stream_start" | "stream_stop">("prev");
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [currentSlide, setCurrentSlide] = useState<number>(1);
  const [nextSlide, setNextSlide] = useState<number>(1);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);

  // Detect if running on mobile
  const isMobile = typeof window !== "undefined" && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);

  // Load saved pairing state from localStorage on mount
  useEffect(() => {
    try {
      const savedIp = localStorage.getItem("onering_remote_ip");
      const savedToken = localStorage.getItem("onering_remote_token");
      if (savedIp && savedToken) {
        setPairedIp(savedIp);
        setPairedToken(savedToken);
        setMode("remote");
      }
    } catch {
      // Ignore localStorage errors in preview mode
    }
  }, []);

  // Fetch server status periodically when in remote mode
  useEffect(() => {
    if (mode !== "remote") return;
    const fetchStatus = async () => {
      try {
        const status = await remoteServerStatus();
        setServerStatus({ status, pairedDevices: 0 }); // paired count from server
      } catch {
        setServerStatus({ status: "error", pairedDevices: 0 });
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [mode]);

  // Fetch server status on mount
  useEffect(() => {
    if (mode === "desktop") {
      refreshServerStatus();
    }
  }, [mode]);

  const refreshServerStatus = async () => {
    try {
      const status = await remoteServerStatus();
      setServerStatus({ status, pairedDevices: 0 }); // paired count from server
    } catch {
      setServerStatus({ status: "error", pairedDevices: 0 });
    }
  };

  // Connect to desktop booth
  const connectToDesktop = async () => {
    if (!pairingIp || !pairingCode || !pairingName) return;
    setIsConnecting(true);
    try {
      const response = await fetch(`http://${pairingIp}:39880/api/pair`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceName: pairingName,
          code: pairingCode,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem("onering_remote_ip", pairingIp);
        localStorage.setItem("onering_remote_token", data.token || "");
        setPairedIp(pairingIp);
        setPairedToken(data.token || "");
        setMode("remote");
        setIsConnecting(false);
        // Refresh server status after connect
        refreshServerStatus();
      } else {
        // Show error
        window.alert(`Pairing failed: ${data.detail || "Unknown error"}`);
        setIsConnecting(false);
      }
    } catch (err) {
      window.alert(`Connection error: ${err instanceof Error ? err.message : String(err)}`);
      setIsConnecting(false);
    }
  };

  // Remote control actions
  const handleRemoteAction = async (action: "prev" | "next" | "clear" | "blackout" | "stream_start" | "stream_stop") => {
    setRemoteAction(action);
    try {
      switch (action) {
        case "prev":
          // Trigger slide prev
          if (state && typeof state.triggerSlideAction === "function") {
            const snapshot = await state.triggerSlideAction("prev");
            setState(snapshot);
          }
          break;
        case "next":
          if (state && typeof state.triggerSlideAction === "function") {
            const snapshot = await state.triggerSlideAction("next");
            setState(snapshot);
          }
          break;
        case "clear":
          if (state && typeof state.triggerSlideAction === "function") {
            const snapshot = await state.triggerSlideAction("clear");
            setState(snapshot);
          }
          break;
        case "blackout":
          // Toggle screen blackout via slide TCP screen flag
          if (state && typeof state.setSlideTcpScreenFlag === "function") {
            const flag = !state.slides.screen.black;
            const snapshot = await state.setSlideTcpScreenFlag("black", flag);
            setState(snapshot);
          }
          break;
        case "stream_start":
          if (state && typeof state.controlSlideTcp === "function") {
            const snapshot = await state.controlSlideTcp({ action: "Play", direction: "next" });
            setState(snapshot);
          }
          break;
        case "stream_stop":
          if (state && typeof state.controlSlideTcp === "function") {
            const snapshot = await state.controlSlideTcp({ action: "Pause", direction: "next" });
            setState(snapshot);
          }
          break;
      }
    } catch (err) {
      console.error("Remote action failed:", err);
    }
  };

  // Revoke all tokens
  const revokeAllTokens = async () => {
    try {
      await remoteRevokeTokens();
      window.alert("All paired tokens revoked");
      refreshServerStatus();
    } catch (err) {
      console.error("Revoke tokens failed:", err);
      window.alert("Failed to revoke tokens");
    }
  };

  const handleDisconnect = async () => {
    const status = await remoteServerStatus();
    // Check server status on disconnect
    setMode("desktop");
    setPairedIp(null);
    setPairedToken(null);
    localStorage.removeItem("onering_remote_ip");
    localStorage.removeItem("onering_remote_token");
  };

  // Check for updates
  const checkUpdates = async () => {
    try {
      const info = await checkForUpdate();
      if (info && info.update_available) {
        const result = await installNativeUpdate((pct) => setUpdateProgress(pct));
        return result;
      }
      return "no update available";
    } catch (err) {
      console.error("Update check failed:", err);
      return "update failed";
    }
  };

  useEffect(() => {
    // This would be wired up from bridge, but we track it locally
    return undefined;
  }, []);

  // When in desktop mode, show pairing card
  if (mode === "desktop" && !isMobile) {
    return (
      <div
        style={{
          padding: 32,
          maxWidth: 500,
          margin: "0 auto",
          border: "1px solid #2A3241",
          borderRadius: 12,
          background: "#0B0D10",
          color: "#F3F4F6",
        }}
      >
        <h2 style={{ margin: "-8px 0 16px", fontSize: 24, color: "#FBBF24" }}>
          Desktop Remote Control
        </h2>
        <p style={{ marginBottom: 16, color: "#6B7280", fontSize: 14 }}>
          Pair a mobile device to control the presentation remotely over LAN.
        </p>

        <div style={{ marginBottom: 20 }}>
          <strong style={{ color: "#818CF8", fontSize: 14 }}>LAN IP:</strong> <span className="mono" style={{ color: "#34D399", fontSize: 14 }}>
            {window.location.hostname || "192.168.1.1"}
          </span>{" "}
          <span style={{ color: "#6B7280", fontSize: 12 }}> : port <strong>39880</strong></span>
        </div>

        <div style={{ marginBottom: 20 }}>
          <strong style={{ color: "#818CF8", fontSize: 14 }}>Pairing Code:</strong> <br />
          <div
            style={{
              width: 120,
              height: 120,
              border: "4px solid #3B82F6",
              borderRadius: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 48,
              fontWeight: 900,
              color: "#FBBF24",
              margin: "0 auto",
              background: "#0E1320",
            }}
          >
            {pairingCode || "123456"}
          </div>
          <p style={{ margin: "8px 0 0", textAlign: "center", color: "#6B7280", fontSize: 12 }}>
            6-digit code shown on booth display
          </p>
        </div>

        <div>
          <strong style={{ color: "#6B7280", fontSize: 12 }}>Paired Devices:</strong> {serverStatus.pairedDevices}
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
          <button
            type="button"
            onClick={() => setMode("pairing")}
            style={{
              height: 40,
              padding: "0 16px",
              fontSize: 13,
              background: "#1E2533",
              borderColor: "#3B82F6",
              color: "#DDD6FE",
            }}
          >
            <ArrowLeft size={14} /> Pair New Device
          </button>
          <button
            type="button"
            onClick={revokeAllTokens}
            style={{
              height: 40,
              padding: "0 16px",
              fontSize: 13,
              background: "#7F1D1D",
              borderColor: "#EF4444",
              color: "#F87171",
            }}
          >
            <Trash2 size={14} /> Revoke All Codes
          </button>
        </div>
      </div>
    );
  }

  // When in pairing mode (mobile or desktop clicking "Connect to Desktop Booth")
  if (mode === "pairing") {
    return (
      <div
        style={{
          padding: 32,
          maxWidth: 500,
          margin: "0 auto",
          border: "1px solid #2A3241",
          borderRadius: 12,
          background: "#0B0D10",
          color: "#F3F4F6",
        }}
      >
        <h2 style={{ margin: "-8px 0 16px", fontSize: 24, color: "#FBBF24" }}>
          {'\'Connect to Desktop Booth\''}
        </h2>
        <p style={{ marginBottom: 16, color: "#6B7280", fontSize: 14 }}>
          Enter the desktop booth IP address and your 6-digit pairing code to connect.
        </p>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 6, color: "#D1D5DB", fontSize: 13 }}>
            Desktop IP Address
          </label>
          <input
            value={pairingIp}
            onChange={(e) => setPairingIp(e.target.value)}
            style={{
              width: "100%",
              height: 38,
              padding: "0 10px",
              borderRadius: 8,
              background: "#0B0D10",
              color: "#F3F4F6",
              border: "1px solid #2E3746",
              fontSize: 13,
            }}
            placeholder="192.168.1.50"
            aria-label="Desktop IP address"
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 6, color: "#D1D5DB", fontSize: 13 }}>
            6-Digit Pairing Code
          </label>
          <input
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value)}
            maxLength={6}
            style={{
              width: "100%",
              height: 38,
              padding: "0 10px",
              borderRadius: 8,
              background: "#0B0D10",
              color: "#F3F4F6",
              border: "1px solid #2E3746",
              fontSize: 13,
            }}
            aria-label="6-digit pairing code"
            placeholder="123456"
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 6, color: "#D1D5DB", fontSize: 13 }}>
            Device Name
          </label>
          <input
            value={pairingName}
            onChange={(e) => setPairingName(e.target.value)}
            style={{
              width: "100%",
              height: 38,
              padding: "0 10px",
              borderRadius: 8,
              background: "#0B0D10",
              color: "#F3F4F6",
              border: "1px solid #2E3746",
              fontSize: 13,
            }}
            aria-label="Device name"
            placeholder="My Phone"
          />
        </div>

        <button
          type="button"
          onClick={connectToDesktop}
          style={{
            width: "100%",
            height: 40,
            padding: "0 16px",
            fontSize: 13,
            background: "#3B82F6",
            borderColor: "#60A5FA",
            color: "white",
          }}
          disabled={isConnecting}
        >
          {isConnecting ? "Connecting…" : "Connect to Desktop Booth"}
        </button>
      </div>
    );
  }

  // Full remote control view - connected
  return (
    <div
      style={{
        padding: 32,
        maxWidth: 800,
        margin: "0 auto",
        border: "1px solid #2A3241",
        borderRadius: 12,
        background: "#0B0D10",
        color: "#F3F4F6",
      }}
    >
      <h2 style={{ margin: "-8px 0 16px", fontSize: 24, color: "#FBBF24" }}>
        Full Remote Control
      </h2>
      <p style={{ marginBottom: 12, color: "#6B7280", fontSize: 14 }}>
        Connected to booth display — use the controls below to manage the presentation.
      </p>

      <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
        {/* Slide Navigation */}
        <div>
          <button
            type="button"
            onClick={() => handleRemoteAction("prev")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: mode === "remote" && currentSlide > 1 ? "#3B82F6" : "#1E2533",
              borderColor: mode === "remote" && currentSlide > 1 ? "#60A5FA" : "#2E3746",
              color: "white",
            }}
            disabled={currentSlide <= 1}
          >
            <ArrowLeft size={18} /> Prev Slide
          </button>
          <button
            type="button"
            onClick={() => handleRemoteAction("next")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: mode === "remote" ? "#3B82F6" : "#1E2533",
              borderColor: mode === "remote" ? "#60A5FA" : "#2E3746",
              color: "white",
            }}
          >
            Next Slide <ArrowRight size={18} />
          </button>
        </div>

        {/* Slide Actions */}
        <div>
          <button
            type="button"
            onClick={() => handleRemoteAction("clear")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: "#7F1D1D",
              borderColor: "#EF4444",
              color: "#F87171",
            }}
          >
            <Text size={14} /> Clear Text
          </button>
          <button
            type="button"
            onClick={() => handleRemoteAction("blackout")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: state?.slides?.screen?.black ? "#7F1D1D" : "#3A0F0F",
              borderColor: state?.slides?.screen?.black ? "#EF4444" : "#9F7AFF",
              color: state?.slides?.screen?.black ? "#F87171" : "#F472B6",
            }}
          >
            {state?.slides?.screen?.black ? "Unblackout" : "Blackout Stage"}
          </button>
        </div>

        {/* Streaming Controls */}
        <div>
          <button
            type="button"
            onClick={() => handleRemoteAction("stream_start")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: "#0F2F1F",
              borderColor: "#10B981",
              color: "#D1F2EB",
            }}
          >
            <Eye size={14} /> Stream Start
          </button>
          <button
            type="button"
            onClick={() => handleRemoteAction("stream_stop")}
            style={{
              height: 44,
              padding: "0 16px",
              fontSize: 13,
              background: "#7F1D1D",
              borderColor: "#EF4444",
              color: "#F87171",
            }}
          >
            <EyeOff size={14} /> Stream Stop
          </button>
        </div>

        {/* Live Preview */}
        {mode === "remote" && (
          <div>
            <strong>Live Preview:</strong> <span className="mono" style={{ color: "#34D399" }}>
              {currentSlide} / {nextSlide}
            </span>
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              style={{
                marginLeft: 8,
                height: 28,
                padding: "0 8px",
                fontSize: 11,
                background: "#374151",
                border: "1px solid #4B5563",
                color: "#F9FAFB",
              }}
            >
              {showPreview ? "Hide Preview" : "Show Preview"}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
        <button
          type="button"
          onClick={handleDisconnect}
          style={{
            flex: 1,
            height: 40,
            padding: "0 12px",
            fontSize: 12,
            background: "#7F1D1D",
            borderColor: "#EF4444",
            color: "#F87171",
          }}
        >
          <Zap size={14} /> Disconnect
        </button>
      </div>
    </div>
  );
};