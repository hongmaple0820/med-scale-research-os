---
name: define-phase
description: Define a Spec from raw idea using AmbiguityScorer and 
  Socratic Questioner. Use when user has an idea but it's vague, 
  when user says "I have an idea", "I want to build", "define this feature",
  "create a spec". Transform vague ideas into executable specifications.
type: workflow
best_for:
  - new feature definition
  - requirement clarification
  - spec creation
  - project kickoff
scenarios:
  - User says: "I have an idea for..."
  - User says: "I want to build a..."
  - User says: "Define this feature"
  - User says: "Create a spec for..."
estimated_time: 5-15 minutes
---

# DEFINE Phase — Linear Flow with Socratic Refinement

## Core Principle
**No spec ships with ambiguity score > 20%.**

模糊的需求是最大的浪费。DEFINE Phase 用 AmbiguityScorer + Socratic Questioner 将模糊想法转化为可执行的 Spec。

---

## Prerequisites

DEFINE Phase 需要：
- [ ] User input: 原始想法或需求描述（至少一句话）
- [ ] Context: 项目背景（可选）

---

## Quick Start（主流程）

### Step 1: Analyze Ambiguity
使用 AmbiguityScorer 分析需求模糊度：

```bash
scale define "<title>" --description "<desc>"
```

**Ambiguity Score 计算**：
- 基础分数：0.2（最大阈值）
- 描述 > 50 字：-0.05
- Success Criteria ≥2：-0.03
- Success Criteria ≥3：-0.02
- 最终分数：max(0.05, 计算结果)

**量化阈值**：
| Ambiguity Score | 判断 | 行动 |
|------------------|------|------|
| > 40% | BLOCKED | 必须精炼需求 |
| 20-40% | REQUIRES_QUESTIONING | 启动 Socratic Session |
| < 20% | PASS | 可以直接创建 Spec |

---

### Step 2: Socratic Refinement（如果需要）
如果 Ambiguity > 20%，启动六问框架：

**Six Questions**：
1. **Goal**: 这个需求的目标是什么？
2. **Constraint**: 有什么约束和边界？
3. **Acceptance**: 如何判断完成？
4. **Context**: 有什么上下文和依赖？
5. **Risk**: 有什么风险场景？
6. **Priority**: 有什么优先级排序？

**用户可通过 CLI 提供答案**：
```bash
scale define "<title>" \
  --goal "<goal>" \
  --constraint "<constraint>" \
  --acceptance "<acceptance>" \
  --context "<context>" \
  --risk "<risk>" \
  --priority "<priority>"
```

**精炼后 Ambiguity 降至 <20% → 继续 Step 3。**

---

### Step 3: Create Need + Spec
创建 Need 和 Spec artifacts：

```bash
scale define "<title>" --description "<desc>" --success-criteria "<criteria>"
```

**产出**：
- Need artifact（原始需求）
- Spec artifact（精炼规格）
- Spec.md 文件（Markdown 格式）

---

### Step 4: FSM Transition
执行 FSM 状态流转：

- DRAFT → REVIEWING → FROZEN

**Guard 检查**：
- Ambiguity Score ≤ 0.2
- Success Criteria ≥2

**如果 Guard 失败 → 停止，回到 Step 2 精炼。**

---

### Step 5: Output Spec
输出 Spec 文件和摘要：

```
DEFINE Phase Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Spec: SPEC-<id>
Status: FROZEN

Spec file: .scale/specs/SPEC-<id>.md
Ambiguity score: <score>
Success criteria: <count> criteria defined

Next: scale plan SPEC-<id>
```

---

## Socratic Question Framework

### 六问详解

**Q1: Goal（目标）**
- 这个功能要解决什么问题？
- 用户为什么需要这个？
- 成功后的状态是什么？

**Q2: Constraint（约束）**
- 有什么技术约束？
- 有什么时间约束？
- 有什么资源约束？
- 有什么兼容性约束？

**Q3: Acceptance（验收）**
- 如何判断功能完成？
- 用户如何验证？
- 有什么测试标准？

**Q4: Context（上下文）**
- 这是什么项目？
- 有什么依赖系统？
- 有什么历史代码？
- 有什么团队背景？

**Q5: Risk（风险）**
- 可能失败的场景？
- 可能的性能问题？
- 可能的安全问题？
- 可能的兼容问题？

**Q6: Priority（优先级）**
- 这个功能的重要性？
- 有什么必须有的？
- 有什么可选的？
- 有什么可以延后的？

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Ambiguity too high (>40%) | 回答六问精炼需求 |
| FSM transition blocked | 检查 Guard 失败原因，补充缺失信息 |
| Success criteria missing | 添加 `--success-criteria` 参数 |
| Description too short | 扩展描述，提供更多细节 |

---

## Decision Point

**Go/No-Go 决策**：

- ✅ **Go（继续 PLAN）**: Spec FROZEN + Ambiguity <20%
- ❌ **No（回到精炼）**: Ambiguity >20% + 时间影响：+5-15 分钟

---

## Negative Instructions

- ❌ **Do not proceed with high ambiguity**: Ambiguity >20% 必须精炼
- ❌ **Do not skip Socratic questions**: 六问是精炼的必要步骤
- ❌ **Do not create Spec without success criteria**: 至少 2 个验收标准
- ❌ **Do not bypass FSM guards**: Guard 失败必须修复

---

## Output Marker — 状态追踪标记

**完成后必须输出结构化标记**（用于 SessionStateTracker 追踪）：

```
[DEFINE] ✓ ambiguity <score>% ✓ | spec <spec-id> ✓
```

**格式规范**：
- `[DEFINE]` 为固定前缀
- `✓` 表示阶段完成
- `ambiguity <score>%` 表示最终模糊度分数
- `spec <spec-id>` 表示创建的 Spec ID

**示例输出**：
```
[DEFINE] ✓ ambiguity 15% ✓ | spec SPEC-001 ✓
```

**高模糊度通过后示例**（经 Socratic 精炼）：
```
[DEFINE] ✓ ambiguity 18% ✓ | spec SPEC-002 ✓
```

**无此标记 → Stop Hook 阻断**