import React, { useEffect, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Tv,
  Mic2,
  Radio,
  Layers,
  CheckCircle2,
  X,
} from "lucide-react";

interface WelcomeTourProps {
  isOpen: boolean;
  onComplete: () => void;
  onNavigateTab: (tab: string) => void;
}

interface TourStep {
  title: string;
  badge: string;
  tagline: string;
  description: string;
  icon: React.ReactNode;
  accentColor: string;
  highlights: string[];
  tabKey?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to One Ring",
    badge: "The All-In-One Church Suite",
    tagline: "One unified program to rule your entire production.",
    description:
      "Say goodbye to running 5 separate programs on 4 overloaded computers. One Ring brings your lyrics, digital audio mixing, live streaming, and PTZ cameras into one single, synchronized system.",
    icon: <Sparkles size={40} color="#F59E0B" />,
    accentColor: "#F59E0B",
    highlights: [
      "Built for volunteers with simple, mistake-proof controls",
      "Sub-millisecond local LAN sync across multiple computers",
      "Replaces SlideHttp, Broadcast, Aoip Controller, and Console-Edit",
    ],
  },
  {
    title: "Presentation & Slides",
    badge: "FOH · Confidence · Lower-Thirds",
    tagline: "Worship lyrics, scriptures, and stage displays without lag.",
    description:
      "Project lyrics with rich motion graphics to your auditorium, send high-contrast clocks and chords to stage confidence displays, and stream transparent lower-thirds over IP with zero capture card overhead.",
    icon: <Tv size={40} color="#3B82F6" />,
    accentColor: "#3B82F6",
    tabKey: "slides",
    highlights: [
      "7-layer graphics compositor (Background, Lyrics, Props, Alerts)",
      "Instant Bible search & Song Library lyric import",
      "Alpha-channel IP Video output for clean broadcast overlays",
    ],
  },
  {
    title: "Audio Mixing & Aoip",
    badge: "Console · IP Audio · Guard Mute",
    tagline: "Tactile console control with automated safety nets.",
    description:
      "Direct OSC control over your Console mixing desk and Aoip network matrix. One Ring features automated Silent Pastor Mic detection, alerting your team before the preacher speaks if their beltpack is muted.",
    icon: <Mic2 size={40} color="#10B981" />,
    accentColor: "#10B981",
    tabKey: "audio",
    highlights: [
      "Motorized DCA faders and 6 assignable Mute Groups",
      "Conmon UDP telemetry & PTP grandmaster clock monitoring",
      "Stage in-ear monitor sends accessible from any iPad or PC",
    ],
  },
  {
    title: "Broadcasting & Cameras",
    badge: "Multi-RTMP · Dual-Canvas · PTZ",
    tagline: "Simultaneous 16:9 + 9:16 vertical streaming and camera switching.",
    description:
      "Stream simultaneously to Video Platform, Social Platform, and mobile portrait feeds without third-party restreaming fees. Switch PTZ cameras and recall stage presets directly from service cues with full tally borders.",
    icon: <Radio size={40} color="#EF4444" />,
    accentColor: "#EF4444",
    tabKey: "broadcast",
    highlights: [
      "Hardware-accelerated video encoding",
      "Automatic recording with dynamic sermon chapter markers",
      "PTZ-IP over IP joystick control and preset recall",
    ],
  },
  {
    title: "Master Show Mode & Settings",
    badge: "Single-Tap Service Cues",
    tagline: "Run your entire Sunday morning from the spacebar.",
    description:
      "In Show Mode, all departments sync on every cue. Tap the spacebar to transition the sermon: the slide changes, the pastor's mic un-mutes, the broadcast cuts to the pulpit camera, and the stage timer starts.",
    icon: <Layers size={40} color="#8B5CF6" />,
    accentColor: "#8B5CF6",
    tabKey: "show",
    highlights: [
      "Dry-Run Rehearsal Mode: practice without touching live outputs",
      "Configure your hardware IP addresses anytime in Settings",
      "Portable *.ring.json show files you can export on a flash drive",
    ],
  },
];

