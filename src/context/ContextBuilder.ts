// SCALE Engine — Context Builder (v0.5.0 完整实现)
// 分层上下文加载 + Token 预算 + SCALE v10.0 哲学 P1 层 + 场景模式感知
// 设计参考：docs/03-CORE-MODULES.md §3.6

import type { ArtifactId, SessionId, ScenarioMode, KnowledgeEntry } from '../artifact/types.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IKnowledgeBase } from '../knowledge/KnowledgeBase.js'
import type { IEventBus } from '../core/eventBus.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ContextLayer {
  name: string
  content: string
  priority: number
  estimatedTokens: number
}

export interface BuiltContext {
  system: string
  metadata: { totalTokens: number; layers: string[]; scenarioMode?: ScenarioMode }
}

export interface ContextStatus {
  sessionId: SessionId
  role: string
  allowedTools: string[]
  deniedTools: string[]
  activeArtifacts: Array<{ id: ArtifactId; type: string; status: string; current?: boolean }>
  constraints: string[]
  scenarioMode?: ScenarioMode
}

export interface IContextBuilder {
  build(opts: { roleId?: string; currentArtifactId?: ArtifactId; sessionId: SessionId; scenarioMode?: ScenarioMode }): Promise<BuiltContext>
  getStatus(sessionId: SessionId, roleGate: { getRole(): { id: string; allowedTools: string[]; deniedTools?: string[] } }): Promise<ContextStatus>
}

// ============================================================================
// SCALE v10.0 Philosophy — P1 system_rules layer content
// ============================================================================

const SCALE_V10_PHILOSOPHY = `## SCALE Engine v10.0 — System Rules

You are operating under SCALE Engine governance. These rules are PHYSICALLY ENFORCED — you cannot bypass them by choice.

### Core Philosophy
- **S**caffold — Every action is scaffolded by artifacts (Spec→Plan→Task→Change→Evidence)
- **C**ontrol — Guardrails physically block dangerous actions; no "soft" suggestions
- **A**rtifact — All work products are tracked artifacts with FSM state machines
- **L**earn — Defects auto-extract to Lessons → Rules → Hooks (evolution loop)
- **E**volve — The system improves itself from mistakes

### Physical Constraints (cannot be bypassed)
🔴 **Dangerous commands** (rm -rf, DROP TABLE, format) are BLOCKED at the gate
🔴 **Hardcoded secrets** (AWS keys, passwords, tokens) are BLOCKED on Edit/Write
🔴 **Unapproved code** — Cannot implement until Spec is FROZEN and Plan is APPROVED
🟡 **Brute retry** — 3+ identical retries detected → forced pause + context injection
🟡 **Premature completion** — Cannot claim "done" without running tests
🟡 **Blame shift** — Detected when AI blames environment without evidence

### Mandatory Workflow
1. **Explore** (role: explorer) — Read/Grep only, no edits
2. **Plan** (role: planner) — Create Spec → refine → approve (guard: ambiguity ≤ 0.2)
3. **Implement** (role: implementer) — Edit/Write/Bash unlocked only after Plan APPROVED
4. **Verify** — Must run build+lint+test before marking task complete
5. **Learn** — Defects auto-extract → lessons → rules → hooks

### Artifact Lifecycle
- Every piece of work is an Artifact with typed FSM transitions
- Guards check quality gates at each transition (ambiguity score, test coverage, etc.)
- Artifacts form a DAG: Need→Insight→Spec→Plan→Task→Change→Evidence
- Challenging a FROZEN Spec invalidates downstream Plans and Tasks

### Self-Evolution
- Defect → Lesson (auto-extracted from root cause)
- Lesson → Rule (promoted by access count + verification)
- Rule → Hook (auto-generated enforcement code)
- The system gets stricter over time, not weaker`

// ============================================================================
// mattpoclock/skills style: Deep Modules + Vertical Slices TDD (Phase 15)
// ============================================================================

