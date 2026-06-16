// SCALE Engine — Agent Channel (v0.8.0)
// Agent 通信管道：消息发送/接收/广播/订阅

import type { Timestamp } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import type { AgentMessage, MessageType } from './types.js'

// ============================================================================
// AgentChannel 接口
// ============================================================================

export interface IAgentChannel {
  send(from: string, to: string | 'broadcast', type: MessageType, payload: unknown): AgentMessage
  receive(agentId: string): AgentMessage[]
  subscribe(agentId: string, channel: string): void
  unsubscribe(agentId: string, channel: string): void
  getPendingCount(agentId: string): number
  broadcast(from: string, type: MessageType, payload: unknown): AgentMessage[]
}

// ============================================================================
// AgentChannel 实现
// ============================================================================

export class AgentChannel implements IAgentChannel {
  private subscriptions = new Map<string, Set<string>>()  // agentId -> subscribed channels
  private messageQueue = new Map<string, AgentMessage[]>()// agentId -> pending messages
  private seq = 0
  private eventBus?: IEventBus

  constructor(eventBus?: IEventBus) {
    this.eventBus = eventBus
  }

  // ========== 消息发送 ==========

  /** 发送消息 */
  send(from: string, to: string | 'broadcast', type: MessageType, payload: unknown): AgentMessage {
    const message: AgentMessage = {
      id: `MSG-${Date.now()}-${++this.seq}`,
      from,
      to,
      type,
      payload,
      timestamp: Date.now() as Timestamp
    }

    if (to === 'broadcast') {
      // 广播给所有订阅者
      this.broadcastInternal(from, message)
    } else {
      // 发送给特定 Agent
      this.deliver(to, message)
    }

    if (this.eventBus) {
      this.eventBus.emit('agent.message_sent', { messageId: message.id, from, to, type }, {})
    }

    return message
  }

  /** 广播消息 */
  broadcast(from: string, type: MessageType, payload: unknown): AgentMessage[] {
    const message = this.send(from, 'broadcast', type, payload)
    
    // 返回所有接收者的消息
    const recipients = this.getSubscribers(from)
    return recipients.map(r => ({
      ...message,
      id: `${message.id}-${r}`,
      to: r
    }))
  }

  // ========== 消息接收 ==========

  /** 接收消息（取出所有待处理消息） */
  receive(agentId: string): AgentMessage[] {
    const messages = this.messageQueue.get(agentId) ?? []
    this.messageQueue.set(agentId, [])
    return messages
  }

  /** 获取待处理消息数量 */
  getPendingCount(agentId: string): number {
    return this.messageQueue.get(agentId)?.length ?? 0
  }

  /** 查看最新消息（不移除） */
  peekLatest(agentId: string): AgentMessage | null {
    const messages = this.messageQueue.get(agentId)
    if (!messages || messages.length === 0) return null
    return messages[messages.length - 1]
  }

  // ========== 订阅管理 ==========

  /** 订阅频道 */
  subscribe(agentId: string, channel: string): void {
    if (!this.subscriptions.has(agentId)) {
      this.subscriptions.set(agentId, new Set())
    }
    this.subscriptions.get(agentId)!.add(channel)

    if (this.eventBus) {
      this.eventBus.emit('agent.subscribed', { agentId, channel }, {})
    }
  }

  /** 取消订阅 */
  unsubscribe(agentId: string, channel: string): void {
    const channels = this.subscriptions.get(agentId)
    if (channels) {
      channels.delete(channel)
      if (channels.size === 0) {
        this.subscriptions.delete(agentId)
      }
    }
  }

  /** 获取订阅者列表 */
  getSubscribers(channel: string): string[] {
    const subscribers: string[] = []
    for (const [agentId, channels] of this.subscriptions) {
      if (channels.has(channel)) {
        subscribers.push(agentId)
      }
    }
    return subscribers
  }

  // ========== 消息过滤 ==========

  /** 按类型过滤消息 */
  filterByType(agentId: string, type: MessageType): AgentMessage[] {
    const messages = this.messageQueue.get(agentId) ?? []
    const filtered = messages.filter(m => m.type === type)
    // 从队列中移除已过滤的消息
    const remaining = messages.filter(m => m.type !== type)
    this.messageQueue.set(agentId, remaining)
    return filtered
  }

  /** 按发送者过滤消息 */
  filterBySender(agentId: string, from: string): AgentMessage[] {
    const messages = this.messageQueue.get(agentId) ?? []
    const filtered = messages.filter(m => m.from === from)
    const remaining = messages.filter(m => m.from !== from)
    this.messageQueue.set(agentId, remaining)
    return filtered
  }

  // ========== Private Methods ==========

  /** 投递消息 */
  private deliver(agentId: string, message: AgentMessage): void {
    if (!this.messageQueue.has(agentId)) {
      this.messageQueue.set(agentId, [])
    }
    this.messageQueue.get(agentId)!.push(message)
  }

  /** 内部广播 */
  private broadcastInternal(from: string, message: AgentMessage): void {
    const subscribers = this.getSubscribers(from)
    for (const agentId of subscribers) {
      // 排除发送者自己
      if (agentId !== from) {
        this.deliver(agentId, message)
      }
    }
  }
}

/** 默认 Channel 实例 */
export const defaultAgentChannel = new AgentChannel()
