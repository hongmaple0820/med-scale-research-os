import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readMedicalWorkflowDashboard } from '../../src/dashboard/MedicalWorkflowData.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('readMedicalWorkflowDashboard', () => {
  it('reads live status, stage4 business metrics, and artifact links', () => {
    const projectDir = makeDir('scale-medical-dashboard-project-')
    const runtimeDir = join(projectDir, 'target-research-platform', 'output', 'dashboard_runtime')
    const stage4Dir = join(projectDir, 'target-research-platform', 'output', 'stage4')

    mkdirSync(runtimeDir, { recursive: true })
    mkdirSync(stage4Dir, { recursive: true })

    const stage4Path = join(stage4Dir, 'CDK4_breast cancer_stage4_results.json')
    const reportPath = join(stage4Dir, 'report_CDK4.html')
    writeFileSync(reportPath, '<html><body>report</body></html>', 'utf-8')
    writeFileSync(stage4Path, JSON.stringify({
      stages: {
        milestones: {
          data: {
            overall_success_rate: 0.0067,
            total_duration_months: 168,
            total_cost_estimate: 95.5,
            estimated_completion: '2040-03-27',
            stage_adjustments: {
              data_sources: ['stage2_druggability', 'stage3_approved_drugs'],
              adjustment_details: {
                druggability_score: 0.527,
              },
            },
            milestones: [
              {
                phase: 'target_validation',
                phase_name: 'Target Validation',
                duration_months: 12,
                success_rate: 0.61,
                cumulative_cost: 1.0,
                end_date: '2027-06-04',
              },
            ],
          },
        },
      },
    }), 'utf-8')

    writeFileSync(join(runtimeDir, 'live_status.json'), JSON.stringify({
      run_id: 'run-1',
      status: 'completed',
      target: 'CDK4',
      disease: 'breast cancer',
      cancers: ['BRCA'],
      modality: 'small_molecule',
      risk_level: 'medium',
      progress_percent: 100,
      current_stage: null,
      current_stage_label: null,
      started_at: '2026-06-09T10:00:00',
      finished_at: '2026-06-09T10:10:00',
      updated_at: '2026-06-09T10:10:00',
      output_root: 'target-research-platform/output',
      summary: {},
      artifacts: {
        stage4_json: 'target-research-platform/output/stage4/CDK4_breast cancer_stage4_results.json',
        stage4_markdown: 'target-research-platform/output/stage4/CDK4_breast cancer_business_plan.md',
      },
      logs: [],
      stages: {
        stage1: { label: 'Stage 1', status: 'completed', started_at: null, finished_at: null, metrics: {}, error: null },
        stage2: { label: 'Stage 2', status: 'completed', started_at: null, finished_at: null, metrics: {}, error: null },
        stage3: { label: 'Stage 3', status: 'completed', started_at: null, finished_at: null, metrics: {}, error: null },
        stage4: {
          label: 'Stage 4',
          status: 'completed',
          started_at: null,
          finished_at: null,
          metrics: {
            success_rate: 0.0067,
            total_duration: '168 months',
            total_cost: '$95.5M',
            estimated_completion: '2040-03-27',
          },
          error: null,
        },
      },
    }), 'utf-8')

    const result = readMedicalWorkflowDashboard(projectDir)

    expect(result.available).toBe(true)
    expect(result.liveStatus?.target).toBe('CDK4')
    expect(result.business?.overallSuccessRate).toBe(0.0067)
    expect(result.business?.dataSources).toEqual(['stage2_druggability', 'stage3_approved_drugs'])
    expect(result.business?.milestones[0]).toMatchObject({
      phase: 'target_validation',
      phaseName: 'Target Validation',
      successRate: 0.61,
    })
    expect(result.reports.some(report => report.path.endsWith('CDK4_breast cancer_stage4_results.json'))).toBe(true)
  })

  it('surfaces manuscript artifacts from live status', () => {
    const projectDir = makeDir('scale-medical-manuscript-project-')
    const runtimeDir = join(projectDir, 'target-research-platform', 'output', 'dashboard_runtime')
    const manuscriptDir = join(projectDir, 'target-research-platform', 'output', 'manuscripts')
    const stage1Dir = join(projectDir, 'target-research-platform', 'output', 'stage1')
    const stage2Dir = join(projectDir, 'target-research-platform', 'output', 'stage2')
    const stage3Dir = join(projectDir, 'target-research-platform', 'output', 'stage3')
    const stage4Dir = join(projectDir, 'target-research-platform', 'output', 'stage4')

    mkdirSync(runtimeDir, { recursive: true })
    mkdirSync(manuscriptDir, { recursive: true })
    mkdirSync(stage1Dir, { recursive: true })
    mkdirSync(stage2Dir, { recursive: true })
    mkdirSync(stage3Dir, { recursive: true })
    mkdirSync(stage4Dir, { recursive: true })

    const manuscriptPath = join(manuscriptDir, 'CDK4_breast_cancer_manuscript.md')
    const zhongliuPath = join(manuscriptDir, 'CDK4_breast_cancer_manuscript_zhongliu.md')
    const metaPath = join(manuscriptDir, 'CDK4_breast_cancer_manuscript_meta.json')
    const qualityPath = join(manuscriptDir, 'CDK4_breast_cancer_manuscript_quality.json')
    const factCheckPath = join(manuscriptDir, 'CDK4_breast_cancer_manuscript_fact_check.json')
    const reviewTasksPath = join(manuscriptDir, 'CDK4_breast_cancer_review_tasks.json')
    const manifestPath = join(manuscriptDir, 'CDK4_breast_cancer_delivery_manifest.json')
    const memorySummaryPath = join(manuscriptDir, 'CDK4_breast_cancer_memory_summary.md')
    const memorySeedPath = join(manuscriptDir, 'CDK4_breast_cancer_memory_seed.json')
    const learningSummaryPath = join(manuscriptDir, 'CDK4_breast_cancer_memory_learning_candidate.md')
    const learningRecordPath = join(manuscriptDir, 'CDK4_breast_cancer_memory_learning_candidate.json')
    const packagePath = join(projectDir, 'target-research-platform', 'output', 'deliveries', 'CDK4_breast_cancer_delivery.zip')
    mkdirSync(join(projectDir, 'target-research-platform', 'output', 'deliveries'), { recursive: true })
    writeFileSync(manuscriptPath, '# manuscript', 'utf-8')
    writeFileSync(zhongliuPath, '# zhongliu', 'utf-8')
    writeFileSync(metaPath, '{"success":true}', 'utf-8')
    writeFileSync(qualityPath, '{"passed":true}', 'utf-8')
    writeFileSync(factCheckPath, '{"passed":true,"score":97,"errors":0,"warnings":1,"claims_checked":12,"unverified_claims":[]}', 'utf-8')
    writeFileSync(reviewTasksPath, '{"papers":[{"index":1,"pmid":"12345678"}]}', 'utf-8')
    writeFileSync(memorySummaryPath, '# memory summary', 'utf-8')
    writeFileSync(learningSummaryPath, '# learning candidate', 'utf-8')
    writeFileSync(memorySeedPath, JSON.stringify({
      generated_at: '2026-06-14T12:00:00Z',
      provider: 'gbrain',
      summary_path: memorySummaryPath,
      source_files: [memorySummaryPath, manuscriptPath, manifestPath],
      staged_files: [memorySummaryPath, manuscriptPath, manifestPath],
      missing_roles: [],
      warnings: [],
      import_ok: true,
    }), 'utf-8')
    writeFileSync(learningRecordPath, JSON.stringify({
      generated_at: '2026-06-14T12:05:00Z',
      candidate_id: 'MLC-medical-cdk4-breast-cancer',
      candidate_path: join(projectDir, '.scale', 'memory', 'learning-candidates', 'MLC-medical-cdk4-breast-cancer.json'),
      candidate_markdown_path: join(projectDir, '.scale', 'memory', 'learning-candidates', 'MLC-medical-cdk4-breast-cancer.md'),
      summary_path: learningSummaryPath,
      recommended_action: 'review-for-knowledge-base',
      promotable: true,
      brain_ingest_ok: true,
      brain_node_id: 'MEM-MLC-medical-cdk4-breast-cancer',
      warnings: [],
    }), 'utf-8')
    writeFileSync(manifestPath, JSON.stringify({
      files: [],
      quality_findings: [
        {
          id: 'literature.enrichment_coverage',
          severity: 'warning',
          message: 'Literature metadata should include PubMed MeSH or citation enrichment.',
        },
      ],
      human_review_todo: [
        'Re-run PubMed/OpenAlex enrichment before external review.',
      ],
      literature: {
        count: 12,
        agent_cache_count: 12,
        llm_count: 0,
        rule_based_count: 0,
        enrichment: {
          sources: [],
          mesh_count: 0,
          citation_count_available: 0,
          cache_used: false,
          cache_hit_count: 0,
        },
      },
      disclaimer: 'Not submission-ready.',
    }), 'utf-8')
    writeFileSync(packagePath, 'zip-bytes', 'utf-8')
    writeFileSync(join(stage1Dir, 'CDK4_stage1_results.json'), JSON.stringify({ ok: true }), 'utf-8')
    writeFileSync(join(stage2Dir, 'breast cancer_stage2_results.json'), JSON.stringify({ ok: true }), 'utf-8')
    writeFileSync(join(stage3Dir, 'CDK4_breast cancer_stage3_results.json'), JSON.stringify({ ok: true }), 'utf-8')
    writeFileSync(join(stage4Dir, 'CDK4_breast cancer_stage4_results.json'), JSON.stringify({
      stages: {
        milestones: {
          data: {
            overall_success_rate: 0.01,
            total_duration_months: 144,
            total_cost_estimate: 88.4,
            estimated_completion: '2038-09-01',
            stage_adjustments: {
              data_sources: ['stage2_druggability'],
              adjustment_details: {},
            },
            milestones: [],
          },
        },
      },
    }), 'utf-8')

    writeFileSync(join(runtimeDir, 'live_status.json'), JSON.stringify({
      run_id: 'manuscript-1',
      status: 'completed',
      target: 'CDK4',
      disease: 'breast cancer',
      cancers: ['BRCA'],
      modality: 'small_molecule',
      risk_level: 'medium',
      progress_percent: 100,
      current_stage: null,
      current_stage_label: null,
      started_at: '2026-06-11T10:00:00',
      finished_at: '2026-06-11T10:01:00',
      updated_at: '2026-06-11T10:01:00',
      output_root: 'target-research-platform/output',
      summary: {
        quality_gate: {
          passed: true,
          score: 98,
          grade: 'A',
          errors: 0,
          warnings: 1,
        },
        fact_check: {
          passed: true,
          score: 97,
          errors: 0,
          warnings: 1,
          claims_checked: 12,
          unverified_claims: [],
        },
        delivery_package: 'target-research-platform/output/deliveries/CDK4_breast_cancer_delivery.zip',
        package_audit: {
          passed: true,
          entry_count: 12,
          files_checked: 10,
          markdown_refs_checked: 0,
          image_refs_checked: 4,
          readme_present: true,
          manifest_present: true,
          errors: 0,
          warnings: 0,
          broken_image_refs: [],
          broken_markdown_refs: [],
        },
      },
      artifacts: {
        manuscript_markdown: 'target-research-platform/output/manuscripts/CDK4_breast_cancer_manuscript.md',
        manuscript_zhongliu: 'target-research-platform/output/manuscripts/CDK4_breast_cancer_manuscript_zhongliu.md',
        manuscript_meta: 'target-research-platform/output/manuscripts/CDK4_breast_cancer_manuscript_meta.json',
        manuscript_quality: 'target-research-platform/output/manuscripts/CDK4_breast_cancer_manuscript_quality.json',
        manuscript_fact_check: 'target-research-platform/output/manuscripts/CDK4_breast_cancer_manuscript_fact_check.json',
        manuscript_review_tasks: 'target-research-platform/output/manuscripts/CDK4_breast_cancer_review_tasks.json',
        delivery_manifest: 'target-research-platform/output/manuscripts/CDK4_breast_cancer_delivery_manifest.json',
        delivery_package: 'target-research-platform/output/deliveries/CDK4_breast_cancer_delivery.zip',
      },
      logs: [],
      stages: {},
    }), 'utf-8')

    const result = readMedicalWorkflowDashboard(projectDir)

    expect(result.available).toBe(true)
    expect(result.liveStatus?.current_stage_label).toBe('\u4ea4\u4ed8\u5305\u5df2\u5c31\u7eea')
    expect(result.liveStatus?.stages).toMatchObject({
      stage1: { status: 'completed' },
      stage2: { status: 'completed' },
      stage3: { status: 'completed' },
      stage4: { status: 'completed' },
    })
    expect(result.reports.some(report => report.path === manuscriptPath)).toBe(true)
    expect(result.reports.some(report => report.path === zhongliuPath)).toBe(true)
    expect(result.reports.some(report => report.path === metaPath)).toBe(true)
    expect(result.reports.some(report => report.path === qualityPath)).toBe(true)
    expect(result.reports.some(report => report.path === reviewTasksPath)).toBe(true)
    expect(result.reports.some(report => report.path === memorySummaryPath)).toBe(true)
    expect(result.reports.some(report => report.path === memorySeedPath)).toBe(true)
    expect(result.reports.some(report => report.path === learningSummaryPath)).toBe(true)
    expect(result.reports.some(report => report.path === learningRecordPath)).toBe(true)
    expect(result.manuscriptQuality).toMatchObject({
      passed: true,
      score: 98,
      grade: 'A',
      errors: 0,
      warnings: 1,
      reportPath: qualityPath,
    })
    expect(result.manuscriptFactCheck).toMatchObject({
      passed: true,
      score: 97,
      errors: 0,
      warnings: 1,
      claimsChecked: 12,
      unverifiedClaims: 0,
      reportPath: factCheckPath,
    })
    expect(result.deliveryPackage).toMatchObject({
      packagePath,
      manifestPath,
      exists: true,
      size: 9,
      packageAudit: {
        passed: true,
        errors: 0,
        warnings: 0,
        entryCount: 12,
        filesChecked: 10,
        markdownRefsChecked: 0,
        imageRefsChecked: 4,
        readmePresent: true,
        manifestPresent: true,
        brokenImageRefs: 0,
        brokenMarkdownRefs: 0,
      },
      qualityFindings: [
        {
          id: 'literature.enrichment_coverage',
          severity: 'warning',
          message: 'Literature metadata should include PubMed MeSH or citation enrichment.',
        },
      ],
      humanReviewTodo: ['Re-run PubMed/OpenAlex enrichment before external review.'],
      literatureEvidence: {
        count: 12,
        agentCacheCount: 12,
        llmCount: 0,
        ruleBasedCount: 0,
        sources: [],
        meshCount: 0,
        citationCountAvailable: 0,
        cacheUsed: false,
        cacheHitCount: 0,
      },
      disclaimer: 'Not submission-ready.',
    })
    expect(result.memorySeed).toMatchObject({
      provider: 'gbrain',
      generatedAt: '2026-06-14T12:00:00Z',
      recordPath: memorySeedPath,
      summaryPath: memorySummaryPath,
      recordReady: true,
      summaryReady: true,
      importOk: true,
      sourceFileCount: 3,
      stagedFileCount: 3,
      missingRoles: [],
      warnings: [],
    })
    expect(result.learningCandidate).toMatchObject({
      candidateId: 'MLC-medical-cdk4-breast-cancer',
      generatedAt: '2026-06-14T12:05:00Z',
      recordPath: learningRecordPath,
      summaryPath: learningSummaryPath,
      recommendedAction: 'review-for-knowledge-base',
      promotable: true,
      brainIngestOk: true,
      brainNodeId: 'MEM-MLC-medical-cdk4-breast-cancer',
      recordReady: true,
      summaryReady: true,
      warnings: [],
    })
    expect(result.reports.find(report => report.path === packagePath)).toMatchObject({
      kind: 'zip',
    })
  })

  it('derives stage4 business snapshot from output files after package runs', () => {
    const projectDir = makeDir('scale-medical-package-business-')
    const runtimeDir = join(projectDir, 'target-research-platform', 'output', 'dashboard_runtime')
    const manuscriptDir = join(projectDir, 'target-research-platform', 'output', 'manuscripts')
    const stage4Dir = join(projectDir, 'target-research-platform', 'output', 'stage4')

    mkdirSync(runtimeDir, { recursive: true })
    mkdirSync(manuscriptDir, { recursive: true })
    mkdirSync(stage4Dir, { recursive: true })

    const manifestPath = join(manuscriptDir, 'EGFR_lung_cancer_delivery_manifest.json')
    writeFileSync(manifestPath, JSON.stringify({ files: [], literature: {} }), 'utf-8')
    writeFileSync(join(stage4Dir, 'EGFR_lung cancer_stage4_results.json'), JSON.stringify({
      stages: {
        milestones: {
          data: {
            overall_success_rate: 0.012,
            total_duration_months: 144,
            total_cost_estimate: 88.4,
            estimated_completion: '2038-09-01',
            stage_adjustments: {
              data_sources: ['stage2_druggability', 'stage3_trials'],
              adjustment_details: {
                druggability_score: 0.71,
              },
            },
            milestones: [
              {
                phase: 'lead_optimization',
                phase_name: 'Lead Optimization',
                duration_months: 18,
                success_rate: 0.52,
                cumulative_cost: 9.5,
                end_date: '2028-03-01',
              },
            ],
          },
        },
      },
    }), 'utf-8')

    writeFileSync(join(runtimeDir, 'live_status.json'), JSON.stringify({
      run_id: 'package-business-1',
      status: 'completed',
      target: 'EGFR',
      disease: 'lung cancer',
      cancers: ['LUAD'],
      modality: 'manuscript',
      risk_level: 'draft',
      progress_percent: 100,
      current_stage: null,
      current_stage_label: null,
      started_at: '2026-06-14T09:00:00',
      finished_at: '2026-06-14T09:05:00',
      updated_at: '2026-06-14T09:05:00',
      output_root: 'target-research-platform/output',
      summary: {
        delivery_package: 'target-research-platform/output/deliveries/EGFR_lung_cancer_delivery.zip',
      },
      artifacts: {
        delivery_manifest: 'target-research-platform/output/manuscripts/EGFR_lung_cancer_delivery_manifest.json',
      },
      logs: [],
      stages: {},
    }), 'utf-8')

    const result = readMedicalWorkflowDashboard(projectDir)

    expect(result.business).toMatchObject({
      overallSuccessRate: 0.012,
      totalDurationMonths: 144,
      totalCostEstimate: 88.4,
      estimatedCompletion: '2038-09-01',
      dataSources: ['stage2_druggability', 'stage3_trials'],
    })
    expect(result.business?.milestones[0]).toMatchObject({
      phase: 'lead_optimization',
      phaseName: 'Lead Optimization',
      successRate: 0.52,
    })
  })

  it('marks all analysis stages completed from derived output files when runtime stages are empty', () => {
    const projectDir = makeDir('scale-medical-derived-stages-')
    const runtimeDir = join(projectDir, 'target-research-platform', 'output', 'dashboard_runtime')
    const stage1Dir = join(projectDir, 'target-research-platform', 'output', 'stage1')
    const stage2Dir = join(projectDir, 'target-research-platform', 'output', 'stage2')
    const stage3Dir = join(projectDir, 'target-research-platform', 'output', 'stage3')
    const stage4Dir = join(projectDir, 'target-research-platform', 'output', 'stage4')
    mkdirSync(runtimeDir, { recursive: true })
    mkdirSync(stage1Dir, { recursive: true })
    mkdirSync(stage2Dir, { recursive: true })
    mkdirSync(stage3Dir, { recursive: true })
    mkdirSync(stage4Dir, { recursive: true })
    writeFileSync(join(stage1Dir, 'EGFR_stage1_results.json'), JSON.stringify({ ok: true }), 'utf-8')
    writeFileSync(join(stage2Dir, 'lung cancer_stage2_results.json'), JSON.stringify({ ok: true }), 'utf-8')
    writeFileSync(join(stage3Dir, 'EGFR_lung cancer_stage3_results.json'), JSON.stringify({ ok: true }), 'utf-8')
    writeFileSync(join(stage4Dir, 'EGFR_lung cancer_stage4_results.json'), JSON.stringify({
      stages: {
        milestones: {
          data: {
            overall_success_rate: 0.012,
            total_duration_months: 144,
            total_cost_estimate: 88.4,
            estimated_completion: '2038-09-01',
            stage_adjustments: {
              data_sources: ['stage2_druggability', 'stage3_trials'],
              adjustment_details: {},
            },
            milestones: [],
          },
        },
      },
    }), 'utf-8')
    writeFileSync(join(runtimeDir, 'live_status.json'), JSON.stringify({
      run_id: 'derived-stages-1',
      status: 'completed',
      target: 'EGFR',
      disease: 'lung cancer',
      cancers: ['LUAD'],
      modality: 'manuscript',
      risk_level: 'draft',
      progress_percent: 100,
      current_stage: null,
      current_stage_label: null,
      started_at: '2026-06-14T09:00:00',
      finished_at: '2026-06-14T09:05:00',
      updated_at: '2026-06-14T09:05:00',
      output_root: 'target-research-platform/output',
      summary: {},
      artifacts: {},
      logs: [],
      stages: {},
    }), 'utf-8')
    const result = readMedicalWorkflowDashboard(projectDir)
    expect(result.liveStatus?.current_stage_label).toBe('\u7814\u7a76\u6d41\u7a0b\u5df2\u5b8c\u6210')
    expect(result.liveStatus?.stages).toMatchObject({
      stage1: { status: 'completed' },
      stage2: { status: 'completed' },
      stage3: { status: 'completed' },
      stage4: { status: 'completed' },
    })
  })
  it('prefers manuscript quality and fact-check files over stale live-status summary values', () => {
    const projectDir = makeDir('scale-medical-dashboard-stale-summary-')
    const runtimeDir = join(projectDir, 'target-research-platform', 'output', 'dashboard_runtime')
    const manuscriptDir = join(projectDir, 'target-research-platform', 'output', 'manuscripts')

    mkdirSync(runtimeDir, { recursive: true })
    mkdirSync(manuscriptDir, { recursive: true })

    const qualityPath = join(manuscriptDir, 'EGFR_lung_cancer_manuscript_quality.json')
    const factCheckPath = join(manuscriptDir, 'EGFR_lung_cancer_manuscript_fact_check.json')

    writeFileSync(qualityPath, JSON.stringify({
      passed: true,
      score: 100,
      grade: 'A',
      errors: 0,
      warnings: 0,
    }), 'utf-8')
    writeFileSync(factCheckPath, JSON.stringify({
      passed: true,
      score: 100,
      errors: 0,
      warnings: 0,
      claims_checked: 22,
      unverified_claims: [],
    }), 'utf-8')

    writeFileSync(join(runtimeDir, 'live_status.json'), JSON.stringify({
      run_id: 'manuscript-2',
      status: 'completed',
      target: 'EGFR',
      disease: 'lung cancer',
      cancers: ['LUAD'],
      modality: 'small_molecule',
      risk_level: 'medium',
      progress_percent: 100,
      current_stage: null,
      current_stage_label: null,
      started_at: '2026-06-13T20:00:00',
      finished_at: '2026-06-13T20:01:00',
      updated_at: '2026-06-13T20:01:00',
      output_root: 'target-research-platform/output',
      summary: {
        quality_gate: {
          passed: true,
          score: 95,
          grade: 'B',
          errors: 0,
          warnings: 1,
        },
        fact_check: {
          passed: true,
          score: 97,
          errors: 0,
          warnings: 1,
          claims_checked: 12,
          unverified_claims: [],
        },
      },
      artifacts: {
        manuscript_quality: 'target-research-platform/output/manuscripts/EGFR_lung_cancer_manuscript_quality.json',
        manuscript_fact_check: 'target-research-platform/output/manuscripts/EGFR_lung_cancer_manuscript_fact_check.json',
      },
      logs: [],
      stages: {},
    }), 'utf-8')

    const result = readMedicalWorkflowDashboard(projectDir)

    expect(result.manuscriptQuality).toMatchObject({
      passed: true,
      score: 100,
      grade: 'A',
      errors: 0,
      warnings: 0,
      reportPath: qualityPath,
    })
    expect(result.manuscriptFactCheck).toMatchObject({
      passed: true,
      score: 100,
      errors: 0,
      warnings: 0,
      claimsChecked: 22,
      unverifiedClaims: 0,
      reportPath: factCheckPath,
    })
  })
})
