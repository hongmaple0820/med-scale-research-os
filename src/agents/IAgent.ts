// SCALE Engine — Agent System Interface
// Purpose: Define contracts for subagent delegation

import type { ArtifactId } from '../artifact/types.js'
import type { Token } from '../core/container.js'

export interface AgentCapability {
  name: string
  description: string
  inputs: string[]
  outputs: string[]
}

export interface AgentTaskContext {
  sessionId: string
  parentArtifactId?: ArtifactId
  userInput: string
  workingDirectory: string
  techStack?: string[]
  constraints?: Record<string, unknown>
}

export interface AgentResult {
  success: boolean
  output?: string
  artifactsCreated?: ArtifactId[]
  error?: string
  durationMs: number
  modelUsed: string
  tokensUsed?: number
}

export interface AgentDefinition {
  id: string
  name: string
  description: string
  triggers: string[]
  capabilities: AgentCapability[]
  toolAllowlist: string[]
  toolDenylist?: string[]
  modelPreference: 'haiku' | 'sonnet' | 'opus'
  maxConcurrency: number
  timeoutMs?: number
  priority: number
}

export interface IAgent {
  readonly definition: AgentDefinition
  execute(context: AgentTaskContext): Promise<AgentResult>
  canHandle(userInput: string): boolean
  getConfidence(userInput: string): number
}

export interface IAgentManager {
  register(definition: AgentDefinition, implementation?: IAgent): void
  dispatch(context: AgentTaskContext): Promise<AgentResult>
  findBestAgent(userInput: string): AgentDefinition | null
  listAll(): AgentDefinition[]
  getById(id: string): IAgent | undefined
  hasHandler(userInput: string): boolean
}

export const AGENT_MANAGER_TOKEN = Symbol('AgentManager') as Token<IAgentManager>
