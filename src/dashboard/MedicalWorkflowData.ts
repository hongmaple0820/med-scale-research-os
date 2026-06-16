import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export interface MedicalWorkflowStageState {
  label: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  metrics: Record<string, unknown>
  error: string | null
}

export interface MedicalWorkflowLiveStatus {
  run_id: string | null
  status: string
  target: string
  disease: string
  cancers: string[]
  modality: string
  risk_level: string
  progress_percent: number
  current_stage: string | null
  current_stage_label: string | null
  started_at: string | null
  finished_at: string | null
  updated_at: string
  output_root: string
  summary: Record<string, unknown>
  artifacts: Record<string, string>
  logs: Array<Record<string, unknown>>
  stages: Record<string, MedicalWorkflowStageState>
}

export interface MedicalWorkflowArtifactLink {
  label: string
  kind: 'html' | 'pdf' | 'docx' | 'markdown' | 'json' | 'zip' | 'other'
  path: string
  relativePath: string
  url: string
  exists: boolean
}

export interface MedicalWorkflowMilestone {
  phase: string
  phaseName: string
  durationMonths: number | null
  successRate: number | null
  cumulativeCost: number | null
  endDate: string | null
}

export interface MedicalWorkflowBusinessSnapshot {
  overallSuccessRate: number | null
  totalDurationMonths: number | null
  totalCostEstimate: number | null
  estimatedCompletion: string | null
  dataSources: string[]
  adjustmentDetails: Record<string, unknown>
  milestones: MedicalWorkflowMilestone[]
}

export interface MedicalWorkflowManuscriptQuality {
  passed: boolean | null
  score: number | null
  grade?: string | null
  errors: number | null
  warnings: number | null
  reportPath: string | null
}

export interface MedicalWorkflowManuscriptFactCheck {
  passed: boolean | null
  score: number | null
  errors: number | null
  warnings: number | null
  claimsChecked: number | null
  unverifiedClaims: number | null
  reportPath: string | null
}

export interface MedicalWorkflowQualityFinding {
  id: string | null
  severity: string | null
  message: string | null
  evidence: unknown
}

export interface MedicalWorkflowPackageAudit {
  passed: boolean | null
  errors: number | null
  warnings: number | null
  entryCount: number | null
  filesChecked: number | null
  markdownRefsChecked: number | null
  imageRefsChecked: number | null
  readmePresent: boolean | null
  manifestPresent: boolean | null
  brokenImageRefs: number | null
  brokenMarkdownRefs: number | null
}

export interface MedicalWorkflowLiteratureEvidence {
  count: number | null
  agentCacheCount: number | null
  llmCount: number | null
  ruleBasedCount: number | null
  sources: string[]
  meshCount: number | null
  citationCountAvailable: number | null
  cacheUsed: boolean | null
  cacheHitCount: number | null
}

export interface MedicalWorkflowDeliveryPackage {
  packagePath: string | null
  manifestPath: string | null
  exists: boolean
  size: number | null
  packageAudit: MedicalWorkflowPackageAudit | null
  qualityFindings: MedicalWorkflowQualityFinding[]
  humanReviewTodo: string[]
  literatureEvidence: MedicalWorkflowLiteratureEvidence | null
  disclaimer: string | null
}

export interface MedicalWorkflowMemorySeed {
  provider: string | null
  generatedAt: string | null
  recordPath: string | null
  summaryPath: string | null
  recordReady: boolean
  summaryReady: boolean
  importOk: boolean | null
  sourceFileCount: number | null
  stagedFileCount: number | null
  missingRoles: string[]
  warnings: string[]
}

export interface MedicalWorkflowLearningCandidate {
  candidateId: string | null
  generatedAt: string | null
  recordPath: string | null
  summaryPath: string | null
  candidatePath: string | null
  candidateMarkdownPath: string | null
  recordReady: boolean
  summaryReady: boolean
  recommendedAction: string | null
  promotable: boolean
  brainIngestOk: boolean | null
  brainNodeId: string | null
  warnings: string[]
}

