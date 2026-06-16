---
name: evolution-loop
description: Self-improve from defects and lessons using the Baton System.
  Use after fixing bugs, when user says "learn from this", "extract lessons",
  "create a rule", "prevent this bug again", "start evolution". Runs across 
  multiple sessions with persistent state via .scale/baton/ files.
type: workflow
best_for:
  - defect learning
  - knowledge extraction
  - rule creation
  - hook activation
  - L6 continuous improvement
scenarios:
  - User says: "Learn from this bug"
  - User says: "Create a rule from this"
  - User says: "Prevent this happening again"
  - After CRITICAL bug fix
  - After repeated similar bugs
estimated_time: 15-60 minutes (may span sessions)
---

# Evolution Loop — Baton System

## Core Principle
**Write next-prompt.md before session ends — or the loop breaks.**

Evolution Loop 跨 session 工作，使用 `.scale/baton/` 目录作为持久化状态。关键是 Step 6 必须写入续命文件。

---

## The Baton System

### 文件结构

```
.scale/baton/
├── current-session.md    # 当前 session 状态
├── defects-found.md      # 发现的缺陷列表
├── lessons-learned.md    # 提取的经验教训
├── rules-proposed.md     # 提议的规则（待验证）
├── hooks-activated.md    # 激活的 hooks
└── next-prompt.md        # ⚠️ 下一步提示词（关键！）
```

### 每个文件职责

| 文件 | 职责 | 格式 |
|------|------|------|
| current-session.md | Session ID + 进度状态 | YAML frontmatter + Markdown |
| defects-found.md | 缺陷列表 | Defect ID + Description + File |
| lessons-learned.md | 教训列表 | Pattern + Solution + Confidence |
| rules-proposed.md | 规则列表 | Rule + Validation Count + Status |
| hooks-activated.md | Hook 列表 | Hook ID + Trigger + File |
| next-prompt.md | 下次 session 启动提示词 | Prompt + Status + Next Action |

---

## Execution Protocol — 6 步循环

### Step 1: Read the Baton ⚠️

**如果 `.scale/baton/` 不存在 → 这是第一个 session，初始化。**

读取 `current-session.md`：

```markdown
---
session_id: EVOL-1778667800000
status: COLLECT_DEFECTS
started: 2026-05-13T18:00:00Z
current_step: 1
defects_count: 0
lessons_count: 0
rules_count: 0
hooks_count: 0
---

# Evolution Session: EVOL-1778667800000

Status: COLLECT_DEFECTS
Next: Collect defects from EventBus
```

---

### Step 2: Consult Context Files

根据 Current Step 读取对应文件：

| Current Step | 读取来源 | 验证 |
|--------------|----------|------|
| COLLECT_DEFECTS | EventBus query | 查询 `defect.opened` 事件 |
| EXTRACT_LESSONS | `defects-found.md` | 检查缺陷数量 ≥3 |
| VALIDATE_LESSONS | `lessons-learned.md` | 检查 Lesson Validations |
| PROPOSE_RULES | `rules-proposed.md` | 检查 Rule Validations ≥3 |
| ACTIVATE_HOOKS | `hooks-activated.md` | 检查 Hook Status |

---

### Step 3: Execute Current Step

#### COLLECT_DEFECTS Step

**目标**：从 EventBus 查询最近的缺陷事件。

**量化阈值**：
- 最少 3 个缺陷才能提取教训
- 如果 <3 → 等待更多缺陷积累，写入 next-prompt.md 结束 session

**行动**：
```bash
# 使用 EventBus 查询
# 或从最近修复的 CRITICAL bugs 中提取
```

**输出到 `defects-found.md`**：
```markdown
# Defects Found

Session: EVOL-1778667800000
Updated: 2026-05-13T18:05:00Z

## DEFECT-001
Description: Empty catch block in auth.ts silenced authentication errors
File: src/auth.ts
Line: 42
Severity: CRITICAL
Found: 2026-05-13T17:00:00Z

## DEFECT-002
Description: SQL injection vulnerability in query.ts due to string concatenation
File: src/db/query.ts
Line: 15
Severity: CRITICAL
Found: 2026-05-13T17:30:00Z

## DEFECT-003
Description: Missing error handling caused payment timeout
File: src/payment.ts
Line: 89
Severity: HIGH
Found: 2026-05-13T17:45:00Z
```

---

#### EXTRACT_LESSONS Step

**目标**：分析每个缺陷，提取 Pattern + Solution。

