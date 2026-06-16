export type ActiveRedTeamSeverity = 'HIGH' | 'MEDIUM' | 'LOW'
export type ActiveRedTeamStatus = 'SKIPPED' | 'PASSED' | 'FAILED'

export interface ActiveRedTeamConfig {
  enabled?: boolean
  baseUrl?: string
  startCommand?: string
  targets?: string[]
  payloads?: string[]
  timeoutMs?: number
  maxRequests?: number
}

export interface ActiveRedTeamFinding {
  ruleId: string
  severity: ActiveRedTeamSeverity
  target: string
  message: string
  evidence?: string
}

export interface ActiveRedTeamProbe {
  target: string
  url: string
  status?: number
  passed: boolean
  findingIds?: string[]
  error?: string
}

export interface ActiveRedTeamReport {
  ok: boolean
  status: ActiveRedTeamStatus
  evidence: string
  findings: ActiveRedTeamFinding[]
  probes: ActiveRedTeamProbe[]
  blockers: string[]
  summary: {
    targets: number
    requests: number
    findings: number
  }
}

export interface ActiveRedTeamRuntime {
  fetch?: (url: string, init?: RequestInit) => Promise<{
    status: number
    text(): Promise<string>
  }>
}

interface ResolvedActiveRedTeamConfig {
  baseUrl: string
  targets: string[]
  payloads: string[]
  timeoutMs: number
  maxRequests: number
}

const DEFAULT_PAYLOADS = [
  '<scale-probe>',
  '"\'<scale-probe>',
]

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_REQUESTS = 20

export async function runActiveRedTeam(
  config?: ActiveRedTeamConfig,
  runtime: ActiveRedTeamRuntime = {},
): Promise<ActiveRedTeamReport> {
  if (!config?.enabled) {
    return createReport({
      ok: true,
      status: 'SKIPPED',
      evidence: 'Active security not enabled or not configured.',
    })
  }

  const resolved = resolveConfig(config)
  if (resolved.blockers.length > 0 || !resolved.config) {
    return createReport({
      ok: false,
      status: 'FAILED',
      evidence: `Active security configuration invalid: ${resolved.blockers.join('; ')}`,
      blockers: resolved.blockers,
    })
  }

  const fetchImpl = runtime.fetch ?? globalThis.fetch
  if (!fetchImpl) {
    return createReport({
      ok: false,
      status: 'FAILED',
      evidence: 'Active security requires fetch support in the current runtime.',
      blockers: ['fetch runtime is unavailable'],
      summary: {
        targets: resolved.config.targets.length,
        requests: 0,
        findings: 0,
      },
    })
  }

  const probes: ActiveRedTeamProbe[] = []
  const findings: ActiveRedTeamFinding[] = []
  const requests = buildRequests(resolved.config)

  for (const request of requests) {
    const probe: ActiveRedTeamProbe = {
      target: request.target,
      url: request.url,
      passed: true,
      findingIds: [],
    }

    try {
      const response = await fetchWithTimeout(fetchImpl, request.url, resolved.config.timeoutMs)
      const text = await response.text()
      probe.status = response.status

      if (text.includes(request.payload)) {
        const finding = {
          ruleId: 'active.reflected-payload',
          severity: 'HIGH',
          target: request.target,
          message: `Probe payload was reflected by ${request.target}.`,
          evidence: request.payload,
        } satisfies ActiveRedTeamFinding
        findings.push(finding)
        probe.passed = false
        probe.findingIds?.push(finding.ruleId)
      }

      if (response.status >= 500) {
        const finding = {
          ruleId: 'active.server-error',
          severity: 'MEDIUM',
          target: request.target,
          message: `Probe returned HTTP ${response.status} for ${request.target}.`,
          evidence: `status=${response.status}`,
        } satisfies ActiveRedTeamFinding
        findings.push(finding)
        probe.passed = false
        probe.findingIds?.push(finding.ruleId)
      }
    } catch (error) {
      probe.passed = false
      probe.error = error instanceof Error ? error.message : String(error)
      findings.push({
        ruleId: 'active.probe-error',
        severity: 'MEDIUM',
        target: request.target,
        message: `Active security probe failed for ${request.target}.`,
        evidence: probe.error,
      })
      probe.findingIds?.push('active.probe-error')
    }

    probes.push(probe)
  }

  const blockers = findings
    .filter(finding => finding.severity === 'HIGH')
    .map(finding => `${finding.ruleId}: ${finding.message}`)

  const ok = blockers.length === 0
  const evidence = ok
    ? `Active security probes passed (${probes.length} requests, ${findings.length} findings).`
    : `Active security found blockers: ${blockers.join('; ')}`

  return createReport({
    ok,
    status: ok ? 'PASSED' : 'FAILED',
    evidence,
    findings,
    probes,
    blockers,
    summary: {
      targets: resolved.config.targets.length,
      requests: probes.length,
      findings: findings.length,
    },
  })
}

function resolveConfig(input: ActiveRedTeamConfig): { config?: ResolvedActiveRedTeamConfig; blockers: string[] } {
  const blockers: string[] = []

  if (!input.baseUrl) {
    blockers.push('security.active.baseUrl is required')
  } else {
    try {
      const url = new URL(input.baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        blockers.push('security.active.baseUrl must use http or https')
      }
    } catch {
      blockers.push('security.active.baseUrl must be a valid URL')
    }
  }

  const targets = input.targets?.filter(Boolean) ?? []
  if (targets.length === 0) {
    blockers.push('security.active.targets must contain at least one target')
  }

  const payloads = input.payloads?.filter(Boolean) ?? DEFAULT_PAYLOADS
  if (payloads.length === 0) {
    blockers.push('security.active.payloads must contain at least one payload')
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    blockers.push('security.active.timeoutMs must be greater than zero')
  }

  const maxRequests = Math.min(input.maxRequests ?? DEFAULT_MAX_REQUESTS, DEFAULT_MAX_REQUESTS)
  if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
    blockers.push('security.active.maxRequests must be greater than zero')
  }

  if (blockers.length > 0 || !input.baseUrl) {
    return { blockers }
  }

  return {
    blockers,
    config: {
      baseUrl: input.baseUrl,
      targets,
      payloads,
      timeoutMs,
      maxRequests,
    },
  }
}

function buildRequests(config: ResolvedActiveRedTeamConfig): Array<{ target: string; payload: string; url: string }> {
  const requests: Array<{ target: string; payload: string; url: string }> = []

  for (const target of config.targets) {
    for (const payload of config.payloads) {
      const url = new URL(target, config.baseUrl)
      url.searchParams.set('scale_probe', payload)
      requests.push({
        target,
        payload,
        url: url.toString(),
      })

      if (requests.length >= config.maxRequests) {
        return requests
      }
    }
  }

  return requests
}

async function fetchWithTimeout(
  fetchImpl: NonNullable<ActiveRedTeamRuntime['fetch']>,
  url: string,
  timeoutMs: number,
): ReturnType<NonNullable<ActiveRedTeamRuntime['fetch']>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetchImpl(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function createReport(input: Partial<ActiveRedTeamReport> & Pick<ActiveRedTeamReport, 'ok' | 'status' | 'evidence'>): ActiveRedTeamReport {
  const findings = input.findings ?? []
  const probes = input.probes ?? []

  return {
    ok: input.ok,
    status: input.status,
    evidence: input.evidence,
    findings,
    probes,
    blockers: input.blockers ?? [],
    summary: input.summary ?? {
      targets: 0,
      requests: probes.length,
      findings: findings.length,
    },
  }
}
