import { logger } from '../../core/logger.js'
import type { IEventBus } from '../../core/eventBus.js'
import { execSync } from 'node:child_process'

export interface AutoFixOptions {
  scope: 'lint' | 'test' | 'security' | 'all'
  maxAttempts: number
  escalateModel: boolean   // try fast→balanced→powerful on retry
  dryRun: boolean
}

export interface FixAttempt {
  attempt: number
  category: string
  diagnosticCommand: string
  fixAction: string
  fixOutput: string
  success: boolean
  verifierCommand: string
  verifierOutput: string
  durationMs: number
}

export interface AutoFixReport {
  totalFailures: number
  fixed: number
  unfixed: number
  attempts: FixAttempt[]
  summary: string
  recommendation: string
}

export class AutoFixEngine {
  private attempts: FixAttempt[] = []

  constructor(private eventBus: IEventBus) {}

  async run(options: AutoFixOptions): Promise<AutoFixReport> {
    const report: AutoFixReport = {
      totalFailures: 0,
      fixed: 0,
      unfixed: 0,
      attempts: [],
      summary: '',
      recommendation: '',
    }

    logger.info({ scope: options.scope }, 'AutoFix engine starting')

    // Step 1: Scan for failures
    const failures = await this.scan(options.scope)
    report.totalFailures = failures.length

    if (failures.length === 0) {
      report.summary = 'No failures detected. All gates passing.'
      report.recommendation = 'No action needed.'
      return report
    }

    // Step 2: For each failure, diagnose → fix → re-verify
    for (let i = 0; i < failures.length; i++) {
      const failure = failures[i]
      logger.info({ failure, index: i }, `Processing failure ${i + 1}/${failures.length}`)

      let fixed = false
      for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        const start = Date.now()

        // Diagnose
        const diagnosis = await this.diagnose(failure, attempt)

        // Fix
        const fixOutput = options.dryRun
          ? `[DRY RUN] Would fix: ${failure.category}`
          : await this.applyFix(failure, attempt)

        // Re-verify
        const verifierOutput = options.dryRun
          ? { passed: false, output: `[DRY RUN] Would re-verify: ${failure.category}` }
          : await this.reVerify(failure)

        const success = !options.dryRun && verifierOutput.passed
        const fa: FixAttempt = {
          attempt,
          category: failure.category,
          diagnosticCommand: diagnosis,
          fixAction: failure.fixStrategy ?? 'auto-detect',
          fixOutput,
          success,
          verifierCommand: failure.verifyCommand ?? '',
          verifierOutput: verifierOutput.output ?? '',
          durationMs: Date.now() - start,
        }

        this.attempts.push(fa)
        this.eventBus.emit('autofix.attempt', fa)

        if (success) {
          fixed = true
          report.fixed++
          break
        }

        // Escalate model tier on retry
        if (options.escalateModel) {
          const escalatedCommand = await this.escalateCommand(failure, attempt)
          logger.info({ attempt, escalatedCommand }, 'Model escalated for retry')
        }
      }

      if (!fixed) {
        report.unfixed++
        logger.warn({ failure }, `Failed to fix after ${options.maxAttempts} attempts`)
      }
    }

    report.summary = `AutoFix complete: ${report.fixed}/${report.totalFailures} fixed, ${report.unfixed} unresolved.`
    report.recommendation = report.unfixed > 0
      ? `Manual intervention needed for ${report.unfixed} failure(s). Review evidence at .scale/evidence/autofix/`
      : 'All failures resolved. Proceed with gate verification.'
    report.attempts = this.attempts

    this.eventBus.emit('autofix.complete', report)
    return report
  }

  private async scan(scope: string): Promise<Array<{ category: string; command: string; description: string; fixStrategy: string; verifyCommand: string }>> {
    const failures: Array<{ category: string; command: string; description: string; fixStrategy: string; verifyCommand: string }> = []

    try {
      if (scope === 'all' || scope === 'lint') {
        try { execSync('npm run lint', { encoding: 'utf-8', stdio: 'pipe' }) }
        catch (e) {
          failures.push({
            category: 'lint',
            command: 'npm run lint',
            description: (e as any).stderr?.slice(0, 500) ?? 'Lint failure detected',
            fixStrategy: 'eslint --fix',
            verifyCommand: 'npm run lint',
          })
        }
      }

      if (scope === 'all' || scope === 'test') {
        try { execSync('npm test', { encoding: 'utf-8', stdio: 'pipe' }) }
        catch (e) {
          failures.push({
            category: 'test',
            command: 'npm test',
            description: (e as any).stderr?.slice(0, 500) ?? 'Test failure detected',
            fixStrategy: 'run-and-inspect',
            verifyCommand: 'npm test',
          })
        }
      }

      if (scope === 'all' || scope === 'security') {
        // Use existing security gate patterns from src/workflow/gates/GateSystem.ts
        failures.push({
          category: 'security',
          command: 'scale preflight --profile security --json',
          description: 'Security gate scan requested',
          fixStrategy: 'manual-review',
          verifyCommand: 'scale preflight --profile security --json',
        })
      }
    } catch (err) {
      logger.error({ err }, 'Error during scan')
    }

    return failures
  }

  private async diagnose(failure: { category: string; description: string }, attempt: number): Promise<string> {
    // Generate a diagnostic command based on failure type and attempt
    const commands: Record<string, string> = {
      lint: `Analyze lint errors (attempt ${attempt}): ${failure.description.slice(0, 200)}`,
      test: `Analyze test failures (attempt ${attempt}): ${failure.description.slice(0, 200)}`,
      security: `Analyze security findings (attempt ${attempt}): ${failure.description.slice(0, 200)}`,
    }
    return commands[failure.category] ?? `Diagnose: ${failure.description.slice(0, 200)}`
  }

  private async applyFix(failure: { category: string; fixStrategy: string }, attempt: number): Promise<string> {
    switch (failure.fixStrategy) {
      case 'eslint --fix':
        try {
          return execSync('npx eslint --fix .', { encoding: 'utf-8', stdio: 'pipe' })
        } catch (e) {
          return (e as any).stdout ?? (e as any).stderr ?? 'eslint --fix ran with warnings'
        }
      case 'run-and-inspect':
        return `Test fix attempt ${attempt}: re-run and inspect failures`
      case 'manual-review':
        return `Security fix attempt ${attempt}: review and apply mitigations`
      default:
        return `Auto-fix attempt ${attempt} using strategy: ${failure.fixStrategy}`
    }
  }

  private async reVerify(failure: { category: string; verifyCommand: string }): Promise<{ passed: boolean; output: string }> {
    try {
      const output = execSync(failure.verifyCommand, { encoding: 'utf-8', stdio: 'pipe' })
      return { passed: true, output }
    } catch (e) {
      return { passed: false, output: (e as any).stderr ?? (e as any).stdout ?? 'Re-verification failed' }
    }
  }

  private async escalateCommand(failure: { category: string }, attempt: number): Promise<string> {
    const tiers = ['fast', 'balanced', 'powerful']
    const tier = tiers[Math.min(attempt, tiers.length - 1)]
    return `${failure.category} fix attempt ${attempt} → escalated to ${tier} model tier`
  }
}
