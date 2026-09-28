import type {
  ConversationStateRow,
  MemoryRow,
  OpenLoopRow,
} from "@/lib/types";
import { DEFAULT_STATE } from "@/lib/state/conversation";

export function makeState(
  overrides: Partial<ConversationStateRow> = {}
): ConversationStateRow {
  return {
    ...DEFAULT_STATE("u1"),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeMemory(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: crypto.randomUUID(),
    user_id: "u1",
    category: "personal_fact",
    content: "User likes hiking",
    importance: 5,
    confidence: 1,
    keywords: ["hiking"],
    entities: [],
    related_memory_ids: [],
    learned_from_user: false,
    evidence_count: 1,
    supporting_memory_ids: [],
    status: "active",
    source_message_id: null,
    created_at: new Date().toISOString(),
    last_referenced_at: null,
    ...overrides,
  };
}

export function makeLoop(overrides: Partial<OpenLoopRow> = {}): OpenLoopRow {
  return {
    id: crypto.randomUUID(),
    user_id: "u1",
    description: "Job interview Friday",
    status: "active",
    importance: 7,
    emotional_weight: 8,
    related_memory_ids: [],
    due_hint: null,
    last_nudged_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
