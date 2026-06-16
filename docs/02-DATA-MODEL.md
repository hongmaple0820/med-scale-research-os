# 02 — 数据模型（系统灵魂）

> 这是整个系统最重要的一篇。读懂这一篇，整个 SCALE 的设计就豁然开朗。
> **核心认知：一切皆 Artifact，一切变化皆 Event，一切迁移皆 FSM。**

---

## 一、Artifact（工件）—— 系统的基本对象

### 1.1 Artifact 类型谱系

整个生命周期由 11 种 Artifact 组成。它们之间通过 `parents/children` 关系构成 DAG：

```
                    ┌─────────────┐
                    │    Need     │  用户原始诉求（可能模糊）
                    └──────┬──────┘
                           ↓
                    ┌─────────────┐
                    │   Insight   │  探索学习产出的事实/约束
                    └──────┬──────┘
                           ↓
                    ┌─────────────┐
                    │    Spec     │  评审通过的需求契约 (WHAT)
                    └──────┬──────┘
                  ┌────────┴─────────┐
                  ↓                  ↓
           ┌─────────────┐   ┌─────────────┐
           │    Plan     │   │  TestPlan   │  HOW + 验证方案
           └──────┬──────┘   └──────┬──────┘
                  ↓                 │
           ┌─────────────┐          │
           │    Task     │  原子可执行单元
           └──────┬──────┘          │
                  ↓                 │
           ┌─────────────┐          │
           │   Change    │  实际代码变更 (commit/PR)
           └──────┬──────┘          │
                  ↓                 │
           ┌─────────────┐          │
           │  Evidence   │ <────────┘ 验证证据 (test output)
           └──────┬──────┘
       通过 ←─────┴─────→ 失败
        ↓                  ↓
 ┌─────────────┐    ┌─────────────┐
 │   Lesson    │    │   Defect    │  缺陷
 └─────────────┘    └──────┬──────┘
                           ↓ (回到对应层修复)
                    ┌─────────────┐
                    │   Release   │  发布单 (所有 Defect 关闭后)
                    └─────────────┘
```

### 1.2 Artifact 通用结构（系统的"心跳"）

每个 Artifact 都有同一套元字段，差异只在 `payload`：

```typescript
interface Artifact<T = unknown> {
  // 标识
  id: string                    // ART-{type}-{yyyymmdd}-{seq}, 如 ART-spec-20260421-0007
  type: ArtifactType            // 11 种之一
  version: number               // 每次内容修改 +1

  // 状态
  status: string                // 由该类型的 FSM 决定
  statusHistory: StatusChange[] // 完整迁移历史

  // 关系
  parents: string[]             // 上游依赖 Artifact ID
  children: string[]            // 下游派生 Artifact ID
  supersedes?: string           // 取代的旧版本 ID

  // 内容
  title: string
  contentRef: string            // 实际内容文件路径，如 .scale/artifacts/spec/0007.md
  payload: T                    // 类型特定的结构化数据

  // 质量门 (Gates) - 必须打开的"通过条件"
  gates: Gate[]

  // 元数据
  createdBy: Actor              // ai:role / human:userId / system
  createdAt: number
  updatedAt: number
  closedAt?: number
  tags: string[]
  labels: Record<string, string>
}

interface StatusChange {
  from: string
  to: string
  at: number
  by: Actor
  reason?: string
  eventId: string               // 关联到事件流
}

interface Gate {
  name: string                  // ambiguity_score / test_passed / human_approved
  required: boolean             // 是否必须通过才能进入下一状态
  threshold?: string            // 比如 "<= 0.2"
  actual?: unknown              // 实际值
  passed: boolean
  checkedAt?: number
  checkedBy?: Actor
}

type Actor =
  | { kind: 'ai', role: string, model?: string }
  | { kind: 'human', userId: string }
  | { kind: 'system', component: string }
```

### 1.3 各类型的 payload 字段

