---
name: qa-checklist
description: 每阶段完成前的检查清单 — 逐项核对，全部通过才能交付
---

# QA 检查清单

## 通用检查（所有阶段必须通过）
- [ ] 所有数值型数据点有原始 API 返回佐证
- [ ] 无编造的数据点（对照 API 返回逐一核对）
- [ ] 所有图表有数据来源标注
- [ ] 术语表一致（同一概念全报告用同一术语）
- [ ] 置信度标注完整（HIGH/MEDIUM/LOW/SPECULATIVE）
- [ ] 缺失数据用占位符，不用编造
- [ ] 所有 p 值有统计方法说明（检验类型 + 校正方法）
- [ ] 所有 HR/OR 有 95% CI

## Phase 1 专项
- [ ] tau_index 计算正确: τ = Σ(1-xi) / (n-1)
- [ ] TCGA 差异表达有 BH 校正
- [ ] 生存分析有 Cox PH + KM
- [ ] 免疫相关性有 FDR 校正
- [ ] TME 分型有明确判定依据

## Phase 2 专项
- [ ] Open Targets score 有 datatype 分解
- [ ] 可成药性分类有依据（Tclin/Tchem/Tbio/Tdark）
- [ ] 遗传约束数据（pLI/LOEUF）有来源

## Phase 3 专项
- [ ] 临床试验来自 ClinicalTrials.gov v2 API
- [ ] 药物机制来自 ChEMBL
- [ ] 文献引用有 PMID 验证
- [ ] 专利数据有来源标注

## Phase 4 专项
- [ ] 里程碑基于同类药物历史数据
- [ ] 市场数据有来源
- [ ] 风险覆盖技术/商业/监管三维度
