import type { LlmClient } from "./LlmClient.js";

// Deterministic stand-in used in tests and whenever no LLM backend is
// configured, so the summarize/draft-reply endpoints stay exercisable
// (routing, persistence, error paths) without a model call in the loop.
export class FakeLlmClient implements LlmClient {
  async complete(_systemPrompt: string, userPrompt: string): Promise<string> {
    const trimmed = userPrompt.trim().replace(/\s+/g, " ");
    return `[fake-llm summary] ${trimmed.slice(0, 240)}`;
  }
}