```typescript
// Need —— 原始诉求
interface NeedPayload {
  rawText: string                  // 用户原话
  ambiguityScore?: number          // 0-1，数值越大越模糊
  stakeholders: string[]
}

// Insight —— 探索学习产出
interface InsightPayload {
  category: 'fact' | 'constraint' | 'risk' | 'opportunity'
  evidence: { type: 'file' | 'doc' | 'test' | 'log', ref: string }[]
  confidence: number               // 0-1
  contradictsArtifact?: string     // 如果发现和某个 Spec/Plan 矛盾
}

// Spec —— 需求契约
interface SpecPayload {
  what: string                     // 做什么
  successCriteria: string[]        // 验收标准（用于自动测试 + Stop Gate）
  outOfScope: string[]             // 不做什么（防漂移）
  edgeCases: string[]
  northStar: string                // 一句话使命
}

// Plan —— 技术方案
interface PlanPayload {
  approach: string                 // 总体思路
  techChoices: { decision: string, rationale: string, alternatives: string[] }[]
  modules: { path: string, action: 'create' | 'modify' | 'delete', reason: string }[]
  rollbackStrategy: string         // 回滚方案（必填）
  estimatedComplexity: number      // 0-1，用于模型路由
}

// TestPlan —— 验证方案
interface TestPlanPayload {
  unitTests: TestSpec[]
  integrationTests: TestSpec[]
  manualChecks: string[]
  perfBudgets?: { metric: string, target: string }[]
}

// Task —— 原子可执行单元
interface TaskPayload {
  description: string
  estimatedTokens?: number
  estimatedDurationMs?: number
  filesInvolved: string[]
  dependsOn: string[]              // 其他 Task ID
  requiredRole: string
  requiredCapabilities: string[]   // 比如 ['can_use_bash', 'can_modify_db']
}

// Change —— 实际变更
interface ChangePayload {
  commitSha?: string               // git commit
  prUrl?: string
  filesChanged: { path: string, additions: number, deletions: number }[]
  diffSummary: string
  reverted?: boolean
}

// Evidence —— 验证证据
interface EvidencePayload {
  testPlanId: string
  toolUsed: string                 // pnpm test / mvn test / playwright / ...
  passed: boolean
  output: string                   // 截断后的测试输出
  duration: number
  artifacts: string[]              // screenshot / coverage report 文件路径
}

// Defect —— 缺陷
interface DefectPayload {
  symptom: string
  rootCauseCategory:               // 决定回退到哪一层
    | 'requirement_ambiguity'      // → 回 Spec
    | 'design_flaw'                // → 回 Plan
    | 'implementation_bug'         // → 回 Change
    | 'test_gap'                   // → 回 TestPlan
    | 'environment_issue'
    | 'unknown'
  rootCauseDetail: string
  fixChangeIds: string[]
  similarTo: string[]              // 相似 Defect ID
  lesson?: string                  // 提炼为 Lesson 的 ID
}

// Lesson —— 沉淀经验
interface LessonPayload {
  type: 'lesson' | 'pattern' | 'best_practice' | 'anti_pattern'
       | 'decision' | 'troubleshooting' | 'workflow' | 'reference'
  problem: string                  // 什么场景
  solution: string                 // 怎么处理
  prevention: string               // 怎么预防
  sourceDefects: string[]          // 来自哪些 Defect
  applicableContexts: string[]     // 哪些场景该召回
  verified: boolean                // 是否经过人审
  promotedToRule?: string          // 如果升级为规则，规则 ID
}

// Release —— 发布单
interface ReleasePayload {
  version: string
  includesSpecs: string[]
  includesChanges: string[]
  rolloutStrategy: 'canary' | 'blue_green' | 'rolling' | 'all_at_once'
  rolledBack?: boolean
  rollbackReason?: string
}
```

---

## 二、Event（事件）—— 系统的"血液"

### 2.1 Event 设计哲学

**所有 Artifact 状态变化都必须先发出 Event。** Event 是 append-only，不可修改。Artifact 只是 Event 的"投影 (projection)"。

