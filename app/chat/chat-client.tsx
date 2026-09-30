"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { receiveSound, sendSound } from "@/lib/sounds";
import { getBrowserSupabase } from "@/lib/supabase/client";
import ClaimSheet from "./claim-sheet";
import ProfileSheet from "./profile-sheet";

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  tapback?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REVEAL_MS = 700;
/** She stays "online" this long after her last message before drifting to "last seen". */
const ONLINE_LINGER_MS = 3 * 60_000;
/** Re-render cadence so "last seen Xm ago" ages and online expires. */
const TICK_MS = 15_000;

const maxIso = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : a > b ? a : b;

export default function ChatClient() {
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Her most recent message's timestamp — drives "last seen"/online. */
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  /** "Read" stamp on his last bubble once she picks it up (typing starts). */
  const [pendingReadAt, setPendingReadAt] = useState<string | null>(null);
  /** `now` state (not render-time Date.now) keeps the status line pure. */
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [plan, setPlan] = useState<"free" | "unlimited">("free");
  const [relationship, setRelationship] = useState<{
    knownSince: string | null;
    daysKnown: number;
    stage: string;
  } | null>(null);
  /** Anonymous guest vs claimed account — gates the claim wall + sheet rows. */
  const [anonymous, setAnonymous] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  /** Guest-create or network failure on mount — unrecoverable inline state. */
  const [guestFailed, setGuestFailed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  const sendingRef = useRef(false);
  /** Message that hit the claim wall — resent once the account is claimed. */
  const blockedTextRef = useRef<string | null>(null);

  const scrollToBottom = useCallback((instant = false) => {
    const go = () =>
      bottomRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth" });
    // instant: double rAF so it lands after the fresh messages have painted
    if (instant) requestAnimationFrame(() => requestAnimationFrame(go));
    else requestAnimationFrame(go);
  }, []);

  const refreshPresence = useCallback(async () => {
    try {
      const res = await fetch("/api/presence");
      if (res.ok) {
        const d = await res.json();
        if (d.lastSeenAt) setLastSeenAt((cur) => maxIso(cur, d.lastSeenAt));
      }
    } catch {
      /* header status is cosmetic — ignore failures */
    }
  }, []);

  // Status-label tick — ages "last seen", expires "online" on schedule.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(iv);
  }, []);

  // Presence poll — her status changes with her clock, not his clicks.
  useEffect(() => {
    const kick = setTimeout(() => void refreshPresence(), 0);
    const iv = setInterval(refreshPresence, 60_000);
    const onFocus = () => void refreshPresence();
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(kick);
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
          await sleep(i === 0 ? REVEAL_MS : REVEAL_MS + Math.min(content.length * 8, 1500));
          setTyping(i < bubbles.length - 1);
          setLastSeenAt(new Date().toISOString()); // she's here — the linger clock starts
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

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/history");
    if (res.ok) {
      const { messages, plan: p, relationship } = await res.json();
      setMessages(messages);
      if (p) setPlan(p);
      if (relationship) setRelationship(relationship);
      const lastHer = [...messages].reverse().find((m: Bubble) => m.role === "assistant");
      if (lastHer?.created_at) setLastSeenAt(lastHer.created_at);
    }
    setLoading(false);
  }, []);

  const tryOpening = useCallback(async () => {
    const open = await fetch("/api/opening");
    if (open.ok) {
      const { bubbles } = await open.json();
      if (bubbles?.length) {
        setTyping(true);
        scrollToBottom();
        await revealBubbles(bubbles);
      }
    }
  }, [revealBubbles, scrollToBottom]);

  // Bootstrap: no session → mint an anonymous guest, then load normally.
  // Guests reach chat unauthenticated by design — the session is created
  // lazily here, not in the proxy, so crawlers never mint user rows.
  useEffect(() => {
    void (async () => {
      const { data } = await getBrowserSupabase().auth.getUser();
      let user = data.user;
      if (!user) {
        const res = await fetch("/api/auth/guest", { method: "POST" }).catch(
          () => null
        );
        if (!res?.ok) {
          setGuestFailed(true);
          setLoading(false);
          return;
        }
        ({ data: { user } } = await getBrowserSupabase().auth.getUser());
      }
      setAnonymous(user?.is_anonymous === true);
      await loadHistory();
      scrollToBottom(true); // open at the newest message, not the top
      await tryOpening(); // proactive opener — she may have a reason to text first
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendText(text: string, echoLocal = true) {
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");
    setPendingReadAt(null);
    if (echoLocal) {
      setMessages((m) => [
        ...m,
        { id: `user-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() },
      ]);
    }
    scrollToBottom();
    sendSound();
    const sentAt = Date.now();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.status === 403) {
        // Guest cap → claim wall. The bubble stays on screen; after a
        // successful claim we resend the same text (echoLocal=false — it's
        // already rendered, and the server never persisted it).
        blockedTextRef.current = text;
        setClaimOpen(true);
        return;
      }
      if (res.status === 402) {
        setPaywall(true);
        return;
      }
      const data = await res.json();
      if (data.tapback?.emoji) {
        // iMessage-style: her reaction lands on his last bubble.
        setMessages((m) => {
          const idx = [...m].reverse().findIndex((b) => b.role === "user");
          if (idx === -1) return m;
          const at = m.length - 1 - idx;
          return m.map((b, i) => (i === at ? { ...b, tapback: data.tapback.emoji } : b));
        });
      }
      // Simulated latency — Delivered sits first; Read + typing dots only in
      // the last stretch, like she picked it up and started replying.
      const bubbles: string[] = data.bubbles ?? ["hmm"];
      const delayLeft = Math.max(0, (data.replyDelayMs ?? 0) - (Date.now() - sentAt));
      const typingLeadMs = Math.min(1200 + bubbles.length * 500, 3000);
      await sleep(Math.max(0, delayLeft - typingLeadMs));
      setTyping(true);
      setPendingReadAt(new Date().toISOString());
      await sleep(Math.min(typingLeadMs, delayLeft));
      await revealBubbles(bubbles);
    } catch {
      setTyping(false);
      await revealBubbles(["my brain just froze 😅 say that again?"]);
    } finally {
      sendingRef.current = false;
    }
  }

  function send(e: FormEvent) {
    e.preventDefault();
    void sendText(input.trim());
  }

  // She's "online" while typing or within the linger window after her last
  // message — and not just because *he* is texting at her.
  const online =
    typing ||
    (lastSeenAt != null &&
      now - new Date(lastSeenAt).getTime() < ONLINE_LINGER_MS);
  const statusText = online
    ? "online"
    : lastSeenAt
      ? `last seen ${lastSeenLabel(lastSeenAt, now)}`
      : "AI companion";

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-white text-black">
      {/* iOS-style header — centered avatar, name, presence.
          pt clears the status bar / notch (viewportFit: cover);
          the center block is in-flow so the header wraps it — nothing clips. */}
      <header className="flex items-center border-b border-neutral-200 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span aria-hidden className="w-9" />
        <div className="flex flex-1 flex-col items-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-rose-300 to-amber-200 text-sm font-semibold text-white">
            J
          </div>
          <div className="mt-0.5 text-[13px] font-semibold leading-tight">Josefine</div>
          <div className="flex items-center gap-1 text-[10px] leading-tight text-neutral-500">
            {online && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#34c759]" />
            )}
            {statusText}
          </div>
        </div>
        <button
          aria-label="About Josefine"
          onClick={() => setSheetOpen(true)}
          className="flex w-9 items-center justify-center p-1.5 text-[#0a84ff]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M12 11v5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">…</div>
        ) : guestFailed ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-neutral-400">
            busy right now — try again in a bit
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-neutral-400">
            say hi — she&rsquo;s curious who you are
          </div>
        ) : (
          <MessageList messages={messages} pendingReadAt={pendingReadAt} />
        )}
        {typing && <TypingDots />}
        {paywall && (
          <a
            href="/paywall"
            className="mx-auto my-4 block max-w-xs rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-center text-sm text-neutral-600"
          >
            that&rsquo;s all the free messages —{" "}
            <span className="font-medium text-[#0a84ff]">go unlimited</span>
          </a>
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

      <ProfileSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        statusLine={statusText}
        plan={plan}
        relationship={relationship}
        anonymous={anonymous}
        onClaim={() => {
          setSheetOpen(false);
          setClaimOpen(true);
        }}
        onDeleted={() => {
          setMessages([]);
          setPendingReadAt(null);
          setLastSeenAt(null);
          void (async () => {
            await loadHistory();
            await tryOpening(); // fresh thread — she may open it
          })();
        }}
      />

      <ClaimSheet
        open={claimOpen}
        onClaimed={() => {
          setAnonymous(false);
          setClaimOpen(false);
          const text = blockedTextRef.current;
          blockedTextRef.current = null;
          if (text) void sendText(text, false); // bubble already on screen
        }}
      />
    </div>
  );
}

const GAP_MS = 60 * 60_000; // timestamp separator after an hour of silence

function MessageList({ messages, pendingReadAt }: { messages: Bubble[]; pendingReadAt: string | null }) {
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
                  {readAt ?? pendingReadAt
                    ? `Read ${formatClock(readAt ?? pendingReadAt!)}`
                    : "Delivered"}
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

/** WhatsApp-style "last seen": just now → Nm → Nh → yesterday → date. */
function lastSeenLabel(iso: string, now: number) {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const d = new Date(iso);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${formatClock(iso)}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${formatClock(iso)}`;
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
