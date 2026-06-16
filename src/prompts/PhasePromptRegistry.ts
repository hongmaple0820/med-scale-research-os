// SCALE Engine — Phase Prompt Registry
// 内置高质量提示词模板，让用户一键启动专业工作流
// 参考: easy-vibe (Datawhale) + vibe-coding-prompt-template (KhazP)

import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

// ============================================================================
// 提示词阶段定义
// ============================================================================

/** 6阶段开发流程 */
export type VibePhase =
  | 'idea'      // 0. 想法验证
  | 'research'  // 1. 深度研究
  | 'prd'       // 2. PRD 生成
  | 'design'    // 3. 技术设计
  | 'agents'    // 4. Agent 文件生成
  | 'build'     // 5. 构建 MVP

/** 用户技术背景 */
export type UserLevel = 'vibe-coder' | 'developer' | 'intermediate'

/** 提示词模板元信息 */
export interface PromptTemplate {
  id: string
  phase: VibePhase
  name: string
  description: string
  estimatedTime: string  // 预估时间
  userLevels: UserLevel[]  // 适用用户
  dependencies: VibePhase[]  // 前置阶段
  outputFile?: string  // 输出文件名
  template: string  // 提示词模板内容
}

/** 提示词组合包 */
export interface PromptPack {
  id: string
  name: string
  description: string
  phases: VibePhase[]
  templates: PromptTemplate[]
}

// ============================================================================
// 内置提示词模板库
// ============================================================================

