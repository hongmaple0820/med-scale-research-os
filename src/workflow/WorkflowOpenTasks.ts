export type WorkflowOpenTaskKind = 'context-grill' | 'diagnostic-loop' | 'tdd-slice' | 'tool-evidence' | 'verification'
export type WorkflowOpenTaskAction = { kind: 'command' | 'blocker'; value: string }

const TASK_PREFIXES: Record<WorkflowOpenTaskKind, string> = {
  'context-grill': 'scale context grill',
  'diagnostic-loop': 'scale diagnose plan',
  'tdd-slice': 'scale tdd slice',
  'tool-evidence': 'scale tool run',
  verification: 'scale verify',
}

export function removeWorkflowOpenTask(openTasks: string[] | undefined, kind: WorkflowOpenTaskKind): string[] {
  const prefix = TASK_PREFIXES[kind]
  return (openTasks ?? []).filter(task => !task.trim().startsWith(prefix))
}

export function firstExecutableOpenTask(openTasks: string[] | undefined): string | undefined {
  return (openTasks ?? []).find(task => task.trim().startsWith('scale '))
}

export function nextWorkflowOpenTask(openTasks: string[] | undefined): WorkflowOpenTaskAction | undefined {
  const value = (openTasks ?? []).find(task => task.trim().length > 0)
  if (!value) return undefined
  return {
    kind: value.trim().startsWith('scale ') ? 'command' : 'blocker',
    value,
  }
}

export function blockingWorkflowOpenTasks(openTasks: string[] | undefined, taskId: string): string[] {
  const currentVerifyCommand = `scale verify ${taskId}`
  return (openTasks ?? []).filter(task => {
    const value = task.trim()
    return value.length > 0 && value !== currentVerifyCommand
  })
}

export function toolEvidenceRunCompletesOpenTask(report: {
  ok: boolean
  dryRun: boolean
  evidence: Array<{ status: string }>
}): boolean {
  return report.ok &&
    !report.dryRun &&
    report.evidence.length > 0 &&
    report.evidence.every(record => record.status === 'passed')
}
