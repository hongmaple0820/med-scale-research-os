// SCALE Cortex — Reflexion Engine
// 对齐 ECC: local LLM (Qwen/GLM/DeepSeek) reflection on failure evidence
// Output: root cause analysis + improvement suggestions + actionable instincts
// Cost: $0 API fees (local model)

import { logger } from '../core/logger.js'
import type { Observation, Instinct } from './InstinctExtractor.js'

export interface ReflexionResult {
  rootCause: string
  confidence: number
  suggestedAction: string
  relatedFailures: string[]
  instinct: Instinct | null
  modelUsed: string
  tokensUsed: number
}

// ---------------------------------------------------------------------------
// ReflexionEngine
// ---------------------------------------------------------------------------

export class ReflexionEngine {
  private modelEndpoint: string
  private modelName: string
  private enabled: boolean

  constructor(options?: { endpoint?: string; model?: string }) {
    this.modelEndpoint = options?.endpoint ?? process.env.SCALE_LOCAL_BASE_URL ?? 'http://localhost:11434'
    this.modelName = options?.model ?? process.env.SCALE_LOCAL_MODEL ?? 'qwen-2.5'
    this.enabled = !!process.env.SCALE_LOCAL_MODEL || !!options?.model
  }

  /**
   * Reflect on a set of failed observations to produce root cause analysis.
   */
  async reflect(observations: Observation[]): Promise<ReflexionResult> {
    if (observations.length === 0) {
      return {
        rootCause: 'No observations to reflect on',
        confidence: 0,
        suggestedAction: 'Collect more data',
        relatedFailures: [],
        instinct: null,
        modelUsed: 'none',
        tokensUsed: 0,
      }
    }

    if (!this.enabled) {
      return this.heuristicReflect(observations)
    }

    try {
      return await this.llmReflect(observations)
    } catch (err) {
      logger.warn({ err }, 'LLM reflection failed, falling back to heuristic')
      return this.heuristicReflect(observations)
    }
  }

  /**
   * Reflect on gate failure patterns and generate improvement instincts.
   */
  async reflectOnGate(gateName: string, failures: Observation[]): Promise<ReflexionResult> {
    const gateFailures = failures.filter(o => o.gateName === gateName && o.gateStatus === 'FAIL')
    return this.reflect(gateFailures)
  }

  /**
   * Batch reflect across all failing gates and merge results.
   */
  async reflectAll(observations: Observation[]): Promise<ReflexionResult[]> {
    const failures = observations.filter(o => o.gateStatus === 'FAIL')
    const byGate = new Map<string, Observation[]>()

    for (const obs of failures) {
      if (!byGate.has(obs.gateName)) byGate.set(obs.gateName, [])
      byGate.get(obs.gateName)!.push(obs)
    }

    const results: ReflexionResult[] = []
    for (const [gate, obs] of byGate) {
      results.push(await this.reflectOnGate(gate, obs))
    }

    return results
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async llmReflect(observations: Observation[]): Promise<ReflexionResult> {
    const prompt = this.buildReflectionPrompt(observations)

    const response = await fetch(`${this.modelEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          { role: 'system', content: 'You are a root cause analysis engine. Analyze the following gate failures and output structured JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) throw new Error(`LLM endpoint returned ${response.status}`)

    const data = await response.json() as any
    const content = data.choices?.[0]?.message?.content ?? ''

    try {
      const parsed = JSON.parse(content)
      return {
        rootCause: parsed.rootCause ?? 'Unknown',
        confidence: parsed.confidence ?? 0.5,
        suggestedAction: parsed.suggestedAction ?? 'Manual investigation recommended',
        relatedFailures: parsed.relatedFailures ?? [],
        instinct: null, // Caller should create instinct from this
        modelUsed: this.modelName,
        tokensUsed: data.usage?.total_tokens ?? 0,
      }
    } catch {
      // If LLM didn't return valid JSON, use heuristic
      return this.heuristicReflect(observations)
    }
  }

  private heuristicReflect(observations: Observation[]): ReflexionResult {
    const gateName = observations[0]?.gateName ?? 'unknown'
    const errorPatterns = observations
      .map(o => o.errorPattern)
      .filter(Boolean) as string[]

    // Most common error pattern
    const patternCounts = new Map<string, number>()
    for (const p of errorPatterns) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1)
    }
    let dominantPattern = ''
    let maxCount = 0
    for (const [p, c] of patternCounts) {
      if (c > maxCount) { maxCount = c; dominantPattern = p }
    }

    const rootCause = dominantPattern
      ? `Gate "${gateName}" recurring failure: "${dominantPattern}" (${maxCount}/${observations.length} occurrences)`
      : `Gate "${gateName}" failed ${observations.length} time(s) — investigate patterns`

    return {
      rootCause,
      confidence: maxCount > 2 ? 0.7 : 0.4,
      suggestedAction: dominantPattern
        ? `Run 'scale auto-fix' targeting ${gateName} failures. Check the most recent evidence for resolution clues.`
        : `Collect more failure data for gate "${gateName}" to identify patterns.`,
      relatedFailures: errorPatterns.slice(0, 5),
      instinct: null,
      modelUsed: 'heuristic',
      tokensUsed: 0,
    }
  }

  private buildReflectionPrompt(observations: Observation[]): string {
    const failures = observations
      .map(o => `[${o.timestamp}] Gate: ${o.gateName} | Pattern: ${o.errorPattern ?? 'unknown'} | RC: ${o.rootCause ?? 'unknown'}`)
      .join('\n')

    return [
      'Analyze these gate failures and output JSON:',
      '',
      failures,
      '',
      'Output format:',
      '{',
      '  "rootCause": "primary root cause",',
      '  "confidence": 0.0-1.0,',
      '  "suggestedAction": "concrete actionable step",',
      '  "relatedFailures": ["pattern1", "pattern2"]',
      '}',
    ].join('\n')
  }
}
