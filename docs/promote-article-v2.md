# SCALE Engine —— 认知脚手架驱动的 AI 编码引擎

> **设计理念**：借鉴 OMC/gstack/Superpowers 的最佳实践，自主实现工作流引擎，让 AI 编码更智能、更可控、更可靠。

---

## 🧠 什么是 SCALE Engine？

SCALE Engine 是一个认知脚手架驱动的 AI 编码引擎，帮助开发者：

- **需求精炼**：通过苏格拉底提问，将模糊需求转化为清晰契约
- **质量门控**：7道自动化质量门禁，确保代码质量
- **认知工作流**：5阶段闭环流程，从探索到交付
- **反惰性机制**：检测并纠正 AI 的懒惰行为

---

## 📐 架构设计

### 认知脚手架核心组件

<div style="text-align: center;">
<img src="https://cdn.nlark.com/yuque/0/2026/png/1698739/1778312235122-cfa7ad6c-7420-40dd-9741-2254f6fef5b0.png?x-oss-process=image%2Fformat%2Cwebp" width="400" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
<p style="text-align: center; color: #888; font-size: 14px; margin-top: 8px;">SCALE Engine 认知工作流架构</p>
</div>

---

## 🔧 核心功能

### 1. 需求模糊度评分 (AmbiguityScorer)

7 维度加权评分，精准量化需求清晰度：

| 维度 | 权重 | 说明 |
|------|------|------|
| 目标清晰度 | 20% | 最终状态是否明确 |
| 输入输出边界 | 15% | 数据流是否清晰 |
| 技术栈约束 | 15% | 技术选型是否确定 |
| 时间约束 | 10% | 是否有明确截止日期 |
| 质量标准 | 15% | 性能/安全要求 |
| 风险边界 | 10% | 失败场景是否考虑 |
| 验收标准 | 15% | 可测试的完成条件 |

**阈值门控**：
- ≤20%：直接进入规划
- 20%-40%：启动苏格拉底提问
- >40%：阻断，需人工精炼

---

### 2. 苏格拉底提问器 (SocraticQuestioner)

六问重构框架，逐层精炼模糊需求：

<div style="text-align: center;">
<img src="https://cdn.nlark.com/yuque/0/2026/jpeg/1698739/1778311890484-5f96693f-745c-4ed5-950a-c3143de40811.jpeg?x-oss-process=image%2Fformat%2Cwebp%2Finterlace%2C1" width="450" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
<p style="text-align: center; color: #888; font-size: 14px; margin-top: 8px;">六问重构流程</p>
</div>

- **目标**：你想要达成什么具体结果？
- **约束**：有哪些不可逾越的边界？
- **验收**：如何验证成功？
- **上下文**：现有系统/依赖有哪些需要兼容？
- **风险**：最可能的2种失败场景是什么？
- **优先级**：如果只能完成一半，哪些必须先做？

---

### 3. 质量门控系统 (GateSystem)

7 道自动化质量门禁，层层把关：

| 门控 | 阶段 | 检查内容 |
|------|------|----------|
| G1 | 探索 | 需求文档已阅读 |
| G2 | 规划 | 技术方案已审核 |
| G3 | TDD | 测试先行 |
| G4 | 编码 | Lint 通过 |
| G5 | 编码 | Tests 通过 |
| G6 | 编码 | Coverage ≥80% |
| G7 | 交付 | 安全扫描通过 |

---

### 4. Karpathy 编码原则检查

借鉴 Andrej Karpathy 的编码哲学：

- **K1-THINK**：编码前列出假设
- **K2-SIMPLE**：拒绝不必要的功能
- **K3-SURGICAL**：精准修改，最小变更
- **K4-GOAL**：每次修改有可验证目标

---

### 5. 诚实交付报告 (HonestDelivery)

告别"测试通过"的虚假合规：

- **已完成**：真正通过验证的工作
- **已验证**：工具生成的证据
- **未验证**：⚠️[UNVERIFIED] 标记
- **阻塞项**：需要人工确认的风险

---

## 🚀 快速开始

```bash
# 安装
npm install @hongmaple0820/scale-engine

# 初始化
scale init

# 6 阶段命令
scale define <需求描述>      # 创建 Spec
scale plan <spec-id>          # 创建 Plan
scale build <plan-id>         # 创建 Task
scale verify <task-id>        # 运行门控
scale review                  # 代码审查
scale ship <task-id>          # 提交交付
```

---

## 📊 与 OMC/gstack/Superpowers 对比

| 特性 | SCALE Engine | OMC | gstack | Superpowers |
|------|-------------|-----|--------|-------------|
| 需求精炼 | 苏格拉底六问 | deep-interview | office-hours | brainstorming |
| 质量门控 | 7道门禁 | 自定义 | qa/review | verification |
| 反惰性 | 5种模式检测 | ✅ | ✅ | 1%规则 |
| 自研改进 | ✅ | 外部依赖 | 外部依赖 | 外部依赖 |
| CLI集成 | ✅ | ✅ | ✅ | ❌ |
| MCP集成 | ✅ | ❌ | ❌ | ❌ |

---

## 🔗 社区与联系方式

<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; margin: 20px 0;">

<div style="text-align: center; flex: 1; min-width: 200px;">
<a href="https://qm.qq.com/q/RuCfOyaOUm">
<img src="https://img.shields.io/badge/628043364-blue.svg" alt="加入QQ群" style="height: 28px;">
</a>
<p style="color: #888; font-size: 12px; margin-top: 4px;">QQ群：628043364</p>
</div>

<div style="text-align: center; flex: 1; min-width: 200px;">
<img src="https://cdn.nlark.com/yuque/0/2026/jpeg/1698739/1778311890484-5f96693f-745c-4ed5-950a-c3143de40811.jpeg?x-oss-process=image%2Fformat%2Cwebp%2Finterlace%2C1" width="150" style="max-width: 100%; height: auto;">
<p style="color: #888; font-size: 12px; margin-top: 4px;">飞书群</p>
</div>

<div style="text-align: center; flex: 1; min-width: 200px;">
<img src="https://cdn.nlark.com/yuque/0/2026/png/1698739/1778312235122-cfa7ad6c-7420-40dd-9741-2254f6fef5b0.png?x-oss-process=image%2Fformat%2Cwebp" width="150" style="max-width: 100%; height: auto;">
<p style="color: #888; font-size: 12px; margin-top: 4px;">微信公众号</p>
</div>

</div>

---

## 📝 总结

SCALE Engine 是一个**借鉴学习 → 自主实现 → 自研改进**的 AI 编码引擎：

- 不依赖外部工作流依赖，保持核心能力自主可控
- 集成外部非工作流技能（文档、视频、浏览器、知识图谱）增强能力
- CLI + MCP + Hooks 三层集成，覆盖开发全流程

---

author: 宝玉
need_open_comment: 1
only_fans_can_comment: 0