const BUILTIN_PROMPTS: PromptTemplate[] = [
  // ========== Phase 0: Idea Validation ==========
  {
    id: 'idea-validate',
    phase: 'idea',
    name: '想法验证',
    description: '快速验证想法是否值得投入，20分钟',
    estimatedTime: '15-20 min',
    userLevels: ['vibe-coder', 'developer', 'intermediate'],
    dependencies: [],
    outputFile: 'docs/idea-validation.md',
    template: `# 想法验证提示词

我来帮你验证这个想法是否值得投入。请回答以下问题：

**Q1:** 你的应用想法是什么？像向朋友解释一样描述——它解决什么问题？

**Q2:** 谁最需要这个？描述你的理想用户（如"忙碌的父母"、"小企业主"、"学生"）

**Q3:** 已经有什么类似的？列出任何现有的应用或解决方案。

**Q4:** 什么会让用户选择 YOUR 应用？你的独特优势是什么？

**Q5:** 发布时绝对必须的3个功能是什么？只说核心！

**Q6:** 你想象用户如何使用——手机应用、网站还是两者？

**Q7:** 你的时间线是什么？几天、几周还是几个月？

**Q8:** 预算现实检查：你能花钱购买工具/服务，还是需要完全免费？

---

回答完后，我会生成一份想法验证报告，包含：
- 市场可行性评估
- 竞争格局分析
- MVP 范围建议
- 时间/预算预估
`
  },

  // ========== Phase 1: Deep Research ==========
  {
    id: 'deep-research',
    phase: 'research',
    name: '深度研究',
    description: '市场分析、竞品调研、技术选型研究',
    estimatedTime: '20-30 min',
    userLevels: ['developer', 'intermediate'],
    dependencies: ['idea'],
    outputFile: 'docs/research-{AppName}.md',
    template: `# 深度研究提示词

基于你的想法验证结果，我将帮你进行深度研究。

## 请提供以下信息：

**技术背景：**
- A) Vibe-coder — 有想法但编程经验有限
- B) Developer — 有编程经验
- C) 中间 — 知道一些基础但还在学习

请选择 A、B 或 C：

---

## 研究范围定义

为每个领域指定研究深度：
- 市场分析: [Surface/Deep/Comprehensive]
- 技术架构: [Surface/Deep/Comprehensive]
- 竞品分析: [Surface/Deep/Comprehensive]
- 实现方案: [Surface/Deep/Comprehensive]
- 成本分析: [Surface/Deep/Comprehensive]

---

## 研究输出格式

完成后生成结构化研究报告：
1. **市场概况** — 用户规模、增长趋势、痛点分析
2. **竞品矩阵** — 功能对比、定价分析、差异化机会
3. **技术选项** — 架构方案对比（性能/成本/复杂度）
4. **风险清单** — 技术风险、市场风险、合规风险
5. **推荐决策** — 最佳技术栈 + 实施路线

使用 web search 获取最新数据，引用来源 URL 和访问日期。
`
  },

  // ========== Phase 2: PRD Generation ==========
  {
    id: 'prd-mvp',
    phase: 'prd',
    name: 'PRD 生成',
    description: '从研究输出生成结构化 PRD 文档',
    estimatedTime: '15-20 min',
    userLevels: ['vibe-coder', 'developer', 'intermediate'],
    dependencies: ['research'],
    outputFile: 'docs/PRD-{AppName}-MVP.md',
    template: `# PRD 生成提示词

基于你的研究报告，我将帮你生成 MVP PRD 文档。

## 输入文件
请确认已准备好以下文件：
- docs/research-{AppName}.md (研究成果)

## PRD 结构

生成的 PRD 将包含以下章节：

### 1. 产品概述
- 产品名称与定位
- 目标用户画像
- 核心价值主张

### 2. 功能规格
按优先级排列功能列表：
| 功能 | 优先级 | 描述 | 验收标准 |
|------|--------|------|----------|

### 3. 非功能需求
- 性能要求（响应时间、并发数）
- 安全要求（认证、数据保护）
- 可用性要求（UI/UX 标准）

### 4. 数据模型
- 核心实体定义
- 关系图
- 存储方案

### 5. 接口设计
- API 端点列表
- 请求/响应格式
- 错误处理约定

### 6. 约束与风险
- 时间约束
- 技术约束
- 已识别风险

### 7. 验收标准
- 功能验收清单
- 性能验收指标
- 用户验收流程

---

请确认以上结构是否符合需求，然后我将基于研究内容填充各章节。
`
  },

  // ========== Phase 3: Technical Design ==========
  {
    id: 'tech-design',
    phase: 'design',
    name: '技术设计',
    description: '技术栈选型、架构设计、实施计划',
    estimatedTime: '15-20 min',
    userLevels: ['developer', 'intermediate'],
    dependencies: ['prd'],
    outputFile: 'docs/TechDesign-{AppName}-MVP.md',
    template: `# 技术设计提示词

基于你的 PRD，我将帮你制定技术设计方案。

## 输入文件
请确认已准备好：
- docs/PRD-{AppName}-MVP.md

## 技术设计结构

### 1. 技术栈决策

请提供以下偏好信息：
- **预算类型:** [免费/低成本/生产级]
- **时间约束:** [几天/几周/几个月]
- **复杂度容忍:** [简单优先/功能完整/高度定制]

基于以上信息，我将推荐：

| 层级 | 推荐方案 | 理由 | 替代方案 |
|------|----------|------|----------|
| 前端 |          |      |          |
| 后端 |          |      |          |
| 数据库 |         |      |          |
| 部署 |          |      |          |
| 认证 |          |      |          |
| 支付 |          |      |          |

### 2. 架构设计

生成架构图（ASCII/Mermaid）：
- 系统边界图
- 数据流图
- 部署架构图

### 3. 目录结构

推荐的项目骨架：
\`\`\`
your-app/
├── src/
│   ├── components/
│   ├── pages/
│   ├── services/
│   └── utils/
├── docs/
│   ├── PRD-*.md
│   └── TechDesign-*.md
├── AGENTS.md
├── MEMORY.md
└── specs/
\`\`\`

### 4. 实施计划

将 PRD 功能分解为开发阶段：
| 阶段 | 功能 | 预估工时 | 依赖 |
|------|------|----------|------|

### 5. 安全与合规

- 认证方案选择
- 数据保护策略
- 合规检查清单

### 6. 成本预估

| 项目 | 预估成本 | 说明 |
|------|----------|------|

---

请确认技术栈偏好，然后我将生成完整技术设计文档。
`
  },

  // ========== Phase 4: Agent Files ==========
  {
    id: 'agent-files',
    phase: 'agents',
    name: 'Agent 文件生成',
    description: '生成 AGENTS.md + agent_docs/ 目录',
    estimatedTime: '1-2 min',
    userLevels: ['vibe-coder', 'developer', 'intermediate'],
    dependencies: ['prd', 'design'],
    outputFile: 'AGENTS.md',
    template: `# Agent 文件生成指令

根据已有的 PRD 和技术设计，生成以下文件：

## 要生成的文件

1. **AGENTS.md** — 主契约文件（AI 通用指令）
2. **agent_docs/** 目录：
   - tech_stack.md
   - code_patterns.md
   - project_brief.md
   - product_requirements.md
   - testing.md
3. **MEMORY.md** — 会话延续文件

## AGENTS.md 结构模板

\`\`\`markdown
# AGENTS.md — {AppName} Master Plan

## Project Overview & Stack
**App:** {AppName}
**Overview:** {One-paragraph description}
**Stack:** {Tech stack list}
**Critical Constraints:** {Key constraints}

## Setup & Commands
- **Setup:** \`npm install\`
- **Development:** \`npm run dev\`
- **Testing:** \`npm test\`
- **Linting:** \`npm run lint\`
- **Build:** \`npm run build\`

## Protected Areas
Do NOT modify without explicit approval:
- Infrastructure: \`infrastructure/\`
- Database migrations
- Payment/Auth configurations

## Coding Conventions
- Formatting: ESLint/Prettier rules
- Architecture: Feature-based folders
- Testing: All utilities must have unit tests
- Types: Strict TypeScript, no \`any\`

## Agent Behaviors
1. Plan Before Execution — Always propose plan first
2. Refactor Over Rewrite — Prefer incremental changes
3. Context Compaction — Write to MEMORY.md instead of chat history
4. Iterative Verification — Run tests after each change
5. Team Coordination — Lead approves teammate plans
\`\`\`

---

请读取 docs/PRD-{AppName}-MVP.md 和 docs/TechDesign-{AppName}-MVP.md，然后填充模板生成文件。
`
  },

  // ========== Phase 5: Build MVP ==========
  {
    id: 'build-mvp',
    phase: 'build',
    name: '构建 MVP',
    description: '分阶段构建 MVP，验证驱动',
    estimatedTime: '1-3 hrs',
    userLevels: ['vibe-coder', 'developer', 'intermediate'],
    dependencies: ['agents'],
    outputFile: '',
    template: `# 构建 MVP 提示词

现在开始构建 MVP。按照以下流程进行：

## 构建原则

1. **分阶段迭代** — 每次只构建一个功能
2. **验证驱动** — 每个阶段完成后验证测试
3. **人工确认** — 重大修改前等待确认

## 推荐构建循环

\`\`\`
Plan → Execute → Verify → Repeat
\`\`\`

## 首次命令

请读取 AGENTS.md，提出第一阶段实施计划，等待我批准后开始逐步构建。

计划应包含：
- 阶段目标（本次要完成的功能）
- 文件变更列表（预计修改哪些文件）
- 验收标准（如何验证完成）

---

## 构建检查清单

每阶段完成后检查：
- [ ] 功能按 PRD 规格实现
- [ ] 测试通过（单元/集成）
- [ ] 无 lint 错误
- [ ] 类型检查通过
- [ ] 手动验证可用

## 阶段完成信号

完成后输出：
\`\`\`
✅ Phase X 完成
- 变更文件: [文件列表]
- 测试状态: [通过/失败]
- 下阶段建议: [Phase Y: 功能描述]
\`\`\`

---

请开始第一阶段计划。
`
  },
]

