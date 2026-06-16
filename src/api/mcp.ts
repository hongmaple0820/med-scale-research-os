// SCALE Engine — MCP Server (W11)
// Model Context Protocol server over stdio
// Exposes SCALE artifacts, transitions, and context as MCP tools

import { EventBus } from '../core/eventBus.js'
import { InMemoryArtifactStore } from '../artifact/store.js'
import { FSM } from '../artifact/fsm.js'
import { registerAllFSMs, INITIAL_STATES } from '../artifact/fsmDefinitions.js'
import { GraphifyKnowledgeBase } from '../knowledge/GraphifyKnowledgeBase.js'
import { ContextBuilder } from '../context/ContextBuilder.js'
import { wireEffects } from '../orchestration/EffectsWiring.js'
import { SCALE_ENGINE_VERSION } from '../version.js'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================================
// MCP Tool Definitions
// ============================================================================

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ============================================================================
// SCALE MCP Server
// ============================================================================

export class ScaleMCPServer {
  private bus: EventBus
  private store: InMemoryArtifactStore
  private fsm: FSM
  private kb: GraphifyKnowledgeBase
  private ctx: ContextBuilder

  constructor(scaleDir: string = '.scale') {
    const eventsDir = join(scaleDir, 'events')
    const artifactsDir = join(scaleDir, 'artifacts')
    for (const d of [eventsDir, artifactsDir]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true })
    }

    this.bus = new EventBus({ eventsDir })
    this.store = new InMemoryArtifactStore(this.bus, { artifactsDir })
    this.fsm = new FSM(this.store, this.bus)
    registerAllFSMs(this.fsm)
    wireEffects(this.fsm, this.store, this.bus)
    this.kb = new GraphifyKnowledgeBase(this.bus, { projectDir: process.cwd(), scaleDir })
    this.ctx = new ContextBuilder(this.store, this.kb, this.bus)
  }

  getTools(): MCPTool[] {
    return [
      {
        name: 'scale_create',
        description: 'Create a new SCALE artifact (Spec, Plan, Task, Defect, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: Object.keys(INITIAL_STATES), description: 'Artifact type' },
            title: { type: 'string', description: 'Artifact title' },
            payload: { type: 'object', description: 'Type-specific payload' },
          },
          required: ['type', 'title'],
        },
      },
      {
        name: 'scale_transition',
        description: 'Transition an artifact to a new state via FSM action',
        inputSchema: {
          type: 'object',
          properties: {
            artifactId: { type: 'string', description: 'Artifact ID' },
            action: { type: 'string', description: 'FSM action name' },
            reason: { type: 'string', description: 'Reason for transition' },
          },
          required: ['artifactId', 'action'],
        },
      },
      {
        name: 'scale_list',
        description: 'List artifacts with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Filter by type' },
            status: { type: 'string', description: 'Filter by status' },
            limit: { type: 'number', description: 'Max results', default: 20 },
          },
        },
      },
      {
        name: 'scale_show',
        description: 'Show artifact details',
        inputSchema: {
          type: 'object',
          properties: {
            artifactId: { type: 'string', description: 'Artifact ID' },
          },
          required: ['artifactId'],
        },
      },
      {
        name: 'scale_available_actions',
        description: 'Get available FSM actions for an artifact',
        inputSchema: {
          type: 'object',
          properties: {
            artifactId: { type: 'string', description: 'Artifact ID' },
          },
          required: ['artifactId'],
        },
      },
      {
        name: 'scale_context',
        description: 'Build context for current session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            artifactId: { type: 'string', description: 'Current artifact ID' },
            roleId: { type: 'string', description: 'Current role' },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'scale_stats',
        description: 'Get engine statistics',
        inputSchema: { type: 'object', properties: {} },
      },
    ]
  }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const actor = { kind: 'system' as const, component: 'mcp-client' }

    switch (name) {
      case 'scale_create': {
        const type = args.type as string
        const title = args.title as string
        const payload = (args.payload as Record<string, unknown>) ?? {}
        const artifact = await this.store.create({
          type: type as any,
          title,
          payload,
          initialStatus: INITIAL_STATES[type as keyof typeof INITIAL_STATES],
          createdBy: actor,
        })
        return { id: artifact.id, type: artifact.type, title: artifact.title, status: artifact.status }
      }

      case 'scale_transition': {
        const id = args.artifactId as string
        const action = args.action as string
        const reason = args.reason as string | undefined
        const result = await this.fsm.transition(id, action, { actor, reason })
        return {
          success: result.success,
          status: result.artifact?.status,
          blockedBy: result.blockedBy,
          effectsExecuted: result.effectsExecuted,
        }
      }

      case 'scale_list': {
        const artifacts = await this.store.query({
          type: args.type as any,
          status: args.status as string | undefined,
          limit: (args.limit as number) ?? 20,
        })
        return artifacts.map((a) => ({
          id: a.id, type: a.type, title: a.title, status: a.status,
        }))
      }

      case 'scale_show': {
        const artifact = await this.store.get(args.artifactId as string)
        if (!artifact) return { error: 'Artifact not found' }
        return artifact
      }

      case 'scale_available_actions': {
        const actions = await this.fsm.availableActions(args.artifactId as string)
        return { artifactId: args.artifactId, actions }
      }

      case 'scale_context': {
        const ctx = await this.ctx.build({
          sessionId: args.sessionId as string,
          currentArtifactId: args.artifactId as string | undefined,
          roleId: args.roleId as string | undefined,
        })
        return ctx
      }

      case 'scale_stats': {
        const all = await this.store.query({ limit: 10000 })
        const byType: Record<string, number> = {}
        for (const a of all) byType[a.type] = (byType[a.type] ?? 0) + 1
        const events = await this.bus.query({ limit: 1000 })
        return { artifactCount: all.length, byType, eventCount: events.length }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
      switch (request.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0', id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'scale-engine', version: SCALE_ENGINE_VERSION },
            },
          }

        case 'tools/list':
          return {
            jsonrpc: '2.0', id: request.id,
            result: { tools: this.getTools() },
          }

        case 'tools/call': {
          const params = request.params as { name: string; arguments: Record<string, unknown> }
          const result = await this.handleToolCall(params.name, params.arguments ?? {})
          return {
            jsonrpc: '2.0', id: request.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          }
        }

        default:
          return {
            jsonrpc: '2.0', id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` },
          }
      }
    } catch (e) {
      return {
        jsonrpc: '2.0', id: request.id,
        error: { code: -32000, message: (e as Error).message },
      }
    }
  }
}