export interface MedicalWorkflowDashboardData {
  available: boolean
  projectRoot: string
  runtimeFile: string
  latestUpdatedAt: string | null
  liveStatus: MedicalWorkflowLiveStatus | null
  business: MedicalWorkflowBusinessSnapshot | null
  manuscriptQuality: MedicalWorkflowManuscriptQuality | null
  manuscriptFactCheck: MedicalWorkflowManuscriptFactCheck | null
  deliveryPackage: MedicalWorkflowDeliveryPackage | null
  memorySeed: MedicalWorkflowMemorySeed | null
  learningCandidate: MedicalWorkflowLearningCandidate | null
  reports: MedicalWorkflowArtifactLink[]
  errors: string[]
}

const REPORT_EXTENSIONS = new Set(['.html', '.pdf', '.docx', '.md', '.json', '.zip'])

export function readMedicalWorkflowDashboard(projectDir: string = process.cwd()): MedicalWorkflowDashboardData {
  const projectRoot = resolve(projectDir)
  const workflowRoot = join(projectRoot, 'target-research-platform')
  const runtimeFile = join(workflowRoot, 'output', 'dashboard_runtime', 'live_status.json')

  if (!existsSync(runtimeFile)) {
    return {
      available: false,
      projectRoot,
      runtimeFile,
      latestUpdatedAt: null,
      liveStatus: null,
      business: null,
      manuscriptQuality: null,
      manuscriptFactCheck: null,
      deliveryPackage: null,
      memorySeed: null,
      learningCandidate: null,
      reports: [],
      errors: ['Medical workflow runtime status file not found. Run the target research pipeline first.'],
    }
  }

  const errors: string[] = []
  const liveStatusRaw = readJson<MedicalWorkflowLiveStatus>(runtimeFile)
  const liveStatusPrepared = liveStatusRaw ? attachDerivedStageCompletion(projectRoot, workflowRoot, liveStatusRaw) : null
  const liveStatus = liveStatusPrepared ? normalizeLiveStatus(projectRoot, workflowRoot, liveStatusPrepared) : null
  if (!liveStatus) {
    return {
      available: false,
      projectRoot,
      runtimeFile,
      latestUpdatedAt: null,
      liveStatus: null,
      business: null,
      manuscriptQuality: null,
      manuscriptFactCheck: null,
      deliveryPackage: null,
      memorySeed: null,
      learningCandidate: null,
      reports: [],
      errors: ['Medical workflow runtime status file exists but could not be parsed.'],
    }
  }

  const business = readBusinessSnapshot(projectRoot, workflowRoot, liveStatus, errors)
  const manuscriptQuality = readManuscriptQuality(projectRoot, workflowRoot, liveStatus)
  const manuscriptFactCheck = readManuscriptFactCheck(projectRoot, workflowRoot, liveStatus)
  const deliveryPackage = readDeliveryPackage(projectRoot, workflowRoot, liveStatus)
  const memorySeed = readMemorySeed(projectRoot, workflowRoot, liveStatus, deliveryPackage)
  const learningCandidate = readLearningCandidate(projectRoot, workflowRoot, liveStatus, deliveryPackage)
  const reports = collectArtifactLinks(projectRoot, workflowRoot, liveStatus, memorySeed, learningCandidate)

  return {
    available: true,
    projectRoot,
    runtimeFile,
    latestUpdatedAt: liveStatus.updated_at ?? null,
    liveStatus,
    business,
    manuscriptQuality,
    manuscriptFactCheck,
    deliveryPackage,
    memorySeed,
    learningCandidate,
    reports,
    errors,
  }
}

