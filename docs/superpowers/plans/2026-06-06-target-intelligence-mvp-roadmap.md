# Target Intelligence — MVP → 完整 可执行路线图

> **日期**: 2026-06-06
> **定位**: 把 `skills/target-intelligence` 从"能跑的原型"做成"医学研究者/投资方敢信的平台"
> **与已有文档关系**:
> - `skills/target-intelligence/REBUILD_PLAN.md`(2026-06-01) — 残酷复盘 + API 门控 + 黄金标准（方法论：数据准确性工程）
> - `docs/superpowers/specs/2026-06-05-target-intelligence-v2-design.md` — 分层指令治理防幻觉
> - **本文** = 把上面两套合并成一条"MVP→完整"的执行线，并补上**需求 2（真·新靶点发现）**这块缺口。

---

## 0. 决策输入（已与作者确认 2026-06-06）

| 项 | 结论 |
|----|------|
| 研发重心 | **两者都要**：先把小分子/抗体（泛癌种）跑通，再扩 CAR-T / 细胞治疗 |
| 黄金基准 | **EGFR/LUAD 当教科书答案 + KRAS/PAAD 当第二回归用例** |
| 可用模型 | qwen(plus/max)、Gemini、DeepSeek(V3/R1)、Claude/GPT —— **分层路由完全可落地** |
| 复用仓库 | `E:\OpenBioMed`、`E:\OpenClaw-Medical-Skills` **均已不存在** → Wave 2/3 不能复用，需自建 |
| 运行环境 | Python 3.12.4 ✅ |

---

## 1. 现状快照（实测，2026-06-06）

### 1.1 结构完整度：V2 已全量搭好
manifest 路由、6 个 static 防幻觉规则、4 个 phase guide、SQLite 缓存、交叉验证器、异步任务、checkpoint、Nature PPTX 均已存在。
**结论：问题是"产出可信度/质量"，不是"功能缺失"。**

### 1.2 数据源连通性（用仓库自带 `APIGate` 端点 + 强制绕过本地代理实测）

| 源 | 状态 | 源 | 状态 |
|----|------|----|------|
| GTEx | ✅ ok | STRING | ✅ ok |
| cBioPortal | ✅ ok | PubMed | ✅ ok |
| ChEMBL | ✅ ok | OpenTargets | ✅ ok |
| ClinicalTrials | ✅ ok | DisGeNET | ❌ ProxyError（疑似转商业+需 key） |
| UniProt | ✅ ok | canSAR | ❌ SSLError（端点证书/迁移） |

**8/10 可直连。** 重要边界：连通 ≠ 数据正确，正确性由 Wave 0 黄金标准校验把关。
> 复现命令（本机）：清掉 `*_proxy` 环境变量后 `python -c "from shared.api_client import APIGate; APIGate.print_report()"`。注意 Windows 上 `requests` 会读注册表代理，`APIGate` 需加 `proxies` / `trust_env=False` 选项（见 T0.1）。

---

## 2. 两个核心判断

### 2.1 主线：从"能跑"到"可信"
作者不满意的三件事（幻觉 / 数据不权威 / 产出不标准）本质是**信任问题**。解法不是加功能，而是把 `anti-hallucination.md` 的纸面约定，变成**API 门控 + 黄金标准回归 + provenance 审计**这三道自动证据。

### 2.2 最高价值缺口：需求 2 目前没真正实现
`run_phase2.py` = "Open Targets 关联评分排序 + Pharos 成药性"，本质是**对已知靶点排序**；Open Targets 永远返回已知关联，无法"发现未知新靶点"。
真正的新靶点发现链路（疾病 vs 正常差异表达 → 候选 → 成药性/表面定位过滤 → 回灌 Phase 1 预后验证）目前缺失——`differential_expression.py` 存在但孤立、可选。**这是科学价值最高、当前最弱的一环，单列 Wave 2b。**

---

## 3. 模型分层路由（所有模型可用，给出落地配置）

| 环节 | 推荐模型 | 理由 |
|------|----------|------|
| Phase 1-2 编排 / API 调用 / 填 Schema（调用量最大） | qwen-plus（默认）→ 漂移则 qwen-max / DeepSeek-V3 | 便宜、工具调用稳、JSON 稳、中文好 |
| 文献深挖（PubMed 多轮、读全文） | **Gemini**（长上下文） | 作者已验证、引用谨慎、幻觉低 |
| Phase 3 综合研判（可开发性/痛点/突破） | DeepSeek-R1 / Gemini 2.5 Pro / Claude | 强推理 + 跨证据整合 |
| Phase 4 商业/投融资研判 | 强推理档 + **人工签字** | 推理 + 行业常识，主观性高 |
| 反幻觉 / Schema / provenance 校验 | **代码规则（非 LLM）** | 确定性，不能交给模型 |

**首测**：先用 qwen-plus 在 EGFR/LUAD 黄金用例上压测"工具调用 + JSON 稳定性"；不稳就升档。
**`[UNCERTAIN]` 待确认**：Hermes 是否支持"按 phase 切换模型"。支持 → 直接按上表；不支持 → 各 phase 脚本内直接调对应模型 API 端点。

---

## 4. 路线图总表