**量化阈值**：
- 每个缺陷至少 1 个 Pattern
- 每个缺陷至少 1 个 Solution
- Confidence 分数：0.0-1.0（初始 0.5，验证后增加）

**分析框架**：
1. What went wrong？（出了什么错？）
2. Why did it happen？（为什么会发生？）
3. How was it fixed？（怎么修复的？）
4. What pattern does it follow？（遵循什么模式？）

**输出到 `lessons-learned.md`**：
```markdown
# Lessons Learned

Session: EVOL-1778667800000
Updated: 2026-05-13T18:10:00Z

## Lesson L001
Pattern: Empty catch blocks silence errors and prevent debugging
Solution: Always log or handle caught exceptions; never swallow silently
Confidence: 0.85
Source: DEFECT-001
Validations: 0

## Lesson L002
Pattern: Raw string concatenation in SQL queries allows injection
Solution: Always use parameterized queries or prepared statements
Confidence: 0.95
Source: DEFECT-002
Validations: 0

## Lesson L003
Pattern: Missing error handling causes silent failures
Solution: Add explicit error handling with retries or fallbacks
Confidence: 0.70
Source: DEFECT-003
Validations: 0
```

---

#### VALIDATE_LESSONS Step

**目标**：验证 Lessons，准备转为 Rules。

**验证规则**：
- Lesson 验证 3 次后 → 可以成为 Rule
- 每次同类 bug 修复后 → 该 Lesson Validation +1
- Confidence 随验证次数增加：+0.1 per validation

**行动**：
1. 检查 `rules-proposed.md` 中已有的验证计数
2. 搜索最近修复中是否有同类 Pattern
3. 更新 Validation 计数

**输出到 `rules-proposed.md`**：
```markdown
# Rules Proposed

Session: EVOL-1778667800000
Updated: 2026-05-13T18:15:00Z

## Rule R001 (Pending)
Content: Never use empty catch blocks — always log or handle exceptions
Lesson: L001
Validations: 2/3 (need 1 more)
Status: PENDING
Confidence: 0.95

## Rule R002 (Activated)
Content: Always use parameterized SQL queries — never concatenate strings
Lesson: L002
Validations: 3/3 ✓
Status: ACTIVATED
Confidence: 1.00

## Rule R003 (Pending)
Content: Add explicit error handling for async operations
Lesson: L003
Validations: 1/3 (need 2 more)
Status: PENDING
Confidence: 0.80
```

---

#### PROPOSE_RULES Step

**目标**：将 Validations ≥3 的 Lessons 转为 Rules。

**阈值**：
- Validations ≥3
- Confidence ≥0.85

**Rule 格式**：
```markdown
## Rule R004
Content: <rule-content>
Lesson: <lesson-id>
Validations: 3
Confidence: 0.90
Status: PROPOSED
Proposed: <datetime>
```

---

#### ACTIVATE_HOOKS Step

**目标**：将已验证的 Rules 转为可执行的 Hooks。

**Hook 设计**：
- Trigger：正则表达式匹配危险模式
- Action：BLOCK + MESSAGE 或 WARN
- File：Guardrails detector 文件

**输出到 `hooks-activated.md`**：
```markdown
# Hooks Activated

Session: EVOL-1778667800000
Updated: 2026-05-13T18:20:00Z

## Hook H001
Rule: R002
Trigger: "executeQuery.*\\+|query.*\\+.*req"
Action: BLOCK
Message: "SQL injection risk: use parameterized queries"
File: src/guardrails/sql-injection-detector.ts
Activated: 2026-05-13T18:20:00Z

## Hook H002
Rule: R001
Trigger: "catch\\s*\\(.*\\)\\s*\\{\\s*(?:\\/\\*.*?\\*\\/|\\/\\/.*)?\\s*\\}"
Action: WARN
Message: "Empty catch block detected: add error handling"
File: src/guardrails/empty-catch-detector.ts
Activated: 2026-05-13T18:20:00Z
```

---

### Step 4: Integrate Results

**目标**：更新所有 baton 文件，确保状态同步。

更新 `current-session.md`：
```markdown
---
session_id: EVOL-1778667800000
status: <new-status>
current_step: <step-number>
defects_count: <count>
lessons_count: <count>
rules_count: <count>
hooks_count: <count>
---

# Evolution Session: EVOL-1778667800000

Status: <new-status>
Progress: <step> of 6
Updated: <datetime>
```

---

### Step 5: Update Documentation

**目标**：将新的 Lessons/Rules/Hooks 写入知识库。

| 内容 | 目标位置 |
|------|----------|
| Lessons | `docs/lessons/<lesson-id>.md` |
| Rules | `docs/rules/<rule-id>.md` |
| Hooks | `src/guardrails/<hook-name>.ts` |

