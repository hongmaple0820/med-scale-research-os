---
name: scale-engine
description: SCALE Engine's 6-phase workflow for shipping quality features.
  Use when starting a new project, implementing features, fixing bugs,
  or when user mentions any phase (define/plan/build/verify/review/ship).
  Automatically selects the correct phase based on user intent.
type: workflow
best_for:
  - new feature implementation
  - bug fixes with quality gates
  - refactoring with verification
  - product development lifecycle
scenarios:
  - User says: "I have an idea for..."
  - User says: "Start implementing..."
  - User says: "Verify the changes"
  - User says: "Ship this feature"
  - User says: "Give me a template"
  - User says: "I want the full MVP workflow"
estimated_time: varies by phase (see time-estimates)
---

# SCALE Engine — Phase Decision Tree

## Quick Phase Selection

用户意图 → 推荐的 Phase：

| 用户意图 | Phase | 命令 | 时间预估 |
|----------|-------|------|----------|
| "我有一个想法/需求" | DEFINE | `scale define <title>` | 5-15 分钟 |
| "我需要规划实现方案" | PLAN | `scale plan <spec-id>` | 10-30 分钟 |
| "开始编码/实现" | BUILD | `scale build <plan-id>` | 30分钟-数小时 |
| "运行测试/验证质量" | VERIFY | `scale verify <task-id>` | 2-10 分钟 |
| "代码审查" | REVIEW | `scale review <task-id>` | 5-15 分钟 |
| "发布/提交" | SHIP | `scale ship <task-id>` | 1-5 分钟 |

---

## Phase Decision Tree

### "我有一个想法" 或 "我想做一个功能"
→ **DEFINE Phase**

**目标**：将模糊想法转化为可执行的 Spec
**产出**：Spec.md + Ambiguity Score
**时间**：5-15 分钟
**下一步**：PLAN Phase

---

### "我需要技术方案" 或 "如何实现这个"
→ **PLAN Phase**

**目标**：设计技术方案 + 风险评估
**产出**：Plan.md + Rollback Strategy
**时间**：10-30 分钟
**下一步**：BUILD Phase

---

### "开始编码" 或 "实现功能"
→ **BUILD Phase**

**目标**：创建 Task 并开始实现
**产出**：Task artifact + 工作目录
**时间**：30分钟-数小时
**下一步**：VERIFY Phase（实现完成后）

---

### "运行测试" 或 "验证质量"
→ **VERIFY Phase**

**目标**：通过 G3-G7 质量门控
**产出**：Evidence records + Coverage report
**时间**：2-10 分钟
**下一步**：REVIEW Phase（全部 Gates PASS）

**量化阈值**：
- Build: exit code 0
- Lint: exit code 0
- Tests: all pass
- Coverage: ≥80%
- Security: no CRITICAL findings

---

### "代码审查" 或 "安全检查"
→ **REVIEW Phase**

**目标**：Karpathy Principles 审查 + 安全检查
**产出**：Review record + Findings report
**时间**：5-15 分钟
**下一步**：SHIP Phase（CRITICAL=0）

**量化阈值**：
- CRITICAL findings: 0（必须）
- HIGH findings: ≤2（或有 mitigation）

---

### "提交代码" 或 "发布功能"
→ **SHIP Phase**

**目标**：安全的 git commit + Honest Delivery Report
**产出**：Commit hash + Delivery report
**时间**：1-5 分钟
**下一步**：Done

**安全默认值**：
- 只 commit review 记录中的文件
- 不使用 force push
- 验证 HEAD 未改变

---

## Vibe Templates（快速启动）

### "给我一个模板" 或 "快速开始"
→ **Vibe Templates**

**命令**：`scale vibe --phase <phase> --pack <pack>`

**可选 Pack**：

| Pack | Phases | 时间 | 适合 |
|------|--------|------|------|
| full-mvp | 6 phases（idea → build） | 数天-数周 | 完整产品开发 |
| quick-prototype | 3 phases（prd → build） | 数小时-数天 | 快速验证想法 |
| developer-path | 5 phases（跳过 idea） | 数天 | 技术团队 |
| vibe-coder-path | 4 phases（简化技术） | 数天 | 非技术用户 |

---

## Phase Flow Diagram

```
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
  │        │       │        │        │       │
  │        │       │        │        │       │
  ▼        ▼       ▼        ▼        ▼       ▼
Spec    Plan    Task    Evidence  Review  Commit
FROZEN APPROVED RUNNING  Records   Record  Hash

每个 Phase 都有：
- Prerequisites（前置条件）
- Decision Point（Go/No-Go 决策）
- Time Impact（No 路径的延迟成本）
```

