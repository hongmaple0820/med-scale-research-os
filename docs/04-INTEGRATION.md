# 04 — 集成方案（如何接入各种 Agent）

> 本篇回答：SCALE Engine 如何让 Claude Code / Codex CLI / Cursor / Gemini CLI / OpenCode 等不同 Agent 都能用上。

---

## 一、总策略：Headless Engine + 三协议接入

```
┌─────────────────────────────────────────────────────────┐
│              SCALE Engine (独立运行)                     │
│                                                         │
│  暴露三种 API:                                          │
│    1. CLI       (任何能 fork 子进程的 Agent 都能用)     │
│    2. MCP       (支持 MCP 协议的 Agent: CC/Cursor)      │
│    3. HTTP      (跨机器/Web/CI 用)                       │
└─────────────────────────────────────────────────────────┘
```

**优先级：CLI > MCP > HTTP**。先用 CLI 覆盖所有 Agent，再加 MCP 提升体验，HTTP 留给团队/CI。

---

## 二、CLI 接入（核心通用方案）

### 2.1 命令清单

```bash
# 项目初始化
scale init [--agents claude,codex,cursor,gemini]
scale init --add-agent codex

# Artifact 操作
scale create <type> <title> [--from <parent_id>]
scale list [--type T] [--status S] [--tag T]
scale show <artifact_id>
scale update <artifact_id> [--field value]
scale transition <artifact_id> --to <action>

# Role 操作
scale role list
scale role activate <role_name>
scale role current

# Gate 操作（被 Hooks 调用，不直接给人用）
scale gate pre-tool <tool> [--args-json ...]
scale gate post-tool <tool> --exit-code N --output ...
scale gate before-stop

# Event 操作
scale event record <type> --payload-json ...
scale event tail [--type T] [--session S]
scale event replay [--from-ts T] [--to-ts T]

# Knowledge 操作
scale lesson list [--verified] [--type T]
scale lesson show <id>
scale lesson approve <id>
scale lesson recall "查询文本"

# Task 操作
scale task list [--status running]
scale task pause <id>
scale task resume <id>
scale task checkpoint <id>

# 自检 / 调试
scale doctor
scale stats
scale rebuild-index
scale export --format json|yaml
```

### 2.2 CLI 输出契约

所有命令支持 `--json` 输出，便于被 Hook 脚本调用：

```bash
$ scale gate pre-tool Edit --args-json '{"file_path":"src/auth.ts"}' --json
{
  "decision": "allow",
  "reason": null,
  "suggestion": null,
  "injectContext": []
}

$ scale gate before-stop --json
{
  "decision": "block",
  "reason": "本会话修改了代码但未运行任何测试。请先 pnpm test 确认通过。",
  "suggestion": "pnpm test"
}
```

退出码：
- `0` = decision=allow
- `1` = decision=block (软警告，AI 看到但不阻断)
- `2` = decision=deny (硬阻断)

### 2.3 接入 Claude Code

`.claude/settings.json` 自动生成：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "command": "scale session start --agent claude-code --session-id $CLAUDE_SESSION_ID --output-context"
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "scale gate pre-tool Bash --args-json $TOOL_INPUT_JSON --session-id $CLAUDE_SESSION_ID"
      },
      {
        "matcher": "Edit|Write|MultiEdit",
        "command": "scale gate pre-tool Edit --args-json $TOOL_INPUT_JSON --session-id $CLAUDE_SESSION_ID"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "command": "scale gate post-tool Edit --args-json $TOOL_INPUT_JSON --output-json $TOOL_OUTPUT_JSON --session-id $CLAUDE_SESSION_ID"
      },
      {
        "matcher": "Bash",
        "command": "scale gate post-tool Bash --args-json $TOOL_INPUT_JSON --exit-code $TOOL_EXIT_CODE --output-text \"$TOOL_OUTPUT\" --session-id $CLAUDE_SESSION_ID"
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "command": "scale gate before-stop --session-id $CLAUDE_SESSION_ID"
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "command": "scale session end --session-id $CLAUDE_SESSION_ID"
      }
    ]
  }
}
```

`CLAUDE.md` 自动生成（≤ 200 行）：

```markdown
# Project: [项目名]

## SCALE Engine 规则

本项目由 SCALE Engine 治理。你（AI）的所有行为都被监控和约束：

1. **Role 必须激活**：每次任务开始，你必须先调用 `scale role activate <role>`，否则工具会被拒绝。
2. **Artifact 必须有上游**：创建 Plan 前必须有 FROZEN 的 Spec。
3. **声称完成前必须验证**：修改代码后必须跑 test/lint，否则 Stop 被阻断。
4. **不准甩锅**：说"环境问题"前必须有 ≥2 个验证证据。

## 当前可用 Roles
- Explorer: 只读，用于初步探索
- SpecWriter: 写需求
- Planner: 写技术方案
- Implementer: 实施代码
- Verifier: 写测试和验证
- Releaser: 发布