function attachDerivedStageCompletion(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
): MedicalWorkflowLiveStatus {
  const outputRoot = resolveArtifactPath(projectRoot, workflowRoot, liveStatus.output_root)
  const target = (liveStatus.target ?? '').trim()
  const disease = (liveStatus.disease ?? '').trim()
  if (!outputRoot || !target || !disease) return liveStatus

  const diseaseVariants = [...new Set([disease, disease.replace(/\s+/g, '_')])]
  const resultPaths = {
    stage1: [join(outputRoot, 'stage1', `${target}_stage1_results.json`)],
    stage2: diseaseVariants.map(token => join(outputRoot, 'stage2', `${token}_stage2_results.json`)),
    stage3: diseaseVariants.map(token => join(outputRoot, 'stage3', `${target}_${token}_stage3_results.json`)),
    stage4: diseaseVariants.map(token => join(outputRoot, 'stage4', `${target}_${token}_stage4_results.json`)),
  }

  const labels: Record<string, string> = {
    stage1: 'Stage 1 Expression',
    stage2: 'Stage 2 Screening',
    stage3: 'Stage 3 Deep Research',
    stage4: 'Stage 4 Business',
  }

  const stages = { ...(liveStatus.stages ?? {}) }
  for (const [stageKey, candidates] of Object.entries(resultPaths)) {
    const found = candidates.find(file => existsSync(file))
    if (!found) continue
    const current = stages[stageKey] ?? {
      label: labels[stageKey],
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      metrics: {},
      error: null,
    }
    if (current.status !== 'failed') {
      stages[stageKey] = {
        ...current,
        label: current.label || labels[stageKey],
        status: 'completed',
      }
    }
  }

  return {
    ...liveStatus,
    stages,
  }
}

function normalizeLiveStatus(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
): MedicalWorkflowLiveStatus {
  if (liveStatus.status !== 'completed' || liveStatus.current_stage_label) return liveStatus
  const summary = asRecord(liveStatus.summary)
  const deliveryPackagePath = resolveArtifactPath(
    projectRoot,
    workflowRoot,
    liveStatus.artifacts?.delivery_package ?? toStringOrNull(summary?.delivery_package) ?? undefined,
  )
  if (deliveryPackagePath && existsSync(deliveryPackagePath)) {
    return {
      ...liveStatus,
      current_stage_label: '\u4ea4\u4ed8\u5305\u5df2\u5c31\u7eea',
    }
  }
  const completedStageCount = Object.values(liveStatus.stages ?? {})
    .filter(stage => stage?.status === 'completed')
    .length
  if (completedStageCount === 4) {
    return {
      ...liveStatus,
      current_stage_label: '\u7814\u7a76\u6d41\u7a0b\u5df2\u5b8c\u6210',
    }
  }
  return liveStatus
}
function readManuscriptQuality(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
): MedicalWorkflowManuscriptQuality | null {
  const artifacts = liveStatus.artifacts ?? {}
  const reportPath = resolveArtifactPath(projectRoot, workflowRoot, artifacts.manuscript_quality)
  const summary = asRecord(liveStatus.summary)
  const inlineQuality = asRecord(summary?.quality_gate)
  if (reportPath && existsSync(reportPath)) {
    const payload = readJson<Record<string, unknown>>(reportPath)
    if (payload) return normalizeManuscriptQuality({ ...(inlineQuality ?? {}), ...payload }, reportPath)
  }

  if (inlineQuality) return normalizeManuscriptQuality(inlineQuality, reportPath)

  return reportPath
    ? { passed: null, score: null, errors: null, warnings: null, reportPath }
    : null
}

function normalizeManuscriptQuality(
  value: Record<string, unknown>,
  reportPath: string | null,
): MedicalWorkflowManuscriptQuality {
  return {
    passed: typeof value.passed === 'boolean' ? value.passed : null,
    score: toNumber(value.score),
    grade: toStringOrNull(value.grade),
    errors: toNumber(value.errors),
    warnings: toNumber(value.warnings),
    reportPath,
  }
}

