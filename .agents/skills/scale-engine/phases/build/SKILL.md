---
name: build-phase
description: Create Task and start implementation. Use after PLAN phase,
  when user says "build this plan", "start implementing", "create a task",
  "begin coding". Initialize Task artifact and transition to RUNNING.
type: workflow
best_for:
  - feature implementation
  - bug fix implementation
  - code development
  - task creation
scenarios:
  - User says: "Build this plan"
  - User says: "Start implementing"
  - User says: "Create a task"
  - User says: "Begin coding"
  - After PLAN phase completes
estimated_time: 30 minutes to hours (depends on scope)
---

# BUILD Phase — Linear Flow with Task Creation

## Core Principle
**Every task must have required capabilities defined.**

没有能力要求的任务会执行失败。BUILD Phase 创建 Task 并定义实现所需的能力。

---

## Prerequisites

BUILD Phase 需要：
- [ ] Plan ID: 来自 PLAN Phase 的 Plan
- [ ] Plan Status: APPROVED
- [ ] Rollback Strategy: 已定义

---

## Quick Start（主流程）

### Step 1: Validate Plan
验证 Plan 存在且状态正确：

```bash
scale build <plan-id>
```

**验证标准**：
- Plan 存在于 ArtifactStore
- Plan.status = APPROVED
- Plan.payload.rollbackStrategy 有内容

**如果验证失败 → 停止，回到 PLAN Phase。**

---

### Step 2: Create Task Payload
创建 TaskPayload：

```typescript
TaskPayload {
  description: "<task-description>",
  filesInvolved: [],
  dependsOn: [],
  requiredRole: "implementer",
  requiredCapabilities: [
    "code-generation",
    "file-editing",
    "test-writing"
  ],
  buildStatus: "pending",
  lintStatus: "pending",
  testPassed: undefined,
  testCoverage: undefined,
  agentBrief: { ... }
}
```

**可添加描述**：
```bash
scale build <plan-id> --description "<task-desc>"
```

---

### Step 3: Create Task Artifact
创建 Task artifact：

```bash
scale build <plan-id>
```

**产出**：
- Task artifact（实现任务）
- Task.status = RUNNING

---

### Step 4: FSM Transition
执行 FSM 状态流转：

**Task FSM**：
- PENDING → READY → RUNNING

**Plan FSM**：
- APPROVED → IMPLEMENTING

---

### Step 5: Output Task
输出 Task 摘要：

```
BUILD Phase Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task: TASK-<id>
Plan: <plan-id>
Status: RUNNING

Description: <description>
Required capabilities: 
  - code-generation
  - file-editing
  - test-writing

FSM transitions:
  Task: PENDING → READY → RUNNING ✓
  Plan: APPROVED → IMPLEMENTING ✓

Next: 
  1. Implement the feature
  2. Run: scale verify TASK-<id>
```

---

## Implementation Guidelines

### During Implementation
按照 Plan 的技术方案实现：

1. **Follow tech choices**: 使用 Plan 指定的技术选型
2. **Track files involved**: 记录涉及的文件
3. **Write tests first**: TDD — 测试先行
4. **Update Task payload**: 定期更新 Task 状态

### Required Capabilities
| Capability | 用途 |
|------------|------|
| code-generation | 生成代码 |
| file-editing | 编辑文件 |
| test-writing | 编写测试 |
| debugging | 调试问题 |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Plan not found | 检查 Plan ID，回到 PLAN |
| Plan not APPROVED | 完成 PLAN Phase |
| FSM transition blocked | 检查 Guard 失败原因 |
| Capability missing | 检查 SkillRegistry 是否注册所需能力 |

---

## Decision Point

**Go/No-Go 决策**：

- ✅ **Go（开始实现）**: Task RUNNING + Capabilities defined
- ❌ **No（回到规划）**: Plan 或 Guard 失败 + 时间影响：+5-15 分钟

---

## Negative Instructions

- ❌ **Do not proceed without capabilities**: 必需能力必须定义
- ❌ **Do not skip TDD**: 测试先行是必需的
- ❌ **Do not bypass FSM guards**: Guard 失败必须修复
- ❌ **Do not implement without plan**: 必须按 Plan 方案实现

---

## Output Marker — 状态追踪标记

**完成后必须输出结构化标记**（用于 SessionStateTracker 追踪）：

```
[EXECUTE] ✓ TDD RED ✓ | GREEN ✓ | REFACTOR ✓ | task <task-id> ✓
```

**格式规范**：
- `[EXECUTE]` 为固定前缀（BUILD Phase 在追踪系统中称为 EXECUTE）
- `✓` 表示阶段完成
- `TDD RED ✓` 表示测试先行（RED 阶段）
- `GREEN ✓` 表示实现通过测试（GREEN 阶段）
- `REFACTOR ✓` 表示重构优化（REFACTOR 阶段）
- `task <task-id>` 表示创建的 Task ID

**示例输出**：
```
[EXECUTE] ✓ TDD RED ✓ | GREEN ✓ | REFACTOR ✓ | task TASK-001 ✓
```

**无此标记 → Stop Hook 阻断**