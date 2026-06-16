# SCALE Engine v0.4.0 — Task Guard Workflow Demo

## Overview

This demo showcases the **Task Guard Enhancement** that prevents Agent false completion through physical constraints (Guards) instead of just behavioral suggestions.

### Core Problem Solved

Before v0.4.0:
- Agent could write buggy code
- Agent could transition Task to COMPLETED without verification
- No physical enforcement of "verify before deliver" principle

After v0.4.0:
- Agent writes code
- Agent attempts to complete Task
- **BLOCKED by Guards** (exit code 1, transition prevented)
- Agent must run `scale verifyTask <id>`
- If verification fails, Agent fixes bugs and re-runs
- Only after verification passes can Task be completed

## Key Components

### 1. TaskPayload Enhancement (types.ts)

```typescript
export interface TaskPayload {
  description: string
  filesInvolved: string[]
  dependsOn: ArtifactId[]
  requiredRole: string
  requiredCapabilities: string[]
  // NEW: Code quality verification fields
  buildStatus?: 'pending' | 'success' | 'failed'
  buildExitCode?: number
  lintStatus?: 'pending' | 'success' | 'failed'
  testPassed?: boolean
  testCoverage?: number
}
```

### 2. TaskFSM Guards (fsmDefinitions.ts)

```typescript
{
  from: 'RUNNING',
  action: 'complete',
  to: 'COMPLETED',
  guards: [
    {
      name: 'build_passed',
      check: (a) => {
        const payload = a.payload as Partial<TaskPayload>
        // BLOCK if not verified
        if (!payload.buildStatus) return false
        return payload.buildStatus === 'success' && (payload.buildExitCode ?? 0) === 0
      },
      errorMessage: 'Task 完成前必须运行 build 验证且通过...'
    },
    // ... lint_passed, tests_passed guards
  ]
}
```

### 3. verifyTask CLI Command (cli.ts)

```typescript
const verifyTask = defineCommand({
  meta: { name: 'verifyTask', description: 'Verify task code quality' },
  async run({ args }) {
    // Run build/lint/test commands
    // Record results to Task payload
    // Exit with error if any check fails
    const results = {
      buildStatus: 'success' | 'failed',
      buildExitCode: number,
      lintStatus: 'success' | 'failed',
      testPassed: boolean,
      testCoverage: number (optional)
    }
    await store.update(args.id, { payload: { ...results } })
  }
})
```

## Complete Workflow Demo

### Step 1: Create Task

```bash
cd F:/project/work/scale-demo

scale create Task "Implement dark mode toggle" \
  --payload '{"description":"Add dark mode toggle button","filesInvolved":["src/App.vue"]}'

# Output:
{
  "id": "TASK-20260422-0022",
  "type": "Task",
  "status": "PENDING",
  "payload": {
    "description": "Add dark mode toggle button",
    "filesInvolved": ["src/App.vue"],
    "requiredRole": "implementer"
  }
}
```

### Step 2: Transition to RUNNING

```bash
scale transition TASK-20260422-0022 schedule --reason "Ready to implement"
scale transition TASK-20260422-0022 start --reason "Starting implementation"

# Output:
{
  "success": true,
  "artifact": {
    "id": "TASK-20260422-0022",
    "status": "RUNNING"
  }
}
```

### Step 3: Agent Writes Code

Agent implements the feature in `src/App.vue`...

### Step 4: Agent Attempts to Complete (BLOCKED!)

```bash
scale transition TASK-20260422-0022 complete --reason "Implementation done"

# Output:
{
  "success": false,
  "blockedBy": [
    {
      "guard": "build_passed",
      "message": "Task 完成前必须运行 build 验证且通过..."
    },
    {
      "guard": "lint_passed",
      "message": "Task 完成前必须运行 lint 验证且通过..."
    },
    {
      "guard": "tests_passed",
      "message": "Task 完成前必须运行测试验证且通过..."
    }
  ]
}
# Exit code: 1 (transition prevented)
```

**This is the core fix**: The transition is **physically blocked**, not just a warning.

### Step 5: Run Verification

```bash
scale verifyTask TASK-20260422-0022

# Output:
🔨 Running build...
   ✅ Build passed

🔍 Running lint...
   ✅ Lint passed

🧪 Running tests...
   ✅ Tests passed

📊 Verification results:
──────────────────────────────────────────────────
  Build:  ✅ success (exit code: 0)
  Lint:   ✅ success
  Tests:  ✅ passed
──────────────────────────────────────────────────

✅ All checks passed! Task can now be completed.
```

**If verification fails**, Agent must:
1. Fix bugs in code
2. Re-run `scale verifyTask <id>`
3. Repeat until all checks pass

### Step 6: Complete Task (SUCCESS!)

```bash
scale transition TASK-20260422-0022 complete --reason "Verified and all checks passed"

# Output:
{
  "success": true,
  "artifact": {
    "id": "TASK-20260422-0022",
    "status": "COMPLETED",
    "payload": {
      "buildStatus": "success",
      "buildExitCode": 0,
      "lintStatus": "success",
      "testPassed": true
    },
    "closedAt": 1776829886199
  }
}
```

## Guard Logic Details