function readManuscriptFactCheck(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
): MedicalWorkflowManuscriptFactCheck | null {
  const artifacts = liveStatus.artifacts ?? {}
  const reportPath = resolveArtifactPath(projectRoot, workflowRoot, artifacts.manuscript_fact_check)
  const summary = asRecord(liveStatus.summary)
  const inlineFactCheck = asRecord(summary?.fact_check)
  if (reportPath && existsSync(reportPath)) {
    const payload = readJson<Record<string, unknown>>(reportPath)
    if (payload) return normalizeManuscriptFactCheck({ ...(inlineFactCheck ?? {}), ...payload }, reportPath)
  }

  if (inlineFactCheck) return normalizeManuscriptFactCheck(inlineFactCheck, reportPath)

  return reportPath
    ? {
        passed: null,
        score: null,
        errors: null,
        warnings: null,
        claimsChecked: null,
        unverifiedClaims: null,
        reportPath,
      }
    : null
}

function normalizeManuscriptFactCheck(
  value: Record<string, unknown>,
  reportPath: string | null,
): MedicalWorkflowManuscriptFactCheck {
  const unverified = Array.isArray(value.unverified_claims)
    ? value.unverified_claims.length
    : toNumber(value.unverifiedClaims)
  return {
    passed: typeof value.passed === 'boolean' ? value.passed : null,
    score: toNumber(value.score),
    errors: toNumber(value.errors),
    warnings: toNumber(value.warnings),
    claimsChecked: toNumber(value.claims_checked) ?? toNumber(value.claimsChecked),
    unverifiedClaims: unverified,
    reportPath,
  }
}

function readDeliveryPackage(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
): MedicalWorkflowDeliveryPackage | null {
  const artifacts = liveStatus.artifacts ?? {}
  const summary = asRecord(liveStatus.summary)
  const rawPackagePath = artifacts.delivery_package ?? toStringOrNull(summary?.delivery_package) ?? undefined
  const packagePath = resolveArtifactPath(projectRoot, workflowRoot, rawPackagePath)
  const manifestPath = resolveArtifactPath(projectRoot, workflowRoot, artifacts.delivery_manifest)
  if (!packagePath && !manifestPath) return null
  const exists = Boolean(packagePath && existsSync(packagePath))
  const manifest = manifestPath && existsSync(manifestPath)
    ? readJson<Record<string, unknown>>(manifestPath)
    : null
  const packageAudit = normalizePackageAudit(asRecord(summary?.package_audit))
  return {
    packagePath,
    manifestPath,
    exists,
    size: exists && packagePath ? statSync(packagePath).size : null,
    packageAudit,
    qualityFindings: normalizeQualityFindings(manifest?.quality_findings),
    humanReviewTodo: normalizeStringList(manifest?.human_review_todo),
    literatureEvidence: normalizeLiteratureEvidence(asRecord(manifest?.literature)),
    disclaimer: toStringOrNull(manifest?.disclaimer),
  }
}

function readMemorySeed(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
  deliveryPackage: MedicalWorkflowDeliveryPackage | null,
): MedicalWorkflowMemorySeed | null {
  const artifacts = liveStatus.artifacts ?? {}
  const summary = asRecord(liveStatus.summary)
  const deliveryReadiness = asRecord(summary?.delivery_readiness)
  const inlineMemorySeed = asRecord(deliveryReadiness?.memory_seed)

  const manifestPath = deliveryPackage?.manifestPath
    ?? resolveArtifactPath(projectRoot, workflowRoot, artifacts.delivery_manifest)
  if (!manifestPath && !inlineMemorySeed) return null

  const derived = deriveMemorySeedArtifacts(projectRoot, workflowRoot, manifestPath)
  const inlineRecordPath = resolveArtifactPath(projectRoot, workflowRoot, toStringOrNull(inlineMemorySeed?.record_path) ?? undefined)
  const inlineSummaryPath = resolveArtifactPath(projectRoot, workflowRoot, toStringOrNull(inlineMemorySeed?.summary_path) ?? undefined)
  const recordPath = inlineRecordPath ?? derived.recordPath
  let summaryPath = inlineSummaryPath ?? derived.summaryPath

  const payload = recordPath && existsSync(recordPath)
    ? readJson<Record<string, unknown>>(recordPath)
    : null

  const payloadSummaryPath = resolveArtifactPath(
    projectRoot,
    workflowRoot,
    toStringOrNull(payload?.summary_path) ?? undefined,
  )
  if (payloadSummaryPath) summaryPath = payloadSummaryPath

  if (!payload && !inlineMemorySeed && !summaryPath) return null

  return {
    provider: toStringOrNull(payload?.provider) ?? toStringOrNull(inlineMemorySeed?.provider),
    generatedAt: toStringOrNull(payload?.generated_at) ?? toStringOrNull(inlineMemorySeed?.generated_at),
    recordPath: recordPath && existsSync(recordPath) ? recordPath : null,
    summaryPath: summaryPath && existsSync(summaryPath) ? summaryPath : null,
    recordReady: Boolean(recordPath && existsSync(recordPath)),
    summaryReady: Boolean(summaryPath && existsSync(summaryPath)),
    importOk: toBooleanOrNull(payload?.import_ok) ?? toBooleanOrNull(inlineMemorySeed?.import_ok),
    sourceFileCount: toStringArray(payload?.source_files).length || toNumber(inlineMemorySeed?.source_file_count),
    stagedFileCount: toStringArray(payload?.staged_files).length || toNumber(inlineMemorySeed?.staged_file_count),
    missingRoles: toStringArray(payload?.missing_roles).length > 0
      ? toStringArray(payload?.missing_roles)
      : toStringArray(inlineMemorySeed?.missing_roles),
    warnings: toStringArray(payload?.warnings).length > 0
      ? toStringArray(payload?.warnings)
      : toStringArray(inlineMemorySeed?.warnings),
  }
}

