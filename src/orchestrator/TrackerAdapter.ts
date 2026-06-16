// SCALE Orchestrator — Issue Tracker Adapter
// 对齐 Symphony: tracker → polling → candidate selection
// Abstract adapter for GitHub Issues, Linear, Jira, etc.

export type IssueState = 'open' | 'in_progress' | 'resolved' | 'closed' | 'cancelled'

export interface TrackerIssue {
  id: string
  title: string
  description: string
  state: IssueState
  labels: string[]
  assignee?: string
  priority: number // 0=highest
  createdAt: string
  updatedAt: string
  blockedBy: string[] // IDs of blocking issues
  metadata?: Record<string, unknown>
}

export interface TrackerConfig {
  type: 'github' | 'linear' | 'jira' | 'mock'
  repo?: string
  owner?: string
  token?: string
  baseUrl?: string
  projectKey?: string
  activeStates: IssueState[]
  terminalStates: IssueState[]
  priorityLabels: Record<string, number>
}

export interface ITrackerAdapter {
  readonly config: TrackerConfig

  /** Fetch all active candidates from the tracker */
  fetchCandidates(): Promise<TrackerIssue[]>

  /** Update issue state (claim, release, resolve) */
  updateState(issueId: string, state: IssueState, metadata?: Record<string, unknown>): Promise<void>

  /** Add a comment to an issue */
  addComment(issueId: string, body: string): Promise<void>

  /** Check if an issue exists */
  exists(issueId: string): Promise<boolean>

  /** Get a single issue by ID */
  getIssue(issueId: string): Promise<TrackerIssue | null>
}

// ---------------------------------------------------------------------------
// GitHub Issues adapter
// ---------------------------------------------------------------------------

export class GitHubTrackerAdapter implements ITrackerAdapter {
  readonly config: TrackerConfig

  constructor(config: TrackerConfig) {
    const defaults: Partial<TrackerConfig> = {
      activeStates: ['open', 'in_progress'],
      terminalStates: ['resolved', 'closed', 'cancelled'],
      priorityLabels: { 'priority:critical': 0, 'priority:high': 1, 'priority:medium': 2, 'priority:low': 3 },
    }
    this.config = { ...defaults, ...config } as TrackerConfig
  }

  async fetchCandidates(): Promise<TrackerIssue[]> {
    const repo = `${this.config.owner}/${this.config.repo}`
    const issues: TrackerIssue[] = []

    try {
      // Use gh CLI for GitHub Issues
      const { execSync } = await import('node:child_process')
      const args = ['issue', 'list', '--repo', repo, '--state', 'open', '--json', 'number,title,body,state,labels,assignees,createdAt,updatedAt', '--limit', '50']
      const stdout = execSync(`gh ${args.join(' ')}`, { encoding: 'utf-8', timeout: 10000 })
      const raw = JSON.parse(stdout) as Array<{
        number: number; title: string; body: string; state: string
        labels: Array<{ name: string }>; assignees: Array<{ login: string }> | null
        createdAt: string; updatedAt: string
      }>

      for (const item of raw) {
        const labels = item.labels?.map(l => l.name) ?? []
        const priority = this.computePriority(labels)

        issues.push({
          id: String(item.number),
          title: item.title,
          description: item.body ?? '',
          state: this.mapState(item.state),
          labels,
          assignee: item.assignees?.[0]?.login,
          priority,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          blockedBy: this.extractBlockedBy(item.body ?? ''),
        })
      }
    } catch {
      // gh CLI not available — return empty
    }

    return issues
  }

  async updateState(issueId: string, state: IssueState, _metadata?: Record<string, unknown>): Promise<void> {
    const repo = `${this.config.owner}/${this.config.repo}`
    try {
      const { execSync } = await import('node:child_process')
      const stateMap: Record<string, string> = { open: 'open', in_progress: 'open', resolved: 'closed', closed: 'closed', cancelled: 'closed' }
      execSync(`gh issue edit ${issueId} --repo ${repo} --state ${stateMap[state] ?? 'open'}`, { timeout: 5000 })
    } catch { /* ignore */ }
  }

  async addComment(issueId: string, body: string): Promise<void> {
    const repo = `${this.config.owner}/${this.config.repo}`
    try {
      const { execSync } = await import('node:child_process')
      execSync(`gh issue comment ${issueId} --repo ${repo} --body "${body.replace(/"/g, '\\"')}"`, { timeout: 5000 })
    } catch { /* ignore */ }
  }

  async exists(issueId: string): Promise<boolean> {
    const repo = `${this.config.owner}/${this.config.repo}`
    try {
      const { execSync } = await import('node:child_process')
      execSync(`gh issue view ${issueId} --repo ${repo} --json number`, { timeout: 5000 })
      return true
    } catch { return false }
  }

  async getIssue(issueId: string): Promise<TrackerIssue | null> {
    const repo = `${this.config.owner}/${this.config.repo}`
    try {
      const { execSync } = await import('node:child_process')
      const stdout = execSync(`gh issue view ${issueId} --repo ${repo} --json number,title,body,state,labels,assignees,createdAt,updatedAt`, { encoding: 'utf-8', timeout: 5000 })
      const item = JSON.parse(stdout)
      const labels = item.labels?.map((l: { name: string }) => l.name) ?? []
      return {
        id: String(item.number),
        title: item.title,
        description: item.body ?? '',
        state: this.mapState(item.state),
        labels,
        assignee: item.assignees?.[0]?.login,
        priority: this.computePriority(labels),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        blockedBy: this.extractBlockedBy(item.body ?? ''),
      }
    } catch { return null }
  }

  private mapState(githubState: string): IssueState {
    switch (githubState) {
      case 'OPEN': return 'open'
      case 'CLOSED': return 'closed'
      default: return 'open'
    }
  }

  private computePriority(labels: string[]): number {
    for (const [label, prio] of Object.entries(this.config.priorityLabels)) {
      if (labels.some(l => l.toLowerCase() === label.toLowerCase())) return prio
    }
    return 2 // default medium
  }

  private extractBlockedBy(body: string): string[] {
    const match = body.match(/blocked[- ]by:\s*#?(\d+(?:,\s*#?\d+)*)/i)
    if (match) return match[1].split(',').map(s => s.replace('#', '').trim())
    return []
  }
}

// ---------------------------------------------------------------------------
// Mock adapter for testing
// ---------------------------------------------------------------------------

export class MockTrackerAdapter implements ITrackerAdapter {
  readonly config: TrackerConfig = {
    type: 'mock',
    activeStates: ['open', 'in_progress'],
    terminalStates: ['resolved', 'closed', 'cancelled'],
    priorityLabels: {},
  }
  private issues: Map<string, TrackerIssue> = new Map()

  constructor(issues: TrackerIssue[] = []) {
    for (const issue of issues) this.issues.set(issue.id, issue)
  }

  async fetchCandidates(): Promise<TrackerIssue[]> {
    return Array.from(this.issues.values()).filter(i =>
      this.config.activeStates.includes(i.state))
  }

  async updateState(issueId: string, state: IssueState): Promise<void> {
    const issue = this.issues.get(issueId)
    if (issue) issue.state = state
  }

  async addComment(_issueId: string, _body: string): Promise<void> { /* noop */ }
  async exists(issueId: string): Promise<boolean> { return this.issues.has(issueId) }
  async getIssue(issueId: string): Promise<TrackerIssue | null> { return this.issues.get(issueId) ?? null }
}
