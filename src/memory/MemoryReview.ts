import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { redactEvidenceText, redactEvidenceValue } from '../tools/ToolEvidenceStore.js'
import { MemoryBrain, type MemoryNodeScope, type MemoryNodeStatus } from './MemoryBrain.js'
import type { MemoryLearningCandidate } from './MemoryLearning.js'

export type MemoryReviewAction = 'approve' | 'reject' | 'stale' | 'restore'
export type MemoryReviewStatus = 'pending' | 'approved' | 'rejected' | 'stale' | 'restored'

export interface MemoryReviewEvent {
  at: string
  action: MemoryReviewAction
  status: MemoryReviewStatus
  reviewer: string
  reason: string | null
  nodeId: string | null
  nodeStatus: MemoryNodeStatus | null
  warnings: string[]
}

export interface MemoryReviewRecord {
  version: '1.0'
  candidateId: string
  status: MemoryReviewStatus
  createdAt: string
  updatedAt: string
  reviewer: string
  reason: string | null
  candidatePath: string
  reviewPath: string
  reviewMarkdownPath: string
  nodeId: string | null
  nodeStatus: MemoryNodeStatus | null
  previousNodeStatus: MemoryNodeStatus | null
  promoted: boolean
  candidate: {
    title: string
    summary: string
    recommendedAction: string
    promotable: boolean
    artifactPaths: string[]
  }
  history: MemoryReviewEvent[]
  warnings: string[]
}

export interface MemoryReviewReport {
  ok: boolean
  action: MemoryReviewAction
  status: MemoryReviewStatus
  candidateId: string | null
  candidatePath: string | null
  reviewPath: string | null
  reviewMarkdownPath: string | null
  nodeId: string | null
  nodeStatus: MemoryNodeStatus | null
  previousNodeStatus: MemoryNodeStatus | null
  promoted: boolean
  warnings: string[]
  record: MemoryReviewRecord | null
}

export interface ReviewMemoryLearningCandidateOptions {
  projectDir?: string
  scaleDir?: string
  candidateId?: string
  action: MemoryReviewAction
  reviewer?: string
  reason?: string
  scope?: MemoryNodeScope
  now?: () => Date
}

interface ResolvedCandidate {
  candidate: MemoryLearningCandidate
  candidatePath: string
  reviewPath: string
  reviewMarkdownPath: string
}

export function reviewMemoryLearningCandidate(options: ReviewMemoryLearningCandidateOptions): MemoryReviewReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleRoot = resolveScaleRoot(projectDir, options.scaleDir)
  const now = options.now ?? (() => new Date())
  const reviewer = cleanText(options.reviewer ?? 'medscale')
  const reason = cleanOptionalText(options.reason)
  const resolved = resolveLearningCandidate(projectDir, scaleRoot, options.candidateId)
  if (!resolved) {
    return {
      ok: false,
      action: options.action,
      status: 'pending',
      candidateId: options.candidateId ?? null,
      candidatePath: null,
      reviewPath: null,
      reviewMarkdownPath: null,
      nodeId: null,
      nodeStatus: null,
      previousNodeStatus: null,
      promoted: false,
      warnings: [`Learning candidate not found: ${options.candidateId ?? '<latest>'}`],
      record: null,
    }
  }

  const { candidate, candidatePath, reviewPath, reviewMarkdownPath } = resolved
  const prior = readReviewRecord(reviewPath)
  const warnings: string[] = []
  let ok = true
  let status: MemoryReviewStatus = statusForAction(options.action)
  let nodeId: string | null = null
  let nodeStatus: MemoryNodeStatus | null = null
  let previousNodeStatus: MemoryNodeStatus | null = null
  let promoted = false

  const brain = new MemoryBrain({ projectDir, scaleDir: scaleRoot, now })
  try {
    if (options.action === 'approve') {
      if (!candidate.promotable) {
        ok = false
        status = prior?.status ?? 'pending'
        warnings.push(`Learning candidate is not promotable: ${candidate.recommendedAction}`)
      } else {
        const report = brain.promote(candidate.id, { scope: options.scope })
        ok = report.ok
        warnings.push(...report.warnings)
        nodeId = report.node?.id ?? null
        nodeStatus = report.node?.status ?? null
        promoted = report.ok && report.node?.status === 'active'
        if (!report.ok) status = prior?.status ?? 'pending'
      }
    } else {
      const targetStatus = nodeStatusForAction(options.action)
      const report = brain.updateStatus(candidate.id, targetStatus, { scope: options.scope })
      ok = report.ok
      warnings.push(...report.warnings)
      nodeId = report.node?.id ?? null
      nodeStatus = report.node?.status ?? null
      previousNodeStatus = report.previousStatus ?? null
      if (!report.ok) status = prior?.status ?? 'pending'
    }
  } finally {
    brain.close()
  }

  const event: MemoryReviewEvent = {
    at: now().toISOString(),
    action: options.action,
    status,
    reviewer,
    reason,
    nodeId,
    nodeStatus,
    warnings,
  }
  const record = sanitizeReviewRecord({
    version: '1.0',
    candidateId: candidate.id,
    status,
    createdAt: prior?.createdAt ?? event.at,
    updatedAt: event.at,
    reviewer,
    reason,
    candidatePath: normalizeProjectPath(projectDir, candidatePath),
    reviewPath: normalizeProjectPath(projectDir, reviewPath),
    reviewMarkdownPath: normalizeProjectPath(projectDir, reviewMarkdownPath),
    nodeId,
    nodeStatus,
    previousNodeStatus,
    promoted,
    candidate: {
      title: candidate.title,
      summary: candidate.summary,
      recommendedAction: candidate.recommendedAction,
      promotable: candidate.promotable,
      artifactPaths: (candidate.artifactPaths ?? []).map(path => normalizeProjectPath(projectDir, path)),
    },
    history: [...(prior?.history ?? []), event],
    warnings: unique([...(prior?.warnings ?? []), ...warnings]),
  })

  mkdirSync(dirname(reviewPath), { recursive: true })
  writeFileSync(reviewPath, JSON.stringify(record, null, 2), 'utf-8')
  writeFileSync(reviewMarkdownPath, renderMemoryReviewMarkdown(record), 'utf-8')

  return {
    ok,
    action: options.action,
    status,
    candidateId: candidate.id,
    candidatePath,
    reviewPath,
    reviewMarkdownPath,
    nodeId,
    nodeStatus,
    previousNodeStatus,
    promoted,
    warnings: record.warnings,
    record,
  }
}

