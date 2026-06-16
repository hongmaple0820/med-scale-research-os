---
name: review-phase
description: Code review with Karpathy Principles and security analysis. 
  Use after VERIFY phase passes, when user says "review this code", 
  "check code quality", "security audit", "code review". Deep analysis 
  required — not a quick scan.
type: workflow
best_for:
  - code quality review
  - security review
  - architecture review
  - before shipping
scenarios:
  - User says: "Review the code"
  - User says: "Security audit"
  - User says: "Check code quality"
  - After VERIFY phase passes
estimated_time: 5-30 minutes
---

# REVIEW Phase — Thinking Framework

## Purpose
这个 Skill 控制 LLM 的**思维方式**，而非具体的操作步骤。

目标：进行深度分析，而非快速扫描。

---

## When to Use / When NOT to Use

**Use when**:
- VERIFY phase 已全部通过
- 代码需要质量审查
- 需要安全审计
- 用户明确要求 review

**NOT Use when**:
- VERIFY phase 还有失败的 Gate（回到 VERIFY）
- 代码还在编写中（回到 BUILD）
- 只需要快速检查（用 VERIFY）

---

## Karpathy Principles — 8 条核心原则

### Principle 1: 列出假设
**量化阈值**：每个改动至少列出 3 个假设。

<Good>
假设 1：用户已登录
假设 2：数据库连接正常
假设 3：输入已验证
</Good>

<Bad>
假设代码会正常工作。
</Bad>

---

### Principle 2: 验证假设
每个假设必须有证据支撑。

**量化阈值**：
- 假设数量：≥3 个
- 有证据支撑的假设：≥50%

---

### Principle 3: 最小化改动
改动范围越小越好。

**量化阈值**：
- 新增文件数：≤5
- 新增代码行数：≤200
- 新增依赖数：≤2

如果超过阈值 → 考虑拆分任务。

---

### Principle 4: 追踪改动
每个改动必须可追溯到原始需求。

**量化阈值**：
- 追踪覆盖率：100%（所有改动都有需求链接）
- Spec → Plan → Task → Code 链路完整

---

### Principle 5: 有验证目标
每个改动必须有明确的验证标准。

**量化阈值**：
- 每个 feature 至少 1 个 acceptance test
- 每个 bug fix 至少 1 个 regression test

---

### Principle 6: 防止额外 feature
不要添加需求中没有的功能。

**Anti-patterns**：
- "顺便优化了一下..."
- "顺手加了个日志..."
- "顺便重构了..."

如果发现额外功能 → 删除或拆分到新 Task。

---

### Principle 7: 安全意识
检查 OWASP Top 10 漏洞。

**量化阈值**：
- 扫描文件数：100%（所有改动的文件）
- CRITICAL findings：0
- HIGH findings：≤2（必须有 mitigation）

---

### Principle 8: 测试意识
测试先于实现（TDD）。

**量化阈值**：
- 测试覆盖率：≥80%
- 新代码覆盖率：≥85%
- 测试先行证据：有（从 EvidenceStore 检查）

---

## Finding Severity 标准

| Severity | 定义 | 行动 |
|----------|------|------|
| CRITICAL | 安全漏洞、数据丢失风险 | **BLOCK** — 必须修复才能 ship |
| HIGH | Bug、重大质量问题 | **WARN** — 应该修复 |
| MEDIUM | 可维护性问题 | **INFO** — 建议修复 |
| LOW | 风格问题 | **NOTE** — 可选 |

**判定标准**：

### CRITICAL 判定条件
- 硬编码密钥（API key, password, token）
- SQL 注入漏洞（string concatenation in queries）
- XSS 漏洞（innerHTML = user input）
- 路径遍历漏洞（readFileSync + req.body）
- 认证绕过（skipAuth = true）
- 数据丢失风险（DROP, DELETE without backup）

### HIGH 判定条件
- 空 catch 块（catch {} 或 catch with only comments）
- 未处理的异常（throw without try）
- @ts-ignore 使用
- shell 执行（shell: true, execSync）
- dangerousInnerHTML（React）
- 未经验证的用户输入

### MEDIUM 判定条件
- any 类型使用
- 超过 50 行的函数
- 超过 800 行的文件
- 嵌套超过 4 层
- 缺少文档的公共 API