function deriveMemorySeedArtifacts(
  projectRoot: string,
  workflowRoot: string,
  manifestPath: string | null,
): { recordPath: string | null; summaryPath: string | null } {
  if (!manifestPath) return { recordPath: null, summaryPath: null }
  const manifestName = manifestPath.replace(/\\/g, '/').split('/').pop() ?? ''
  const slug = manifestName.replace(/_delivery_manifest\.json$/i, '')
  if (!slug) return { recordPath: null, summaryPath: null }
  const manifestDir = manifestPath.slice(0, manifestPath.length - manifestName.length).replace(/[\\/]+$/, '')
  const recordPath = resolveArtifactPath(projectRoot, workflowRoot, `${manifestDir}/${slug}_memory_seed.json`)
  const summaryPath = resolveArtifactPath(projectRoot, workflowRoot, `${manifestDir}/${slug}_memory_summary.md`)
  return { recordPath, summaryPath }
}

function readLearningCandidate(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
  deliveryPackage: MedicalWorkflowDeliveryPackage | null,
): MedicalWorkflowLearningCandidate | null {
  const artifacts = liveStatus.artifacts ?? {}
  const manifestPath = deliveryPackage?.manifestPath
    ?? resolveArtifactPath(projectRoot, workflowRoot, artifacts.delivery_manifest)
  if (!manifestPath) return null

  const manifestName = manifestPath.replace(/\\/g, '/').split('/').pop() ?? ''
  const slug = manifestName.replace(/_delivery_manifest\.json$/i, '')
  const manifestDir = manifestPath.slice(0, manifestPath.length - manifestName.length).replace(/[\\/]+$/, '')
  const recordPath = resolveArtifactPath(projectRoot, workflowRoot, `${manifestDir}/${slug}_memory_learning_candidate.json`)
  const summaryPath = resolveArtifactPath(projectRoot, workflowRoot, `${manifestDir}/${slug}_memory_learning_candidate.md`)
  const payload = recordPath && existsSync(recordPath)
    ? readJson<Record<string, unknown>>(recordPath)
    : null
  if (!payload && !summaryPath) return null

  return {
    candidateId: toStringOrNull(payload?.candidate_id),
    generatedAt: toStringOrNull(payload?.generated_at),
    recordPath: recordPath && existsSync(recordPath) ? recordPath : null,
    summaryPath: summaryPath && existsSync(summaryPath) ? summaryPath : null,
    candidatePath: resolveArtifactPath(projectRoot, workflowRoot, toStringOrNull(payload?.candidate_path) ?? undefined),
    candidateMarkdownPath: resolveArtifactPath(projectRoot, workflowRoot, toStringOrNull(payload?.candidate_markdown_path) ?? undefined),
    recordReady: Boolean(recordPath && existsSync(recordPath)),
    summaryReady: Boolean(summaryPath && existsSync(summaryPath)),
    recommendedAction: toStringOrNull(payload?.recommended_action),
    promotable: Boolean(payload?.promotable),
    brainIngestOk: toBooleanOrNull(payload?.brain_ingest_ok),
    brainNodeId: toStringOrNull(payload?.brain_node_id),
    warnings: toStringArray(payload?.warnings),
  }
}

