export interface MobileDetectResult {
  isMobile: boolean;
  isTablet: boolean;
  platform: "android" | "ios" | "desktop";
}

export function isMobile(): MobileDetectResult {
  if (typeof window === "undefined") {
    return { isMobile: false, isTablet: false, platform: "desktop" };
  }

  const userAgent = navigator.userAgent;
  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/.test(userAgent);

  // Check for Tauri desktop with coarse pointer (external display / window capture scenarios)
  const hasCoarsePointer = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

  let platform: "android" | "ios" | "desktop" = "desktop";
  let isMobile = false;
  let isTablet = false;

  if (isAndroid) {
    platform = "android";
    isMobile = !/Tablet/.test(userAgent);
    isTablet = /Tablet/.test(userAgent);
  } else if (isIOS) {
    platform = "ios";
    isMobile = !/iPad/.test(userAgent);
    isTablet = /iPad/.test(userAgent);
  } else if (hasCoarsePointer) {
    // Tauri desktop with touch-capable/coarse pointer (e.g. external display, touch screen on desktop)
    platform = "desktop";
    isMobile = true;
    isTablet = false;
  }

  return { isMobile, isTablet, platform };
}

/**
 * Feature list that is only available in the desktop Tauri app.
 * These features require native OS access (window capture, local FFmpeg, OpenCode CLI, external displays).
 */
export const DESKTOP_ONLY = [
  "window_capture",
  "local_ffmpeg_install",
  "opencode_cli_install",
  "external_displays",
] as const;

export type DesktopOnlyFeature = typeof DESKTOP_ONLY[number];