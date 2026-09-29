<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes

- AI companion chat app — persona logic lives in `lib/` (see README.md architecture).
- The orchestrator (`lib/ai/orchestrator.ts`) is the product brain; LLM calls go through the `ChatModel` interface (`lib/ai/provider.ts`) — never call a provider SDK directly.
- All pacing/tuning constants live in `lib/config.ts`.
- Persona source of truth: `lib/persona/CHARACTER_BIBLE.md`; prompt-facing distillation in `lib/persona/profile.ts`.
- Verify with: `npm run typecheck`, `npm run lint`, `npm test`.
- Eval harness: `npm run eval` (requires live env keys; creates throwaway users).
- Supabase schema: `supabase/migrations/0001_init.sql` + numbered follow-ups; life threads seed via `npm run seed:life`. Migrations are applied manually in the Supabase SQL editor — no direct DB connection in env.
- Semantic recall needs `EMBEDDING_API_KEY` (OpenAI-compatible embeddings, `text-embedding-3-small`/1536-dim) + migration `0005` (`match_memories` RPC). Without it, retrieval silently falls back to heuristic — fine for dev.
- Per-user turn lock lives on `conversation_state.turn_locked_at` (migration `0004`); routes acquire it around orchestration. TTL 150s — must outlast a worst-case bounded LLM turn + async extraction.
- Memory consolidation cron: `GET /api/cron/consolidate`, Vercel cron daily 04:00 UTC, guarded by `CRON_SECRET` env.
- Billing: Stripe webhook `/api/stripe/webhook` is the only writer of `profiles.plan` (migration `0006`); active subscription bypasses usage caps. Needs `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID`/`STRIPE_WEBHOOK_SECRET`.
- Burst gate: `burst_gate` RPC + `conversation_state.burst_*` columns (migration `0007`) cap rapid-fire sends at `CONFIG.usage.burstPerMinute`; DB missing → fails open.
- One active conversation per user: `conversations.is_active` + partial unique index (migration `0007`); `/api/reset` retires the old thread.
- No pg pooler needed — supabase-js speaks HTTPS/PostgREST; Supabase pools server-side.
- Load test: `npm run loadtest -- --users N --msgs M [--mock]` — creates throwaway auth users, exercises the real turn lock + orchestrator, reports p50/p95 and invariant checks.