function normalizeQualityFindings(value: unknown): MedicalWorkflowQualityFinding[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map(item => ({
      id: toStringOrNull(item.id),
      severity: toStringOrNull(item.severity),
      message: toStringOrNull(item.message),
      evidence: item.evidence ?? null,
    }))
}

function normalizePackageAudit(value: Record<string, unknown> | null): MedicalWorkflowPackageAudit | null {
  if (!value) return null
  const brokenImageRefs = Array.isArray(value.broken_image_refs)
    ? value.broken_image_refs.length
    : toNumber(value.brokenImageRefs)
  const brokenMarkdownRefs = Array.isArray(value.broken_markdown_refs)
    ? value.broken_markdown_refs.length
    : toNumber(value.brokenMarkdownRefs)
  return {
    passed: typeof value.passed === 'boolean' ? value.passed : null,
    errors: toNumber(value.errors),
    warnings: toNumber(value.warnings),
    entryCount: toNumber(value.entry_count) ?? toNumber(value.entryCount),
    filesChecked: toNumber(value.files_checked) ?? toNumber(value.filesChecked),
    markdownRefsChecked: toNumber(value.markdown_refs_checked) ?? toNumber(value.markdownRefsChecked),
    imageRefsChecked: toNumber(value.image_refs_checked) ?? toNumber(value.imageRefsChecked),
    readmePresent: toBooleanOrNull(value.readme_present) ?? toBooleanOrNull(value.readmePresent),
    manifestPresent: toBooleanOrNull(value.manifest_present) ?? toBooleanOrNull(value.manifestPresent),
    brokenImageRefs,
    brokenMarkdownRefs,
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => typeof item === 'string' ? item : null)
    .filter((item): item is string => Boolean(item && item.trim()))
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
}

function normalizeLiteratureEvidence(value: Record<string, unknown> | null): MedicalWorkflowLiteratureEvidence | null {
  if (!value) return null
  const enrichment = asRecord(value.enrichment)
  const sources = Array.isArray(enrichment?.sources)
    ? enrichment.sources.map(item => String(item)).filter(Boolean)
    : []
  return {
    count: toNumber(value.count),
    agentCacheCount: toNumber(value.agent_cache_count),
    llmCount: toNumber(value.llm_count),
    ruleBasedCount: toNumber(value.rule_based_count),
    sources,
    meshCount: toNumber(enrichment?.mesh_count),
    citationCountAvailable: toNumber(enrichment?.citation_count_available),
    cacheUsed: typeof enrichment?.cache_used === 'boolean' ? enrichment.cache_used : null,
    cacheHitCount: toNumber(enrichment?.cache_hit_count),
  }
}