```
真相之源:   events.jsonl  (append-only)
查询投影:   SQLite (artifacts 表，可重建)
```

**这一设计的好处：**
- 任何状态都可重建（重放事件即可）
- 完整审计 (谁在什么时候做了什么)
- 时间旅行调试 (重放到任意历史状态)
- 多消费者 (BehaviorTracker / KnowledgeBase 都订阅同一事件流)

### 2.2 Event 通用结构

```typescript
interface Event<T = unknown> {
  id: string                    // EVT-{ts_ms}-{seq}
  type: EventType               // 见下方分类
  timestamp: number
  sessionId: string             // 关联到具体 Agent 会话
  actor: Actor
  artifactId?: string           // 涉及的 Artifact (若有)
  payload: T

  // 因果链
  causedBy?: string             // 导致此事件的事件 ID
  correlationId?: string        // 同一逻辑流的事件用同一 ID
}
```

### 2.3 Event 分类

```typescript
type EventType =
  // Artifact 生命周期
  | 'artifact.created'
  | 'artifact.updated'
  | 'artifact.transitioned'         // 状态变化
  | 'artifact.gate_checked'
  | 'artifact.deleted'

  // 工具调用
  | 'tool.called'                   // PreToolUse
  | 'tool.completed'                // PostToolUse 成功
  | 'tool.failed'                   // PostToolUse 失败
  | 'tool.blocked'                  // Hook 拒绝

  // 护栏
  | 'gate.checked'
  | 'gate.passed'
  | 'gate.failed'

  // 行为模式
  | 'behavior.brute_retry'
  | 'behavior.idle_tool'
  | 'behavior.busy_loop'
  | 'behavior.premature_done'
  | 'behavior.blame_shift'

  // Role
  | 'role.activated'
  | 'role.denied'

  // Session
  | 'session.started'
  | 'session.ended'
  | 'session.compacted'
  | 'session.cleared'

  // Knowledge
  | 'lesson.proposed'
  | 'lesson.approved'
  | 'lesson.rejected'
  | 'lesson.recalled'
  | 'lesson.helpful'
  | 'lesson.useless'

  // Evolution
  | 'rule.proposed'
  | 'rule.enforced'
  | 'hook.generated'
```

### 2.4 事件流持久化格式

```jsonl
{"id":"EVT-1745234567000-0001","type":"artifact.created","timestamp":1745234567000,"sessionId":"S-abc","actor":{"kind":"human","userId":"liming"},"artifactId":"ART-need-20260421-0001","payload":{"type":"Need","title":"增加订单导出"}}
{"id":"EVT-1745234580000-0002","type":"role.activated","timestamp":1745234580000,"sessionId":"S-abc","actor":{"kind":"ai","role":"Explorer","model":"claude-sonnet-4-5"},"payload":{"role":"Explorer"}}
{"id":"EVT-1745234600000-0003","type":"tool.called","timestamp":1745234600000,"sessionId":"S-abc","actor":{"kind":"ai","role":"Explorer"},"payload":{"tool":"Read","args":{"file":"src/order.ts"}}}
```

存储位置：`.scale/events/YYYY-MM-DD.jsonl`（按天分文件，便于归档）

---

## 三、FSM（状态机）—— 系统的"宪法"

### 3.1 设计原则

**所有状态变化必须通过 `fsm.transition()` 接口。** 任何代码（包括 SCALE 自己的代码）直接修改 `artifact.status` 字段都视为 BUG，会被 lint 规则拦截。

### 3.2 各 Artifact 的状态机定义

#### Need 状态机

```
DRAFT ──refine──▶ CLARIFIED
  │                  │
  └──discard──────▶ ABANDONED
                     │
                     ▼ (产出 Spec 后)
                   FULFILLED
```

#### Spec 状态机（最关键）

