"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { receiveSound, sendSound } from "@/lib/sounds";

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  tapback?: string | null;
}

type Presence = "here" | "fading" | "out";
type Receipt = "delivered" | "read";

const REVEAL_MS = 700;

export default function ChatClient() {
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [loading, setLoading] = useState(true);
  const [presence, setPresence] = useState<Presence | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<Promise<void>>(Promise.resolve());

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() =>
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    );
  }, []);

  const refreshPresence = useCallback(async () => {
    try {
      const res = await fetch("/api/presence");
      if (res.ok) {
        const d = await res.json();
        if (d.presence) setPresence(d.presence);
      }
    } catch {
      /* header status is cosmetic — ignore failures */
    }
  }, []);

  // Presence poll — her status changes with her clock, not his clicks.
  useEffect(() => {
    void refreshPresence();
    const iv = setInterval(refreshPresence, 60_000);
    const onFocus = () => void refreshPresence();
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(iv);
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshPresence]);

  // Staggered reveal — bubbles land one at a time like real texts.
  const revealBubbles = useCallback(
    (bubbles: string[]) => {
      pendingRef.current = pendingRef.current.then(async () => {
        for (const [i, content] of bubbles.entries()) {
          await new Promise((r) =>
            setTimeout(r, i === 0 ? REVEAL_MS : REVEAL_MS + Math.min(content.length * 8, 1500))
          );
          setTyping(i < bubbles.length - 1);
          setMessages((m) => [
            ...m,
            {
              id: `local-${Date.now()}-${i}`,
              role: "assistant",
              content,
              created_at: new Date().toISOString(),
            },
          ]);
          receiveSound();
          scrollToBottom();
        }
        setTyping(false);
      });
      return pendingRef.current;
    },
    [scrollToBottom]
  );

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/history");
      if (res.ok) {
        const { messages, presence: p } = await res.json();
        setMessages(messages);
        if (p) setPresence(p);
      }
      setLoading(false);
      // Proactive opener — she may have a reason to text first.
      const open = await fetch("/api/opening");
      if (open.ok) {
        const { bubbles } = await open.json();
        if (bubbles?.length) {
          setTyping(true);
          scrollToBottom();
          await revealBubbles(bubbles);
        }
      }
    })();
  }, [revealBubbles, scrollToBottom]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || typing) return;
    setInput("");
    setMessages((m) => [
      ...m,
      { id: `user-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() },
    ]);
    scrollToBottom();
    setTyping(true);
    sendSound();
    const sentAt = Date.now();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.status === 402) {
        setTyping(false);
        setPaywall(true);
        return;
      }
      const data = await res.json();
      if (data.presence) setPresence(data.presence);
      if (data.tapback?.emoji) {
        // iMessage-style: her reaction lands on his last bubble.
        setMessages((m) => {
          const idx = [...m].reverse().findIndex((b) => b.role === "user");
          if (idx === -1) return m;
          const at = m.length - 1 - idx;
          return m.map((b, i) => (i === at ? { ...b, tapback: data.tapback.emoji } : b));
        });
      }
      // She's out — the message sits as Delivered. Real silence.
      if (data.asleep) {
        setTyping(false);
        return;
      }
      // Simulated latency — she's typing, not a server.
      const remaining = Math.max(0, (data.replyDelayMs ?? 0) - (Date.now() - sentAt));
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      await revealBubbles(data.bubbles ?? ["hmm"]);
    } catch {
      setTyping(false);
      await revealBubbles(["my brain just froze 😅 say that again?"]);
    }
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-white text-black">
      {/* iOS-style header — centered avatar, name, presence */}
      <header className="relative flex items-center border-b border-neutral-200 px-2 py-2">
        <span aria-hidden className="p-2 text-[#0a84ff]">
          <svg width="14" height="22" viewBox="0 0 14 22" fill="none">
            <path d="M13 1L2 11l11 10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-rose-300 to-amber-200 text-sm font-semibold text-white">
            J
          </div>
          <div className="mt-0.5 text-[13px] font-semibold leading-tight">Josefine</div>
          <div className="flex items-center gap-1 text-[10px] text-neutral-500">
            {presence === "out" ? (
              <>🌙 sleeping</>
            ) : presence === "here" || presence === "fading" ? (
              <>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#34c759]" />
                active now
              </>
            ) : (
              <>AI companion</>
            )}
          </div>
        </div>
        <div className="ml-auto p-2 text-[#0a84ff]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M12 11v5" strokeLinecap="round" />
          </svg>
        </div>
      </header>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">…</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-neutral-400">
            say hi — she&rsquo;s curious who you are
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
        {typing && <TypingDots />}
        {paywall && (
          <div className="mx-auto my-4 max-w-xs rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-center text-sm text-neutral-600">
            that&rsquo;s all the free messages for now — unlimited chatting is
            coming soon.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* iOS input bar */}
      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-neutral-200 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex-1 rounded-full border border-neutral-300 px-4 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="iMessage"
            className="w-full text-[16.5px] outline-none placeholder:text-neutral-400"
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0a84ff] text-white transition disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}

const HOUR_MS = 3_600_000;
const GAP_MS = 60 * 60_000; // timestamp separator after an hour of silence

function MessageList({ messages }: { messages: Bubble[] }) {
  // iOS groups consecutive same-sender bubbles; tail goes on the last one.
  const groups: { role: Bubble["role"]; items: Bubble[] }[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.role === m.role) last.items.push(m);
    else groups.push({ role: m.role, items: [m] });
  }

  // Receipt state for the most recent user bubble: Read once her reply
  // follows it, Delivered while it's the last word of the conversation.
  const lastUserGroupIdx = groups.map((g) => g.role).lastIndexOf("user");
  const lastUserGroup = lastUserGroupIdx >= 0 ? groups[lastUserGroupIdx] : null;
  const hasLaterAssistant = lastUserGroupIdx >= 0 && lastUserGroupIdx < groups.length - 1;
  const readAt = hasLaterAssistant
    ? groups[lastUserGroupIdx + 1].items[0]?.created_at
    : null;

  return (
    <div className="flex flex-col">
      {groups.map((g, gi) => {
        const prev = groups[gi - 1];
        const showTime =
          gi === 0 ||
          gap(g.items[0], prev?.items[prev.items.length - 1]) > GAP_MS;
        const isLastUserGroup = gi === lastUserGroupIdx;
        return (
          <div key={gi}>
            {showTime && (
              <div className="my-3 text-center text-[11px] text-neutral-400">
                {groupStamp(g.items[0].created_at)}
              </div>
            )}
            <div
              className={`mb-2 flex flex-col ${g.role === "user" ? "items-end" : "items-start"}`}
            >
              {g.items.map((m, i) => {
                const last = i === g.items.length - 1;
                return (
                  <div
                    key={m.id}
                    className={`im-bubble im-pop ${g.role === "user" ? "im-user" : "im-her"} ${last ? "im-tail" : ""} ${i > 0 ? "mt-[2px]" : ""}`}
                  >
                    {m.content}
                    {m.tapback && <div className="im-tapback">{m.tapback}</div>}
                  </div>
                );
              })}
              {isLastUserGroup && (
                <div className="mt-1 px-1 text-right text-[10px] text-neutral-400">
                  {readAt ? `Read ${formatClock(readAt)}` : "Delivered"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function gap(a: Bubble, b?: Bubble): number {
  if (!a.created_at || !b?.created_at) return 0;
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function TypingDots() {
  return (
    <div className="mb-2 flex items-start">
      <div className="im-bubble im-her im-tail flex gap-1 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="im-dot h-2 w-2 rounded-full bg-neutral-400"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** iOS-style separators: "Today 9:41 PM", "Yesterday 8:02 AM", "Sep 20, 7:15 PM". */
function groupStamp(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday = d.toDateString() === yesterday.toDateString();
  const time = formatClock(iso);
  if (sameDay) return `Today ${time}`;
  if (wasYesterday) return `Yesterday ${time}`;
  const daysAgo = (now.getTime() - d.getTime()) / 86_400_000;
  if (daysAgo < 7) {
    return `${d.toLocaleDateString([], { weekday: "long" })} ${time}`;
  }
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
