import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  attestTargetNoModelUsage,
  buildTargetReleaseReadiness,
  buildTargetRuntimeReadiness,
  buildTargetSetupPlan,
  buildTargetTokenCostReport,
  applyTargetSetup,
  formatStageLabel,
  ingestTargetTokenUsage,
  readTargetNoModelUsageAttestation,
  renderTargetSetupVisualPlan,
  resolveTargetMemorySeedPlan,
  resolveTargetPlatform,
  settleTargetDeliveryLearning,
  targetCommand,
} from '../../src/cli/targetCommands.js'

describe('targetCommands', () => {
  function writeUsageRecord(projectDir: string, overrides: Record<string, unknown> = {}) {
    const usageDir = join(projectDir, '.scale', 'model-usage')
    mkdirSync(usageDir, { recursive: true })
    writeFileSync(join(usageDir, 'usage.jsonl'), JSON.stringify({
      id: 'USAGE-test',
      timestamp: '2026-06-15T10:00:00.000Z',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      taskId: 'literature-review-CDK4',
      sessionId: 'SESSION-medscale',
      inputTokens: 1000,
      outputTokens: 250,
      cacheEligibleTokens: 700,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 500,
      cachedTokens: 0,
      estimatedCostUsd: 0.12,
      metadata: { medical_lane: 'literature', target: 'CDK4', disease: 'breast cancer' },
      totalTokens: 1250,
      cacheSavingsTokens: 500,
      ...overrides,
    }) + '\n', 'utf-8')
  }

  it('resolves target-research-platform from repository root', () => {
    const repoRoot = join(import.meta.dirname, '..', '..')
    const resolved = resolveTargetPlatform(repoRoot)
    expect(resolved).not.toBeNull()
    expect(resolved?.mainPy.endsWith('main.py')).toBe(true)
    expect(resolved?.platformDir).toContain('target-research-platform')
  })

  it('returns null when platform is missing', () => {
    const resolved = resolveTargetPlatform('/tmp/non-existent-scale-project')
    expect(resolved).toBeNull()
  })

  it('formats stage labels for delivery docs', () => {
    expect(formatStageLabel('expression')).toContain('表达')
    expect(formatStageLabel('business')).toContain('商业')
  })
  it('exposes manuscript generation as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('manuscript')
  })

  it('exposes delivery packaging as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('package')
  })

  it('exposes medical memory seeding as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('remember')
  })

  it('exposes medical learning settlement as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('learn')
  })

  it('exposes Memory Brain review as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('memory-review')
  })

  it('exposes token/cost reporting as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('token')
    expect(Object.keys(targetCommand.subCommands?.token.subCommands ?? {})).toContain('ingest')
    expect(Object.keys(targetCommand.subCommands?.token.subCommands ?? {})).toContain('attest-no-usage')
  })

  it('exposes medical runtime doctor as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('doctor')
  })

  it('exposes release readiness as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('release-check')
  })

  it('exposes MedSCALE OS plan export as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('os-plan')
  })

  it('exposes MedSCALE setup planning as a first-class target command', () => {
    expect(Object.keys(targetCommand.subCommands ?? {})).toContain('setup')
  })

  it('reports optional third-party runtime gaps without requiring governance CLI', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-target-runtime-'))
    try {
      const fakeBin = join(projectDir, 'bin')
      mkdirSync(fakeBin, { recursive: true })
      for (const command of ['gbrain', 'graphify', 'python', 'uv', 'node']) {
        writeFileSync(join(fakeBin, command), '', 'utf-8')
        writeFileSync(join(fakeBin, `${command}.cmd`), '', 'utf-8')
      }

      const scaleDir = join(projectDir, '.scale')
      mkdirSync(scaleDir, { recursive: true })
      writeFileSync(join(scaleDir, 'memory-providers.json'), JSON.stringify({
        routing: { mode: 'external-first', defaultOrder: ['gbrain', 'scale-local'] },
        providers: [
          { id: 'gbrain', enabled: true, writeMode: 'disabled' },
          { id: 'scale-local', enabled: true, writeMode: 'candidate-only' },
          { id: 'agentmemory', enabled: false },
        ],
      }), 'utf-8')
      writeFileSync(join(scaleDir, 'skills.json'), JSON.stringify({
        policy: { mode: 'warn' },
        domains: { ui: {}, webResearch: {} },
      }), 'utf-8')
      writeFileSync(join(scaleDir, 'code-intelligence.json'), JSON.stringify({
        providers: { codegraph: { enabled: true }, graphify: { enabled: true } },
      }), 'utf-8')

      mkdirSync(join(projectDir, 'mcp-configs', 'memory'), { recursive: true })
      mkdirSync(join(projectDir, 'mcp-configs', 'playwright'), { recursive: true })
      mkdirSync(join(projectDir, 'graphify-out'), { recursive: true })
      writeFileSync(join(projectDir, 'graphify-out', 'manifest.json'), '{}\n', 'utf-8')
      mkdirSync(join(projectDir, '.codegraph'), { recursive: true })
      writeFileSync(join(projectDir, '.codegraph', 'codegraph.db'), '', 'utf-8')

      const platformDir = join(projectDir, 'target-research-platform')
      mkdirSync(join(platformDir, 'src', 'api_clients'), { recursive: true })
      mkdirSync(join(platformDir, 'src', 'dashboard'), { recursive: true })
      mkdirSync(join(platformDir, 'src', 'output'), { recursive: true })
      mkdirSync(join(platformDir, 'tests'), { recursive: true })
      writeFileSync(join(platformDir, 'main.py'), 'print("ok")\n', 'utf-8')
      writeFileSync(join(platformDir, 'requirements.txt'), 'pytest\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'dashboard', 'app.py'), '', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'pubmed_client.py'), 'class PubMedClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'openalex_client.py'), 'class OpenAlexClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'openfda_client.py'), 'class OpenFDAClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'patentsview_client.py'), 'class PatentsViewClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'output', 'delivery_packager.py'), 'def audit_delivery_package():\n    return {"hash_mismatches": [], "broken_markdown_refs": [], "broken_image_refs": [], "image_refs_checked": 1}\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'output', 'manuscript_quality.py'), 'CHECK_ID = "figures.referenced_in_text"\n', 'utf-8')
      writeFileSync(join(platformDir, 'tests', 'test_literature_enrichment.py'), 'def test_literature():\n    assert True\n', 'utf-8')
      writeFileSync(join(platformDir, 'tests', 'test_delivery_manifest.py'), 'def test_delivery_manifest():\n    assert True\n', 'utf-8')

      const readiness = buildTargetRuntimeReadiness(projectDir, {
        ...process.env,
        PATH: fakeBin,
        Path: fakeBin,
        PATHEXT: '.CMD;.EXE;.PS1',
      })
      const cards = Object.fromEntries(readiness.cards.map(card => [card.id, card]))

      expect(readiness.status).toBe('degraded')
      expect(cards.third_party_memory.state).toBe('pass')
      expect(cards.code_intelligence.state).toBe('warning')
      expect(cards.cli_runtime.state).toBe('pass')
      expect(cards.medical_skills.state).toBe('warning')
      expect(cards.mcp_surface.state).toBe('warning')
      expect(cards.token_cost.state).toBe('warning')
      expect(cards.token_cost.statusLabel).toBe('COST PENDING')
      expect(cards.medical_retrieval.state).toBe('warning')
      expect(cards.medical_retrieval.statusLabel).toBe('PATENT KEY MISSING')
      expect(cards.medical_retrieval.details).toContain('patent_api_key=missing')
      expect(cards.medical_workflow.state).toBe('pass')
      expect(readiness.requiredMissing).toEqual([])

      const release = buildTargetReleaseReadiness({
        projectDir,
        env: {
          ...process.env,
          PATH: fakeBin,
          Path: fakeBin,
          PATHEXT: '.CMD;.EXE;.PS1',
        },
        checkGit: false,
      })
      expect(release.ok).toBe(false)
      expect(release.status).toBe('blocked')
      expect(release.blockers).toEqual(expect.arrayContaining([
        expect.stringContaining('token_usage_ledger'),
      ]))
      expect(release.blockers).not.toEqual(expect.arrayContaining([
        expect.stringContaining('patent_evidence_credentials'),
      ]))
      expect(release.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('runtime_readiness'),
        expect.stringContaining('patent_evidence_credentials'),
      ]))

      const attestation = attestTargetNoModelUsage({
        projectDir,
        releaseScope: 'test-release',
        reason: 'Focused release readiness tests did not call a model provider.',
        assertedBy: 'vitest',
        evidence: ['npx vitest run tests/cli/targetCommands.test.ts'],
      })
      expect(readTargetNoModelUsageAttestation(projectDir)).toEqual(attestation)

      const releaseWithAttestation = buildTargetReleaseReadiness({
        projectDir,
        env: {
          ...process.env,
          PATH: fakeBin,
          Path: fakeBin,
          PATHEXT: '.CMD;.EXE;.PS1',
        },
        checkGit: false,
      })
      expect(releaseWithAttestation.ok).toBe(true)
      expect(releaseWithAttestation.checks.find(check => check.id === 'token_usage_ledger')).toEqual(expect.objectContaining({
        state: 'pass',
        statusLabel: 'NO MODEL USAGE ATTESTED',
      }))
      expect(buildTargetTokenCostReport({ projectDir, sinceDays: undefined }).summary.totalRecords).toBe(0)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('marks medical skill domains and MCP server map ready when contracts exist', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-target-contracts-'))
    try {
      const fakeBin = join(projectDir, 'bin')
      mkdirSync(fakeBin, { recursive: true })
      for (const command of ['gbrain', 'graphify', 'codegraph', 'python', 'uv', 'node']) {
        writeFileSync(join(fakeBin, command), '', 'utf-8')
        writeFileSync(join(fakeBin, `${command}.cmd`), '', 'utf-8')
      }

      const scaleDir = join(projectDir, '.scale')
      mkdirSync(scaleDir, { recursive: true })
      writeFileSync(join(scaleDir, 'memory-providers.json'), JSON.stringify({
        routing: { mode: 'external-first', defaultOrder: ['gbrain', 'scale-local'] },
        providers: [
          { id: 'gbrain', enabled: true, writeMode: 'disabled' },
          { id: 'scale-local', enabled: true, writeMode: 'candidate-only' },
        ],
      }), 'utf-8')
      writeFileSync(join(scaleDir, 'skills.json'), JSON.stringify({
        policy: { mode: 'warn' },
        domains: {
          medicalLiteratureReview: {},
          medicalFactCheck: {},
          medicalEvidenceGrading: {},
          medicalStatisticalReview: {},
          medicalPackageAudit: {},
          medicalMemoryCurator: {},
        },
      }), 'utf-8')
      writeFileSync(join(scaleDir, 'code-intelligence.json'), JSON.stringify({
        providers: { codegraph: { enabled: true }, graphify: { enabled: true } },
      }), 'utf-8')
      writeFileSync(join(scaleDir, 'mcp-servers.yaml'), [
        'servers:',
        '  - id: medical-literature',
        '  - id: medical-fact-check',
        '  - id: medical-memory-review',
        '  - id: medical-package-audit',
        '  - id: medical-evidence-manifest',
        '',
      ].join('\n'), 'utf-8')
      writeUsageRecord(projectDir)

      mkdirSync(join(projectDir, 'mcp-configs', 'memory'), { recursive: true })
      mkdirSync(join(projectDir, 'mcp-configs', 'playwright'), { recursive: true })
      mkdirSync(join(projectDir, 'graphify-out'), { recursive: true })
      writeFileSync(join(projectDir, 'graphify-out', 'manifest.json'), '{}\n', 'utf-8')
      mkdirSync(join(projectDir, '.codegraph'), { recursive: true })
      writeFileSync(join(projectDir, '.codegraph', 'codegraph.db'), '', 'utf-8')

      const platformDir = join(projectDir, 'target-research-platform')
      mkdirSync(join(platformDir, 'src', 'api_clients'), { recursive: true })
      mkdirSync(join(platformDir, 'src', 'dashboard'), { recursive: true })
      mkdirSync(join(platformDir, 'src', 'output'), { recursive: true })
      mkdirSync(join(platformDir, 'tests'), { recursive: true })
      writeFileSync(join(platformDir, 'main.py'), 'print("ok")\n', 'utf-8')
      writeFileSync(join(platformDir, 'requirements.txt'), 'pytest\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'dashboard', 'app.py'), '', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'pubmed_client.py'), 'class PubMedClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'openalex_client.py'), 'class OpenAlexClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'openfda_client.py'), 'class OpenFDAClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'patentsview_client.py'), 'class PatentsViewClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'output', 'delivery_packager.py'), 'def audit_delivery_package():\n    return {"hash_mismatches": [], "broken_markdown_refs": [], "broken_image_refs": [], "image_refs_checked": 1}\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'output', 'manuscript_quality.py'), 'CHECK_ID = "figures.referenced_in_text"\n', 'utf-8')
      writeFileSync(join(platformDir, 'tests', 'test_literature_enrichment.py'), 'def test_literature():\n    assert True\n', 'utf-8')
      writeFileSync(join(platformDir, 'tests', 'test_delivery_manifest.py'), 'def test_delivery_manifest():\n    assert True\n', 'utf-8')

      const readiness = buildTargetRuntimeReadiness(projectDir, {
        ...process.env,
        PATH: fakeBin,
        Path: fakeBin,
        PATHEXT: '.CMD;.EXE;.PS1',
        PATENTSVIEW_API_KEY: 'test-key',
      })
      const cards = Object.fromEntries(readiness.cards.map(card => [card.id, card]))

      expect(readiness.status).toBe('ready')
      expect(cards.medical_skills.state).toBe('pass')
      expect(cards.medical_skills.statusLabel).toBe('SKILLS READY')
      expect(cards.mcp_surface.state).toBe('pass')
      expect(cards.mcp_surface.statusLabel).toBe('MCP READY')
      expect(cards.mcp_surface.details).toContain('missing_medical_routes=none')
      expect(cards.medical_retrieval.state).toBe('pass')
      expect(cards.medical_retrieval.statusLabel).toBe('RETRIEVAL READY')
      expect(cards.medical_retrieval.details).toContain('patent_api_key=present')
      expect(cards.token_cost.state).toBe('pass')
      expect(cards.token_cost.statusLabel).toBe('COST TRACKED')

      const release = buildTargetReleaseReadiness({
        projectDir,
        env: {
          ...process.env,
          PATH: fakeBin,
          Path: fakeBin,
          PATHEXT: '.CMD;.EXE;.PS1',
          PATENTSVIEW_API_KEY: 'test-key',
        },
        checkGit: false,
      })
      expect(release.ok).toBe(true)
      expect(release.status).toBe('ready')
      expect(release.checks.map(check => [check.id, check.state])).toEqual([
        ['runtime_readiness', 'pass'],
        ['token_usage_ledger', 'pass'],
        ['patent_evidence_credentials', 'pass'],
        ['git_worktree_clean', 'warning'],
      ])
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('builds a bilingual setup plan for third-party medical workflow capabilities', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-target-setup-'))
    try {
      const fakeBin = join(projectDir, 'bin')
      mkdirSync(fakeBin, { recursive: true })
      for (const command of ['gbrain', 'graphify', 'python', 'uv', 'node']) {
        writeFileSync(join(fakeBin, command), '', 'utf-8')
        writeFileSync(join(fakeBin, `${command}.cmd`), '', 'utf-8')
      }

      writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
        name: '@hongmaple0820/med-scale-research-os',
        bin: { medscale: 'dist/api/medscale.js' },
      }), 'utf-8')

      const scaleDir = join(projectDir, '.scale')
      mkdirSync(scaleDir, { recursive: true })
      writeFileSync(join(scaleDir, 'memory-providers.json'), JSON.stringify({
        routing: { mode: 'external-first', defaultOrder: ['gbrain', 'scale-local'] },
        providers: [
          { id: 'gbrain', enabled: true, writeMode: 'disabled' },
          { id: 'scale-local', enabled: true, writeMode: 'candidate-only' },
          { id: 'agentmemory', enabled: false },
        ],
      }), 'utf-8')
      writeFileSync(join(scaleDir, 'skills.json'), JSON.stringify({
        policy: { mode: 'warn' },
        domains: { ui: {}, webResearch: {} },
      }), 'utf-8')
      writeFileSync(join(scaleDir, 'code-intelligence.json'), JSON.stringify({
        providers: { codegraph: { enabled: true }, graphify: { enabled: true } },
      }), 'utf-8')

      mkdirSync(join(projectDir, 'mcp-configs', 'memory'), { recursive: true })
      mkdirSync(join(projectDir, 'graphify-out'), { recursive: true })
      writeFileSync(join(projectDir, 'graphify-out', 'manifest.json'), '{}\n', 'utf-8')

      const platformDir = join(projectDir, 'target-research-platform')
      mkdirSync(join(platformDir, 'src', 'api_clients'), { recursive: true })
      mkdirSync(join(platformDir, 'src', 'dashboard'), { recursive: true })
      mkdirSync(join(platformDir, 'src', 'output'), { recursive: true })
      mkdirSync(join(platformDir, 'tests'), { recursive: true })
      writeFileSync(join(platformDir, 'main.py'), 'print("ok")\n', 'utf-8')
      writeFileSync(join(platformDir, 'requirements.txt'), 'pytest\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'dashboard', 'app.py'), '', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'pubmed_client.py'), 'class PubMedClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'api_clients', 'openalex_client.py'), 'class OpenAlexClient: pass\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'output', 'delivery_packager.py'), 'def audit_delivery_package():\n    return {"hash_mismatches": [], "broken_markdown_refs": [], "broken_image_refs": [], "image_refs_checked": 1}\n', 'utf-8')
      writeFileSync(join(platformDir, 'src', 'output', 'manuscript_quality.py'), 'CHECK_ID = "figures.referenced_in_text"\n', 'utf-8')
      writeFileSync(join(platformDir, 'tests', 'test_literature_enrichment.py'), 'def test_literature():\n    assert True\n', 'utf-8')
      writeFileSync(join(platformDir, 'tests', 'test_delivery_manifest.py'), 'def test_delivery_manifest():\n    assert True\n', 'utf-8')

      const env = {
        ...process.env,
        PATH: fakeBin,
        Path: fakeBin,
        PATHEXT: '.CMD;.EXE;.PS1',
      }
      const plan = buildTargetSetupPlan({
        projectDir,
        lang: 'en',
        platform: 'linux',
        env,
      })
      const capabilities = Object.fromEntries(plan.capabilities.map(capability => [capability.id, capability]))

      expect(plan.schema).toBe('medscale.setup_plan.v1')
      expect(plan.product).toBe('MedSCALE Research OS')
      expect(plan.lang).toBe('en')
      expect(plan.platform).toBe('linux')
      expect(plan.status).toBe('degraded')
      expect(plan.summary.requiredMissing).toEqual([])
      expect(plan.commands.npx).toContain('@hongmaple0820/med-scale-research-os')
      expect(plan.commands.visual).toContain('--visual')
      expect(capabilities['native-cli'].status).toBe('ready')
      expect(capabilities['npx-visual-installer'].status).toBe('partial')
      expect(capabilities['npx-visual-installer'].evidence).toContain('visual_command=present')
      expect(capabilities.gbrain.status).toBe('ready')
      expect(capabilities.graphify.status).toBe('ready')
      expect(capabilities.codegraph.status).toBe('missing')
      expect(capabilities.rtk.status).toBe('missing')
      expect(capabilities.gbrain.required).toBe(false)
      expect(capabilities.agentmemory.required).toBe(false)
      expect(capabilities.graphify.required).toBe(false)
      expect(capabilities.codegraph.required).toBe(false)
      expect(capabilities.rtk.required).toBe(false)
      expect(capabilities['medical-skills'].status).toBe('partial')
      expect(capabilities['mcp-server-map'].status).toBe('partial')
      expect(capabilities['pubmed-openalex'].status).toBe('partial')
      expect(capabilities['package-audit'].status).toBe('ready')
      expect(capabilities['figure-refs'].status).toBe('ready')
      expect(capabilities['memory-brain-review'].status).toBe('ready')
      expect(capabilities['token-cost'].status).toBe('partial')
      expect(capabilities['token-cost'].verify.selected).toContain('token report')
      expect(capabilities['memory-brain-review'].verify.selected).toContain('memory-review')
      expect(capabilities.rtk.install.selected).toContain('cargo install')
      expect(capabilities['pubmed-openalex'].verify.selected).toContain('python -m pytest')

      const zhPlan = buildTargetSetupPlan({
        projectDir,
        lang: 'zh',
        platform: 'windows',
        env,
      })
      const zhMedicalSkills = zhPlan.capabilities.find(capability => capability.id === 'medical-skills')
      expect(zhPlan.lang).toBe('zh')
      expect(zhPlan.nextSteps[0]).toContain('运行')
      expect(zhMedicalSkills?.title).toContain('医学')
      expect(zhMedicalSkills?.summary).toContain('文献评审')
      expect(zhPlan.capabilities.find(capability => capability.id === 'codegraph')?.install.selected).toContain('npm install')

      const visual = renderTargetSetupVisualPlan(plan)
      expect(visual).toContain('MedSCALE Research OS Visual Setup Guide')
      expect(visual).toContain('Capability lanes')
      expect(visual).toContain('Install queue')
      expect(visual).toContain('Verify queue')
      expect(visual).toContain('npx -y @hongmaple0820/med-scale-research-os setup --visual --lang en')
      expect(visual).toContain('Tip: setup --visual only displays grouped commands')
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('applies bundled MedSCALE medical platform files into an empty workspace without overwriting', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-setup-apply-'))
    try {
      const first = applyTargetSetup({ projectDir, lang: 'en' })

      expect(first.schema).toBe('medscale.setup_apply.v1')
      expect(first.ok).toBe(true)
      expect(first.copied).toBeGreaterThanOrEqual(5)
      expect(first.missing).toBe(0)
      expect(existsSync(join(projectDir, 'target-research-platform', 'main.py'))).toBe(true)
      expect(existsSync(join(projectDir, 'target-research-platform', 'src', 'api_clients', 'pubmed_client.py'))).toBe(true)
      expect(existsSync(join(projectDir, '.scale', 'skills.json'))).toBe(true)
      expect(existsSync(join(projectDir, '.scale', 'mcp-servers.yaml'))).toBe(true)
      expect(existsSync(join(projectDir, 'mcp-configs', 'memory', 'config.json'))).toBe(true)
      expect(existsSync(join(projectDir, 'target-research-platform', 'output'))).toBe(false)

      const sentinelPath = join(projectDir, '.scale', 'skills.json')
      writeFileSync(sentinelPath, '{"sentinel":true}\n', 'utf-8')
      const second = applyTargetSetup({ projectDir, lang: 'en' })

      expect(second.ok).toBe(true)
      expect(second.skipped).toBeGreaterThan(0)
      expect(readFileSync(sentinelPath, 'utf-8')).toContain('"sentinel":true')
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('applies bundled platform files when the package is installed under node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'medscale-setup-npx-'))
    const packageRoot = join(root, 'node_modules', '@hongmaple0820', 'med-scale-research-os')
    const projectDir = join(root, 'workspace')
    try {
      mkdirSync(join(packageRoot, 'target-research-platform', 'src', 'api_clients'), { recursive: true })
      mkdirSync(join(packageRoot, '.scale'), { recursive: true })
      mkdirSync(join(packageRoot, 'mcp-configs', 'memory'), { recursive: true })
      mkdirSync(join(packageRoot, 'docs'), { recursive: true })
      writeFileSync(join(packageRoot, 'target-research-platform', 'main.py'), 'print("medscale")\n', 'utf-8')
      writeFileSync(join(packageRoot, 'target-research-platform', 'requirements.txt'), 'pytest\n', 'utf-8')
      writeFileSync(join(packageRoot, 'target-research-platform', 'src', 'api_clients', 'pubmed_client.py'), '# pubmed\n', 'utf-8')
      writeFileSync(join(packageRoot, '.scale', 'skills.json'), '{"domains":[]}\n', 'utf-8')
      writeFileSync(join(packageRoot, '.scale', 'mcp-servers.yaml'), 'servers: []\n', 'utf-8')
      writeFileSync(join(packageRoot, '.scale', 'verification.json'), '{}\n', 'utf-8')
      writeFileSync(join(packageRoot, 'mcp-configs', 'memory', 'config.json'), '{}\n', 'utf-8')
      writeFileSync(join(packageRoot, 'docs', 'README.md'), '# MedSCALE\n', 'utf-8')

      const report = applyTargetSetup({ projectDir, packageRoot, lang: 'en' })

      expect(report.ok).toBe(true)
      expect(report.missing).toBe(0)
      expect(existsSync(join(projectDir, 'target-research-platform', 'main.py'))).toBe(true)
      expect(existsSync(join(projectDir, 'target-research-platform', 'src', 'api_clients', 'pubmed_client.py'))).toBe(true)
      expect(existsSync(join(projectDir, 'mcp-configs', 'memory', 'config.json'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('builds a MedSCALE token/cost report from the model usage ledger', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-token-cost-'))
    try {
      writeUsageRecord(projectDir)

      const report = buildTargetTokenCostReport({
        projectDir,
        sinceDays: undefined,
        limit: 10,
      })

      expect(report.schema).toBe('medscale.token_cost.v1')
      expect(report.status).toBe('ready')
      expect(report.summary.totalRecords).toBe(1)
      expect(report.summary.totalTokens).toBe(1250)
      expect(report.summary.cacheSavingsTokens).toBe(500)
      expect(report.summary.estimatedCostUsd).toBe(0.12)
      expect(report.byMedicalLane).toEqual([
        expect.objectContaining({
          key: 'literature',
          label: 'Literature review',
          records: 1,
          totalTokens: 1250,
          estimatedCostUsd: 0.12,
        }),
      ])
      expect(report.usagePath).toContain(join('.scale', 'model-usage', 'usage.jsonl'))
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('ingests real token usage from medical workflow artifacts without duplicating records', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-token-ingest-'))
    try {
      const platformDir = join(projectDir, 'target-research-platform')
      const manuscriptsDir = join(platformDir, 'output', 'manuscripts')
      mkdirSync(manuscriptsDir, { recursive: true })
      writeFileSync(join(platformDir, 'main.py'), 'print("ok")\n', 'utf-8')

      const factCheck = join(manuscriptsDir, 'CDK4_breast_cancer_manuscript_fact_check.json')
      const manifestPath = join(manuscriptsDir, 'CDK4_breast_cancer_delivery_manifest.json')
      writeFileSync(factCheck, JSON.stringify({
        checks: [
          {
            role: 'medical_fact_check',
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            estimated_cost_usd: 0.045,
            usage: {
              input_tokens: 400,
              output_tokens: 80,
              cache_read_input_tokens: 120,
            },
          },
        ],
      }), 'utf-8')
      writeFileSync(manifestPath, JSON.stringify({
        target: 'CDK4',
        disease: 'breast cancer',
        files: [
          { role: 'manuscript_fact_check', path: factCheck },
          { role: 'delivery_manifest', path: manifestPath },
        ],
      }), 'utf-8')

      const first = ingestTargetTokenUsage({
        projectDir,
        target: 'CDK4',
        disease: 'breast cancer',
      })

      expect(first.schema).toBe('medscale.token_ingest.v1')
      expect(first.status).toBe('ready')
      expect(first.recorded).toBe(1)
      expect(first.duplicates).toBe(0)
      expect(first.sources[0]).toEqual(expect.objectContaining({
        status: 'recorded',
        medicalLane: 'fact_check',
        provider: 'anthropic',
        totalTokens: 480,
      }))
      expect(first.tokenCost.summary.totalRecords).toBe(1)
      expect(first.tokenCost.byMedicalLane).toEqual([
        expect.objectContaining({
          key: 'fact_check',
          records: 1,
          totalTokens: 480,
          cacheSavingsTokens: 120,
          estimatedCostUsd: 0.045,
        }),
      ])

      const second = ingestTargetTokenUsage({
        projectDir,
        target: 'CDK4',
        disease: 'breast cancer',
      })

      expect(second.recorded).toBe(0)
      expect(second.duplicates).toBe(1)
      expect(second.tokenCost.summary.totalRecords).toBe(1)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('does not ingest business cost artifacts without model token fields', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-token-ingest-cost-'))
    try {
      const artifact = join(projectDir, 'package_audit.json')
      writeFileSync(artifact, JSON.stringify({
        package_audit: {
          passed: true,
          total_cost_estimate: 125000,
          cost_usd: 4500,
        },
      }), 'utf-8')

      const report = ingestTargetTokenUsage({
        projectDir,
        files: [artifact],
        provider: 'anthropic',
      })

      expect(report.status).toBe('pending')
      expect(report.recorded).toBe(0)
      expect(report.sources).toEqual([])
      expect(report.tokenCost.summary.totalRecords).toBe(0)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('deduplicates repeated MedSCALE usage envelope ids across artifacts', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-token-ingest-envelope-'))
    try {
      const envelope = {
        schema: 'medscale.usage_envelope.v1',
        usage_id: 'MSU-shared-envelope',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        medical_lane: 'literature',
        source_role: 'literature_deep_review',
        target: 'CDK4',
        disease: 'breast cancer',
        evidence_ref: 'pmid:12345678',
        usage: {
          prompt_tokens: 900,
          completion_tokens: 120,
          cache_read_input_tokens: 300,
        },
      }
      const first = join(projectDir, 'manuscript_meta.json')
      const second = join(projectDir, 'delivery_manifest.json')
      writeFileSync(first, JSON.stringify({ usage_envelopes: [envelope] }), 'utf-8')
      writeFileSync(second, JSON.stringify({ usage: { envelopes: [envelope] } }), 'utf-8')

      const report = ingestTargetTokenUsage({
        projectDir,
        files: [first, second],
      })

      expect(report.recorded).toBe(1)
      expect(report.duplicates).toBe(1)
      expect(report.tokenCost.summary.totalRecords).toBe(1)
      expect(report.records[0].metadata).toEqual(expect.objectContaining({
        usage_id: 'MSU-shared-envelope',
        medical_lane: 'literature',
      }))
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('builds a delivery-memory seed plan from the matching manifest', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-target-memory-'))
    try {
      const platformDir = join(projectDir, 'target-research-platform')
      const manuscriptsDir = join(platformDir, 'output', 'manuscripts')
      mkdirSync(manuscriptsDir, { recursive: true })
      writeFileSync(join(platformDir, 'main.py'), 'print("ok")\n', 'utf-8')

      const manuscript = join(manuscriptsDir, 'CDK4_breast_cancer_manuscript.md')
      const meta = join(manuscriptsDir, 'CDK4_breast_cancer_manuscript_meta.json')
      const quality = join(manuscriptsDir, 'CDK4_breast_cancer_manuscript_quality.json')
      const factCheck = join(manuscriptsDir, 'CDK4_breast_cancer_manuscript_fact_check.json')
      const manifestPath = join(manuscriptsDir, 'CDK4_breast_cancer_delivery_manifest.json')

      writeFileSync(manuscript, '# manuscript\n', 'utf-8')
      writeFileSync(meta, '{"target":"CDK4"}\n', 'utf-8')
      writeFileSync(quality, '{"passed":true}\n', 'utf-8')
      writeFileSync(factCheck, '{"passed":true}\n', 'utf-8')
      writeFileSync(manifestPath, JSON.stringify({
        target: 'CDK4',
        disease: 'breast cancer',
        files: [
          { role: 'manuscript_markdown', path: manuscript },
          { role: 'manuscript_meta', path: meta },
          { role: 'manuscript_quality', path: quality },
          { role: 'manuscript_fact_check', path: factCheck },
          { role: 'delivery_manifest', path: manifestPath },
        ],
      }), 'utf-8')

      const plan = resolveTargetMemorySeedPlan({
        projectDir,
        target: 'CDK4',
        disease: 'breast cancer',
      })

      expect(plan.ok).toBe(true)
      expect(plan.manifestPath).toBe(manifestPath)
      expect(plan.sourceFiles).toEqual(expect.arrayContaining([
        manuscript,
        meta,
        quality,
        factCheck,
        manifestPath,
      ]))
      expect(plan.missingRoles).toEqual(expect.arrayContaining([
        'manuscript_zhongliu',
        'literature_evidence_pack',
      ]))
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('settles a medical delivery into a reviewable learning candidate', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'medscale-target-learning-'))
    try {
      const platformDir = join(projectDir, 'target-research-platform')
      const manuscriptsDir = join(platformDir, 'output', 'manuscripts')
      mkdirSync(manuscriptsDir, { recursive: true })
      writeFileSync(join(platformDir, 'main.py'), 'print("ok")\n', 'utf-8')

      const manuscript = join(manuscriptsDir, 'EGFR_lung_cancer_manuscript.md')
      const meta = join(manuscriptsDir, 'EGFR_lung_cancer_manuscript_meta.json')
      const quality = join(manuscriptsDir, 'EGFR_lung_cancer_manuscript_quality.json')
      const factCheck = join(manuscriptsDir, 'EGFR_lung_cancer_manuscript_fact_check.json')
      const manifestPath = join(manuscriptsDir, 'EGFR_lung_cancer_delivery_manifest.json')

      writeFileSync(manuscript, '# manuscript\n', 'utf-8')
      writeFileSync(meta, '{"target":"EGFR"}\n', 'utf-8')
      writeFileSync(quality, '{"passed":true,"grade":"A","score":98}\n', 'utf-8')
      writeFileSync(factCheck, '{"passed":true,"score":97,"claims_checked":12}\n', 'utf-8')
      writeFileSync(manifestPath, JSON.stringify({
        target: 'EGFR',
        disease: 'lung cancer',
        human_review_todo: ['Add authors and ethics statements.'],
        literature: {
          count: 12,
          agent_cache_count: 8,
          llm_count: 2,
          rule_based_count: 0,
        },
        files: [
          { role: 'manuscript_markdown', path: manuscript },
          { role: 'manuscript_meta', path: meta },
          { role: 'manuscript_quality', path: quality },
          { role: 'manuscript_fact_check', path: factCheck },
          { role: 'delivery_manifest', path: manifestPath },
        ],
      }), 'utf-8')

      const report = settleTargetDeliveryLearning({
        projectDir,
        target: 'EGFR',
        disease: 'lung cancer',
      })

      expect(report.ok).toBe(true)
      expect(report.candidateId).toContain('MLC-medical-egfr-lung-cancer')
      expect(report.promotable).toBe(true)
      expect(report.recommendedAction).toBe('review-for-knowledge-base')
      expect(report.candidatePath).toContain('.scale')
      expect(report.mirrorRecordPath).toContain('memory_learning_candidate.json')
      expect(report.mirrorSummaryPath).toContain('memory_learning_candidate.md')
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
