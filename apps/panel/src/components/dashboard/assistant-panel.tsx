"use client";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  Bot,
  User as UserIcon,
  TerminalSquare,
  Check,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import { api } from "@/lib/client";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** suggested console commands attached to an assistant message */
  commands?: string[];
  /** which engine produced this reply */
  source?: "ai" | "rules";
}

interface AssistantResponse {
  reply: string;
  suggestedCommands?: string[];
  source: "ai" | "rules";
}

const SUGGESTIONS = [
  "Why won't my server start?",
  "How do I add a plugin?",
  "Set the difficulty to hard",
  "Where are my backups?",
];

/**
 * AI Server Copilot — a per-server chat assistant. Talks to
 * /api/servers/:id/assistant, which answers using the server's live context.
 * When the user holds `control.command`, suggested commands render as clickable
 * chips that run via the existing /api/servers/:id/command endpoint.
 *
 * `detail` is the server-detail payload (so we can show the game/state header
 * and decide command-permission from its scopes). Works with zero AI config —
 * the backend falls back to a deterministic rule-based helper.
 */
export function AssistantPanel({ id, detail }: { id: string; detail: any }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranCommand, setRanCommand] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scopes: string[] = detail?.scopes ?? [];
  const canCommand = scopes.includes("control.command") || scopes.includes("*");
  const serverName: string = detail?.server?.name ?? "this server";
  const game: string = detail?.server?.game ?? "";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    setInput("");

    const history: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(history);
    setBusy(true);
    try {
      const res = await api<AssistantResponse>(`/api/servers/${id}/assistant`, {
        method: "POST",
        // Send only role/content — strip UI-only fields.
        json: { messages: history.map((m) => ({ role: m.role, content: m.content })) },
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.reply,
          commands: res.suggestedCommands,
          source: res.source,
        },
      ]);
    } catch (e: any) {
      setError(e.message || "The copilot is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(cmd: string) {
    if (!canCommand) return;
    setError(null);
    try {
      await api(`/api/servers/${id}/command`, { method: "POST", json: { command: cmd } });
      setRanCommand(cmd);
      setTimeout(() => setRanCommand((c) => (c === cmd ? null : c)), 2500);
    } catch (e: any) {
      setError(e.message || "Could not send the command.");
    }
  }

  return (
    <div className="glass flex h-[640px] flex-col overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-cyan-violet/20">
          <Sparkles className="h-4 w-4 text-cyan" />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold text-white">Server Copilot</h3>
          <p className="truncate text-xs text-white/40">
            Ask anything about <span className="text-white/60">{serverName}</span>
          </p>
        </div>
      </div>

      {/* message list */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-black/30">
              <Bot className="h-7 w-7 text-violet" />
            </span>
            <div>
              <p className="font-display text-white">How can I help with this server?</p>
              <p className="mt-1 max-w-sm text-sm text-white/45">
                I know your game, version, state and startup settings. Ask a question or pick one below.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.filter((s) => game === "minecraft" || !/plugin|difficulty/i.test(s)).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition hover:border-cyan/40 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <span
              className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 ${
                m.role === "user" ? "bg-white/5" : "bg-cyan-violet/20"
              }`}
            >
              {m.role === "user" ? (
                <UserIcon className="h-3.5 w-3.5 text-white/60" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-cyan" />
              )}
            </span>
            <div className={`min-w-0 max-w-[80%] ${m.role === "user" ? "items-end text-right" : ""}`}>
              <div
                className={`inline-block whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-left text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-cyan-violet/15 text-white"
                    : "border border-white/10 bg-black/25 text-white/85"
                }`}
              >
                {m.content}
              </div>

              {/* suggested command chips */}
              {m.role === "assistant" && m.commands && m.commands.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/35">
                    <Wand2 className="h-3 w-3" /> Suggested actions
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {m.commands.map((cmd) => (
                      <button
                        key={cmd}
                        disabled={!canCommand}
                        onClick={() => runCommand(cmd)}
                        title={canCommand ? "Run this command on the server" : "You don't have permission to send commands"}
                        className="group inline-flex items-center gap-1.5 rounded-lg border border-cyan/25 bg-cyan/10 px-2.5 py-1.5 font-mono text-xs text-cyan-light transition hover:bg-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {ranCommand === cmd ? (
                          <Check className="h-3.5 w-3.5 text-online" />
                        ) : (
                          <TerminalSquare className="h-3.5 w-3.5" />
                        )}
                        {cmd}
                      </button>
                    ))}
                  </div>
                  {!canCommand && (
                    <p className="text-[11px] text-white/30">
                      You need the <span className="text-white/50">Send commands</span> permission to apply these.
                    </p>
                  )}
                </div>
              )}

              {m.role === "assistant" && m.source === "rules" && (
                <p className="mt-1 text-[10px] text-white/25">Offline assistant</p>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-3">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-cyan-violet/20">
              <Sparkles className="h-3.5 w-3.5 text-cyan" />
            </span>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 py-2.5 text-sm text-white/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan" /> Thinking…
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-5 mb-2 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-white/10 px-4 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the copilot…"
          disabled={busy}
          className="input flex-1"
        />
        <button type="submit" disabled={busy || !input.trim()} className="btn-primary shrink-0 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
