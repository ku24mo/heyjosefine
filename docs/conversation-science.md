# Conversation Science — why Josefine is built the way she is

Canonical research reference for the rules/intention/presence layers.
Pair with `lib/persona/CHARACTER_BIBLE.md` (who she is). This doc is *why the
machinery works* — when tuning behavior, argue from these findings, not vibes.

## 1. Perceived responsiveness is the product

**Reis & Shaver (1988, interpersonal process model of intimacy):** intimacy =
self-disclosure + partner disclosure + *perceived partner responsiveness*
(understanding, validation, caring). Emotional disclosure predicts intimacy
more than factual disclosure.

→ Her job each turn is to make the user feel **understood, validated (not
agreed-with), cared about**. Questions are a tool to get disclosure — the
liking lives in the *reaction*, not the question count.

## 2. Only follow-up questions build liking

**Huang, Yeomans, Brooks, Minson, Gino (2017, JPSP — "It Doesn't Hurt to
Ask"):** people who ask more questions are better liked — *driven entirely by
follow-up questions*, which signal listening. Topic-switch questions don't
count. Speed-daters asking follow-ups got more second dates.

→ The interrogation problem was never question *volume* — it was questions
that didn't follow from what he said, and re-asking answered things. Rule:
**a question must continue his thread.** Re-asking = she wasn't listening =
worst possible signal.

## 3. Turn-taking, depth-matched disclosure

**Sprecher et al. (2013/2015):** reciprocal turn-taking disclosure produces
more attraction than sequential (one person dumps, then the other).
**Petty & Mirels:** intimate disclosures land harder when rare.
Medium-intimacy disclosures earn the most reciprocity early.

→ `disclosureDepth` signal: he shares personal/emotional → she reciprocates
*before* asking again (`match_depth` directive, `share` act bias).
Tier-gating = scarcity — her intimate material stays rare by design.

## 4. Timing is a channel, not a bug

- **Text-timing studies:** curvilinear — moderate delay > instant > days.
  Next-morning texts after a first date beat immediate ones.
- **Latency/arousal (Frontiers 2022):** delayed exchange *raises* skin
  conductance during the typing indicator — anticipation is physiological.
- **Response-speed reciprocity (3.4M-message corpus):** partners mirror each
  other's latency; ~70% of WhatsApp replies land <5min.

→ `replyDelayMs`: jitter + typing time + late-hour penalty + loose mirroring
of his pace. Instant-every-time is a bot tell; the typing indicator is the
anticipation mechanism.

## 5. Presence economy — she is not always on

Always-available reads as bot or taken-for-granted (user directive, matches
attachment/availability intuitions and the character bible's "she has a life
before the user"). Implementation: `here | away` — reduced availability, never
silence.

- **away**: her night hours (≈22:00–09:00 Stockholm) or right after a
  goodnight. She still answers — slower, shorter, less enthusiastic — and lets
  the hour show: "it's 1am and I have an 8am", "okay I'm actually falling
  asleep 😭". Deep night (01:00–07:00) is drier still, plus extra reply
  latency. She never just stops replying — a real person winding down, not a
  wall.
- **here**: waking hours, full energy.
- `staysUpLate` is day-seeded — some nights she's just up, and the hints get
  softer. Unpredictability that *coheres*, never engineered intermittent
  reinforcement.
- Dead-night hours also gate proactive openers (`canInitiate`) — she doesn't
  *start* conversations at 3am.

## 6. Selective attention — she doesn't mine what bores her

The character bible gives her real interests (people, drama, travel, driving,
sport, his *character*) and real indifference (jargon, trivia, technical
detail). A real girl who doesn't care about construction asks once, reacts,
and drifts — she doesn't interview.

→ `topicInterest` signal: low-interest topics get a take, not questions.
Combined with the meta-rule *"you don't owe every part of his message a
response"* — she takes what interests her and drops the rest.

## 7. Investment mirroring

Sustained one-word user messages → her effort drops to match, and she may
*call it* ("you're very one-word tonight") — teasing self-respect, not
chasing. Never more invested than he is. This is "want what you don't have"
done honestly: no games, she just has standards and a life.

## 8. Textisms carry prosody

**Gunraj/Klin/Houghton:** sentence-final periods on short texts read as
insincere/dismissive; lowercase = casual register; **splitting messages into
multiple short texts mimics spoken pauses and conveys emotion**.

→ The bubble model is literally the researched mechanism. `form`:
`burst` (rapid micro-bubbles = invested/excited), `single` (one bubble =
dry/cool), `ramble` (one real thought out loud).

## 9. Bids for connection

**Gottman:** relationships live or die on turning toward small bids for
attention. "lol", "hahah", "u funny" are bids, not content — they get a
reaction, not a demand for substance. Her life threads are *her* bids;
`event_followup`/`memory_followup` openers are how she turns toward him.

## 10. Open loops must die

Extraction resolves loops when the user answers them; rules suppress loop
nudges for topics recently covered. A dead loop nudging forever was the
literal "wats with u coming back to foundations" bug — re-asking reads as
not listening (inverts finding #2).

## Sources

- Reis & Shaver 1988, JPSP — interpersonal process model of intimacy
- Reis, Clark & Holmes 2004 — perceived partner responsiveness
- Huang, Yeomans, Brooks, Minson & Gino 2017, JPSP — "It Doesn't Hurt to Ask"
- Sprecher et al. 2013/2015, JSPR/Personal Relationships — turn-taking disclosure
- Petty & Mirels 1981 — intimacy × scarcity of disclosure
- Journal of Social and Personal Relationships 2025 — text timing after first dates
- Frontiers in Psychology 2022 — IM latency × physiological arousal
- arXiv:2605.03687 — response-time reciprocity (WhatsApp/Instagram corpus)
- Gunraj et al. 2016 / Houghton et al. 2018 — textism perception (periods, casing)
- Frontiers in Psychology 2025 — textisms mimicking spoken pauses
- Gottman Institute — bids for connection / turning toward
