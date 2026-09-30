// Domain types mirroring the Supabase schema.

export type Role = "user" | "assistant";

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  meta: MessageMeta;
  created_at: string;
}

export interface MessageMeta {
  bubble_index?: number;
  plan?: ResponsePlan;
  directives?: string[]; // rule reasons, for eval/debug
  intention?: Intention;
  beat?: Beat;
  /** iMessage-style tapback she attached to this message (emoji) */
  tapback?: string;
}

export type MemoryCategory =
  | "personal_fact"
  | "goal"
  | "relationship"
  | "preference"
  | "emotion"
  | "event"
  | "pattern";

export interface MemoryEntity {
  type: "person" | "place" | "event" | "goal" | "conversation" | "thing";
  name: string;
}

export interface MemoryRow {
  id: string;
  user_id: string;
  category: MemoryCategory;
  content: string;
  importance: number;
  confidence: number;
  keywords: string[];
  entities: MemoryEntity[];
  related_memory_ids: string[];
  learned_from_user: boolean;
  evidence_count: number;
  supporting_memory_ids: string[];
  status: "active" | "archived";
  source_message_id: string | null;
  created_at: string;
  last_referenced_at: string | null;
}

export type LoopStatus = "active" | "resolved" | "cancelled" | "stale";

export interface OpenLoopRow {
  id: string;
  user_id: string;
  description: string;
  status: LoopStatus;
  importance: number;
  emotional_weight: number;
  related_memory_ids: string[];
  due_hint: string | null;
  last_nudged_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Beat =
  | "free_chat"
  | "problem_introduced"
  | "exploring"
  | "deeper_context"
  | "reflection"
  | "decision"
  | "action"
  | "open_loop_created";

export interface ConversationStateRow {
  user_id: string;
  mood: string;
  energy: number;
  warmth: number;
  curiosity: number;
  seriousness: number;
  her_mood: string;
  her_energy: number;
  current_beat: Beat;
  beat_started_at: string | null;
  current_topic: string | null;
  summary: string;
  consecutive_ai_questions: number;
  act_histogram: Record<string, number>;
  recent_emotion: string | null;
  familiarity: number;
  stage: "new" | "warming" | "familiar" | "close";
  days_active: number;
  active_dates: string[];
  depth_points: number;
  last_depth_date: string | null;
  first_met_at: string;
  last_interaction_at: string | null;
  last_milestone_day: number;
  turn_locked_at: string | null;
  updated_at: string;
}

export interface LifeThreadRow {
  id: string;
  slug: string;
  title: string;
  status: "active" | "resolved" | "paused";
  emotional_impact: string | null;
  disclosure_tier: 1 | 2 | 3;
  she_wants_to_talk: boolean;
  can_open: boolean;
  timeline: { at: string; development: string }[];
  body: string;
  seeded_at: string;
  resolved_at: string | null;
}

export interface LifeThreadStateRow {
  user_id: string;
  thread_id: string;
  last_mentioned_at: string | null;
  awareness_stage: number;
}

// ── Orchestrator domain ─────────────────────────────────────────────────────

export type Act =
  | "react"
  | "answer"
  | "share"
  | "ask"
  | "tease"
  | "challenge"
  | "callback";

export type Openness = "resolve" | "leave_open" | "change_topic";

export interface Intention {
  acts: Act[]; // ordered composition, e.g. ["react","share","ask"]
  openness: Openness;
  targetLength: "one_liner" | "short" | "medium" | "long";
  /**
   * Reply shape — de-templates the turn so "react|opinion|question" isn't
   * every reply. burst = several rapid micro-bubbles (invested/excited);
   * single = one bubble (dry/cool); ramble = one real thought out loud.
   */
  form: "burst" | "single" | "ramble";
}

export interface ResponsePlan {
  user_intent: string;
  user_emotion: string | null;
  move: string; // model's suggested move — advisory only
  memory_ids_used: string[];
  beat_transition: Beat | null;
}

export interface AssistantResponse {
  plan: ResponsePlan;
  bubbles: string[];
  /** iMessage-style tapback on the user's latest message — sparingly */
  tapback?: { emoji: string } | null;
  state_update?: Partial<
    Pick<
      ConversationStateRow,
      | "mood"
      | "energy"
      | "warmth"
      | "curiosity"
      | "seriousness"
      | "recent_emotion"
      | "current_topic"
      | "her_mood"
      | "her_energy"
    >
  >;
}