```
                  ┌──── reject ────┐
                  ▼                │
   DRAFT ──refine──▶ REVIEWING ──approve──▶ FROZEN
     ▲                                         │
     │ challenge                               │ supersede
     └─────────────── REVISING ◀───────────────┘
                                               │
                                               ▼
                                          OBSOLETED
```

**关键约束：**
- 只有 `FROZEN` 状态的 Spec 才能派生 Plan
- `REVISING` 状态的 Spec 会自动 invalidate 下游所有 Plan/TestPlan
- `OBSOLETED` 是终态，被新版本取代后进入

#### Plan 状态机

```
DRAFT ──review──▶ APPROVED ──implement──▶ IMPLEMENTING ──complete──▶ DONE
  │                  │                          │
  │                  └────invalidate────────────┘
  ▼                                    (上游 Spec 改变)
SUPERSEDED                             ▼
                                    REVISING
                                       │
                                       ▼
                                    APPROVED
```

#### Task 状态机

```
PENDING ──schedule──▶ READY ──start──▶ RUNNING ──complete──▶ DONE
   │                                       │                   │
   │                                       ├──pause──▶ PAUSED  │
   │                                       │                   │
   │                                       └──fail───▶ FAILED  │
   ▼                                                           ▼
CANCELLED                                                  COMPLETED
```

#### Change 状态机

```
DRAFT ──commit──▶ COMMITTED ──verify──▶ VERIFIED
                       │                    │
                       └──revert──────▶ REVERTED
                                            ↓
                                        DEFECT (生成 Defect 工件)
```

#### Defect 状态机

```
OPEN ──assign──▶ INVESTIGATING ──diagnose──▶ DIAGNOSED ──fix──▶ FIXED ──verify──▶ CLOSED
                       │                          │
                       │                          └──reopen────────────────────────▶ OPEN
                       └──duplicate──▶ DUPLICATE
```

#### Lesson 状态机

```
PROPOSED ──review──▶ APPROVED ──promote──▶ ACTIVE ──evolve──▶ RULE
   │                    │                                       │
   │                    └──reject────▶ REJECTED                 ▼
   │                                                          HOOK
   └──supersede────▶ SUPERSEDED
```

#### Release 状态机

```
PLANNED ──prepare──▶ READY ──ship──▶ DEPLOYING ──verify──▶ DEPLOYED
                                          │                    │
                                          └──rollback──▶ ROLLED_BACK
```

### 3.3 FSM 引擎接口

```typescript
interface FSMDefinition<S extends string, A extends string> {
  states: S[]
  initial: S
  terminal: S[]
  transitions: Array<{
    from: S
    action: A
    to: S
    guards?: Guard[]              // 必须满足才能迁移
    effects?: Effect[]            // 迁移后自动执行
  }>
}

interface Guard {
  name: string
  check: (artifact: Artifact, context: TransitionContext) => boolean | Promise<boolean>
  errorMessage: string
}

interface Effect {
  name: string
  run: (artifact: Artifact, context: TransitionContext) => void | Promise<void>
}

interface TransitionContext {
  actor: Actor
  reason?: string
  payload?: Record<string, unknown>
}
```

**典型 Guard：**
```typescript
const ambiguityGuard: Guard = {
  name: 'ambiguity_below_threshold',
  check: (a) => (a.payload as SpecPayload).ambiguityScore <= 0.2,
  errorMessage: 'Spec 模糊度必须 ≤ 0.2 才能 FROZEN'
}

const allTestsPassedGuard: Guard = {
  name: 'all_tests_passed',
  check: async (a) => {
    const evidences = await store.findChildren(a.id, 'Evidence')
    return evidences.every(e => (e.payload as EvidencePayload).passed)
  },
  errorMessage: '存在失败的测试证据，不能进入 DONE'
}
```