---

## Decision Points Summary

| Phase | Go Condition | No Action | Time Impact |
|-------|--------------|-----------|-------------|
| DEFINE | Ambiguity <20% | Socratic refinement | +5-15 min |
| PLAN | Rollback defined | Add rollback | +5-15 min |
| BUILD | Task RUNNING | Fix Guard | +5-15 min |
| VERIFY | All Gates PASS | Fix failures | +2-60 min |
| REVIEW | CRITICAL=0 | Fix CRITICAL | +30-120 min |
| SHIP | Evidence valid | Fix evidence | +5-30 min |

---

## Quality Gates Reference

| Gate | Check | Threshold | Command |
|------|-------|-----------|---------|
| G3 | Build | exit code 0 | `pnpm build` |
| G4 | Lint | exit code 0 | `pnpm lint` |
| G5 | Tests | all pass | `pnpm test` |
| G6 | Coverage | ≥80% | `pnpm coverage` |
| G7 | Security | no CRITICAL | `pnpm security-check` |

---

## Sub-Skills Reference

本套件包含以下 Phase Skills：

- `phases/define/SKILL.md` — DEFINE Phase
- `phases/plan/SKILL.md` — PLAN Phase
- `phases/build/SKILL.md` — BUILD Phase
- `phases/verify/SKILL.md` — VERIFY Phase（借口反驳表）
- `phases/review/SKILL.md` — REVIEW Phase（思维框架）
- `phases/ship/SKILL.md` — SHIP Phase（安全默认值）
- `vibe-templates/SKILL.md` — 模板库入口
- `evolution/SKILL.md` — L6 自改进循环

---

## Anti-Patterns（避免）

- ❌ 跳过 VERIFY Phase 直接 ship
- ❌ CRITICAL findings >0 仍然继续
- ❌ Coverage <80% 就提交
- ❌ 不运行安全检查
- ❌ Force push 到 main
- ❌ Commit 未 review 的文件

---

## Quick Commands

```bash
# 完整工作流
scale define "Feature Title"
scale plan SPEC-xxx
scale build PLAN-xxx
scale verify TASK-xxx
scale review TASK-xxx
scale ship TASK-xxx

# 快速模板
scale vibe --phase prd --user developer
scale vibe --pack full-mvp

# 自改进
scale evolution --session-id EVOL-xxx
```

---

## Output Marker Tracking

每个 Phase 完成后必须输出状态标记，用于 SessionStateTracker 追踪：

| Phase | Marker Format | Example |
|-------|---------------|---------|
| DEFINE | `[DEFINE] ✓ ambiguity <score>% ✓ | spec ✓` | `[DEFINE] ✓ ambiguity 15% ✓ | spec SPEC-001 ✓` |
| PLAN | `[PLAN] ✓ impact ✓ | contract ✓ | rollback ✓ | plan ✓` | `[PLAN] ✓ impact ✓ | contract ✓ | rollback ✓ | plan PLAN-001 ✓` |
| BUILD | `[EXECUTE] ✓ TDD RED ✓ | GREEN ✓ | REFACTOR ✓ | task ✓` | `[EXECUTE] ✓ TDD RED ✓ | GREEN ✓ | REFACTOR ✓ | task TASK-001 ✓` |
| VERIFY | `[VERIFY] ✓ G3 build ✓ | G4 lint ✓ | G5 tests ✓ | G6 coverage <N>% ✓ | G7 security ✓` | `[VERIFY] ✓ build ✓ | lint ✓ | tests ✓ | coverage 85% ✓ | security ✓` |
| REVIEW | `[REVIEW] ✓ files <count> ✓ | findings <total> ✓ | CRITICAL 0 ✓ | HIGH <count> ✓ | principles 8/8 ✓` | `[REVIEW] ✓ files 5 ✓ | findings 3 ✓ | CRITICAL 0 ✓ | HIGH 1 ✓ | principles 8/8 ✓` |
| SHIP | `[SHIP] ✓ evidence ✓ | staged <count> ✓ | commit <hash> ✓ | push ✓ | report ✓` | `[SHIP] ✓ evidence ✓ | staged 5 ✓ | commit a1b2c3d ✓ | push ✓ | report ✓` |

**追踪机制**：
- SessionStateTracker 读取 marker 并更新 `.flow-state` 文件
- Stop Hook 检查所有 Phase 是否完成（✓）
- 未完成 Phase → 阻断并提示缺失步骤