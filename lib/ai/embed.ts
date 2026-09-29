import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany } from "ai";

/**
 * Embeddings for semantic memory retrieval.
 * DeepSeek has no embeddings API — this points at any OpenAI-compatible
 * endpoint (default OpenAI text-embedding-3-small, 1536-dim, matches the
 * provisioned `memories.embedding` column). Unconfigured → null, and all
 * callers fall back to pure heuristic retrieval.
 */

function embeddingModel() {
  const apiKey = process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const provider = createOpenAICompatible({
    name: "embeddings",
    baseURL: process.env.EMBEDDING_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
  });
  return provider.textEmbeddingModel(
    process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"
  );
}

/** Embed one string. null when unconfigured or on failure — never throws. */
export async function embedText(text: string): Promise<number[] | null> {
  const out = await embedTexts([text]);
  return out?.[0] ?? null;
}

/** Batch embed. null when unconfigured or on failure — never throws. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const model = embeddingModel();
  if (!model || !texts.length) return null;
  try {
    const { embeddings } = await embedMany({ model, values: texts });
    return embeddings;
  } catch (e) {
    console.error("[embed] failed:", e);
    return null;
  }
}