const DEEP_MODULES_PRINCIPLE = `## Deep Modules 原则

接口深度 = 调用者杠杆 + 维护者局部性

**删除测试**：如果删除这个模块，调用者需要写多少代码补偿？
- 补偿代码越多 = 模块价值越大
- 补偿代码越少 = 模块可删除

**设计决策**：
- 抓杠杆：接口应该让调用者一次调用完成复杂操作
- 保局部：复杂逻辑隐藏在模块内部，不在接口暴露

**判断标准**：
- 好模块：简单接口，隐藏复杂性（如 fs.readFile(path) vs 手写文件系统）
- 坏模块：复杂接口，暴露内部复杂性（如 10 个参数的 init 函数）

**设计时问自己**：
1. 调用者需要了解多少才能使用？
2. 如果删除，调用者需要补偿多少？
3. 内部实现变更，接口需要变吗？`

const VERTICAL_SLICES_TDD = `## Vertical Slices TDD（Tracer Bullets）

**Wrong（Horizontal）**：
1. 写所有测试
2. 实现所有功能
3. 运行所有测试

**Right（Vertical）**：
1. 选一个行为
2. 写该行为的测试
3. 实现该行为
4. 验证测试通过
5. 下一个行为

**优势**：
- 每个切片独立可验证
- 失败时定位精确
- 避免大爆炸集成
- 早期发现设计问题

**Tracer Bullets 原则**：
- 先打通端到端骨架（可能不完整但可运行）
- 再逐层填充细节
- 每一步都有可验证的产出

**TDD 防幻觉铁律**：
- 绝不能同时写代码和测试！
- 如果先写了有 Bug 的代码，再写测试，会写出"验证错误逻辑"的测试
- 正确做法：测试先行，独立验证
- 测试文件一旦写完，后续实现中禁止修改测试（除非测试本身有错）`

// ============================================================================
// Karpathy Guidelines (andrej-karpathy-skills style)
// ============================================================================

const KARPATHY_PRINCIPLES = `## Karpathy Guidelines — LLM 编码行为准则

源自 Andrej Karpathy 对 LLM 编码陷阱的观察。**倾向谨慎而非速度**。

### 1. Think Before Coding（编码前先思考）
**不做假设。不隐藏困惑。呈现权衡。**

- 显式陈述假设。不确定就问。
- 存在多种解释时全部呈现 — 不要默默选择。
- 如果有更简单方案，说出来。该反驳就反驳。
- 不清楚时停下。命名困惑点。询问。

### 2. Simplicity First（简单优先）
**解决问题的最少代码。拒绝投机性功能。**

- 不写超出需求的功能。
- 单用途代码不抽象化。
- 不添加未请求的"灵活性"或"可配置性"。
- 不处理不可能发生的错误场景。
- 如果 200 行可以写成 50 行，重写它。

**测试**：资深工程师会说"这过度复杂了吗？"如果是，简化。

### 3. Surgical Changes（手术式修改）
**只动必须动的。只清理自己制造的垃圾。**

编辑现有代码时：
- 不要"改进"相邻代码、注释或格式。
- 不要重构未损坏的东西。
- 匹配现有风格，即使你偏好不同写法。
- 注意到无关死代码时提及 — 不要删除。

你的修改产生孤儿时：
- 删除 YOUR 修改导致未使用的导入/变量/函数。
- 不要删除预先存在的死代码（除非被要求）。

**测试**：每行改动应能追溯到用户请求。

### 4. Goal-Driven Execution（目标驱动执行）
**定义成功标准。循环直到验证。**

将任务转化为可验证目标：
- "添加验证" → "为无效输入写测试，然后使测试通过"
- "修复 bug" → "写一个复现它的测试，然后使测试通过"
- "重构 X" → "确保前后测试都通过"

多步骤任务格式：
\`\`\`
1. [步骤] → verify: [检查]
2. [步骤] → verify: [检查]
3. [步骤] → verify: [检查]
\`\`\`

强成功标准让你独立循环。弱标准（"让它工作"）需要频繁澄清。`

// ============================================================================
// Scenario Mode Context Additions
// ============================================================================