### build_passed Guard

```typescript
check: (artifact) => {
  const payload = artifact.payload as Partial<TaskPayload>
  // BLOCK if buildStatus not set
  if (!payload.buildStatus) return false
  // Allow only if success AND exit code 0
  return payload.buildStatus === 'success' && (payload.buildExitCode ?? 0) === 0
}
```

### lint_passed Guard

```typescript
check: (artifact) => {
  const payload = artifact.payload as Partial<TaskPayload>
  // BLOCK if lintStatus not set
  if (!payload.lintStatus) return false
  // Allow only if success
  return payload.lintStatus === 'success'
}
```

### tests_passed Guard

```typescript
check: (artifact) => {
  const payload = artifact.payload as Partial<TaskPayload>
  // BLOCK if testPassed not set
  if (!payload.testPassed) return false
  // Coverage is optional:
  // - If not set: only require testPassed=true
  // - If set: require testPassed=true AND coverage>=80
  if (payload.testCoverage === undefined) return payload.testPassed === true
  return payload.testPassed === true && payload.testCoverage >= 80
}
```

## Key Design Decisions

### 1. Physical Constraints vs Behavioral Suggestions

**Before**: Guards had "dev-friendly" logic that allowed transitions without verification
- Rationale: "Allow manual verification"
- Problem: Agent never runs verification → false completion

**After**: Guards have strict logic that BLOCKS without verification
- Rationale: "Force verification via physical constraint"
- Benefit: Agent CANNOT complete without verification (exit code 1)

### 2. Coverage Optional

For simple projects without coverage requirements:
- `testCoverage` field is optional
- If not set: only require `testPassed=true`
- If set: require `testPassed=true AND coverage>=80`

This balances enforcement with practicality.

### 3. Clear Error Messages

Each Guard provides actionable error message:
```
"Task 完成前必须运行 build 验证且通过（buildStatus=success, exitCode=0）。
运行: scale verify-task <id>"
```

Agent knows exactly what to do.

## Integration with SCALE OS Principles

This enhancement implements the core principle from SCALE OS v10.0:

### §0.2 显性推理 (Explicit Reasoning)

Agent must verify before claiming completion - no "brain-completed" assumptions.

### §0.4 反惰性警觉

Prevents Agent's "忙碌假象" (busy delusion) - writing code without verifying it works.

### §2.4 验证测试

"验证只能由工具完成，不可由大脑脑补" - Guards enforce tool verification.

### §4 零幻觉

"No hallucination" - Agent cannot hallucinate completion without real verification.

## Technical Implementation

### FSM Guard System

Guards are part of FSM transition definition:

```typescript
interface TransitionDef {
  from: string
  action: string
  to: string
  guards?: Guard[]  // Pre-transition checks
}

interface Guard {
  name: string
  check: (artifact: Artifact) => boolean | Promise<boolean>
  errorMessage: string
}
```

### Guard Execution Flow

```
Agent calls: scale transition <id> complete
    ↓
FSM.transition() checks guards
    ↓
Guard.check(artifact) runs
    ↓
If ANY guard returns false:
    ↓
Return GuardFailedError
Exit code 1
Transition prevented
    ↓
Agent must fix and retry
```

### Payload Update Flow

```
Agent calls: scale verifyTask <id>
    ↓
CLI runs build/lint/test commands
    ↓
CLI captures results
    ↓
CLI updates Task.payload
    ↓
Task now has verification fields
    ↓
Next complete attempt checks guards
    ↓
If all guards satisfied → transition allowed
```

## Comparison with Previous Workflow

### v0.3.0 (Before)

```
Agent creates Task
Agent writes code (with bugs)
Agent claims completion
  → SUCCESS (no verification required)
User discovers bugs in production
```

### v0.4.0 (After)

```
Agent creates Task
Agent writes code (with bugs)
Agent claims completion
  → BLOCKED (buildStatus missing)
Agent runs verifyTask
  → FAILS (build/lint/test errors)
Agent fixes bugs
Agent re-runs verifyTask
  → SUCCESS (all checks pass)
Agent claims completion
  → SUCCESS (guards satisfied)
User gets verified, working code
```

## Future Enhancements

### Possible Extensions

1. **Coverage thresholds by project type**:
   - Frontend: 80%
   - Backend: 90%
   - Library: 95%

2. **Custom verification commands**:
   - `verifyTask --custom "npm run e2e"`

3. **Verification caching**:
   - Skip verification if files unchanged

4. **Multi-stage verification**:
   - Stage 1: build/lint
   - Stage 2: unit tests
   - Stage 3: integration tests

## Conclusion

SCALE Engine v0.4.0 Task Guard Enhancement successfully prevents Agent false completion through **physical constraints** instead of behavioral suggestions. This demonstrates the core SCALE OS principle: "Verify before deliver" is enforced by the system, not left to Agent's discretion.

The demo project shows:
- ✅ Guards BLOCK completion without verification
- ✅ verifyTask command records results to Task payload
- ✅ Guards allow completion after verification passes
- ✅ Clear error messages guide Agent actions
- ✅ Coverage optional for simple projects

This is the foundation for building reliable AI engineering workflows that guarantee code quality through system constraints.