// ============================================================================
// 预定义提示词组合包
// ============================================================================

const BUILTIN_PACKS: PromptPack[] = [
  {
    id: 'full-mvp',
    name: '完整 MVP 工作流',
    description: '从想法到 MVP 的完整 6 阶段流程',
    phases: ['idea', 'research', 'prd', 'design', 'agents', 'build'],
    templates: BUILTIN_PROMPTS,
  },
  {
    id: 'quick-prototype',
    name: '快速原型',
    description: '跳过研究，直接进入 PRD → Build',
    phases: ['prd', 'agents', 'build'],
    templates: BUILTIN_PROMPTS.filter(t => ['prd', 'agents', 'build'].includes(t.phase)),
  },
  {
    id: 'developer-path',
    name: '开发者路径',
    description: '适合有经验的开发者，跳过入门阶段',
    phases: ['research', 'prd', 'design', 'agents', 'build'],
    templates: BUILTIN_PROMPTS.filter(t => t.phase !== 'idea'),
  },
  {
    id: 'vibe-coder-path',
    name: 'Vibe Coder 路径',
    description: '面向初学者，完整引导流程',
    phases: ['idea', 'prd', 'agents', 'build'],
    templates: BUILTIN_PROMPTS.filter(t => ['idea', 'prd', 'agents', 'build'].includes(t.phase)),
  },
]

// ============================================================================
// PhasePromptRegistry 类
// ============================================================================