const SCENARIO_CONTEXT: Record<ScenarioMode, string> = {
  sandbox: `### Scenario Mode: SANDBOX 🏖️
- Lower detector sensitivity — exploratory work allowed
- Verification NOT required before completion
- Human confirmation NOT required
- Audit trail disabled (lighter weight)
- Max retries: 10 (freedom to experiment)
- Use for: prototyping, exploration, learning`,

  standard: `### Scenario Mode: STANDARD ⚙️
- Medium detector sensitivity — production-quality required
- Verification REQUIRED before completion
- Human confirmation NOT required (trust the process)
- Audit trail ENABLED
- Max retries: 5 (balanced)
- Use for: feature development, bug fixes, regular work`,

  critical: `### Scenario Mode: CRITICAL 🔒
- Maximum detector sensitivity — zero tolerance for errors
- Verification REQUIRED before completion
- Human confirmation REQUIRED for key transitions
- Audit trail ENABLED (comprehensive)
- Max retries: 3 (fail fast, escalate)
- Use for: security changes, production deployments, data migrations`,
}

// ============================================================================
// ContextBuilder
// ============================================================================

export class ContextBuilder implements IContextBuilder {
  private budget = { total: 200_000, reserved: 30_000 }

  constructor(
    private store: IArtifactStore,
    private kb: IKnowledgeBase,
    private eventBus: IEventBus
  ) {}

  async build(opts: { roleId?: string; currentArtifactId?: ArtifactId; sessionId: SessionId; scenarioMode?: ScenarioMode }): Promise<BuiltContext> {
    const scenarioMode = opts.scenarioMode ?? 'standard'
    const layers: ContextLayer[] = []

    // P1: System Rules — SCALE v10.0 Philosophy (always present, highest priority)
    layers.push({
      name: 'system_rules',
      content: SCALE_V10_PHILOSOPHY,
      priority: 1,
      estimatedTokens: 3500,
    })

    // P1.5: Scenario Mode awareness
    layers.push({
      name: 'scenario_mode',
      content: SCENARIO_CONTEXT[scenarioMode],
      priority: 1,
      estimatedTokens: 800,
    })

    // P1.6: Deep Modules Principle (mattpoclock/skills style)
    layers.push({
      name: 'deep_modules',
      content: DEEP_MODULES_PRINCIPLE,
      priority: 1,
      estimatedTokens: 1200,
    })

    // P1.7: Vertical Slices TDD (mattpoclock/skills style)
    layers.push({
      name: 'vertical_slices_tdd',
      content: VERTICAL_SLICES_TDD,
      priority: 1,
      estimatedTokens: 1500,
    })

    // P1.8: Karpathy Guidelines (andrej-karpathy-skills style)
    layers.push({
      name: 'karpathy_guidelines',
      content: KARPATHY_PRINCIPLES,
      priority: 1,
      estimatedTokens: 2000,
    })


    // P1.9: Project Glossary (mattpocock/skills CONTEXT.md style)
    // Reads .scale/GLOSSARY.md for domain terminology injection
    try {
      const glossaryPath = join(process.env.SCALE_DIR ?? '.scale', 'GLOSSARY.md')
      if (existsSync(glossaryPath)) {
        const glossaryContent = readFileSync(glossaryPath, 'utf-8')
        const terms = glossaryContent
          .split('## Language')[1]
          ?.split('## ')[0]
          ?.split('\n')
          ?.filter(l => l.startsWith('**') && l.includes(':'))
          ?.map(l => l.replace(/\*\*/g, '').trim())
          ?.slice(0, 12)
          .join('\n') ?? ''
        if (terms) {
          layers.push({
            name: 'project_glossary',
            content: `## Project Glossary\n${terms}\n\nUse these domain terms exactly. Do not substitute synonyms.`,
            priority: 1,
            estimatedTokens: 600,
          })
        }
      }
    } catch { /* glossary optional */ }

    // P2: Role prompt
    if (opts.roleId) {
      layers.push({ name: 'role_prompt', content: `## Active Role: ${opts.roleId}\n...`, priority: 2, estimatedTokens: 1500 })
    }

    // P3: Current artifact context
    if (opts.currentArtifactId) {
      const artifact = await this.store.get(opts.currentArtifactId)
      if (artifact) {
        layers.push({ name: 'current_artifact', content: `## ${artifact.title}\n${JSON.stringify(artifact.payload, null, 2)}`, priority: 3, estimatedTokens: 5000 })
      }
    }

    // P5: 召回 lessons (W7 集成)
    // Enhanced: Always recall relevant lessons based on tags or artifact context
    const lessons = await this.recallRelevantLessons(opts.currentArtifactId, opts.roleId)
    if (lessons.length > 0) {
      const content = '## 相关历史经验\n' + lessons.map((l) => `- ${l.title} (${l.tags.join(', ')})`).join('\n')
      layers.push({ name: 'recalled_lessons', content, priority: 5, estimatedTokens: 1500 })
    }

    const available = this.budget.total - this.budget.reserved
    const selected: ContextLayer[] = []
    let used = 0
    for (const layer of layers.sort((a, b) => a.priority - b.priority)) {
      if (used + layer.estimatedTokens > available) break
      selected.push(layer)
      used += layer.estimatedTokens
    }

    this.eventBus.emit('context.built', { layers: selected.map((l) => l.name), totalTokens: used, scenarioMode }, { sessionId: opts.sessionId })

    return {
      system: selected.map((l) => l.content).join('\n\n---\n\n'),
      metadata: { totalTokens: used, layers: selected.map((l) => l.name), scenarioMode },
    }
  }