**典型 Effect：**
```typescript
const invalidateDownstreamEffect: Effect = {
  name: 'invalidate_downstream_plans',
  run: async (spec) => {
    const plans = await store.findChildren(spec.id, 'Plan')
    for (const plan of plans) {
      if (plan.status === 'APPROVED' || plan.status === 'IMPLEMENTING') {
        await fsm.transition(plan.id, 'invalidate', {
          reason: `Upstream Spec ${spec.id} entered REVISING`
        })
      }
    }
  }
}
```

---

## 四、SQLite Schema（持久化）

```sql
-- artifacts 表：当前状态投影
CREATE TABLE artifacts (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL,
  title           TEXT NOT NULL,
  content_ref     TEXT NOT NULL,                  -- 内容文件路径
  payload_json    TEXT NOT NULL,                  -- payload 序列化
  parents_json    TEXT NOT NULL DEFAULT '[]',
  children_json   TEXT NOT NULL DEFAULT '[]',
  supersedes      TEXT,
  created_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  closed_at       INTEGER,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  labels_json     TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_artifacts_type_status ON artifacts(type, status);
CREATE INDEX idx_artifacts_updated_at  ON artifacts(updated_at);
CREATE INDEX idx_artifacts_supersedes  ON artifacts(supersedes);

-- gates 表：每个 Artifact 的质量门
CREATE TABLE gates (
  artifact_id     TEXT NOT NULL,
  name            TEXT NOT NULL,
  required        INTEGER NOT NULL,               -- 0/1
  threshold       TEXT,
  actual_json     TEXT,
  passed          INTEGER NOT NULL DEFAULT 0,
  checked_at      INTEGER,
  checked_by      TEXT,
  PRIMARY KEY (artifact_id, name),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
);

-- status_history 表：状态迁移历史
CREATE TABLE status_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id     TEXT NOT NULL,
  from_status     TEXT NOT NULL,
  to_status       TEXT NOT NULL,
  at              INTEGER NOT NULL,
  by              TEXT NOT NULL,
  reason          TEXT,
  event_id        TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
);

CREATE INDEX idx_status_history_artifact ON status_history(artifact_id, at);

-- sessions 表：会话元数据
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  agent           TEXT NOT NULL,                  -- claude-code / codex / cursor
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  active_role     TEXT,
  metadata_json   TEXT
);

-- knowledge 表：Lesson 索引
CREATE TABLE knowledge_entries (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  tags_json       TEXT NOT NULL,
  content_ref     TEXT NOT NULL,
  embedding_id    TEXT,                          -- Qdrant point id
  relevance       REAL NOT NULL DEFAULT 0.5,
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_accessed   INTEGER,
  verified        INTEGER NOT NULL DEFAULT 0,
  verified_by     TEXT,
  verified_at     INTEGER,
  created_at      INTEGER NOT NULL,
  source_artifact TEXT
);

CREATE INDEX idx_knowledge_type_relevance ON knowledge_entries(type, relevance DESC);

-- behavior_metrics 表：行为统计（用于自进化）
CREATE TABLE behavior_metrics (
  session_id      TEXT NOT NULL,
  metric_name     TEXT NOT NULL,
  value           REAL NOT NULL,
  recorded_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, metric_name, recorded_at)
);

-- rules 表：进化出的规则
CREATE TABLE rules (
  id              TEXT PRIMARY KEY,
  source_lesson   TEXT NOT NULL,
  rule_text       TEXT NOT NULL,
  enforcement     TEXT NOT NULL,                  -- 'advisory' | 'hook'
  status          TEXT NOT NULL,                  -- 'proposed' | 'approved' | 'enforced'
  created_at      INTEGER NOT NULL,
  approved_by     TEXT,
  approved_at     INTEGER,
  hook_path       TEXT                            -- 如果 enforcement='hook'
);
```

---

## 五、文件系统布局