function readBusinessSnapshot(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
  errors: string[],
): MedicalWorkflowBusinessSnapshot | null {
  const artifacts = liveStatus.artifacts ?? {}
  const preferredFiles = [
    artifacts.stage4_json,
    artifacts.stage4_milestones,
  ].filter((value): value is string => Boolean(value))

  for (const file of preferredFiles) {
    const absolute = resolveArtifactPath(projectRoot, workflowRoot, file)
    if (!absolute || !existsSync(absolute)) continue
    const payload = readJson<Record<string, unknown>>(absolute)
    if (!payload) continue
    const snapshot = normalizeBusinessSnapshot(payload)
    if (snapshot) return snapshot
  }

  const derived = deriveBusinessArtifactCandidates(projectRoot, workflowRoot, liveStatus)
  for (const absolute of derived) {
    if (!existsSync(absolute)) continue
    const payload = readJson<Record<string, unknown>>(absolute)
    if (!payload) continue
    const snapshot = normalizeBusinessSnapshot(payload)
    if (snapshot) return snapshot
  }

  if (liveStatus.stages?.stage4?.metrics) {
    return {
      overallSuccessRate: toNumber(liveStatus.stages.stage4.metrics.success_rate),
      totalDurationMonths: parseDurationMonths(liveStatus.stages.stage4.metrics.total_duration),
      totalCostEstimate: parseCostValue(liveStatus.stages.stage4.metrics.total_cost),
      estimatedCompletion: toStringOrNull(liveStatus.stages.stage4.metrics.estimated_completion),
      dataSources: [],
      adjustmentDetails: {},
      milestones: [],
    }
  }

  errors.push('Stage 4 business snapshot is not available yet.')
  return null
}

function deriveBusinessArtifactCandidates(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
): string[] {
  const outputRoot = resolveArtifactPath(projectRoot, workflowRoot, liveStatus.output_root)
  const target = (liveStatus.target ?? '').trim()
  const disease = (liveStatus.disease ?? '').trim()
  if (!outputRoot || !target || !disease) return []

  const diseaseVariants = [...new Set([
    disease,
    disease.replace(/\s+/g, '_'),
  ])]

  const candidates: string[] = []
  for (const diseaseToken of diseaseVariants) {
    candidates.push(join(outputRoot, 'stage4', `${target}_${diseaseToken}_stage4_results.json`))
    candidates.push(join(outputRoot, 'stage4', `${target}_${diseaseToken}_milestones.json`))
  }
  return candidates
}

function normalizeBusinessSnapshot(payload: Record<string, unknown>): MedicalWorkflowBusinessSnapshot | null {
  const container = pickBusinessContainer(payload)
  if (!container) return null

  const stageAdjustments = asRecord(container.stage_adjustments)
  const adjustmentDetails = asRecord(stageAdjustments?.adjustment_details) ?? {}
  const milestones = Array.isArray(container.milestones)
    ? container.milestones.map(normalizeMilestone).filter((value): value is MedicalWorkflowMilestone => Boolean(value))
    : []

  return {
    overallSuccessRate: toNumber(container.overall_success_rate),
    totalDurationMonths: toNumber(container.total_duration_months),
    totalCostEstimate: toNumber(container.total_cost_estimate),
    estimatedCompletion: toStringOrNull(container.estimated_completion),
    dataSources: Array.isArray(stageAdjustments?.data_sources)
      ? stageAdjustments.data_sources.map(item => String(item))
      : [],
    adjustmentDetails,
    milestones,
  }
}

function pickBusinessContainer(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof payload.overall_success_rate !== 'undefined') return payload
  const stages = asRecord(payload.stages)
  const milestoneStage = asRecord(stages?.milestones)
  const data = asRecord(milestoneStage?.data)
  if (data && typeof data.overall_success_rate !== 'undefined') return data
  return null
}

function normalizeMilestone(value: unknown): MedicalWorkflowMilestone | null {
  const record = asRecord(value)
  if (!record) return null
  return {
    phase: toStringOrNull(record.phase) ?? 'unknown',
    phaseName: toStringOrNull(record.phase_name) ?? toStringOrNull(record.phase) ?? 'Unknown',
    durationMonths: toNumber(record.duration_months),
    successRate: toNumber(record.success_rate),
    cumulativeCost: toNumber(record.cumulative_cost),
    endDate: toStringOrNull(record.end_date),
  }
}