| 波次 | 验收口径（Definition of Done） | 对应需求 | 该波新增工具 |
|------|------|------|------|
| **Wave 0 · 可信地基(MVP)** | EGFR/LUAD + KRAS/PAAD 的 **Phase 1** 通过黄金标准自动校验，且每个数值带 provenance+置信度 | 需求1地基 | —（先把已接好的源跑实） |
| **Wave 1 · Phase 1 全量可信** | 表达+预后+免疫 全部 ≥2 源交叉验证，Nature-style 图，冲突标红 | 需求1 | HPA/ProteomicsDB(蛋白)、KM-Plotter/PRECOG(预后交叉)、TISIDB(免疫交叉) |
| **Wave 2a · 已知靶点排序** | Open Targets + Pharos 排序稳定可信（基本完成，做硬化） | 需求2 | Enrichr(通路) |
| **Wave 2b · 真·新靶点发现** | 输入疾病→差异表达→过滤→**回灌 Phase 1 验证**→新颖候选清单 | **需求2 核心** | GEO/cBioPortal 差异表达、DepMap、(CAR-T)表面组 + CARTAR/CARTiBASE/Beacon |
| **Wave 3 · 深度调研** | 功能/机制/管线/专利/公司 全部可点击溯源(PMID/NCT/专利号)，研判带依据 | 需求3 | UniProt+STRING+GO+AlphaFold 百科、PatentsView/Lens(换 USPTO)、canSAR(待修)、Cortellis(需授权) |
| **Wave 4 · 商业/投融资** | 里程碑由 Phase1-3 数据驱动(非硬编码)，估算明确标注为假设 | 需求4 | 同类药历史数据、市场来源标注 |

执行顺序：Wave 0 → 1 → 2a → 2b → 3 → 4；横切项(第 7 节)贯穿每一波。

---

## 5. Wave 0（MVP）任务清单

> 目标：不加功能，只做到"敢相信报告里每个数字"。

- [ ] **T0.1 修 APIGate 环境稳健性**：增加 `proxies` / `trust_env=False` 选项（Windows 注册表代理导致自检全 FAIL）；把 DisGeNET(转商业)、canSAR(SSL) 标 known-issue 并提供降级。
- [ ] **T0.2 黄金标准 → 自动化测试**：把 `REBUILD_PLAN §9.2` 落成 `tests/golden/`：
  - EGFR/LUAD：GTEx 肺/皮肤 TPM 在范围、OT 肺癌评分 > 阈值、ClinicalTrials 计数下限、已知药(erlotinib/gefitinib/osimertinib)存在
  - KRAS/PAAD：作为第二回归用例
- [ ] **T0.3 Phase 1 三脆弱点出真数**：确认/修复 `tcga_analysis.py`(走 cBioPortal)、`survival_analysis.py`、`immune_correlation.py`(TIMER)，EGFR/LUAD 端到端无空壳。
- [ ] **T0.4 provenance 审计**：扫描 Phase 1 输出 JSON，确认每个数值字段含 `source/api_url/timestamp/confidence`，缺失即补或标占位符。
- [ ] **T0.5 反幻觉门禁（代码化）**：写校验器，按 `anti-hallucination.md`+`schema-definitions.md` 自动检查输出——无裸数字、无禁用模糊词("通常/研究表明")、HR/OR 带 CI。
- [ ] **Gate**：两个黄金用例全绿 + provenance 审计 100% 通过，才算 Wave 0 完成。

---

## 6. Wave 2b — 真·新靶点发现 技术方案

**输入**：疾病/适应症（可无已知靶点）

1. **差异表达发现**：TCGA(cBioPortal) + GEO 取 疾病 vs 正常，算 log2FC / FDR(BH)，取显著上调集合。
2. **候选过滤**（多维打分）：
   - 成药性：Open Targets tractability / Pharos(Tclin-Tdark) / canSAR ligandability(待修)
   - 安全窗口：GTEx 正常组织低表达 + tau 特异性指数
   - 定位：UniProt 亚细胞定位（**抗体/CAR-T 必须细胞表面**）
   - 依赖性：DepMap CRISPR 基因效应（肿瘤是否真依赖）
3. **新颖性判定**：与 Open Targets 已知关联取**差集**，标"已知/新颖"，新颖候选优先。
4. **回灌 Phase 1**：对 Top 新颖候选跑 表达+预后+免疫，确认重要性 —— 正是需求 2 要的"再做预后/疾病相关性"。
5. **证据分级 + 人工筛选**（human-in-loop）。

**CAR-T 扩展（重心第二步）**：表面组优先；用 CARTAR/CARTiBASE/Beacon 比对已有 CAR-T 靶点，避开红海、找差异化。
**注意**：DepMap/GEO 多为批量下载而非 REST API；canSAR 当前 SSL 不通，需先修或换源。

---

## 7. 横切关注点（每波都要）

1. **模型路由**：按第 3 节；Phase 1-2 省钱、Phase 3-4 砸强模型，叠加已有缓存控成本。
2. **黄金标准回归**：每波"完成"= 黄金用例自动校验通过，而非"我觉得跑通了"。
3. **人机协同**：Phase 3-4 定位"高质量草稿 + 人工签字"，不是结论。
4. **诚实占位**：缺数据用 `[DATA_NOT_AVAILABLE]`，绝不用模型知识补。

---

## 8. 风险与未决

| 项 | 状态 / 缓解 |
|----|------|
| DisGeNET 转商业、需 API key | 用 Open Targets genetic evidence 替代，或申请 key |
| canSAR SSL 不通 | 修证书/换端点，或暂用 Open Targets+Pharos 覆盖成药性 |
| 复用仓库已失踪 | Wave 2/3 自建 pubmed-search / 证据分级模块 |
| Hermes 能否按 phase 路由模型 `[UNCERTAIN]` | 决定模型路由的实现方式 |
| 连通 ≠ 数据正确 | 黄金标准校验为真正闸门 |
| Phase 3-4 强模型成本 | 缓存 + 同基因+疾病 7 天不重复 |

---

## 9. 待作者确认

- Wave 0 是否就按 EGFR/LUAD + KRAS/PAAD 开工？
- Hermes 是否支持按阶段切换模型？（决定路由落地方式）
- DisGeNET / canSAR 是修复还是先用替代源跳过？
