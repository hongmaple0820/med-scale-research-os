import type { RuntimeSessionLevel } from './SessionLedger.js'
import { doctorRuntimeEvidence, type RuntimeDoctorReport } from './RuntimeDoctor.js'

export interface FinalReportReadinessOptions {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  sessionId?: string
  level?: RuntimeSessionLevel
}

export interface FinalReportReadiness {
  ready: boolean
  blocked: boolean
  reasons: string[]
  report: RuntimeDoctorReport
}

export function evaluateFinalReportReadiness(options: FinalReportReadinessOptions = {}): FinalReportReadiness {
  const report = doctorRuntimeEvidence(options)
  const reasons = report.checks
    .filter(check => check.status === 'fail' || check.name === 'Runtime completion evidence' && check.status === 'warn')
    .map(check => check.message)

  return {
    ready: reasons.length === 0,
    blocked: report.blocked || reasons.length > 0,
    reasons,
    report,
  }
}
