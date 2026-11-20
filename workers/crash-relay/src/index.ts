interface CrashReport {
  id: string;
  timestampUtc: string;
  appVersion: string;
  os: string;
  arch: string;
  kind: string;
  message: string;
  location: string;
  stack: string;
  fingerprint: string;
}

interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
}

interface Issue {
  number: number;
  html_url: string;
  body?: string | null;
}

const MAX_BODY_BYTES = 64 * 1024;
const KINDS = new Set(["rust_panic", "frontend_error"]);
const FINGERPRINT_MARKER = "<!-- crash-fingerprint:";
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

function reply(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isValidReport(value: unknown): value is CrashReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Record<string, unknown>;
  const strings = [
    "id",
    "timestampUtc",
    "appVersion",
    "os",
    "arch",
    "kind",
    "message",
    "location",
    "stack",
    "fingerprint",
  ];
  if (!strings.every((key) => isString(report[key]))) return false;
  if (!KINDS.has(report.kind as string)) return false;
  if (!(report.id as string).length || (report.id as string).length > 128) return false;
  if (!/^[a-f0-9]{16}$/.test(report.fingerprint as string)) return false;
  if (!(report.message as string).trim()) return false;
  return true;
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? "").trim().slice(0, 160) || "unknown failure";
}

function summary(report: CrashReport): string {
  return [
    `**Kind:** \`${report.kind}\``,
    `**Fingerprint:** \`${report.fingerprint}\``,
    `**Version:** ${report.appVersion} (${report.os}/${report.arch})`,
    `**Reported:** ${report.timestampUtc}`,
    `**Location:** ${report.location}`,
    "",
    "**Message:**",
    "```text",
    report.message,
    "```",
    "",
    "<details><summary>Stack</summary>",
    "",
    "```text",
    report.stack || "(none)",
    "```",
    "",
    "</details>",
  ].join("\n");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return reply({ ok: false, error: "POST required" }, 405);
    }

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return reply({ ok: false, error: "Crash report exceeds 64 KiB" }, 413);
    }

    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return reply({ ok: false, error: "Crash report exceeds 64 KiB" }, 413);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return reply({ ok: false, error: "Malformed JSON" }, 400);
    }
    if (!isValidReport(payload)) {
      return reply({ ok: false, error: "Invalid crash report fields" }, 400);
    }
    const report = payload;

    const token = (env.GITHUB_TOKEN ?? "").trim();
    const repo = (env.GITHUB_REPO ?? "").trim();
    if (!token || !repo || !REPO_PATTERN.test(repo)) {
      return reply({ ok: false, error: "Relay is not configured" }, 503);
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "one-ring-crash-relay",
    };
    const api = `https://api.github.com/repos/${repo}`;
    const marker = `${FINGERPRINT_MARKER} ${report.fingerprint} -->`;

    const lookup = await fetch(`${api}/issues?state=open&labels=crash&per_page=100`, { headers });
    if (!lookup.ok) {
      return reply({ ok: false, error: "Issue lookup failed" }, 502);
    }
    const issues = (await lookup.json()) as Issue[];
    const existing = issues.find((issue) => (issue.body ?? "").includes(marker));

    if (existing) {
      const commented = await fetch(`${api}/issues/${existing.number}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: `Another occurrence:\n\n${summary(report)}` }),
      });
      if (!commented.ok) {
        return reply({ ok: false, error: "Issue comment failed" }, 502);
      }
      return reply({ ok: true, issueUrl: existing.html_url, deduplicated: true }, 200);
    }

    const created = await fetch(`${api}/issues`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: `[Crash] ${report.kind}: ${firstLine(report.message)}`.slice(0, 200),
        body: `${marker}\n\n${summary(report)}`,
        labels: ["bug", "crash"],
      }),
    });
    if (!created.ok) {
      return reply({ ok: false, error: "Issue creation failed" }, 502);
    }
    const issue = (await created.json()) as { html_url: string };
    return reply({ ok: true, issueUrl: issue.html_url, deduplicated: false }, 201);
  },
};