  /**
   * Enhanced lesson recall: based on artifact tags + role context
   */
  private async recallRelevantLessons(currentArtifactId?: ArtifactId, roleId?: string): Promise<KnowledgeEntry[]> {
    const tagsToMatch: string[] = []

    // 1. Extract tags from current artifact
    if (currentArtifactId) {
      const artifact = await this.store.get(currentArtifactId)
      if (artifact?.tags) {
        tagsToMatch.push(...artifact.tags)
      }
      // Also match on artifact type
      if (artifact?.type) {
        tagsToMatch.push(artifact.type)
      }
    }

    // 2. Add role-specific tags
    if (roleId) {
      tagsToMatch.push(`role:${roleId}`)
    }

    // 3. Query verified lessons
    const allLessons = await this.kb.recall({ type: 'lesson', verifiedOnly: true, limit: 10 })

    // 4. If we have tags to match, try to filter by tag overlap
    if (tagsToMatch.length > 0) {
      const scored = allLessons.map(l => ({
        lesson: l,
        score: l.tags.filter(t => tagsToMatch.includes(t)).length
      })).filter(s => s.score > 0)
      scored.sort((a, b) => b.score - a.score)

      // If we found matching lessons, return them
      if (scored.length > 0) {
        return scored.slice(0, 5).map(s => s.lesson)
      }
      // Otherwise, fallback to all verified lessons
    }

    // 5. Fallback: return top verified lessons
    return allLessons.slice(0, 5)
  }

  async getStatus(sessionId: SessionId, roleGate: { getRole(): { id: string; allowedTools: string[]; deniedTools?: string[] } }): Promise<ContextStatus> {
    const role = roleGate.getRole()

    // Query active artifacts for this session (linked via events)
    const events = await this.eventBus.query({
      sessionId,
      types: ['artifact.created', 'artifact.transitioned'],
      limit: 50
    })

    const artifactIds = new Set<ArtifactId>()
    for (const event of events) {
      if (event.artifactId) {
        artifactIds.add(event.artifactId)
      }
    }

    const activeArtifacts = await Promise.all(
      Array.from(artifactIds).map(async (id) => {
        const artifact = await this.store.get(id)
        return artifact ? {
          id: artifact.id,
          type: artifact.type,
          status: artifact.status,
        } : null
      })
    )

    const validArtifacts = activeArtifacts.filter((a) => a !== null) as Array<{ id: ArtifactId; type: string; status: string }>

    // Extract constraints from artifacts and FSM definitions
    const constraints: string[] = []
    for (const artifact of validArtifacts) {
      if (artifact.type === 'Spec' && artifact.status !== 'FROZEN') {
        constraints.push(`Spec must be FROZEN before writing code (current: ${artifact.status})`)
      }
      if (artifact.type === 'Plan' && artifact.status === 'DRAFT') {
        constraints.push(`Plan must be approved before implementation`)
      }
      if (artifact.type === 'Task' && artifact.status === 'TODO') {
        constraints.push(`Task must be READY before implementation`)
      }
    }

    return {
      sessionId,
      role: role.id,
      allowedTools: role.allowedTools,
      deniedTools: role.deniedTools ?? [],
      activeArtifacts: validArtifacts,
      constraints,
    }
  }
}