export function renderMemoryReviewMarkdown(record: MemoryReviewRecord): string {
  const lines = [
    `# Memory Review: ${record.candidateId}`,
    '',
    `- Status: ${record.status}`,
    `- Reviewer: ${record.reviewer}`,
    `- Updated: ${record.updatedAt}`,
    `- Node: ${record.nodeId ?? 'n/a'} (${record.nodeStatus ?? 'n/a'})`,
    `- Promoted: ${record.promoted ? 'yes' : 'no'}`,
    `- Reason: ${record.reason ?? 'n/a'}`,
    '',
    '## Candidate',
    '',
    `- Title: ${record.candidate.title}`,
    `- Recommended action: ${record.candidate.recommendedAction}`,
    `- Promotable: ${record.candidate.promotable ? 'yes' : 'no'}`,
    '',
    record.candidate.summary,
    '',
    '## History',
    '',
  ]
  for (const event of record.history) {
    lines.push(`- ${event.at} ${event.action} -> ${event.status} by ${event.reviewer}`)
    if (event.reason) lines.push(`  - Reason: ${event.reason}`)
    if (event.warnings.length > 0) lines.push(`  - Warnings: ${event.warnings.join('; ')}`)
  }
  if (record.history.length === 0) lines.push('- none')

  lines.push('', '## Warnings', '')
  for (const warning of record.warnings) lines.push(`- ${warning}`)
  if (record.warnings.length === 0) lines.push('- none')
  lines.push('')
  return lines.join('\n')
}

function resolveLearningCandidate(projectDir: string, scaleRoot: string, candidateId?: string): ResolvedCandidate | null {
  const dir = join(scaleRoot, 'memory', 'learning-candidates')
  if (!existsSync(dir)) return null
  const candidatePath = candidateId
    ? join(dir, `${safePathSegment(candidateId)}.json`)
    : readdirSync(dir)
        .filter(name => name.endsWith('.json') && !name.endsWith('.review.json'))
        .map(name => join(dir, name))
        .sort()
        .at(-1)
  if (!candidatePath || !existsSync(candidatePath)) return null
  try {
    const candidate = JSON.parse(readFileSync(candidatePath, 'utf-8').replace(/^\uFEFF/, '')) as MemoryLearningCandidate
    const basePath = join(dir, safePathSegment(candidate.id))
    return {
      candidate,
      candidatePath,
      reviewPath: `${basePath}.review.json`,
      reviewMarkdownPath: `${basePath}.review.md`,
    }
  } catch {
    return null
  }
}

function readReviewRecord(path: string): MemoryReviewRecord | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as MemoryReviewRecord
  } catch {
    return null
  }
}

function statusForAction(action: MemoryReviewAction): MemoryReviewStatus {
  if (action === 'approve') return 'approved'
  if (action === 'reject') return 'rejected'
  if (action === 'stale') return 'stale'
  return 'restored'
}

function nodeStatusForAction(action: Exclude<MemoryReviewAction, 'approve'>): Exclude<MemoryNodeStatus, 'active'> {
  if (action === 'reject') return 'rejected'
  if (action === 'stale') return 'stale'
  return 'candidate'
}

function sanitizeReviewRecord(record: MemoryReviewRecord): MemoryReviewRecord {
  const redacted = redactEvidenceValue(record).value as MemoryReviewRecord
  return {
    ...redacted,
    reviewer: cleanText(redacted.reviewer),
    reason: cleanOptionalText(redacted.reason ?? undefined),
    candidate: {
      ...redacted.candidate,
      title: cleanText(redacted.candidate.title),
      summary: cleanText(redacted.candidate.summary),
    },
    history: redacted.history.map(event => ({
      ...event,
      reviewer: cleanText(event.reviewer),
      reason: cleanOptionalText(event.reason ?? undefined),
      warnings: event.warnings.map(cleanText),
    })),
    warnings: redacted.warnings.map(cleanText),
  }
}

function cleanText(value: string): string {
  return redactEvidenceText(String(value)).value.trim()
}

function cleanOptionalText(value: string | null | undefined): string | null {
  const cleaned = cleanText(value ?? '')
  return cleaned ? cleaned : null
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'memory-learning'
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  return isAbsolute(scaleDir ?? '') ? scaleDir as string : join(projectDir, scaleDir ?? '.scale')
}

function normalizeProjectPath(projectDir: string, filePath: string): string {
  const rel = relative(projectDir, filePath)
  return rel && !rel.startsWith('..') && !isAbsolute(rel)
    ? rel.replace(/\\/g, '/')
    : filePath
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