## 项目特定规则（团队补充）
... 项目自己加 ...
```

### 2.4 接入 Codex CLI

`.codex/hooks.json`:

```json
{
  "session_start": [
    { "command": "scale session start --agent codex --session-id $CODEX_SESSION_ID" }
  ],
  "pre_tool_use": [
    { "command": "scale gate pre-tool $CODEX_TOOL_NAME --args-json $CODEX_TOOL_INPUT --session-id $CODEX_SESSION_ID" }
  ],
  "post_tool_use": [
    { "command": "scale gate post-tool $CODEX_TOOL_NAME --output-json $CODEX_TOOL_OUTPUT --exit-code $CODEX_TOOL_EXIT --session-id $CODEX_SESSION_ID" }
  ],
  "session_end": [
    { "command": "scale session end --session-id $CODEX_SESSION_ID" }
  ]
}
```

`AGENTS.md`（与 Claude Code 的 CLAUDE.md 内容相同，文件名不同）。

### 2.5 接入 Cursor

`.cursor/rules/scale.mdc`：

```markdown
---
description: SCALE Engine governance rules
alwaysApply: true
---

本项目由 SCALE Engine 治理。所有规则同 SCALE 项目根 README。

## 关键约束
- 修改代码后必须跑测试（Hook 强制）
- 创建 Spec 前需先 scale create need
- ...
```

Cursor Hook 配置在 `.cursor/hooks/` （Cursor 0.45+）。

### 2.6 接入 Gemini CLI

`GEMINI.md` + `gemini-extension.json`，原理类似。

### 2.7 接入未支持 Hook 的 Agent

降级方案：仅依赖 system prompt（CLAUDE.md/AGENTS.md 等价文件）+ 用户手动调用 `scale gate before-stop` 验证。

---

## 三、MCP 接入（提升体验）

### 3.1 MCP Server 实现

```typescript
// src/api/mcp.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'

const server = new Server({
  name: 'scale-engine',
  version: '0.1.0'
}, {
  capabilities: { tools: {}, resources: {} }
})

// 工具：让 AI 可以主动调用 SCALE
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scale_create_artifact',
      description: 'Create a new SCALE artifact (Need/Spec/Plan/Task etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['Need', 'Spec', 'Plan', 'Task', ...] },
          title: { type: 'string' },
          parentId: { type: 'string' },
          payload: { type: 'object' }
        }
      }
    },
    {
      name: 'scale_transition',
      description: 'Transition an artifact to a new state',
      inputSchema: { ... }
    },
    {
      name: 'scale_recall_lesson',
      description: 'Recall historical lessons relevant to a query',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, topK: { type: 'number' } }
      }
    },
    {
      name: 'scale_activate_role',
      description: 'Switch to a different role to unlock tools',
      inputSchema: { type: 'object', properties: { role: { type: 'string' } } }
    },
    {
      name: 'scale_check_gates',
      description: 'Check if all gates of an artifact are passing',
      inputSchema: { ... }
    }
  ]
}))

// 资源：让 AI 可以读取 SCALE 状态
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: 'scale://artifacts/active', name: 'Active artifacts' },
    { uri: 'scale://session/current', name: 'Current session' },
    { uri: 'scale://lessons/top', name: 'Top relevant lessons' }
  ]
}))
```

### 3.2 客户端配置

Claude Code:
```json
{
  "mcpServers": {
    "scale": {
      "command": "scale",
      "args": ["mcp-server"]
    }
  }
}
```

Cursor 0.45+: 同上格式。

---

## 四、HTTP API（团队 / Web / CI）

### 4.1 Hono Server 路由

```typescript
import { Hono } from 'hono'
const app = new Hono()

// Artifacts
app.post('/artifacts', async (c) => store.create(await c.req.json()))
app.get('/artifacts/:id', async (c) => store.get(c.req.param('id')))
app.patch('/artifacts/:id', async (c) => store.update(...))
app.post('/artifacts/:id/transitions', async (c) => fsm.transition(...))

// Events (SSE 实时推送)
app.get('/events/stream', async (c) => {
  const stream = new ReadableStream({
    start(controller) {
      eventBus.on('*', (event) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
      })
    }
  })
  return c.body(stream, 200, {'Content-Type': 'text/event-stream'})
})

// Knowledge
app.post('/knowledge/recall', async (c) => {
  const { query, topK } = await c.req.json()
  return c.json(await knowledgeBase.recallByVector(query, topK))
})

// Gates (供 webhook / CI 调用)
app.post('/gates/pre-tool', ...)
app.post('/gates/before-stop', ...)
```

### 4.2 启动方式

```bash
scale serve --port 3137 --auth-token $SCALE_TOKEN
```

---

## 五、多机协作场景

如果团队多人共享同一份 SCALE 数据：

```
┌──────────────┐    ┌──────────────┐
│ 开发者 A     │    │ 开发者 B     │
│ Claude Code  │    │ Cursor       │
└──────┬───────┘    └──────┬───────┘
       │                   │
       └─────────┬─────────┘
                 ▼
         HTTP / WebSocket
                 │
       ┌─────────▼──────────┐
       │  SCALE Server      │
       │  (中心实例)        │
       │  + PostgreSQL      │
       │  + Qdrant          │
       └────────────────────┘
