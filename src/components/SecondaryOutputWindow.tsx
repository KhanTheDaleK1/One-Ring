import React, { useEffect, useState } from "react";
import { Monitor, Radio } from "lucide-react";
import type { SlideState } from "../types";

export const SecondaryOutputWindow: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const outputType = params.get("output") || "foh"; // "foh" | "stage" | "lower_third"
  const [slides, setSlides] = useState<SlideState | null>(() => {
    try {
      const saved = localStorage.getItem("onering_live_slides_state");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const channel = new BroadcastChannel("onering_display_sync");
    channel.onmessage = (ev) => {
      if (ev.data?.type === "SLIDES_UPDATE") {
        setSlides(ev.data.slides);
      }
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === "onering_live_slides_state" && ev.newValue) {
        try {
          setSlides(JSON.parse(ev.newValue));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      channel.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const currentArr = slides?.slides || [];
  const currentSlide =
    currentArr.find((s) => s.number === slides?.currentSlide) || currentArr[0];
  const theme = slides?.theme;

  // Stage Confidence Display Layout (High Contrast Yellow / Cyan Words)
  if (outputType === "stage") {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#000000",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "5vh 6vw",
          boxSizing: "border-box",
          fontFamily: "Inter, system-ui, sans-serif",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", color: "#64748B", fontSize: "2.2vh" }}>
          <span>ONE RING STAGE CONFIDENCE • {slides?.presentationName || "Standby"}</span>
          <span>Slide {slides?.currentSlide || 0} / {slides?.totalSlides || 0}</span>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ color: "#EAB308", fontSize: "2.4vh", fontWeight: 800, textTransform: "uppercase", marginBottom: "1vh" }}>
            CURRENT LYRIC
          </div>
          <div style={{ fontSize: "6.5vh", fontWeight: 800, lineHeight: 1.25, whiteSpace: "pre-line" }}>
            {slides?.cleared ? "[CLEARED]" : currentSlide?.text || slides?.currentText || "—"}
          </div>
        </div>

        <div style={{ borderTop: "2px solid #262626", paddingTop: "3vh" }}>
          <div style={{ color: "#38BDF8", fontSize: "2.2vh", fontWeight: 800, textTransform: "uppercase", marginBottom: "0.8vh" }}>
            NEXT UP
          </div>
          <div style={{ fontSize: "4.2vh", fontWeight: 600, color: "#94A3B8", lineHeight: 1.3, whiteSpace: "pre-line" }}>
            {slides?.nextText || "—"}
          </div>
        </div>
      </div>
    );
  }

  // Livestream Lower Thirds Alpha Overlay Output
  if (outputType === "lower_third") {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#00FF00", // Chroma-key green or keyed alpha surface for capture/Syphon
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {!slides?.cleared && (currentSlide?.text || slides?.currentText) && (
          <div
            style={{
              background: theme?.lowerThirdBg || "rgba(10, 14, 23, 0.92)",
              borderTop: `4px solid ${theme?.lowerThirdAccent || "#3B82F6"}`,
              padding: "3.5vh 6vw",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontFamily: theme?.fontFamily || "Inter, system-ui, sans-serif",
                fontSize: `${Math.round((theme?.fontSize || 22) * 2.2)}px`,
                fontWeight: 700,
                color: theme?.textColor || "#FFFFFF",
                lineHeight: 1.3,
                whiteSpace: "pre-line",
              }}
            >
              {currentSlide?.text || slides?.currentText}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Default: FOH Fullscreen Congregation Display Output
  const fohBg =
    theme?.backgroundType === "image" && theme.backgroundImage
      ? `url(${theme.backgroundImage}) center/cover no-repeat`
      : theme?.backgroundType === "gradient"
      ? `linear-gradient(135deg, ${theme.backgroundColor} 0%, ${theme.gradientTo || "#1E1B4B"} 100%)`
      : theme?.backgroundColor || "#05070B";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: fohBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6vw",
        textAlign: "center",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {!slides?.cleared && (currentSlide?.text || slides?.currentText) ? (
        <div
          style={{
            fontFamily: theme?.fontFamily || "Inter, system-ui, sans-serif",
            fontSize: `${Math.round((theme?.fontSize || 22) * 3.1)}px`,
            fontWeight: 800,
            color: theme?.textColor || "#FFFFFF",
            lineHeight: 1.35,
            whiteSpace: "pre-line",
            textShadow: "0 4px 20px rgba(0,0,0,0.85)",
          }}
        >
          {currentSlide?.text || slides?.currentText}
        </div>
      ) : (
        <div style={{ opacity: 0.12, display: "flex", alignItems: "center", gap: 8, color: "#FFFFFF", fontSize: 13 }}>
          <Monitor size={16} /> <Radio size={14} /> FOH Output Standby
        </div>
      )}
    </div>
  );
};
