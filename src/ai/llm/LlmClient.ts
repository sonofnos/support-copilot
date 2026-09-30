export interface LlmClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