export const WelcomeTour: React.FC<WelcomeTourProps> = ({
  isOpen,
  onComplete,
  onNavigateTab,
}) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onComplete();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onComplete]);

  if (!isOpen) return null;

  const currentStep = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      const nextIndex = stepIndex + 1;
      setStepIndex(nextIndex);
      if (TOUR_STEPS[nextIndex].tabKey) {
        onNavigateTab(TOUR_STEPS[nextIndex].tabKey!);
      }
    }
  };

  const handlePrev = () => {
    if (stepIndex > 0) {
      const prevIndex = stepIndex - 1;
      setStepIndex(prevIndex);
      if (TOUR_STEPS[prevIndex].tabKey) {
        onNavigateTab(TOUR_STEPS[prevIndex].tabKey!);
      }
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(5, 7, 12, 0.88)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 24,
        animation: "fadeIn 0.3s ease-out",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onComplete();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-tour-title"
        style={{
          width: "100%",
          maxWidth: 680,
          background: "linear-gradient(145deg, #161C26 0%, #0F131A 100%)",
          border: `1px solid ${currentStep.accentColor}44`,
          boxShadow: `0 24px 60px rgba(0, 0, 0, 0.7), 0 0 35px ${currentStep.accentColor}22`,
          borderRadius: 20,
          padding: 36,
          color: "#E2E8F0",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          transition: "border 0.4s ease, box-shadow 0.4s ease",
        }}
      >
        {/* Skip / Close Button */}
        <button
          type="button"
          onClick={onComplete}
          title="Skip tour"
          aria-label="Skip tour"
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "50%",
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94A3B8",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <X size={16} />
        </button>

        {/* Step Progression Indicators */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {TOUR_STEPS.map((step, idx) => (
            <button
              key={step.title}
              type="button"
              aria-label={`Go to step ${idx + 1}: ${step.title}`}
              aria-current={idx === stepIndex ? "step" : undefined}
              onClick={() => {
                setStepIndex(idx);
                if (step.tabKey) onNavigateTab(step.tabKey);
              }}
              style={{
                flex: idx === stepIndex ? 2 : 1,
                height: 8,
                padding: 0,
                border: "none",
                borderRadius: 4,
                backgroundColor:
                  idx === stepIndex
                    ? step.accentColor
                    : idx < stepIndex
                    ? "#64748B"
                    : "#334155",
                transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                cursor: "pointer",
              }}
            />
          ))}
        </div>

        {/* Hero Visual Card */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            borderRadius: 16,
            padding: "20px 24px",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: `radial-gradient(circle, ${currentStep.accentColor}25 0%, rgba(0,0,0,0) 70%)`,
              border: `1px solid ${currentStep.accentColor}55`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {currentStep.icon}
          </div>
          <div>
            <div
              style={{
                display: "inline-block",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: currentStep.accentColor,
                marginBottom: 4,
              }}
            >
              {currentStep.badge}
            </div>
            <h2
              id="welcome-tour-title"
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 800,
                color: "#FFFFFF",
                letterSpacing: "-0.02em",
              }}
            >
              {currentStep.title}
            </h2>
            <div style={{ fontSize: 13, color: "#94A3B8", marginTop: 4 }}>
              {currentStep.tagline}
            </div>
          </div>
        </div>

        {/* Detailed Explanation */}
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.6,
            color: "#CBD5E1",
          }}
        >
          {currentStep.description}
        </p>

        {/* Feature Highlights Grid */}
        <div
          style={{
            display: "grid",
            gap: 10,
            background: "#0B0E14",
            border: "1px solid #1E2533",
            borderRadius: 12,
            padding: 16,
          }}
        >
          {currentStep.highlights.map((h) => (
            <div
              key={h}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                color: "#E2E8F0",
              }}
            >
              <CheckCircle2 size={16} color={currentStep.accentColor} />
              <span>{h}</span>
            </div>
          ))}
        </div>

        {/* Navigation Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          <div style={{ fontSize: 12, color: "#94A3B8" }}>
            Step {stepIndex + 1} of {TOUR_STEPS.length}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                style={{
                  height: 42,
                  padding: "0 16px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: 10,
                  color: "#CBD5E1",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <ArrowLeft size={15} /> Back
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              style={{
                height: 42,
                padding: "0 22px",
                background: currentStep.accentColor,
                border: "none",
                borderRadius: 10,
                color: "#050B14",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                fontWeight: 700,
                boxShadow: `0 4px 14px ${currentStep.accentColor}55`,
              }}
            >
              <span>{isLast ? "Get Started" : "Continue"}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
