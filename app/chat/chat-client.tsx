"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

const REVEAL_MS = 900;

export default function ChatClient() {
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<Promise<void>>(Promise.resolve());

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() =>
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    );
  }, []);

  // Staggered reveal — bubbles appear one at a time like real texts.
  const revealBubbles = useCallback(
    (bubbles: string[]) => {
      pendingRef.current = pendingRef.current.then(async () => {
        for (const [i, content] of bubbles.entries()) {
          await new Promise((r) => setTimeout(r, i === 0 ? REVEAL_MS : REVEAL_MS + Math.min(content.length * 8, 1500)));
          setTyping(i < bubbles.length - 1);
          setMessages((m) => [
            ...m,
            { id: `local-${Date.now()}-${i}`, role: "assistant", content },
          ]);
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
        const { messages } = await res.json();
        setMessages(messages);
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
      // She's out (asleep/gone) — the message lands with no reply. Real silence.
      if (data.asleep) {
        setTyping(false);
        return;
      }
      // Simulated latency — she's typing, not a server. The typing indicator
      // IS the anticipation; honor the delay the server computed.
      const remaining = Math.max(0, (data.replyDelayMs ?? 0) - (Date.now() - sentAt));
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      await revealBubbles(data.bubbles ?? ["hmm"]);
    } catch {
      setTyping(false);
      await revealBubbles(["my brain just froze 😅 say that again?"]);
    }
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-neutral-950 text-neutral-100">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-neutral-900 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-amber-300 text-sm font-semibold text-neutral-950">
          J
        </div>
        <div>
          <div className="text-sm font-medium leading-tight">Josefine</div>
          <div className="text-[11px] text-neutral-500">AI companion</div>
        </div>
      </header>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-600">
            …
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-neutral-500">
            say hi — she&rsquo;s curious who you are
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
        {typing && <TypingDots />}
        {paywall && (
          <div className="mx-auto my-4 max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-center text-sm text-neutral-300">
            that&rsquo;s all the free messages for now — unlimited chatting is
            coming soon.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* input */}
      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-neutral-900 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message"
          className="flex-1 rounded-full border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-[15px] outline-none placeholder:text-neutral-500 focus:border-neutral-600"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-400 text-neutral-950 transition hover:bg-rose-300 disabled:opacity-30"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}

function MessageList({ messages }: { messages: Bubble[] }) {
  // Group consecutive same-role bubbles; timestamps only at group ends.
  const groups: { role: Bubble["role"]; items: Bubble[] }[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.role === m.role) last.items.push(m);
    else groups.push({ role: m.role, items: [m] });
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, gi) => (
        <div
          key={gi}
          className={`flex flex-col gap-1 ${g.role === "user" ? "items-end" : "items-start"}`}
        >
          {g.items.map((m) => (
            <div
              key={m.id}
              className={
                g.role === "user"
                  ? "max-w-[78%] rounded-2xl rounded-br-md bg-rose-400 px-3.5 py-2 text-[15px] leading-snug text-neutral-950"
                  : "max-w-[78%] rounded-2xl rounded-bl-md bg-neutral-800 px-3.5 py-2 text-[15px] leading-snug"
              }
            >
              {m.content}
            </div>
          ))}
          {g.items[g.items.length - 1]?.created_at && (
            <div className="px-1 text-[10px] text-neutral-600">
              {formatTime(g.items[g.items.length - 1].created_at!)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="mt-1 flex items-start">
      <div className="flex gap-1 rounded-2xl rounded-bl-md bg-neutral-800 px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}
