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
- Supabase schema: `supabase/migrations/0001_init.sql`; life threads seed via `npm run seed:life`.