export class PhasePromptRegistry {
  private prompts: Map<string, PromptTemplate> = new Map()
  private packs: Map<string, PromptPack> = new Map()
  private projectDir: string

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir
    this.loadBuiltin()
    this.loadCustom()
  }

  private loadBuiltin(): void {
    for (const prompt of BUILTIN_PROMPTS) {
      this.prompts.set(prompt.id, prompt)
    }
    for (const pack of BUILTIN_PACKS) {
      this.packs.set(pack.id, pack)
    }
  }

  private loadCustom(): void {
    // 加载项目自定义提示词: .scale/prompts/*.md
    const promptsDir = join(this.projectDir, '.scale', 'prompts')
    if (existsSync(promptsDir)) {
      // TODO: 扫描并加载自定义提示词
    }

    // 加载用户全局自定义提示词: ~/.claude/prompts/*.md
    const globalDir = join(homedir(), '.claude', 'prompts')
    if (existsSync(globalDir)) {
      // TODO: 扫描并加载全局自定义提示词
    }
  }

  // ========== API ==========

  getPrompt(id: string): PromptTemplate | undefined {
    return this.prompts.get(id)
  }

  getPromptByPhase(phase: VibePhase): PromptTemplate[] {
    return BUILTIN_PROMPTS.filter(p => p.phase === phase)
  }

  getPack(id: string): PromptPack | undefined {
    return this.packs.get(id)
  }

  listPrompts(): PromptTemplate[] {
    return Array.from(this.prompts.values())
  }

  listPacks(): PromptPack[] {
    return Array.from(this.packs.values())
  }

  /** 获取下一阶段的提示词 */
  getNextPrompt(currentPhase: VibePhase): PromptTemplate | undefined {
    const phaseOrder: VibePhase[] = ['idea', 'research', 'prd', 'design', 'agents', 'build']
    const currentIndex = phaseOrder.indexOf(currentPhase)
    if (currentIndex === -1 || currentIndex === phaseOrder.length - 1) return undefined
    const nextPhase = phaseOrder[currentIndex + 1]
    return this.getPromptByPhase(nextPhase)[0]
  }

  /** 生成阶段提示词（带上下文填充） */
  generatePrompt(
    promptId: string,
    context: {
      appName?: string
      userLevel?: UserLevel
      previousOutputs?: Record<VibePhase, string>
    }
  ): string {
    const prompt = this.prompts.get(promptId)
    if (!prompt) return ''

    let template = prompt.template

    // 填充应用名称
    if (context.appName) {
      template = template.replace(/\{AppName\}/g, context.appName)
    }

    // 添加前置阶段输出引用
    if (prompt.dependencies.length > 0 && context.previousOutputs) {
      const deps = prompt.dependencies
        .map(phase => context.previousOutputs?.[phase])
        .filter(Boolean)
        .join('\n\n')
      if (deps) {
        template = `\`\`\`前置阶段输出\`\`\`\n${deps}\n\n---\n\n${template}`
      }
    }

    return template
  }

  /** 导出提示词到文件 */
  exportPrompt(promptId: string, outputPath: string): void {
    const prompt = this.prompts.get(promptId)
    if (!prompt) return
    // TODO: 写入文件
  }

  /** 生成阶段索引 Markdown */
  generateIndexMd(): string {
    const lines = [
      '# SCALE Engine 提示词模板库\n\n',
      '> 内置高质量提示词，让用户一键启动专业工作流\n\n',
      '## 可用提示词组合包\n\n',
    ]

    for (const pack of this.listPacks()) {
      lines.push(`### ${pack.name}\n\n`)
      lines.push(`**描述:** ${pack.description}\n\n`)
      lines.push(`**阶段:** ${pack.phases.join(' → ')}\n\n`)
      lines.push(`**使用:** \`scale vibe --pack ${pack.id}\`\n\n`)
    }

    lines.push('## 单阶段提示词\n\n')

    for (const prompt of this.listPrompts()) {
      lines.push(`| ${prompt.phase} | ${prompt.name} | ${prompt.estimatedTime} | \`scale vibe --phase ${prompt.phase}\` |\n`)
    }

    return lines.join('')
  }
}

// ============================================================================
// 导出
// ============================================================================

export { BUILTIN_PROMPTS, BUILTIN_PACKS }
export type { PromptTemplate as PhasePromptTemplate }