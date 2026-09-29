import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { CONFIG } from "@/lib/config";
import {
  extractJson,
  type ChatModel,
  type GenerateOptions,
  type StructuredOptions,
} from "./provider";

/**
 * DeepSeek via its OpenAI-compatible API.
 * deepseek-chat supports JSON-object mode; we still keep a text+repair
 * fallback because structured output is less strict than tool-calling APIs.
 */
export function createDeepSeekModel(): ChatModel {
  const provider = createOpenAICompatible({
    name: "deepseek",
    baseURL: process.env.MODEL_BASE_URL ?? "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
  const modelId = process.env.MODEL_NAME ?? "deepseek-chat";
  const model = provider.chatModel(modelId);

  // AI SDK v7: system prompts go in `instructions`, not `messages`.
  const split = (messages: { role: string; content: string }[]) => ({
    instructions: messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n") || undefined,
    messages: messages.filter((m) => m.role !== "system") as {
      role: "user" | "assistant";
      content: string;
    }[],
  });

  return {
    name: `deepseek:${modelId}`,

    async generateText({ messages, temperature, maxTokens }: GenerateOptions) {
      const { instructions, messages: rest } = split(messages);
      const { text } = await generateText({
        model,
        instructions,
        messages: rest,
        temperature,
        maxOutputTokens: maxTokens,
        abortSignal: AbortSignal.timeout(CONFIG.llm.timeoutMs),
        maxRetries: CONFIG.llm.maxRetries,
      });
      return text;
    },

    /**
     * DeepSeek doesn't expose JSON-schema response format through the
     * openai-compatible provider — go straight to text + parse + zod,
     * with a retry when the model returns malformed JSON.
     */
    async generateStructured<T>({
      schema,
      messages,
      temperature,
      maxTokens,
      maxAttempts = 2,
    }: StructuredOptions<T>): Promise<T> {
      const { instructions, messages: rest } = split(messages);
      let lastError: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const { text } = await generateText({
            model,
            instructions,
            messages: [
              ...rest,
              {
                role: "user" as const,
                content:
                  "(system note: respond ONLY with the JSON object in the required format. No prose, no markdown fences, no explanation.)",
              },
            ],
            temperature,
            maxOutputTokens: maxTokens,
            abortSignal: AbortSignal.timeout(CONFIG.llm.timeoutMs),
            maxRetries: CONFIG.llm.maxRetries,
            providerOptions: {
              openaiCompatible: {
                // DeepSeek supports response_format json_object — forces valid JSON.
                response_format: { type: "json_object" },
              },
            },
          });
          return schema.parse(JSON.parse(extractJson(text))) as T;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    },
  };
}

/** Provider factory — add alternatives (openai/anthropic/gemini) here. */
export function getChatModel(): ChatModel {
  const providerName = process.env.MODEL_PROVIDER ?? "deepseek";
  switch (providerName) {
    case "deepseek":
      return createDeepSeekModel();
    default:
      throw new Error(`Unknown MODEL_PROVIDER: ${providerName}`);
  }
}
