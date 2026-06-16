# Scale Orchestrator — 声明式编排守护进程

> 对标 Symphony WORKFLOW.md 协调循环模式。声明式策略驱动的自治多仓库工作循环。

## 设计理念

**编排逻辑应该声明式、可版本控制、可 review。** AI Agent 不应该自己决定"什么时候做什么"——这由策略文件定义，daemon 执行。

## 声明式策略 (`SCALE_POLICY.md`)

### 格式

YAML frontmatter (机器可读) + Markdown body (人类可读):

```yaml
---
tracker:
  type: github
  repo: org/repo
  labels: ["agent-task"]
  activeStates: ["open", "in_progress"]
  terminalStates: ["closed", "done"]
  priorityLabels:
    p0: ["critical", "urgent"]
    p1: ["high"]

polling:
  intervalMs: 30000
  jitterMs: 5000
  maxRetries: 3

workspace:
  root: /tmp/scale-workspaces
  maxParallel: 3
  cleanupOnComplete: true
  retentionHours: 24

hooks:
  afterCreate: ["npm install"]
  beforeRun: ["scale shield status"]
  afterRun: ["scale cortex extract"]
  beforeRemove: []

agent:
  maxTurns: 50
  timeoutMinutes: 30
  model: sonnet
  mode: standard

codex:
  enabled: false
  fallback: claude
---
```

### 6-Key Schema

| Key | 说明 |
|-----|------|
| `tracker` | IssueTracker 连接配置 (GitHub/Linear/Jira) |
| `polling` | 轮询间隔、抖动、最大重试 |
| `workspace` | git worktree 隔离配置 |
| `hooks` | 生命周期钩子 (afterCreate/beforeRun/afterRun/beforeRemove) |
| `agent` | Agent 行为约束 (最大轮次、超时、模型) |
| `codex` | Codex 兼容模式配置 |

### 动态重载

文件变更 → 自动重载策略。解析失败 → 保留上一次良好配置。

## 协调循环 (Reconciliation Loop)

```
┌──────────────────────────────────────────────┐
│                                               │
│  ┌─────────┐   ┌──────────┐   ┌───────────┐  │
│  │  Poll   │ → │  Filter  │ → │  Isolate  │  │
│  │ Tracker │   │Candidates│   │ Worktree  │  │
│  └─────────┘   └──────────┘   └───────────┘  │
│       ↑                              ↓        │
│       │                        ┌───────────┐  │
│       │                        │  Dispatch │  │
│       │                        │   Agent   │  │
│       │                        └───────────┘  │
│       │                              ↓        │
│  ┌─────────┐                   ┌───────────┐  │
│  │ Notify  │ ←──────────────── │ Reconcile │  │
│  └─────────┘                   └───────────┘  │
│                                               │
└──────────────────────────────────────────────┘
```

### 候选选择逻辑

1. id 存在且合法
2. state 在 `activeStates` 列表中
3. 非 terminal 状态
4. 未被其他 workspace claim
5. 并发数未达 `max_parallel_workspaces`
6. `blocked_by` 全部 terminal

### 状态机

```
Unclaimed → Claimed → Running → RetryQueued → Released
                ↓                     ↑
              Running ──(失败)──→ RetryQueued
```

## Git Worktree 隔离

### 路径规则

```
<workspace.root>/<sanitized_issue_identifier>
```

- 字符集限制: `[A-Za-z0-9._-]`
- 长度上限: 64 字符

### 3 安全不变量

1. **workspace⊆root**: Agent cwd 必须在 workspace 路径下
2. **Sanitized name**: workspace 名称只允许 `[A-Za-z0-9._-]`
3. **Agent cwd⊆workspace**: 运行时目录限制在 workspace 内

### 生命周期 Hooks

```yaml
afterCreate:   # workspace 创建后执行
  - npm install
beforeRun:     # Agent 启动前执行
  - scale shield status
afterRun:      # Agent 完成后执行
  - scale cortex extract
beforeRemove:  # workspace 删除前执行
  - git push origin HEAD
```

## 启动恢复

Orchestrator 不持久化自身状态。启动时：

1. 清理 terminal workspaces
2. 重新从 tracker 拉取活跃 issues
3. 重新分派未完成的 candidates
4. 退避延迟: `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`

## 多轮 Worker

Agent 在同一解释器会话中保持多轮：
- 最大轮次: `agent.maxTurns` (默认 50)
- 超时: `agent.timeoutMinutes` (默认 30)
- 每轮间检查 tracker 状态 (可能被外部取消)

## CLI 命令

```bash
# 启动 daemon
scale orch start
# 后台运行，写入 PID 文件

# 查看状态
scale orch status
# 输出: PID, 运行时间, 活跃 workspace 列表, 最近分派记录

# 停止 daemon
scale orch stop
# 清理 workspaces, 移除 PID 文件

# 查看日志
scale orch log --lines 50
```

## 安全保证

- **隔离**: 每个 issue 独立 git worktree，互不干扰
- **可审计**: 所有操作记录到 `.scale/orchestrator/` 日志
- **无持久化状态**: daemon crash 后重启恢复，不丢任务
- **签名验证**: workspace name 强制 sanitize，防止路径穿越

## 相关文件

- `src/orchestrator/OrchestratorDaemon.ts` — daemon 主循环
- `src/orchestrator/PolicyLoader.ts` — SCALE_POLICY.md 解析 + 动态重载
- `src/orchestrator/WorkspaceManager.ts` — git worktree 生命周期
- `src/orchestrator/ReconciliationLoop.ts` — 协调循环 + 状态机
- `src/orchestrator/TrackerAdapter.ts` — IssueTracker 适配器接口
- `src/cli/orchCommands.ts` — CLI 入口
- `SCALE_POLICY.md` — 声明式编排策略模板
