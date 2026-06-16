---
tracker:
  type: github
  # owner: your-org
  # repo: your-repo
  activeStates:
    - open
    - in_progress
  terminalStates:
    - resolved
    - closed
    - cancelled

polling:
  intervalMs: 30000           # Poll tracker every 30 seconds
  maxParallelWorkspaces: 3    # Max concurrent agent worktrees
  maxRetryBackoffMs: 300000   # Max backoff = 5 minutes
  maxAttempts: 3              # Max retries per issue
  priorityLabels:
    priority:critical: 0
    priority:high: 1
    priority:medium: 2
    priority:low: 3

workspace:
  root: .scale/worktrees      # Git worktree root directory
  allowedChars: "[A-Za-z0-9._-]"  # Sanitized issue name character set
  maxWorkspaceAgeHours: 24    # Auto-cleanup after 24 hours

hooks:
  # Optional shell commands for workspace lifecycle
  # afterCreate: "echo 'Workspace created'"
  # beforeRun: "npm install"
  # afterRun: "npm test"
  # beforeRemove: "echo 'Cleaning up'"

agent:
  model: claude-sonnet-4-6
  maxTurns: 50                # Max agent turns per issue
  timeoutMinutes: 30          # Max time per issue

codex:
  enabled: true
  # promptTemplate: "Solve issue: {{issue.title}}\\n\\n{{issue.description}}"
---

# SCALE Orchestrator Policy

This file defines how the SCALE Orchestrator daemon autonomously processes issues
from your project tracker. It follows the Symphony-style declarative pattern:

1. **Poll** the issue tracker for active candidates
2. **Isolate** each issue in a git worktree
3. **Dispatch** an agent to solve the issue
4. **Reconcile** results back to the tracker
5. **Notify** the team of progress

## How It Works

When you run `scale orch start`, the daemon:
- Reads this policy file
- Connects to your issue tracker (GitHub Issues by default)
- Starts polling for open issues
- For each eligible issue, creates an isolated git worktree
- Dispatches an AI agent to work on the issue
- Updates the issue tracker with progress

## Configuration

Edit the YAML frontmatter above to customize:
- `tracker.type`: "github" | "linear" | "jira"
- `polling.intervalMs`: How often to check for new issues
- `polling.maxParallelWorkspaces`: Maximum concurrent agent worktrees
- `workspace.root`: Where git worktrees are created
- `agent.model`: Which model to use for issue solving
- `agent.maxTurns`: Maximum conversation turns per issue

## Safety Guarantees

- Agent cwd is always inside the workspace path
- Workspace names are sanitized to `[A-Za-z0-9._-]`
- Workspaces are cleaned up after `maxWorkspaceAgeHours`
- No persistent orchestrator state — clean restart on recovery
