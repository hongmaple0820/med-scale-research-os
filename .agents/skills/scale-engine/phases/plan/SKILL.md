---
name: plan-phase
description: Create implementation plan using ConsensusPlanner. Use after 
  DEFINE phase, when user says "plan this spec", "create a plan", 
  "design the implementation", "how to implement this". Generate technical 
  approach, tech choices, and rollback strategy.
type: workflow
best_for:
  - implementation planning
  - technical design
  - architecture decision
  - risk assessment
scenarios:
  - User says: "Plan this spec"
  - User says: "How to implement this"
  - User says: "Create a plan for..."
  - After DEFINE phase completes
estimated_time: 10-30 minutes
---

# PLAN Phase — Linear Flow with Consensus Planning

## Core Principle
**Every plan must have a rollback strategy.**

没有回滚方案的计划是不完整的计划。PLAN Phase 使用 ConsensusPlanner（Planner → Architect → Critic）生成技术方案。

---

## Prerequisites

PLAN Phase 需要：
- [ ] Spec ID: 来自 DEFINE Phase 的 Spec
- [ ] Spec Status: FROZEN
- [ ] Spec Content: 有明确的需求描述

---

## Quick Start（主流程）

### Step 1: Validate Spec
验证 Spec 存在且状态正确：

```bash
scale plan <spec-id>
```

**验证标准**：
- Spec 存在于 ArtifactStore
- Spec.status = FROZEN
- Spec.payload.what 有内容

**如果验证失败 → 停止，回到 DEFINE Phase。**

---

### Step 2: Consensus Planning
运行 Planner → Architect → Critic 三轮规划：

**Planner Round**：
- 分析 Spec 内容
- 生成 2-3 个可行方案
- 评估每个方案的优劣

**Architect Round**：
- 深化选定方案
- 设计技术架构
- 定技术选型

**Critic Round**：
- 预判失败场景
- 生成 Pre-mortem 分析
- 提出 mitigations

---

### Step 3: Define Rollback Strategy
**量化阈值**：必须有 rollback strategy。

**默认 rollback**：从 Critic 的 mitigations 中提取。

或通过 CLI 指定：
```bash
scale plan <spec-id> --rollback "<rollback-strategy>"
```

---

### Step 4: Create Plan Artifact
创建 Plan artifact：

```bash
scale plan <spec-id> --rollback "<rollback>"
```

**产出**：
- Plan artifact（技术方案）
- Plan.md 文件（Markdown 格式）
- Rollback strategy（回滚方案）

---

### Step 5: FSM Transition
执行 FSM 状态流转：

- DRAFT → APPROVED

**Guard 检查**：
- rollbackStrategy 存在且非空

**如果 Guard 失败 → 停止，回到 Step 3 添加 rollback。**

---

### Step 6: Output Plan
输出 Plan 文件和摘要：

```
PLAN Phase Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Plan: PLAN-<id>
Spec: <spec-id>
Status: APPROVED

Plan file: .scale/plans/PLAN-<id>.md
Approach: <approach>
Rollback: <rollback-strategy>

Pre-mortem risks: <count> risks identified
Mitigations: <count> mitigations defined

Next: scale build PLAN-<id>
```

---

## Rollback Strategy Template

好的 rollback strategy 应包含：

```markdown
## Rollback Strategy

### Code Rollback
git revert <commit-range>

### Database Rollback
- Migration down: <down-migration-file>
- Backup location: <backup-path>

### Configuration Rollback
- Config restore: <config-backup>
- Environment revert: <env-changes>

### Verification
- Run tests: pnpm test
- Check coverage: pnpm coverage
- Verify security: pnpm security-check
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Spec not found | 检查 Spec ID，回到 DEFINE |
| Spec not FROZEN | 完成 DEFINE Phase，freeze Spec |
| Rollback missing | 添加 `--rollback` 参数 |
| FSM transition blocked | 检查 Guard：rollbackStrategy 必须非空 |

---

## Decision Point

**Go/No-Go 决策**：

- ✅ **Go（继续 BUILD）**: Plan APPROVED + Rollback defined
- ❌ **No（回到规划）**: Rollback missing + 时间影响：+5-15 分钟

---

## Negative Instructions

- ❌ **Do not proceed without rollback**: Rollback strategy 是必需的
- ❌ **Do not skip Pre-mortem**: Pre-mortem 风险分析必须执行
- ❌ **Do not bypass FSM guards**: Guard 失败必须修复

---

## Output Marker — 状态追踪标记

**完成后必须输出结构化标记**（用于 SessionStateTracker 追踪）：

```
[PLAN] ✓ impact ✓ | contract ✓ | rollback ✓ | plan <plan-id> ✓
```

**格式规范**：
- `[PLAN]` 为固定前缀
- `✓` 表示阶段完成
- `impact ✓` 表示影响分析完成
- `contract ✓` 表示契约定义完成
- `rollback ✓` 表示回滚方案定义完成
- `plan <plan-id>` 表示创建的 Plan ID

**示例输出**：
```
[PLAN] ✓ impact ✓ | contract ✓ | rollback ✓ | plan PLAN-001 ✓
```

**无此标记 → Stop Hook 阻断**