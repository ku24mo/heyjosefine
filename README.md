# Josefine — AI Companion (V1)

A mobile-first web app where an AI persona inspired by the creator Josefine
holds persistent, memory-driven conversations. Not a chatbot with a prompt —
a relationship system around an LLM.

## Architecture

```
POST /api/chat
  → Conversation Orchestrator (lib/ai/orchestrator.ts)
      1. Context: recent messages + conversation_summary + memory clusters
         + open loops + conversation state + her life threads + persona
      2. Rules engine (lib/ai/rules.ts) → directives
      3. Intention composition (lib/ai/intention.ts): react/share/ask/…
      4. ChatModel → { plan, bubbles, state_update }
      5. Post-validation (hard rules)
      6. Persist + state updates
      7. Async memory extraction (lib/memory/extract.ts) via after()

GET /api/opening — returning-user opener, strategy-selected
(memory_followup | event_followup | callback | her_life | playful |
curiosity | normal), always with a reason
```

## Key ideas

- **The LLM is the actor, not the brain.** `rules.ts` decides when to ask vs
  answer, follow up, challenge, stay brief; the model generates inside those
  boundaries. Directives are logged to `messages.meta` for debugging/eval.
- **Believability model**: bounded knowledge, moods with momentum, decaying/
  fuzzy memory, probabilistic trust arc (day-capped familiarity), and her own
  evolving life (`life_threads`, seeded from `lib/persona/life/*.md`).
- **Memory is structured**: 7 categories incl. guarded `pattern` (needs ≥2
  supporting memories), entity-linked clusters, `learned_from_user` for
  shared-knowledge callbacks, open loops with importance × emotional weight.
- **Provider-agnostic**: `ChatModel` interface (`lib/ai/provider.ts`);
  DeepSeek default via `MODEL_PROVIDER`. `MemoryRetriever` interface allows
  swapping heuristic → semantic retrieval later (`memories.embedding`
  column is reserved).

## Setup

```bash
npm install
cp .env.example .env.local   # fill in keys
```

1. Create a Supabase project → run `supabase/migrations/0001_init.sql` then
   `0002_seed_life_threads.sql` in the SQL editor (life threads ship seeded).
2. Email magic links are enabled by default. In **Auth → URL Configuration**:
   Site URL `http://localhost:3000`, add `http://localhost:3000/auth/callback`
   to Redirect URLs. (Social providers can be added later — the UI is
   email-only for now.)
3. Fill `.env.local` (see `.env.example`): `DEEPSEEK_API_KEY`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
   `sb_publishable_…` key), `SUPABASE_SERVICE_ROLE_KEY` (the `sb_secret_…`
   key — only needed for `npm run eval` / `npm run seed:life`).
4. `npm run dev` → http://localhost:3000

> Email note: Supabase's default SMTP is rate-limited (~4 emails/hour).
> Before real users test, configure a custom SMTP provider
> (Project Settings → Auth → SMTP) or magic links will silently stop.

## Commands

| command | what |
|---|---|
| `npm run dev` | dev server |
| `npm run build` / `npm start` | production |
| `npm test` | vitest unit tests (rules, memory, state) |
| `npm run typecheck` | tsc --noEmit |
| `npm run seed:life` | seed life_threads from `lib/persona/life/` |
| `npm run eval` | scenario eval harness (needs live keys); `--scenario <name>`, `--no-judge` |

## Eval harness

`scripts/eval/` replays ~19 scripted scenarios (first conversation, two-week
follow-up, "should I text my ex?", obscure fact, rude user, crisis…) through
the real orchestrator against Supabase, then an LLM judge scores
naturalness, question quality, memory use, continuity, persona consistency,
emotional appropriateness, brevity, imperfection — and the headline metric:
**"would I reply?"**

## Persona content

- `lib/persona/CHARACTER_BIBLE.md` — canonical character doc
- `lib/persona/profile.ts` — distilled voice/rules/stages (prompt-facing)
- `lib/persona/world.md` — entity roster (Odin, parents, Mia, 911, Stockholm)
- `lib/persona/life/*.md` — evolving life threads (frontmatter → DB)
- `lib/persona/views/*.md` — her perspectives
- `lib/persona/CREATOR_BRIEF.md` — questionnaire for creator review/boundaries

## Tuning

All pacing constants (familiarity caps, question budget, memory decay,
opening cooldowns, length targets) live in `lib/config.ts`.
