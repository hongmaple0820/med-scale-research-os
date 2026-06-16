export interface LocalModelConfig {
  name: string
  baseUrl: string
  apiKey: string
  maxTokens: number
}

export function resolveLocalModelConfig(): LocalModelConfig {
  const name = process.env.SCALE_LOCAL_MODEL ?? 'qwen-2.5-72b'
  const baseUrl = process.env.SCALE_LOCAL_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'http://localhost:11434/v1'
  const apiKey = process.env.SCALE_LOCAL_API_KEY ?? process.env.OPENAI_API_KEY ?? 'ollama'

  return {
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    maxTokens: parseInt(process.env.SCALE_LOCAL_MAX_TOKENS ?? '32000', 10),
  }
}

export function getSupportedLocalModels(): Array<{ id: string; description: string }> {
  return [
    { id: 'qwen-2.5-72b', description: 'Qwen 2.5 72B — Alibaba Cloud / local deployment' },
    { id: 'glm-4-plus', description: 'GLM-4 Plus — Zhipu AI / local deployment' },
    { id: 'deepseek-v3', description: 'DeepSeek V3 — DeepSeek / local deployment' },
    { id: 'llama-3.1-70b', description: 'Llama 3.1 70B — Meta / Ollama' },
    { id: 'qwen-2.5-7b', description: 'Qwen 2.5 7B — lightweight, fits consumer GPU' },
  ]
}
