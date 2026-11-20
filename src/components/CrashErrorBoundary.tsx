import React from "react";
import {
  openUrl,
  recordFrontendCrash,
  sanitizeCrashText,
  UPDATE_REPO_URL,
} from "../bridge";
import type { CrashReportSummary } from "../types";

const ISSUE_TITLE = "One Ring crash report";
const GLOBAL_DEBOUNCE_MS = 1500;

/** Resolve the configured update repository to a generic issue-composer base URL. */
function issueComposerBase(): string | null {
  const configured = UPDATE_REPO_URL.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:" || !/^github\.com$/i.test(parsed.hostname)) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, "");
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    return `https://github.com/${owner}/${repo}/issues/new`;
  } catch {
    // Build configuration may also be a plain owner/name slug.
    const slug = /^([\w.-]+\/[\w.-]+)$/.exec(configured);
    return slug ? `https://github.com/${slug[1]}/issues/new` : null;
  }
}

/** Minimum details needed to compose a shareable, sanitized issue report. */
export type CrashIssueDetails = Pick<CrashReportSummary, "message" | "stack"> &
  Partial<CrashReportSummary>;

/** Build a pre-filled, sanitized issue link, or null when no repository is configured. */
export function buildCrashIssueUrl(report?: CrashIssueDetails | null): string | null {
  const base = issueComposerBase();
  if (!base) return null;

  const rawMessage = sanitizeCrashText(report?.message ?? "Frontend error").split("\n")[0];
  const title = `${ISSUE_TITLE}: ${rawMessage.slice(0, 90) || "Frontend error"}`;
  const body = report
    ? [
        "A sanitized crash log was recorded by One Ring.",
        "",
        `Timestamp (UTC): ${sanitizeCrashText(report.timestampUtc ?? "")}`,
        `App version: ${sanitizeCrashText(report.appVersion ?? "")}`,
        `Kind: ${sanitizeCrashText(report.kind ?? "frontend")}`,
        `Fingerprint: ${sanitizeCrashText(report.fingerprint ?? "")}`,
        "",
        "Message:",
        sanitizeCrashText(report.message),
        "",
        "Stack:",
        "```",
        sanitizeCrashText(report.stack),
        "```",
      ].join("\n")
    : "A sanitized crash log was recorded. Copy it from the recovery screen before filing this report.";

  const query = new URLSearchParams({ title, body: body.slice(0, 6000) });
  return `${base}?${query.toString()}`;
}

interface QueuedFrontendCrash {
  message: string;
  stack: string;
  componentStack: string;
  count: number;
}

let globalHandlersInstalled = false;
let globalDebounceTimer: number | null = null;
let queuedCrash: QueuedFrontendCrash | null = null;

function queueGlobalCrash(message: string, stack: string, componentStack: string): void {
  const safeMessage = sanitizeCrashText(message).slice(0, 500) || "Unhandled frontend error";
  if (queuedCrash && queuedCrash.message === safeMessage) {
    queuedCrash.count += 1;
  } else {
    queuedCrash = {
      message: safeMessage,
      stack: sanitizeCrashText(stack).slice(0, 6000),
      componentStack: sanitizeCrashText(componentStack).slice(0, 2000),
      count: 1,
    };
  }

  // A burst of identical errors is recorded once, after the stream goes quiet.
  if (globalDebounceTimer !== null) window.clearTimeout(globalDebounceTimer);
  globalDebounceTimer = window.setTimeout(() => {
    globalDebounceTimer = null;
    const pending = queuedCrash;
    queuedCrash = null;
    if (!pending) return;
    const suffix = pending.count > 1 ? ` (repeated ${pending.count} times)` : "";
    void recordFrontendCrash(
      `${pending.message}${suffix}`,
      pending.stack,
      pending.componentStack
    ).catch(() => undefined);
  }, GLOBAL_DEBOUNCE_MS);
}

function rejectionMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message || "Unhandled promise rejection";
  if (typeof reason === "string" && reason.trim()) return reason;
  return "Unhandled promise rejection";
}

/** Install the one-time global JS error listeners. Safe to call from a strict-mode double mount. */
export function installGlobalFrontendCrashHandlers(): void {
  if (globalHandlersInstalled || typeof window === "undefined") return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : null;
    queueGlobalCrash(
      error?.message || event.message || "Unhandled frontend error",
      error?.stack ?? "",
      ""
    );
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    queueGlobalCrash(
      rejectionMessage(reason),
      reason instanceof Error ? reason.stack ?? "" : "",
      ""
    );
  });
}

interface CrashErrorBoundaryState {
  error: Error | null;
  copied: boolean;
}

/** Last-resort React boundary: records a sanitized log and offers calm recovery actions. */
export class CrashErrorBoundary extends React.Component<
  React.PropsWithChildren,
  CrashErrorBoundaryState
> {
  state: CrashErrorBoundaryState = { error: null, copied: false };
  private recorded = false;
  private componentStack = "";

  static getDerivedStateFromError(error: Error): CrashErrorBoundaryState {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (this.recorded) return;
    this.recorded = true;
    this.componentStack = info.componentStack || "";
    void recordFrontendCrash(error.message, error.stack || "", this.componentStack).catch(
      () => undefined
    );
  }

  private copySanitizedLog = async (): Promise<void> => {
    const error = this.state.error;
    if (!error) return;
    const log = sanitizeCrashText(
      [error.message, error.stack || "", "component stack:", this.componentStack].join("\n")
    );
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(log);
      } else {
        const field = document.createElement("textarea");
        field.value = log;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) return;
      }
      this.setState({ copied: true });
    } catch {
      // Clipboard access can be denied by the host; the log stays on screen in the issue link.
    }
  };

  render(): React.ReactNode {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    const issueUrl = buildCrashIssueUrl({
      message: error.message,
      stack: [error.stack || "", this.componentStack].filter(Boolean).join("\n\n"),
    });
    const buttonStyle: React.CSSProperties = {
      minHeight: 38,
      padding: "0 14px",
      borderRadius: 8,
      border: "1px solid #3B82F6",
      background: "#1C222D",
      color: "#DBEAFE",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
    };

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#0B0D10",
          color: "#F3F4F6",
          fontFamily: "inherit",
        }}
      >
        <div
          style={{
            width: "min(520px, 100%)",
            padding: 28,
            borderRadius: 14,
            background: "#14181F",
            border: "1px solid #2A3241",
            display: "grid",
            gap: 14,
            boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#60A5FA" }}>
            ONE RING
          </div>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.01em" }}>
            One Ring paused to protect your show
          </h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#9CA3AF" }}>
            An unexpected interface error occurred. A sanitized crash log was recorded locally —
            your show files and saved settings were not changed.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "#6B7280" }}>
            You can keep the log for support, open a pre-filled issue, or reload the app to return
            to the booth.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
            <button type="button" style={buttonStyle} onClick={() => window.location.reload()}>
              Reload One Ring
            </button>
            <button type="button" style={buttonStyle} onClick={() => void this.copySanitizedLog()}>
              {copied ? "Copied Sanitized Crash Log" : "Copy Sanitized Crash Log"}
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, opacity: issueUrl ? 1 : 0.5 }}
              disabled={!issueUrl}
              title={
                issueUrl
                  ? "Open a pre-filled issue with the sanitized log"
                  : "Configure a repository URL to enable issue reporting"
              }
              onClick={() => {
                if (issueUrl) void openUrl(issueUrl);
              }}
            >
              Open GitHub Issue
            </button>
          </div>
        </div>
      </div>
    );
  }
}
