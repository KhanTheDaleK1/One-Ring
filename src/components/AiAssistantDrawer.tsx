import React, { useEffect, useRef, useState } from "react";
import { Sparkles, Send, X, Check, Wand2, RefreshCw } from "lucide-react";
import {
  aiAssistantChat,
  getAiAssistantStatus,
  installOpenCodeCli,
  type AiAssistantStatusInfo,
  type AiChatMessageItem,
  type AiProposedActionItem,
  type BiblePassageResult,
  type BibleTranslationInfo,
} from "../bridge";
import type { AppStateSnapshot, SlideCue, SlideTheme } from "../types";
import { searchSongLyrics } from "../bridge";

interface AiAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppStateSnapshot;
  onApplySong: (title: string, slides: SlideCue[]) => void;
  onApplyScripture: (reference: string, slides: SlideCue[]) => void;
  onApplyTheme: (theme: Partial<SlideTheme>) => void;
  onApplyStageMessage: (text: string) => void;
}

interface UiTurn extends AiChatMessageItem {
  id: string;
  actions?: AiProposedActionItem[];
  appliedIndices?: number[];
}

const QUICK_PROMPTS = [
  "Create a Christmas Outreach announcement slide matching our church theme",
  "Build a Welcome & Greeting announcement slide with a warm blue gradient",
  "Suggest a 4-song Sunday morning worship order with transitions",
  "Send a stage alert: 5 minutes to doors open, mic check complete",
];

function lyricsToSlides(title: string, lyrics: string): SlideCue[] {
  const lines = lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const slides: SlideCue[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const num = slides.length + 1;
    slides.push({
      id: `ai-song-${Date.now()}-${num}`,
      number: num,
      section: num === 1 ? "Verse 1" : `Slide ${num}`,
      title: `${title} - ${num}`,
      text: lines.slice(i, i + 2).join("\n"),
      kind: "lyrics",
    });
  }
  return slides;
}