---

### Step 6: Prepare Next Baton ⚠️ CRITICAL

**这是最关键的一步！必须写入 `next-prompt.md`！**

如果不写这个文件 → 循环断开，下次 session 无法继续。

**写入 `next-prompt.md`**：
```markdown
---
session_id: EVOL-1778667800000
status: <current-status>
next_action: <COLLECT/EXTRACT/VALIDATE/PROPOSE/ACTIVATE/DONE>
---

# Evolution Next Step

Session: EVOL-1778667800000
Status: VALIDATE_LESSONS
Pending Lessons: 3
Pending Rules: 2
Next Action: VALIDATE_LESSONS

Current Progress:
- DEFECTS: collected (3 defects)
- LESSONS: extracted (3 lessons)
- RULES: proposed (2 rules pending validation)
- HOOKS: 0 activated

Recommended Prompt for Next Session:
"Continue evolution loop. Session EVOL-1778667800000 at VALIDATE_LESSONS step.
Lessons L001 and L003 need validation (2/3 and 1/3). Check recent bug fixes
for similar patterns to increment validation counts."

Time Estimate: +15-30 minutes in next session
```

---

## Completion Condition

当满足以下条件 → Evolution DONE：

- `defects-found.md` 为空（所有缺陷已处理）
- 所有 Lessons 都是 Rules（Validations ≥3）
- 所有 Rules 已激活为 Hooks

**输出最终报告**：
```markdown
# Evolution Complete

Session: EVOL-1778667800000
Status: DONE

Statistics:
- Defects processed: 5
- Lessons extracted: 5
- Rules created: 5
- Hooks activated: 3

Duration: 3 sessions over 2 days

Knowledge Base Updates:
- docs/lessons/: 5 files created
- docs/rules/: 5 files created
- src/guardrails/: 3 detectors added

Self-Improvement Cycle Complete.
```

---

## Rationalizations — 借口反驳表

LLM 可能会找借口跳过关键步骤。**不接受这些借口**：

| 借口 | 反驳 |
|------|------|
| "This bug is unique, no pattern" | Unique bugs have unique patterns. 提取它。 |
| "I'll remember this, no need to write" | Memory is unreliable. 写入文件持久化。 |
| "One defect is not enough for a lesson" | One defect starts one lesson. 积累会来的。 |
| "The lesson is obvious" | Obvious to you ≠ obvious to others. 记录它。 |
| "I'll create the hook later" | Later never comes. 现在写 next-prompt.md。 |
| "I forgot to write the baton" | That breaks the loop. 现在写 next-prompt.md。 |
| "No time for evolution now" | Evolution saves time in the long run. 执行它。 |
| "This is just a minor bug" | Minor bugs accumulate. 提取它。 |

---

## Decision Points

每个 Step 有 Go/No-Go 决策：

| Step | Go Condition | No Action | Time Impact |
|------|--------------|-----------|-------------|
| COLLECT | Defects ≥3 | Wait for more, write next-prompt | +1 session |
| EXTRACT | Lessons ≥1 | Back to COLLECT | +15 min |
| VALIDATE | Any validation +1 | Back to EXTRACT | +15 min |
| PROPOSE | Validations ≥3 | Back to VALIDATE | +1 session |
| ACTIVATE | Rules verified | Back to PROPOSE | +30 min |
| DONE | All Rules are Hooks | Evolution complete | - |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| EventBus query fails | 手动从最近修复的 bugs 中提取 |
| defects-found.md empty | 等待更多缺陷积累 |
| Validations stuck at 1/3 | 搜索历史修复记录找同类 Pattern |
| next-prompt.md missing | 循环断开，手动重新开始 |
| Hook activation fails | 先创建 detector 文件，再注册到 Gateway |

---

## Negative Instructions

- ❌ **Do not skip Step 6**: next-prompt.md 必须写入
- ❌ **Do not skip validation**: Rules 需要 3 次验证
- ❌ **Do not activate unverified Rules**: Confidence <0.85 不能激活
- ❌ **Do not end session without baton**: 必须更新所有 baton 文件
- ❌ **Do not ignore patterns**: 即使 "minor" bug 也要提取教训

---

## Quick Commands

```bash
# 启动 Evolution
scale evolution

# 继续 session
scale evolution --session EVOL-xxx

# 查看状态
cat .scale/baton/current-session.md

# 手动添加缺陷
scale evolution --add-defect "Description" --file "path" --severity "HIGH"
```