```

切换存储：环境变量 `SCALE_DB_URL=postgres://...`，引擎自动适配 Drizzle backend。

---

## 六、`scale init` 命令的智能化

```bash
$ cd my-project
$ scale init
[?] 检测到项目类型: TypeScript + Spring Boot multi-module
[?] 选择要配置的 Agents: 
    [x] Claude Code (检测到 .claude/)
    [x] Codex CLI (检测到 .codex/)
    [ ] Cursor
    [ ] Gemini CLI
[?] 启用以下能力:
    [x] PreToolUse 防危险命令拦截
    [x] PostToolUse 自动 lint
    [x] Stop Gate 验证强制
    [x] Role 权限网关
    [x] Lesson 召回（需要 Qdrant，本地启动？是）
    [ ] BehaviorTracker（占资源，先关）

✓ 创建 .scale/config.yaml
✓ 创建 .scale/scale.db
✓ 写入 .claude/settings.json (备份原配置到 .claude/settings.json.bak)
✓ 写入 .codex/hooks.json
✓ 生成 CLAUDE.md (200 行精简版)
✓ 生成 AGENTS.md (符号链接到 CLAUDE.md)
✓ 启动 Qdrant docker container (qdrant-scale)
✓ 添加 .scale/ 到 .gitignore (除 artifacts/ 和 rules/enforced/)

下一步: scale create need "你的第一个需求"
```

### 6.1 生成的 .scale/config.yaml

```yaml
version: 1
project:
  name: 3d-car-mall
  type: spring-boot-multi-module
  rootDir: F:/project/work/maple-cart-mall/3d-car-mall

storage:
  db: .scale/scale.db
  events: .scale/events
  artifacts: .scale/artifacts
  vectors:
    backend: qdrant
    url: http://localhost:6333

agents:
  - name: claude-code
    settingsFile: .claude/settings.json
    promptFile: CLAUDE.md
  - name: codex-cli
    settingsFile: .codex/hooks.json
    promptFile: AGENTS.md

models:
  defaults:
    explore: claude-haiku
    plan: claude-sonnet-4-5
    implement: claude-sonnet-4-5
    verify: claude-haiku
    architect: claude-opus-4-5
  routing:
    - condition: "task.complexity < 0.3"
      model: claude-haiku
    - condition: "task.complexity >= 0.7 || role == 'Architect'"
      model: claude-opus-4-5
    - default: claude-sonnet-4-5

guardrails:
  preTool:
    enabled: true
    detectors:
      - dangerous-command
      - role-permission
      - brute-retry
  postTool:
    enabled: true
    autoLint:
      enabled: true
      commands:
        '*.ts': pnpm lint --fix
        '*.tsx': pnpm lint --fix
        '*.java': mvn -q compile -pl :{{module}}
  beforeStop:
    enabled: true
    requireVerification: true
    verificationCommands:
      typescript: pnpm test
      java: mvn -q test

knowledge:
  extraction:
    enabled: true
    triggers:
      - defect.closed_with_root_cause
      - task.completed_after_3+_retries
  recall:
    topK: 3
    minRelevance: 0.4
  decay:
    enabled: true
    schedule: "0 3 * * *"   # 每天凌晨 3 点

evolution:
  enabled: false           # MVP 阶段先关，等系统稳定再开
  autoApprove: false       # 永远人审

logging:
  level: info
  file: .scale/scale.log
```

---

## 七、安装、升级、卸载

### 安装
```bash
npm install -g scale-engine
# 或使用 bun
bun add -g scale-engine
```

### 升级
```bash
scale upgrade            # 自动备份当前配置后升级
```

### 数据迁移
每个版本变化的 schema 由 `src/migrations/` 管理。`scale upgrade` 自动执行待迁移项。

### 卸载
```bash
scale uninstall --agents claude,codex
# 移除 hooks 配置，保留 .scale/ 数据
scale purge              # 删除所有 .scale/ 数据（不可逆）
```

---

## 八、问答 (FAQ)

**Q: SCALE Engine 会不会拖慢 AI 响应？**  
A: PreToolUse hook 目标 < 50ms p99。SQLite + 内存缓存 Role/Rule，几乎无感。

**Q: 多人协作时数据冲突怎么办？**  
A: 单机模式下 SQLite WAL 支持并发读，写有锁。多人共享 Server 模式用 PostgreSQL。Artifact 内容是 git 文件，按 git merge 流程解决。

**Q: 我用的 Agent 不在列表里怎么办？**  
A: 只要支持 fork 子进程（几乎所有 CLI Agent 都支持），写一个 hook 配置即可。SCALE 提供 `scale adapter generate <agent-name>` 命令。

**Q: Hook 拒绝太频繁，AI 卡住怎么办？**  
A: 每个 Detector 都有 `severity: warn / block`。可以全局设置 `guardrails.strict: false` 改为只警告不阻断。

**Q: 我不想用某些功能怎么办？**  
A: 配置里关掉。例如 `evolution.enabled: false` 关闭自进化层。