export const AiAssistantDrawer: React.FC<AiAssistantDrawerProps> = ({
  isOpen,
  onClose,
  state,
  onApplySong,
  onApplyScripture,
  onApplyTheme,
  onApplyStageMessage,
}) => {
  const [status, setStatus] = useState<AiAssistantStatusInfo | null>(null);
  const [turns, setTurns] = useState<UiTurn[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm your One Ring AI Production Assistant (powered by OpenCode Free models, local Ollama, or your own endpoint). Ask me to create announcement slides, build worship sets, adjust slide themes, or send stage alerts — every action previews here before going live.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [installingCli, setInstallingCli] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideBanner, setHideBanner] = useState(() =>
    sessionStorage.getItem("onering_hide_opencode_banner") === "true"
  );
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    getAiAssistantStatus().then(setStatus).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  const installOpenCode = async () => {
    if (installingCli) return;
    setInstallingCli(true);
    setError(null);
    try {
      // The native command re-checks `status` after installing, so this turns the badge green.
      setStatus(await installOpenCodeCli());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingCli(false);
    }
  };

  const handleDismissOpenCodeBanner = () => {
    setHideBanner(true);
    sessionStorage.setItem("onering_hide_opencode_banner", "true");
  };

  if (!isOpen) return null;

  const sendMessage = async (promptText?: string) => {
    const text = (promptText ?? input).trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    const userTurn: UiTurn = { id: `u-${Date.now()}`, role: "user", content: text };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    setBusy(true);
    try {
      const history: AiChatMessageItem[] = nextTurns
        .filter((t) => t.id !== "welcome")
        .slice(-8)
        .map((t) => ({ role: t.role, content: t.content }));
      const context = {
        serviceName: state.serviceName,
        songs: (state.slides.songs || []).map((s) => ({ title: s.title, slideCount: s.slides.length })),
        activeSlideTitle: (state.slides.slides || [])[(state.slides.currentSlide || 1) - 1]?.title ?? null,
        theme: state.slides.theme,
        cueCount: state.cues.length,
      };
      const res = await aiAssistantChat(text, history.slice(0, -1), context);
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: res.reply,
          actions: res.actions,
          appliedIndices: [],
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applyAction = (turnId: string, actionIdx: number, action: AiProposedActionItem) => {
    const p = action.payload || {};
    if (action.kind === "add_announcement_slide") {
      const eyebrow = String(p.eyebrow ?? "ANNOUNCEMENT").trim();
      const title = String(p.title ?? "Church Announcement").trim();
      const subtitle = String(p.subtitle ?? "").trim();
      const cta = String(p.cta ?? "").trim();
      const body = String(p.body ?? "").trim();
      const lines = [eyebrow, title, subtitle, cta, body].filter(Boolean);
      const slide: SlideCue = {
        id: `ai-announce-${Date.now()}`,
        number: 1,
        section: eyebrow || "Announcement",
        title,
        text: lines.join("\n"),
        kind: "title",
      };
      onApplySong(title, [slide]);
      if (typeof p.backgroundColor === "string" || typeof p.gradientTo === "string") {
        onApplyTheme({
          backgroundType: p.gradientTo ? "gradient" : "solid",
          ...(typeof p.backgroundColor === "string" ? { backgroundColor: p.backgroundColor } : {}),
          ...(typeof p.gradientTo === "string" ? { gradientTo: p.gradientTo } : {}),
          ...(typeof p.accentColor === "string" ? { lowerThirdAccent: p.accentColor } : {}),
        });
      }
    } else if (action.kind === "add_song") {
      // If the backend enrichment already provided pre-resolved slides, use them.
      // Otherwise, fall back to searching for lyrics in the frontend.
      const rawSlides = Array.isArray(p.slides) ? (p.slides as Partial<SlideCue>[]) : undefined;
      if (rawSlides && rawSlides.length > 0) {
        const title = String(p.title ?? "New Song").trim();
        const ts = Date.now();
        const normalized: SlideCue[] = rawSlides.map((s, idx) => ({
          id: typeof s.id === "string" && s.id.trim() ? s.id : `ai-song-${ts}-${idx + 1}`,
          number: typeof s.number === "number" && s.number > 0 ? s.number : idx + 1,
          section: typeof s.section === "string" && s.section.trim() ? s.section : "Verse",
          title: typeof s.title === "string" && s.title.trim() ? s.title : `${title} - ${idx + 1}`,
          text: String(s.text ?? ""),
          kind: s.kind || "lyrics",
        }));
        onApplySong(title, normalized);
      } else {
        // No pre-resolved slides (e.g. browser preview mode) — search for lyrics frontend.
        const title = String(p.title ?? "New Song").trim();
        searchSongLyrics(title, undefined, true).then((results) => {
          if (results.length > 0) {
            const song = results[0];
            // Balance lyrics into slides: split into word-bounded lines, ~46 chars per line, 2 lines per slide
            const rawLyrics = song.lyrics;
            const lines: string[] = rawLyrics.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
            const balancedLines: string[] = [];
            let currentLineSet: string[] = [];
            let currentChars = 0;
            for (const line of lines) {
              const lineLen = line.length;
              if (currentChars + lineLen > 46 && currentLineSet.length > 0) {
                balancedLines.push(currentLineSet.join(" "));
                currentLineSet = [];
                currentChars = 0;
              }
              currentLineSet.push(line);
              currentChars += lineLen;
            }
            if (currentLineSet.length > 0) {
              balancedLines.push(currentLineSet.join(" "));
            }
            // Chunk into 2-line slides
            const slides: SlideCue[] = [];
            for (let i = 0; i < balancedLines.length; i += 2) {
              const chunk = balancedLines.slice(i, i + 2);
              const num = slides.length + 1;
              slides.push({
                id: `ai-song-${Date.now()}-${num}`,
                number: num,
                section: num === 1 ? "Verse 1" : `Slide ${num}`,
                title: `${title} - ${num}`,
                text: chunk.join("\n"),
                kind: "lyrics",
              });
            }
            if (slides.length > 0) {
              onApplySong(title, slides);
            }
          } else {
            // No results found — try using the title as fallback lyrics
            const title = String(p.title ?? "New Song").trim();
            const slides = lyricsToSlides(title, title);
            if (slides.length > 0) onApplySong(title, slides);
          }
        }).catch(() => {
          // Search failed — try fallback
          const title = String(p.title ?? "New Song").trim();
          const slides = lyricsToSlides(title, title);
          if (slides.length > 0) onApplySong(title, slides);
        });
      }
    } else if (action.kind === "add_scripture") {
      const reference = String(p.reference ?? "").trim();
      const translation = String(p.translation ?? "ESV").trim();
      if (!reference) return;
      // The backend enrichment step populates payload.slides with 1-2 verses per slide.
      // If slides are already resolved (backend mode), use them directly.
      const slides = p.slides as SlideCue[] | undefined;
      if (slides && slides.length > 0) {
        onApplyScripture(reference, slides);
      } else {
        // Fallback mode (e.g. browser preview): create simple slides from the reference.
        // We'll generate 1-2 verse slides using a basic text representation.
        // In a full implementation, this would call the Bible API, but for now we use
        // the reference as the slide text.
        const slides: SlideCue[] = [
          {
            id: `ai-scripture-${Date.now()}`,
            number: 1,
            section: reference,
            title: reference,
            text: reference,
            kind: "scripture",
          }
        ];
        onApplyScripture(reference, slides);
      }
    } else if (action.kind === "update_theme") {
      const patch: Partial<SlideTheme> = {};
      if (p.backgroundType === "solid" || p.backgroundType === "gradient" || p.backgroundType === "image") {
        patch.backgroundType = p.backgroundType;
      }
      if (typeof p.backgroundColor === "string") patch.backgroundColor = p.backgroundColor;
      if (typeof p.gradientTo === "string") patch.gradientTo = p.gradientTo;
      if (typeof p.textColor === "string") patch.textColor = p.textColor;
      if (typeof p.accentColor === "string") patch.lowerThirdAccent = p.accentColor;
      if (typeof p.fontSize === "number") patch.fontSize = p.fontSize;
      onApplyTheme(patch);
    } else if (action.kind === "set_stage_message") {
      const text = String(p.text ?? "").trim();
      if (text) onApplyStageMessage(text);
    }

    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId
          ? { ...t, appliedIndices: Array.from(new Set([...(t.appliedIndices || []), actionIdx])) }
          : t
      )
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Production Assistant"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(440px, 96vw)",
        background: "#0B0F17",
        borderLeft: "1px solid #252C38",
        boxShadow: "-12px 0 36px rgba(0,0,0,0.6)",
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #1E2533",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Sparkles size={17} color="#A78BFA" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#F8FAFC" }}>AI Production Assistant</div>
            <div className="mono" style={{ fontSize: 10.5, color: status?.available ? "#34D399" : "#FBBF24", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {status ? `${status.provider} · ${status.model}` : "Checking provider..."}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => getAiAssistantStatus().then(setStatus).catch(() => {})}
            title="Refresh AI provider status"
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            aria-label="Close AI Assistant"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Status notice */}
      {status && !status.available && (
        <div style={{ padding: "8px 14px", background: "#1F170A", borderBottom: "1px solid #78350F", fontSize: 11.5, color: "#FDE68A" }}>
          {status.detail}
        </div>
      )}

      {/* One-click CLI install */}
      {!status?.opencodeInstalled && !hideBanner && (
        <div
          style={{
            padding: "10px 14px",
            background: "#0F172A",
            borderBottom: "1px solid #1E3A5F",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 11.5, color: "#94A3B8", lineHeight: 1.4 }}>
            Install the free local CLI to unlock the built-in models without configuring an API key.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {status && !status.opencodeInstalled && !installingCli && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void installOpenCode()}
                style={{ flexShrink: 0 }}
              >
                Install OpenCode CLI (Free)
              </button>
            )}
            <button
              type="button"
              onClick={handleDismissOpenCodeBanner}
              title="Hide this banner for this session"
              style={{
                background: "transparent",
                border: "none",
                color: "#6B728C",
                cursor: "pointer",
                padding: 0,
                fontSize: 12,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Quick Prompts */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #1E2533", display: "flex", flexWrap: "wrap", gap: 6 }}>
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => void sendMessage(q)}
            style={{
              background: "#131926",
              border: "1px solid #2A3446",
              color: "#CBD5E1",
              borderRadius: 999,
              padding: "4px 10px",
              fontSize: 11,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Wand2 size={10} style={{ marginRight: 5, verticalAlign: "middle", color: "#A78BFA" }} />
            {q.length > 42 ? `${q.slice(0, 42)}…` : q}
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {turns.map((turn) => (
          <div
            key={turn.id}
            style={{
              alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              background: turn.role === "user" ? "#1E3A8A" : "#141A26",
              border: `1px solid ${turn.role === "user" ? "#3B82F6" : "#252C38"}`,
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "#F1F5F9",
              whiteSpace: "pre-wrap",
            }}
          >
            {turn.content}
            {turn.actions && turn.actions.length > 0 && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {turn.actions.map((act, idx) => {
                  const applied = turn.appliedIndices?.includes(idx);
                  return (
                    <div
                      key={`${turn.id}-act-${idx}`}
                      style={{
                        background: "#0B0F17",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        padding: "8px 10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 10, color: "#A78BFA", textTransform: "uppercase" }}>
                          {act.kind.replace(/_/g, " ")}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#F8FAFC" }}>{act.label}</div>
                      </div>
                      <button
                        type="button"
                        className={applied ? "btn btn-sm" : "btn btn-sm btn-primary"}
                        onClick={() => applyAction(turn.id, idx, act)}
                        style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}
                      >
                        {applied ? <><Check size={12} /> Applied</> : "Apply"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Apply All button: show when 2+ unapplied actions exist in the turn */}
            {turn.actions && turn.actions.length >= 2 && ((turn.appliedIndices as number[])?.length || 0) < turn.actions.length && (
              <div style={{ marginTop: 8, padding: 6, background: "#1A222A", borderRadius: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    // Apply all unapplied actions in this turn
                    const actions = turn.actions as AiProposedActionItem[];
                    const appliedCount = ((turn.appliedIndices as number[])?.length || 0);
                    const unappliedIndices = actions
                      .map((_act, i) => i)
                      .filter((i) => !((turn.appliedIndices as number[])?.[i] === undefined));
                    unappliedIndices.forEach((i) => applyAction(turn.id, i, actions[i]));
                  }}
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: "#2563EB",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    padding: "4px 8px",
                    fontSize: 10,
                    minWidth: 60,
                  }}>
                  Apply All ({turn.actions.length - ((turn.appliedIndices as number[]).length || 0)})
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ fontSize: 12, color: "#A78BFA", padding: "4px 6px" }}>
            Thinking with {status?.model || "AI"}…
          </div>
        )}
        {error && (
          <div role="alert" style={{ fontSize: 12, color: "#FCA5A5", background: "#450A0A", padding: "8px 10px", borderRadius: 6 }}>
            {error}
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage();
        }}
        style={{
          padding: 12,
          borderTop: "1px solid #1E2533",
          display: "flex",
          gap: 8,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe slides, songs, themes, or cues…"
          aria-label="Ask AI Production Assistant"
          disabled={busy}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "9px 12px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#0F172A",
            color: "#F8FAFC",
            fontSize: 13,
          }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !input.trim()}
          aria-label="Send message to AI Assistant"
          style={{ padding: "0 14px", display: "flex", alignItems: "center", gap: 6 }}
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
};