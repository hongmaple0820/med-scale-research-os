---
name: vibe-templates
description: Access SCALE Engine's 6-phase prompt templates. Use when 
  starting a phase, when user asks for templates, says "give me a PRD",
  "I need a research template", "start the idea phase", "I want a workflow 
  pack". Load specific templates via --phase or get full packs via --pack.
type: component
best_for:
  - quick start for phases
  - template-based development
  - vibe-coder workflow
  - developer workflow
scenarios:
  - User says: "Give me a PRD template"
  - User says: "Start the research phase"
  - User says: "I want the quick-prototype pack"
  - User says: "I'm a vibe-coder, help me"
  - User says: "I need a template for..."
estimated_time: 5 seconds (template loading)
---

# Vibe Templates Registry

## Quick Access

```bash
scale vibe --phase <phase>   # 获取特定阶段模板
scale vibe --pack <pack>     # 获取完整工作流包
scale vibe --user <level>    # 按用户级别定制
```

---

## Phase Decision Tree

### "我有一个想法但很模糊"
→ **idea-validate** template

**用户级别适配**：
- vibe-coder：用简单语言描述验证问题
- developer：包含技术可行性分析
- intermediate：平衡

**加载**：`scale vibe --phase idea`

---

### "我需要研究这个领域"
→ **deep-research** template

**用户级别适配**：
- vibe-coder：聚焦用户研究和市场分析
- developer：包含技术调研和架构研究
- intermediate：平衡

**加载**：`scale vibe --phase research`

---

### "我需要一个 PRD"
→ **prd-mvp** template

**用户级别适配**：
- vibe-coder：简化技术规格
- developer：完整技术细节
- intermediate：平衡

**加载**：`scale vibe --phase prd`

---

### "我需要设计系统规格"
→ **design-system** template

**加载**：`scale vibe --phase design`

---

### "我需要设计 Agent 规格"
→ **agents-design** template

**加载**：`scale vibe --phase agents`

---

### "我需要实现指导"
→ **build-implementation** template

**加载**：`scale vibe --phase build`

---

## Pack Selection Decision Tree

### "我想要完整 MVP 工作流"
→ **full-mvp** pack

**Phases**: idea → research → prd → design → agents → build
**时间**: 数天到数周
**适合**: 完整产品开发

---

### "我想要快速原型"
→ **quick-prototype** pack

**Phases**: prd → agents → build
**时间**: 数小时到数天
**适合**: 快速验证想法

---

### "我是开发者，跳过想法阶段"
→ **developer-path** pack

**Phases**: research → prd → design → agents → build
**时间**: 数天
**适合**: 技术团队

---

### "我是非技术用户，给我简单提示词"
→ **vibe-coder-path** pack

**Phases**: idea → prd → agents → build
**时间**: 数天（更长的验证周期）
**适合**: 非技术用户

---

## User Level Adaptation

| 用户级别 | 特点 | 模板风格 |
|----------|------|----------|
| vibe-coder | 非技术背景 | 简单语言，聚焦业务价值 |
| developer | 技术背景 | 完整技术细节，架构设计 |
| intermediate | 混合背景 | 平衡技术与业务 |

**CLI 使用**：
```bash
scale vibe --phase prd --user vibe-coder
scale vibe --phase research --user developer
```

---

## Template Index

| Phase | Template | User Levels | Token Size |
|-------|----------|-------------|------------|
| idea | idea-validate.md | vibe-coder, developer, intermediate | ~2K |
| research | deep-research.md | developer, intermediate | ~3K |
| prd | prd-mvp.md | vibe-coder, developer, intermediate | ~5K |
| design | design-system.md | developer, intermediate | ~3K |
| agents | agents-design.md | developer | ~4K |
| build | build-implementation.md | developer, intermediate | ~2K |

---

## Progressive Disclosure

主文件（SKILL.md）仅包含决策树。

完整模板存储在 `references/` 目录，LLM 用 Read 工具按需加载：

- idea-validate.md: ~2K tokens
- deep-research.md: ~3K tokens
- prd-mvp.md: ~5K tokens
- design-system.md: ~3K tokens
- agents-design.md: ~4K tokens
- build-implementation.md: ~2K tokens

**总上下文占用**：主文件 + 1-2 个参考文档 ≈ <10K tokens

---

## Usage Examples

### 快速获取 PRD 模板
```bash
scale vibe --phase prd
```

Output:
```
PRD Template Loaded
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase: prd
Template: prd-mvp.md
User level: intermediate (default)

Template content:
[Full template loaded from references/prd-mvp.md]

Tip: Use --user vibe-coder for simplified version
```

### 获取完整 MVP 包
```bash
scale vibe --pack full-mvp
```

Output:
```
Full MVP Pack Loaded
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Pack: full-mvp
Phases: 6 phases (idea → build)
Templates loaded:
  1. idea-validate.md
  2. deep-research.md
  3. prd-mvp.md
  4. design-system.md
  5. agents-design.md
  6. build-implementation.md

Estimated total time: days to weeks
Recommended order: Phase 1 → 2 → 3 → 4 → 5 → 6
```

---

## References

详细模板存储在 `references/` 目录：

- `references/idea-validate.md` — 想法验证模板
- `references/deep-research.md` — 深度研究模板
- `references/prd-mvp.md` — PRD MVP 模板
- `references/design-system.md` — 设计系统模板
- `references/agents-design.md` — Agent 设计模板
- `references/build-implementation.md` — 实现指导模板