### LOW 判定条件
- 命名不规范
- 缺少注释
- 格式问题

---

## Rationalizations — 借口反驳表

| 借口 | 反驳 |
|------|------|
| "This is just a style issue" | Style issues 今天是 style，明天是 debt。统一风格。 |
| "The security finding is theoretical" | Theoretical vulnerabilities become real exploits。修复它。 |
| "I inherited this bad code" | 你现在拥有这段代码。修复它或记录为 future task。 |
| "The test coverage is good enough" | "Good enough" 不是 ≥80%。达标。 |
| "This pattern is common in this project" | Common patterns can be common bugs。检查是否有同类问题。 |
| "I reviewed it mentally" | Mental review 是幻觉。运行 ReviewAnalyzer。 |

---

## Stability Rules — 反幻觉规则

1. **Never reshape evidence to fit assumptions**: 证据决定判断，不是判断选择证据。
2. **Never skip CRITICAL findings**: CRITICAL 就是 BLOCK，没有例外。
3. **Never accept "I'll fix later"**: Later never comes。现在修复。
4. **Never lower thresholds without justification**: 阈值是硬性标准。不达标就是不通过。

---

## Completion Checklist

Review 完成前，必须全部打勾：

- [ ] 所有改动文件已扫描（100%覆盖率）
- [ ] Karpathy Principles 检查完成（8 条原则）
- [ ] 安全扫描完成（G7: OWASP Top 10）
- [ ] Finding Severity 正确分类
- [ ] **CRITICAL findings: 0**（必须）
- [ ] **HIGH findings: ≤2**（或有 mitigation）
- [ ] Review record 写入 ReviewStore

**只有 CRITICAL=0 才能进入 SHIP Phase。**

---

## Decision Point

**Go/No-Go 决策**：

- ✅ **Go（继续 SHIP）**: CRITICAL=0 + Checklist 全部打勾
- ❌ **No（回到修复）**: CRITICAL>0 + 时间影响：+30-120 分钟

**时间影响**：
| Finding Severity | 修复时间预估 |
|------------------|--------------|
| CRITICAL | 30-120 分钟 |
| HIGH | 10-30 分钟 |
| MEDIUM | 5-15 分钟 |

---

## Output Format

Review 输出应包含：

```
REVIEW Phase Results
- Review ID: REVIEW-<timestamp>
- Files scanned: <count>
- Findings: <count> total
  - CRITICAL: <count> (must be 0)
  - HIGH: <count>
  - MEDIUM: <count>
  - LOW: <count>
- Karpathy Principles: <pass/fail per principle>
- Recommendation: Ready to ship / Fix CRITICAL issues

Findings Details:
[CRITICAL] <file>: <description>
  Evidence: <line-number>: <code-snippet>
  
[HIGH] <file>: <description>
  Evidence: <line-number>: <code-snippet>
```

---

## Negative Instructions — 明确禁止

- ❌ **Do not skip CRITICAL findings**: CRITICAL 必须修复
- ❌ **Do not lower severity without evidence**: Severity 由标准决定
- ❌ **Do not accept "common pattern" excuse**: Common patterns need review too
- ❌ **Do not proceed with CRITICAL>0**: 必须回到修复
- ❌ **Do not mentally review**: 必须运行 ReviewAnalyzer

---

## Output Marker — 状态追踪标记

**完成后必须输出结构化标记**（用于 SessionStateTracker 追踪）：

```
[REVIEW] ✓ files <count> ✓ | findings <total> ✓ | CRITICAL 0 ✓ | HIGH <count> ✓ | principles 8/8 ✓
```

**格式规范**：
- `[REVIEW]` 为固定前缀
- `✓` 表示阶段完成
- `files <count>` 表示扫描文件数
- `findings <total>` 表示总发现数
- `CRITICAL 0` 必须为 0 才能继续
- `HIGH <count>` 显示 HIGH 数量（≤2 或有 mitigation）
- `principles 8/8` 表示 Karpathy Principles 通过率

**示例输出**：
```
[REVIEW] ✓ files 5 ✓ | findings 3 ✓ | CRITICAL 0 ✓ | HIGH 1 ✓ | principles 8/8 ✓
```

**无此标记 → Stop Hook 阻断**