// SCALE Engine — Pattern Extractor (Positive Learning)
// Purpose: Extract successful patterns from completed artifacts

import type { IArtifactStore } from '../artifact/store.js'
import type { IKnowledgeBase } from '../knowledge/KnowledgeBase.js'
import type { IEventBus } from '../core/eventBus.js'
import type { ArtifactId, ArtifactType } from '../artifact/types.js'
import { logger } from '../core/logger.js'

export interface Pattern {
  id: string
  name: string
  description: string
  contexts: string[]
  steps: PatternStep[]
  successRate: number
  extractedFrom: ArtifactId[]
  createdAt: number
  verified: boolean
}

export interface PatternStep {
  order: number
  action: string
  expectedOutcome: string
  toolsUsed: string[]
}

export interface IPatternExtractor {
  extractFromArtifact(artifactId: ArtifactId): Promise<Pattern | null>
  extractFromSession(sessionId: string): Promise<Pattern[]>
  validatePattern(pattern: Pattern): Promise<boolean>
  getPatterns(): Pattern[]
}

export class PatternExtractor implements IPatternExtractor {
  private patterns: Map<string, Pattern> = new Map()
  private seq = 0

  constructor(
    private store: IArtifactStore,
    private kb: IKnowledgeBase,
    private eventBus: IEventBus,
  ) {}

  async extractFromArtifact(artifactId: ArtifactId): Promise<Pattern | null> {
    const artifact = await this.store.get(artifactId)
    if (!artifact) return null

    if (artifact.status !== 'DONE') {
      logger.debug({ artifactId, status: artifact.status }, 'Artifact not DONE')
      return null
    }

    const payload = artifact.payload as Record<string, unknown>
    const transitions = payload.transitions as Array<{ from: string; to: string; action: string }> | undefined
    if (!transitions || transitions.length < 2) return null

    const retries = payload.transitionRetries as number | undefined
    if (retries && retries > 0) return null

    const pattern = this.buildPattern(artifact, transitions)
    this.patterns.set(pattern.id, pattern)

    await this.kb.add({
      type: 'pattern',
      title: pattern.name,
      tags: [...pattern.contexts, 'positive-learning'],
      contentRef: 'patterns/' + pattern.id + '.md',
      verified: false,
      sourceArtifact: artifactId,
    })

    this.eventBus.emit('pattern.extracted', { patternId: pattern.id, artifactId })
    logger.info({ patternId: pattern.id, artifactId }, 'Pattern extracted')
    return pattern
  }

  async extractFromSession(sessionId: string): Promise<Pattern[]> {
    const artifacts = await this.store.query({})
    const sessionArtifacts = artifacts.filter(a => (a.payload as any).sessionId === sessionId)
    const patterns: Pattern[] = []
    for (const a of sessionArtifacts.filter(a => a.status === 'DONE')) {
      const p = await this.extractFromArtifact(a.id)
      if (p) patterns.push(p)
    }
    return patterns
  }

  async validatePattern(pattern: Pattern): Promise<boolean> {
    const artifacts = await this.store.query({})
    const similar = artifacts.filter(a => a.status === 'DONE' && a.type === (pattern.contexts[0] as ArtifactType))
    pattern.successRate = similar.length > 0 ? similar.length / artifacts.length : 0
    pattern.verified = pattern.successRate >= 0.7
    if (pattern.verified) {
      this.eventBus.emit('pattern.verified', { patternId: pattern.id, successRate: pattern.successRate })
    }
    return pattern.verified
  }

  getPatterns(): Pattern[] { return Array.from(this.patterns.values()) }

  private buildPattern(artifact: any, transitions: any[]): Pattern {
    const steps: PatternStep[] = transitions.map((t, i) => ({
      order: i + 1,
      action: t.action,
      expectedOutcome: 'Transition ' + t.from + ' to ' + t.to,
      toolsUsed: [],
    }))
    return {
      id: 'PATTERN-' + Date.now() + '-' + (++this.seq).toString().padStart(3, '0'),
      name: artifact.type + ' Workflow',
      description: 'Extracted from: ' + artifact.title,
      contexts: [artifact.type],
      steps,
      successRate: 1.0,
      extractedFrom: [artifact.id],
      createdAt: Date.now(),
      verified: false,
    }
  }
}
