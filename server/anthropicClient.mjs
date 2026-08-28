import Anthropic from "@anthropic-ai/sdk";

export function createAnthropicClient(apiKey) {
  return new Anthropic({
    apiKey,
    maxRetries: 0,
  });
}

export async function collect(page) {
  const items = [];
  for await (const item of page) items.push(item);
  return items;
}
