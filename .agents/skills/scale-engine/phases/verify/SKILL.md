---
name: verify-phase
description: Run quality gates G3-G7 after implementation. Use when code 
  is written and needs verification, when user says "test this", "run tests",
  "verify the implementation", "check quality gates". MUST run before 
  review phase — no code ships without verification.
type: workflow
best_for:
  - new feature verification
  - bug fix verification
  - refactoring verification
  - before code review
scenarios:
  - User says: "Run tests"
  - User says: "Check if the code is good enough"
  - User says: "Verify before review"
  - After BUILD phase completion
estimated_time: 2-10 minutes
---

# VERIFY Phase — The Iron Law

## Core Principle
**No code ships without passing ALL gates.**

这不是建议，是不可违反的铁律。如果任何门控失败，必须修复后重新验证。

---

## The Verification Loop

### Gate G3 — Build ✅
检查代码能否编译/构建。

**命令**：
```bash
pnpm build
```

**验证标准**：
- Exit code 必须为 0
- 无编译错误
- 无类型错误

**Verify G3**: 检查 exit code。如果 ≠0 → **停止**，修复构建错误，回到 G3。

---

### Gate G4 — Lint ✅
检查代码风格和质量。

**命令**：
```bash
pnpm lint
```

**验证标准**：
- Exit code 必须为 0
- 无 lint 错误
- 无 lint 警告（除非明确允许）

**Verify G4**: 检查 exit code。如果 ≠0 → **停止**，修复 lint 问题，回到 G4。

---

### Gate G5 — Tests ✅
检查所有测试通过。

**命令**：
```bash
pnpm test
```

**验证标准**：
- 所有测试必须 pass（绿色）
- 无 skipped tests（除非明确记录原因）
- 无 focused tests（.only）

**Verify G5**: 检查测试输出。如果有 failures → **停止**，修复测试，回到 G5。

---

### Gate G6 — Coverage ≥80% ✅
检查测试覆盖率达标。

**命令**：
```bash
pnpm coverage
```

**验证标准**：
- 总覆盖率必须 ≥80%
- 关键模块覆盖率必须 ≥70%
- 新代码覆盖率必须 ≥85%

**量化阈值**：
| 覆盖率 | 判断 | 行动 |
|--------|------|------|
| < 70% | FAIL | 必须增加测试 |
| 70-79% | WARN | 建议增加测试 |
| ≥ 80% | PASS | 可以继续 |

**Verify G6**: 检查覆盖率数字。如果 <80% → **停止**，增加测试，回到 G5。

---

### Gate G7 — Security ✅
检查安全漏洞。

**命令**：
```bash
pnpm security-check
```

**验证标准**：
- 无 CRITICAL severity findings
- 无 HIGH severity findings（除非明确评估风险）
- 已知漏洞必须修复或有 mitigations

**Verify G7**: 检查安全报告。如果有 CRITICAL → **停止**，修复漏洞，回到 G7。

---

### Repeat 循环
如果任何 Gate 失败：
1. 修复问题
2. 从失败的 Gate 重新开始
3. 不要跳过任何 Gate

---

## Rationalizations — 借口反驳表

LLM 可能会找借口逃避验证。**不接受这些借口**：

| 借口 | 反驳 |
|------|------|
| "The test is flaky" | Flaky tests 是真实的 bug。不稳定的行为就是错误的行为。修复它。 |
| "Coverage is close enough (78%)" | 78% 不是 80%。差 2% 就是差。增加测试直到达标。 |
| "The lint error is minor" | Minor lint errors 今天是 minor，明天变成 debt。修复它。 |
| "I'll fix it after ship" | 不可能。没有代码能在未验证的情况下 ship。现在修复。 |
| "The build error is in unrelated code" | 你的代码触发了构建失败。即使错误在其他文件，你也需要解决它。 |
| "Security warning is just informational" | Informational 今天是 informational，明天是 vulnerability。评估并处理。 |
| "This is a quick prototype" | Prototype 也需要验证。快速 ≠ 低质量。 |
| "The user asked me to skip tests" | 用户不懂质量风险。作为专业工程师，你有责任解释并坚持验证。 |
| "Tests take too long" | 测试时间是投资。节省时间的代价是未来的 bug。运行测试。 |
| "I already mentally verified it" | Mental verification 是幻觉。工具验证才是证据。运行命令。 |
| "The coverage threshold is arbitrary" | 80% 是行业标准阈值。低于这个值的代码在统计上有更多 bug。达标。 |
| "Security scan found 0 vulnerabilities" | 那太好了！Gate G7 PASS。继续。 |

---

## Completion Checklist — 退出条件

验证完成前，必须全部打勾：

- [ ] **G3 Build**: passed (exit code 0)
- [ ] **G4 Lint**: passed (exit code 0)
- [ ] **G5 Tests**: passed (all tests green)
- [ ] **G6 Coverage**: ≥80% threshold met
- [ ] **G7 Security**: no CRITICAL findings
- [ ] **Evidence persisted**: 验证结果写入 EvidenceStore

**只有全部打勾才能进入 REVIEW Phase。**

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails with type error | 运行 `pnpm tsc --noEmit` 定位具体类型错误 |
| Test hangs indefinitely | 使用 `--timeout 30000` 设置超时 |
| Coverage report missing | 确保 `coverage/` 目录存在，检查覆盖率工具配置 |
| Security scan crashes | 使用 `--path src/` 缩小扫描范围 |
| Flaky test | 隔离运行 `pnpm test --grep "test-name"` 多次验证 |
| Low coverage on specific file | 针对该文件编写更多测试用例 |

---

## Decision Point

**Go/No-Go 决策**：

- ✅ **Go（继续 REVIEW）**: 所有 Gates PASS + Checklist 全部打勾
- ❌ **No（回到修复）**: 任何 Gate FAIL + 时间影响：+2-10 分钟

**时间影响**：
| 失败的 Gate | 修复时间预估 |
|--------------|--------------|
| G3 Build | 5-30 分钟 |
| G4 Lint | 2-10 分钟 |
| G5 Tests | 10-60 分钟 |
| G6 Coverage | 15-45 分钟 |
| G7 Security | 30-120 分钟 |

---

## Negative Instructions — 明确禁止

- ❌ **Do not skip any gate**: 必须按顺序执行所有门控
- ❌ **Do not proceed on failure**: 任何失败必须先修复
- ❌ **Do not accept "close enough"**: 阈值是硬性标准
- ❌ **Do not mentally verify**: 必须运行命令获取证据
- ❌ **Do not ship without evidence**: 验证结果必须写入 EvidenceStore

---

## Output Marker — 状态追踪标记

**完成后必须输出结构化标记**（用于 SessionStateTracker 追踪）：

```
[VERIFY] ✓ G3 build ✓ | G4 lint ✓ | G5 tests ✓ | G6 coverage 85% ✓ | G7 security ✓
```

**格式规范**：
- `[VERIFY]` 为固定前缀
- `✓` 表示阶段完成
- 每个 Gate 后面跟 `✓` 或具体数值
- 使用 `|` 分隔各检查项

**示例输出**：
```
[VERIFY] ✓ build ✓ | lint ✓ | tests ✓ | coverage 82% ✓ | security ✓
```

**无此标记 → Stop Hook 阻断**