function collectArtifactLinks(
  projectRoot: string,
  workflowRoot: string,
  liveStatus: MedicalWorkflowLiveStatus,
  memorySeed?: MedicalWorkflowMemorySeed | null,
  learningCandidate?: MedicalWorkflowLearningCandidate | null,
): MedicalWorkflowArtifactLink[] {
  const links = new Map<string, MedicalWorkflowArtifactLink>()
  const knownArtifacts = liveStatus.artifacts ?? {}

  for (const [key, file] of Object.entries(knownArtifacts)) {
    const absolute = resolveArtifactPath(projectRoot, workflowRoot, file)
    if (!absolute) continue
    const exists = existsSync(absolute)
    const kind = classifyArtifact(absolute)
    links.set(absolute, {
      label: prettifyArtifactLabel(key),
      kind,
      path: absolute,
      relativePath: relative(projectRoot, absolute),
      url: artifactUrl(absolute),
      exists,
    })
  }

  for (const [key, file] of [
    ['memory_seed_record', memorySeed?.recordPath],
    ['memory_seed_summary', memorySeed?.summaryPath],
    ['learning_candidate_record', learningCandidate?.recordPath],
    ['learning_candidate_summary', learningCandidate?.summaryPath],
  ] as const) {
    if (!file) continue
    links.set(file, {
      label: prettifyArtifactLabel(key),
      kind: classifyArtifact(file),
      path: file,
      relativePath: relative(projectRoot, file),
      url: artifactUrl(file),
      exists: existsSync(file),
    })
  }

  const outputRoot = resolveArtifactPath(projectRoot, workflowRoot, liveStatus.output_root)
  if (outputRoot && existsSync(outputRoot)) {
    for (const discovered of findReportFiles(outputRoot, 3, 24)) {
      if (links.has(discovered)) continue
      links.set(discovered, {
        label: prettifyArtifactLabel(relative(outputRoot, discovered)),
        kind: classifyArtifact(discovered),
        path: discovered,
        relativePath: relative(projectRoot, discovered),
        url: artifactUrl(discovered),
        exists: true,
      })
    }
  }

  return [...links.values()]
    .filter(link => link.exists)
    .sort((left, right) => left.label.localeCompare(right.label))
}

function findReportFiles(root: string, maxDepth: number, maxFiles: number): string[] {
  const results: Array<{ path: string; mtimeMs: number }> = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || results.length >= maxFiles) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= maxFiles) return
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!isReportCandidate(entry.name)) continue
      const stats = statSync(absolute)
      results.push({ path: absolute, mtimeMs: stats.mtimeMs })
    }
  }

  walk(root, 0)

  return results
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map(item => item.path)
}

function isReportCandidate(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (!hasReportExtension(lower)) return false
  return (
    lower.includes('report')
    || lower.includes('milestone')
    || lower.includes('pipeline_output')
    || lower.includes('manuscript')
    || lower.includes('memory_summary')
    || lower.includes('memory_seed')
    || lower.includes('learning_candidate')
  )
}

function hasReportExtension(fileName: string): boolean {
  for (const extension of REPORT_EXTENSIONS) {
    if (fileName.endsWith(extension)) return true
  }
  return false
}

function classifyArtifact(path: string): MedicalWorkflowArtifactLink['kind'] {
  const lower = path.toLowerCase()
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.zip')) return 'zip'
  return 'other'
}

function prettifyArtifactLabel(value: string): string {
  return value
    .replace(/\\/g, ' / ')
    .replace(/_/g, ' ')
    .replace(/\bjson\b/gi, 'JSON')
    .replace(/\bhtml\b/gi, 'HTML')
    .replace(/\bpdf\b/gi, 'PDF')
    .replace(/\bdocx\b/gi, 'DOCX')
}

function artifactUrl(path: string): string {
  return `/medical-artifact?path=${encodeURIComponent(path)}`
}

function resolveArtifactPath(projectRoot: string, workflowRoot: string, rawPath: string | undefined): string | null {
  if (!rawPath) return null
  if (/^[A-Za-z]:[\\/]/.test(rawPath)) return resolve(rawPath)
  const workflowCandidate = resolve(workflowRoot, rawPath)
  if (existsSync(workflowCandidate)) return workflowCandidate
  return resolve(projectRoot, rawPath)
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseDurationMonths(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null
  const match = value.match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : null
}

function parseCostValue(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null
  const match = value.match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : null
}
