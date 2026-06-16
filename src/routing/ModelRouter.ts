// SCALE Engine — Model Router (W9)
// 基于任务复杂度选择模型
// 设计参考：docs/01-ARCHITECTURE.md §二 L4

import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export type ModelTier = 'fast' | 'balanced' | 'powerful' | 'local'

export interface ModelConfig {
  tier: ModelTier
  name: string
  maxTokens: number
  costPerMToken: number // $ per million tokens
  modalities: string[]
}

export const DEFAULT_MODELS: Record<ModelTier, ModelConfig> = {
  fast: { tier: 'fast', name: 'claude-haiku', maxTokens: 200_000, costPerMToken: 0.25, modalities: ['text'] },
  balanced: { tier: 'balanced', name: 'claude-sonnet', maxTokens: 200_000, costPerMToken: 3.0, modalities: ['text', 'vision'] },
  powerful: { tier: 'powerful', name: 'claude-opus', maxTokens: 200_000, costPerMToken: 15.0, modalities: ['text', 'vision'] },
  local: { tier: 'local', name: 'local-llm', maxTokens: 32_000, costPerMToken: 0.0, modalities: ['text'] },
}

// Local model registry for China market
export const LOCAL_MODELS: Record<string, ModelConfig> = {
  'qwen-2.5-72b': { tier: 'local', name: 'qwen-2.5-72b', maxTokens: 32_000, costPerMToken: 0.0, modalities: ['text'] },
  'glm-4-plus': { tier: 'local', name: 'glm-4-plus', maxTokens: 128_000, costPerMToken: 0.0, modalities: ['text', 'vision'] },
  'deepseek-v3': { tier: 'local', name: 'deepseek-v3', maxTokens: 64_000, costPerMToken: 0.0, modalities: ['text'] },
}

export interface RoutingContext {
  taskComplexity?: number    // 0-1, from BehaviorTracker or manual
  artifactType?: string
  stepCount?: number
  previousFailures?: number
  budget?: 'low' | 'medium' | 'high'
  modality?: 'text' | 'vision'
}

export interface RouterConfig {
  baseUrl?: string
  apiKey?: string
  localModelName?: string // e.g. 'qwen-2.5-72b', 'glm-4-plus', 'deepseek-v3'
}

export interface IModelRouter {
  route(ctx: RoutingContext): ModelConfig
  getModels(): Record<ModelTier, ModelConfig>
  setModel(tier: ModelTier, config: ModelConfig): void
  preCheck(ctx: RoutingContext): ModelConfig  // always returns local tier if available
  setLocalModel(name: string, config: Partial<ModelConfig>): void
}

export class ModelRouter implements IModelRouter {
  private models: Record<ModelTier, ModelConfig>

  constructor(
    private eventBus: IEventBus,
    models?: Partial<Record<ModelTier, ModelConfig>>,
  ) {
    this.models = { ...DEFAULT_MODELS, ...models }
  }

  route(ctx: RoutingContext): ModelConfig {
    let tier: ModelTier

    // Rule 1: Budget override
    if (ctx.budget === 'low') {
      tier = 'fast'
    } else if (ctx.budget === 'high') {
      tier = 'powerful'
    }
    // Rule 2: High complexity or repeated failures → powerful
    else if ((ctx.taskComplexity ?? 0) > 0.7 || (ctx.previousFailures ?? 0) >= 2) {
      tier = 'powerful'
    }
    // Rule 3: Simple tasks → fast
    else if ((ctx.taskComplexity ?? 0.5) < 0.3 && (ctx.stepCount ?? 1) <= 2) {
      tier = 'fast'
    }
    // Rule 4: Default → balanced
    else {
      tier = 'balanced'
    }

    // If vision task and selected tier lacks vision, upgrade
    if (ctx.modality === 'vision' && !(this.models[tier].modalities ?? ['text']).includes('vision')) {
      // Upgrade to next tier that supports vision
      if ((this.models.balanced.modalities ?? ['text']).includes('vision')) tier = 'balanced'
      else if ((this.models.powerful.modalities ?? ['text']).includes('vision')) tier = 'powerful'
    }

    const model = this.models[tier]

    logger.debug({ ctx, selectedTier: tier, model: model.name }, 'Model routed')
    this.eventBus.emit('tool.called', {
      tool: 'ModelRouter',
      routedTo: model.name,
      tier,
      reason: this.explainRouting(ctx, tier),
    })

    return model
  }

  getModels(): Record<ModelTier, ModelConfig> {
    return { ...this.models }
  }

  setModel(tier: ModelTier, config: ModelConfig): void {
    this.models[tier] = config
  }

  preCheck(ctx: RoutingContext): ModelConfig {
    // For pre-check gates, always try local model first (cheaper)
    return this.models.local
  }

  setLocalModel(name: string, config: Partial<ModelConfig>): void {
    const localModel = LOCAL_MODELS[name]
    if (localModel) {
      this.models.local = { ...localModel, ...config }
    } else {
      this.models.local = { tier: 'local', name, maxTokens: 32_000, costPerMToken: 0.0, modalities: ['text'], ...config }
    }
  }

  private explainRouting(ctx: RoutingContext, tier: ModelTier): string {
    if (ctx.budget === 'low') return 'budget=low → fast'
    if (ctx.budget === 'high') return 'budget=high → powerful'
    if ((ctx.previousFailures ?? 0) >= 2) return `${ctx.previousFailures} failures → powerful`
    if ((ctx.taskComplexity ?? 0) > 0.7) return `complexity=${ctx.taskComplexity} → powerful`
    if ((ctx.taskComplexity ?? 0.5) < 0.3) return `complexity=${ctx.taskComplexity} → fast`
    return `default → ${tier}`
  }
}

