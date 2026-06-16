---
name: ship-phase
description: Ship verified and reviewed code with git commit and Honest 
  Delivery Report. Use after REVIEW phase passes, when user says "ship this",
  "commit this", "deploy", "push to main", "release this". Safe git flow — 
  never force push, always verify before commit.
type: workflow
best_for:
  - feature release
  - bug fix release
  - code delivery
  - after review passes
scenarios:
  - User says: "Ship this feature"
  - User says: "Commit and push"
  - User says: "Release this"
  - User says: "Push to main"
  - After REVIEW phase passes
estimated_time: 1-5 minutes
---

# SHIP Phase — Linear Flow with Safe Defaults

## Core Principle
**Always ship reviewed files only, never include unreviewed changes.**

安全默认值：
- 默认只 commit review 记录中的文件
- 默认验证 HEAD 未改变（使用 --no-commit 时）
- 默认生成 Honest Delivery Report
- 不使用 force push

---

## Prerequisites

SHIP Phase 必须满足：
- [ ] VERIFY Phase: 全部 Gates PASS
- [ ] REVIEW Phase: CRITICAL findings = 0
- [ ] Evidence persisted: 验证和审查记录完整
- [ ] Review files match working tree: staged 文件在 review 记录中

如果未满足 → 回到对应 Phase 修复。

---

## Quick Start（主流程）

### Step 1: Verify Evidence
检查验证和审查记录：

```bash
scale ship <task-id> --json
```

内部验证：
- `validateVerificationEvidence()`: 检查 G3-G7 evidence
- `validateReviewEvidence()`: 检查 review record 存在且 passed

**如果验证失败 → 停止，回到 VERIFY 或 REVIEW Phase。**

---

### Step 2: Stage Reviewed Files Only
只 stage review 记录中的文件：

```bash
git add -- <reviewed-files>
```

**安全检查**：
- 只添加 `ReviewRecord.changedFiles` 中的文件
- 检查 working tree 有无 unreviewed files
- 如果有 unreviewed files → **停止**，提示用户

---

### Step 3: Verify No Unreviewed Changes
检查是否有未审查的改动：

```bash
git status --short
git ls-files --others --exclude-standard
```

**验证标准**：
- Working tree 除了 reviewed files 外无其他改动
- Untracked files 只能是被 .gitignore 忽略的

**如果有 unreviewed changes → 停止，回到 REVIEW Phase。**

---

### Step 4: Commit（可选）
根据参数决定是否 commit：

**Option A：--no-commit（生成报告但不 commit）**
- 验证 HEAD 未改变
- 输出 Honest Delivery Report
- 不执行 git commit

**Option B：正常 commit**
```bash
git commit -m "<message>"
```

**安全默认值**：
- 使用 `--no-commit` 生成报告，手动 commit
- 不使用 `--amend`
- 不使用 `-f` 或 `--force`

---

### Step 5: Push（可选）
如果 commit 成功：

```bash
git push origin <branch>
```

**安全检查**：
- 不使用 `--force`
- 不使用 `-f`
- 验证 push 成功

---

### Step 6: Generate Honest Delivery Report
输出交付报告：

```
SHIP Phase Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task: <task-id>
Status: COMPLETED

[COMPLETED]
  - Commit: <hash> (or null if --no-commit)
  - Files committed: <count>
  - Time: <datetime>

[VERIFIED]
  [PASS] G3 Build: passed
  [PASS] G4 Lint: passed
  [PASS] G5 Tests: passed
  [PASS] G6 Coverage: 82.5%
  [PASS] G7 Security: no CRITICAL findings
  [PASS] Evidence records: VERIFY-xxx, VERIFY-yyy

[REVIEWED]
  [PASS] Review: REVIEW-xxx
  [PASS] CRITICAL findings: 0
  [PASS] HIGH findings: 2 (mitigated)
  [PASS] Review files: 3 files reviewed

[UNVERIFIED]
  (none — all gates passed)

Done. Feature shipped successfully.
```

---

## Fallback（降级方案）

如果 CLI 命令失败：

### git add 失败
```bash
# 手动 add
git status --short
git add -- <specific-files>
```

### git commit 失败
```bash
# 检查是否有未 staged 的改动
git diff --cached
# 如果 nothing to commit，检查 git status
git status
```

### git push 失败
```bash
# 检查 remote
git remote -v
# 检查 branch
git branch -vv
# 手动 push
git push origin HEAD
```

---

## Negative Instructions — 明确禁止

- ❌ **Do not force push**: `git push --force` 禁止
- ❌ **Do not commit unreviewed files**: 只 commit review 记录中的文件
- ❌ **Do not skip evidence validation**: 必须验证 VERIFY 和 REVIEW evidence
- ❌ **Do not amend commits**: 不使用 `git commit --amend`
- ❌ **Do not merge to main directly**: 优先创建 PR 或使用 --no-commit 验证
- ❌ **Do not skip coverage check**: 必须 ≥80%

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Unreviewed files detected | 回到 REVIEW Phase，review 新文件 |
| Evidence validation failed | 回到 VERIFY Phase，重新验证 |
| Nothing to commit | 检查 files 是否已 staged |
| Permission denied (push) | 检查 git 权限或使用 SSH key |
| Merge conflict | 手动解决：`git status` → edit → `git add` → `git commit` |

---

## Decision Point

**Go/No-Go 决策**：

- ✅ **Go（Ship 成功）**: Evidence validated + No unreviewed files + Commit/Push success
- ❌ **No（回到修复）**: Evidence 或 Review 失败 + 时间影响：+5-30 分钟

**时间影响**：
| 失败原因 | 修复时间预估 |
|----------|--------------|
| Evidence missing | 2-10 分钟 |
| Unreviewed files | 10-30 分钟 |
| Git operation fails | 5-15 分钟 |

---

## Safe Defaults Summary

| 场景 | 默认行为 | 原因 |
|------|----------|------|
| Staging files | 只 stage reviewed files | 防止 commit 未经审查的代码 |
| Force push | 禁止 | 防止覆盖远程历史 |
| --no-commit | 验证 HEAD 不变 | 确保不意外 commit |
| Evidence check | 强制验证 | 防止绕过质量门控 |
| Unreviewed files | 阻断 | 防止 commit 无关改动 |

---

## Output Marker — 状态追踪标记

**完成后必须输出结构化标记**（用于 SessionStateTracker 追踪）：

```
[SHIP] ✓ evidence ✓ | staged <count> ✓ | commit <hash> ✓ | push ✓ | report ✓
```

**格式规范**：
- `[SHIP]` 为固定前缀
- `✓` 表示阶段完成
- `evidence ✓` 表示验证/审查证据完整
- `staged <count>` 表示 staged 文件数
- `commit <hash>` 表示 commit hash（或 `null` 如果 --no-commit）
- `push ✓` 表示推送成功（或 `skip` 如果 --no-commit）
- `report ✓` 表示 Honest Delivery Report 已生成

**示例输出**：
```
[SHIP] ✓ evidence ✓ | staged 5 ✓ | commit a1b2c3d ✓ | push ✓ | report ✓
```

**--no-commit 模式示例**：
```
[SHIP] ✓ evidence ✓ | staged 5 ✓ | commit null ✓ | push skip ✓ | report ✓
```

**无此标记 → Stop Hook 阻断**