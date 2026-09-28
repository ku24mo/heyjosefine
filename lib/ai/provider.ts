import type { ZodType } from "zod";

/**
 * Provider-agnostic model interface. Product logic talks to ChatModel only —
 * swap providers via MODEL_PROVIDER env without touching the orchestrator.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GenerateOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredOptions<T> extends GenerateOptions {
  schema: ZodType<T>;
  /** Optional repair retry when the model returns malformed JSON. */
  maxAttempts?: number;
}

export interface ChatModel {
  readonly name: string;
  generateText(opts: GenerateOptions): Promise<string>;
  generateStructured<T>(opts: StructuredOptions<T>): Promise<T>;
}

/** Extract a JSON object from possibly-noisy model output. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text.trim();
  return text.slice(start, end + 1);
}