```
.scale/                                          # 项目根目录下
├── config.yaml                                  # 项目配置
├── scale.db                                     # SQLite 主库
├── scale.db-wal                                 # WAL
├── events/                                      # 事件流
│   ├── 2026-04-21.jsonl
│   ├── 2026-04-22.jsonl
│   └── ...
├── artifacts/                                   # Artifact 内容（git 友好）
│   ├── need/NEED-20260421-0001.md
│   ├── insight/INS-20260421-0002.md
│   ├── spec/SPEC-20260421-0003.md
│   ├── plan/PLAN-20260421-0004.md
│   ├── testplan/TP-20260421-0005.md
│   ├── task/TASK-20260421-0006.yaml
│   ├── change/CHG-20260421-0007.md
│   ├── evidence/EV-20260421-0008.json
│   ├── defect/DEF-20260421-0009.md
│   ├── lesson/LSN-20260421-0010.md
│   └── release/REL-20260421-0011.md
├── checkpoints/                                 # 任务检查点
│   └── TASK-xxx/
│       ├── 1745234567/state.json
│       └── ...
├── rules/                                       # 进化出的规则
│   ├── proposed/                                # 待审
│   ├── enforced/                                # 已启用
│   └── archived/                                # 已废弃
├── hooks/                                       # 自动生成的 Hook 脚本
│   └── auto/
└── vectors/                                     # Qdrant 数据
    └── (qdrant 自管)
```

**为什么 Artifact 内容用文件而不是数据库 BLOB：**
- ✅ git 友好（diff/blame/history）
- ✅ 编辑器原生支持
- ✅ 工具友好（grep/sed/cat）
- ❌ 失去全文搜索 → 用 SQLite FTS5 索引补偿

---

## 六、典型操作的数据变化

### 操作：用户创建一个 Need

```
1. CLI: scale create need "增加订单导出"
2. 引擎生成 ID: NEED-20260421-0001
3. 写文件: .scale/artifacts/need/NEED-20260421-0001.md
4. SQLite INSERT artifacts(...)
5. EventLog append: artifact.created
6. EventBus.emit("artifact.created")
   → BehaviorTracker 接收，更新 metrics
   → KnowledgeBase 接收，准备召回相关 Lesson
```

### 操作：FSM 迁移 (Spec REVIEWING → FROZEN)

```
1. fsm.transition('SPEC-...0003', 'approve', {actor, reason})
2. 找到 transition 定义: REVIEWING --approve--> FROZEN
3. 执行所有 guards:
   - ambiguity_below_threshold? ✓
   - human_approved? ✓
4. 全部通过 → 开始迁移:
   a. 写 status_history
   b. UPDATE artifacts SET status='FROZEN', updated_at=...
   c. EventLog append: artifact.transitioned
   d. EventBus.emit
5. 执行所有 effects:
   - notify_downstream_planner_role
6. 返回新 Artifact
```

### 操作：Spec 进入 REVISING（反馈回路）

```
1. fsm.transition('SPEC-...0003', 'challenge', {...})
2. Guards 通过 → 状态变 REVISING
3. Effects:
   - invalidate_downstream_plans:
     → 找到所有 child Plan
     → 对每个 APPROVED/IMPLEMENTING 状态的 Plan，
       自动调用 fsm.transition(plan.id, 'invalidate')
     → 级联触发 Plan 的 effects (通知 Implementer 暂停)
4. 系统化的反馈传播完成
```

---

## 七、为什么这个设计能解决 5 大病灶

| 病灶 | 数据模型如何解决 |
|------|----------------|
| 幻觉式合规 | Stop Gate 检查"必须有 PASS 状态的 Evidence Artifact" |
| 暴力重试 | 事件流统计 `tool.called` 同 cmd 频率 → 检测出来 |
| 甩锅 | Defect 必须填 `rootCauseCategory`，"environment_issue" 需要证据 Artifact |
| 上下文崩塌 | 永远不把整个 Artifact DAG 塞进上下文，按 ContextBuilder 优先级取 |
| 零经验复利 | Defect 关闭触发 Lesson 提炼，新任务向量召回历史 Lesson |

**这就是数据模型作为"系统宪法"的力量——它从结构上让正确的事变得可能，让错误的事变得困难。**

