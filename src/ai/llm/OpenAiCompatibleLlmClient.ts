import type { LlmClient } from "./LlmClient.js";

export class OpenAiCompatibleLlmClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Chat completion failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    const content = body.choices[0]?.message.content;
    if (content === undefined) throw new Error("No completion returned");
    return content;
  }
}
