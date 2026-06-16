# 靶点情报系统重建方案 v2.0

> **目标**：将 target-intelligence 从"原型演示"升级为"医学研究者可信赖的靶点分析平台"
> **原则**：数据准确 > 功能全面 > 界面美观
> **日期**：2026-06-01

---

## 一、反思：为什么上次实现质量差

### 1.1 根因分析

| 问题 | 根因 | 教训 |
|------|------|------|
| 5 个 Phase 1 分析中 4 个是空壳 | 先写了框架再找 API，发现 API 不通就留了占位符 | **必须先验证 API 可用性，再写代码** |
| TCGA/GDC 查询返回 0 结果 | 没有查阅 GDC API 文档就猜字段名 | **每个 API 调用必须对照官方文档** |
| HPA 脚本完全是空函数 | 知道 HPA 没有 REST API 但仍保留了"交叉验证"的承诺 | **不能用虚假承诺填充报告** |
| 竞品分析混入无关试验 | ClinicalTrials.gov 搜索没有过滤条件 | **数据必须经过相关性过滤才能进入报告** |
| Phase 4 完全是硬编码模板 | 没有设计数据流从 Phase 1-3 到 Phase 4 的管道 | **每个阶段的输出必须是下一阶段的输入** |
| 无测试、无验证 | 赶进度跳过了验证环节 | **每个脚本必须有端到端测试用例** |

### 1.2 核心教训

```
❌ 错误做法：写代码 → 假设 API 会工作 → 发现不通 → 留占位符 → 声称完成
✅ 正确做法：验证 API → 写最小可行代码 → 用真实数据测试 → 确认输出正确 → 才算完成
```

---

## 二、总体架构设计

### 2.1 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    用户输入: 靶点 + 疾病                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Pipeline Orchestrator                        │
│  (Python, 顺序执行四阶段, 每阶段有门控检查)                    │
└──┬──────────┬──────────┬──────────────┬──────────────────────┘
   │          │          │              │
   ▼          ▼          ▼              ▼
Phase 1     Phase 2     Phase 3       Phase 4
表达谱       筛选        深度调研       商业计划
   │          │          │              │
   ▼          ▼          ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                   共享基础设施层                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │API客户端  │ │数据校验器│ │报告生成器│ │可视化引擎│       │
│  │(带缓存)   │ │(交叉验证)│ │(HTML/MD) │ │(Plotly)  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    输出层                                     │
│  index.html (交互式仪表板) + JSON数据 + PDF报告 + 图表        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

1. **数据准确性第一**：每个 API 调用必须有官方文档 URL 注释，返回数据必须有 schema 校验
2. **失败即失败**：API 不通时明确报告"数据不可用"，不用假数据或空壳填充
3. **交叉验证**：关键数据（表达、生存）必须从 2+ 数据源获取并比对
4. **可追溯性**：每个数据点必须有 provenance（来源、时间、查询参数、API 版本）
5. **渐进式输出**：每完成一个阶段就生成该阶段的独立报告，不依赖后续阶段

---

## 三、数据源权威性矩阵

### 3.1 一级数据源（必须接入，数据直接用于分析）

| 数据源 | 用途 | API 类型 | 状态 | 官方文档 |
|--------|------|----------|------|----------|
| **GTEx Portal API v8** | 正常组织表达谱 | REST | ✅ 已验证可用 | gtexportal.org/home/documentationPage |
| **GDC Data Portal** | TCGA 肿瘤表达/临床 | REST | ⚠️ 需修复查询 | docs.gdc.cancer.gov/API/Users_Guide/Getting_Started |
| **Open Targets GraphQL** | 靶点-疾病关联评分 | GraphQL | ✅ 已验证可用 | platform.opentargets.org/api |
| **ChEMBL REST API** | 药物机制/活性数据 | REST | ⚠️ 需修复查询 | chembl.gitbook.io/chembl-interface-documentation |
| **ClinicalTrials.gov v2** | 临床试验数据 | REST | ✅ 已验证可用 | clinicaltrials.gov/data-api/about-api |
| **PubMed E-utilities** | 文献检索 | REST | ✅ 已验证可用 | ncbi.nlm.nih.gov/books/NBK25500 |

### 3.2 二级数据源（优先接入，用于交叉验证和补充）

| 数据源 | 用途 | API 类型 | 状态 | 备注 |
|--------|------|----------|------|------|
| **Pharos/TIGA** | 成药性分类 (Tclin/Tchem) | REST | ⚠️ 需验证 | 可用 Open Targets tractability 替代 |
| **UniProt REST API** | 蛋白序列/功能注释 | REST | ✅ 可用 | 当前代码已配置但未使用 |
| **STRING API** | 蛋白互作网络 | REST | ✅ 可用 | 当前代码已配置但未使用 |
| **cBioPortal** | 肿瘤基因组学 | REST | ✅ 可用 | 替代 GDC 的差异化分析 |
| **PRECOG** | 预后基因签名 | 文件下载 | ⚠️ 需验证 | 需下载预计算矩阵 |
| **HPA (非 API)** | 蛋白表达验证 | 网页抓取 | ❌ 无 REST API | 改用 ProteomicsDB 或直接移除 |

### 3.3 三级数据源（可选接入，用于深度调研）

| 数据源 | 用途 | 备注 |
|--------|------|------|
| **USPTO/PatentsView** | 专利分析 | 当前 API 503，需找替代方案 |
| **OpenAlex** | 学术文献图谱 | 可替代 PubMed 做引用分析 |
| **DrugBank** | 药物详细信息 | 需学术许可 |
| **canSAR** | 靶点可药性 | 需验证 API 可用性 |
| **DepMap** | 肿瘤依赖性 | CRISPR 筛选数据 |

---

## 四、Phase 1 重建方案：靶点表达全景与预后挖掘

### 4.1 子模块 1：GTEx 组织表达谱（保留，增强）

**当前状态**：✅ 可工作，但需增强

**需要修复**：
1. 将 `datasetId=gtex_v8` 改为可配置参数（文档应如实标注版本）
2. 添加表达值范围校验（TPM 应在 0-100000 范围内）
3. 添加跨数据库比对逻辑（与 cBioPortal 或 ProteomicsDB 比对）

**增强项**：
- 添加组织特异性评分（tissue specificity score, tau index）
- 标注该靶点在哪些组织中高表达（> 均值 2 倍）
- 生成交互式 Plotly 柱状图（替代静态 PNG）

**API 调用规范**：
```python
# 官方文档: https://gtexportal.org/home/documentationPage
# API v2 端点
GENE_SEARCH = "https://gtexportal.org/api/v2/reference/gene"
EXPRESSION = "https://gtexportal.org/api/v2/expression/medianGeneExpression"

# 参数说明:
#   datasetId: "gtex_v8" (GTEx Analysis Release V8)
#   gencodeId: Ensembl ID with version, e.g. "ENSG00000146648.17"
#   tissueSiteDetailId: 可选，指定组织
```

**数据校验规则**：
```python
def validate_gtex_response(data: dict) -> list[str]:
    errors = []
    if "data" not in data:
        errors.append("Missing 'data' field in GTEx response")
    for item in data.get("data", []):
        if "median" not in item:
            errors.append(f"Missing 'median' in tissue record")
        elif not (0 <= item["median"] <= 100000):
            errors.append(f"TPM value {item['median']} out of expected range")
    return errors
```

### 4.2 子模块 2：HPA 蛋白验证（替换方案）

**当前状态**：❌ 完全不工作（空函数）

**问题**：HPA 没有公开 REST API。

**解决方案**：采用三层替代策略

```
优先级 1: ProteomicsDB API (proteomicsdb.org)
  - 有 REST API，提供蛋白定量数据
  - 需要注册获取 API key
  - 查询: /api/protein/{accession}/expression

优先级 2: PaxDb (pax-db.org)
  - 蛋白丰度数据库，有 API
  - 查询: /api/protein/{accession}

优先级 3: 标注为"蛋白表达数据待补充"
  - 不伪造数据，明确标注数据缺失
  - 提供 HPA 网页链接供手动查阅
```

**代码实现要点**：
```python
def query_protein_expression(gene_symbol: str) -> dict:
    """
    三层尝试获取蛋白表达数据:
    1. ProteomicsDB -> 2. PaxDb -> 3. 返回不可用声明
    """
    # 尝试 ProteomicsDB
    try:
        result = proteomicsdb_client.get(f"/api/protein/{gene_symbol}/expression")
        if result and result.get("data"):
            return {"source": "ProteomicsDB", "data": result["data"], "status": "ok"}
    except Exception:
        pass

    # 尝试 PaxDb
    try:
        result = paxdb_client.get(f"/api/protein/{gene_symbol}")
        if result and result.get("abundances"):
            return {"source": "PaxDb", "data": result["abundances"], "status": "ok"}
    except Exception:
        pass

    # 明确报告不可用
    return {
        "source": None,
        "data": None,
        "status": "unavailable",
        "note": "蛋白表达数据暂不可用，请手动查阅 https://www.proteinatlas.org/",
        "manual_url": f"https://www.proteinatlas.org/{gene_symbol}"
    }
```

### 4.3 子模块 3：TCGA 肿瘤差异表达（重写）

**当前状态**：❌ API 查询字段名错误，返回 0 结果

**问题根因**：GDC API 的 `filters` 使用了错误的字段名。缓存证据显示 API 返回 `"unrecognized values: [gene_expression.tpm_unstrand, cases.sample_type, ...]"`。

**解决方案**：采用 cBioPortal API 替代 GDC 直接查询

```
为什么用 cBioPortal 而不是 GDC:
1. cBioPortal 有预处理的表达矩阵，无需下载原始文件
2. 提供肿瘤 vs 正常的直接比较数据
3. API 更简洁稳定
4. 被 9000+ 研究论文引用，权威性有保障
```

**API 调用规范**：
```python
# 官方文档: https://docs.cbioportal.org/6.-web-api-and-clients/api-overview
CBIO_BASE = "https://www.cbioportal.org/api"

# 步骤 1: 查询基因在指定癌症中的表达数据
# GET /molecular-profiles/{molecularProfileId}/molecular-data
# molecularProfileId 格式: "{study_id}_rna_seq_v2_mrna_median_Zscores"

# 步骤 2: 获取样本分类（肿瘤/正常）
# GET /studies/{studyId}/samples

# 步骤 3: 计算差异表达
# 在本地用 scipy.stats.mannwhitneyu 做 Mann-Whitney U 检验
# 计算 log2FC, adjusted p-value (Benjamini-Hochberg)
```

**数据校验规则**：
```python
def validate_differential_expression(result: dict) -> list[str]:
    errors = []
    required = ["log2fc", "pvalue", "adj_pvalue", "n_tumor", "n_normal"]
    for field in required:
        if field not in result:
            errors.append(f"Missing required field: {field}")
    if result.get("n_tumor", 0) < 10:
        errors.append(f"Tumor sample size too small: {result['n_tumor']}")
    if result.get("n_normal", 0) < 5:
        errors.append(f"Normal sample size too small: {result['n_normal']}")
    if not (0 <= result.get("adj_pvalue", 1) <= 1):
        errors.append(f"Invalid adjusted p-value: {result['adj_pvalue']}")
    return errors
```

### 4.4 子模块 4：生存分析（重写）

**当前状态**：⚠️ 只有临床元数据，无法执行 KM/Cox 分析

**问题根因**：生存分析需要表达数据来分组（高表达 vs 低表达），但当前没有获取表达数据。

**解决方案**：使用 cBioPortal 的预计算生存数据

```
方案 A (推荐): 使用 cBioPortal 生存 API
  - cBioPortal 提供按基因表达分组的生存数据
  - 无需自己下载表达矩阵和临床数据
  - API: GET /studies/{studyId}/clinical-data

方案 B (备选): 使用 Kaplan-Meier Plotter (kmplot.com)
  - 有 REST API 但需验证可用性
  - 提供预计算的 HR, p-value, 置信区间

方案 C (备选): 使用 PRECOG 数据库
  - 预计算的预后签名数据
  - 下载预计算矩阵文件
```

**输出必须包含**：
```python
survival_result = {
    "endpoint": "OS",  # OS, DFS, PFS, RFS
    "hr": 1.85,        # Hazard Ratio
    "hr_ci_lower": 1.32,
    "hr_ci_upper": 2.59,
    "pvalue": 0.0003,
    "n_high": 254,     # 高表达组样本量
    "n_low": 255,      # 低表达组样本量
    "median_high": 18.2,  # 高表达组中位生存(月)
    "median_low": 34.7,   # 低表达组中位生存(月)
    "cutoff": "median",   # 分组方式: median, quartile, optimal
    "km_curve_url": "...", # KM 曲线图片 URL
    "source": "cBioPortal",
    "cancer_type": "LUAD"
}
```

### 4.5 子模块 5：免疫微环境相关性（重写）

**当前状态**：❌ TIMER API 返回 404，GDC 备选方案也不工作

**解决方案**：使用 TISIDB + cBioPortal 组合

```
方案 A (推荐): TISIDB (cis.hku.hk/TISIDB)
  - 专门的肿瘤-免疫相互作用数据库
  - 有 API 接口
  - 提供基因表达与 28 种免疫细胞的相关性

方案 B (备选): TIMER 2.0 (timer.cistrome.org)
  - 需要验证正确的 API 端点格式
  - 可能需要通过网页表单提交而非直接 REST API

方案 C (备选): 使用 CIBERSORT 本地计算
  - 下载 TCGA 表达矩阵
  - 使用 CIBERSORT 或 scran 进行免疫浸润估计
  - 计算 Spearman 相关系数
```

**输出必须包含**：
```python
immune_result = {
    "gene": "EGFR",
    "cancer_type": "LUAD",
    "correlations": [
        {
            "cell_type": "CD8+ T cell",
            "correlation": -0.23,
            "pvalue": 0.001,
            "adj_pvalue": 0.008,
            "method": "Spearman"
        },
        # ... 更多细胞类型
    ],
    "source": "TISIDB",
    "n_samples": 500
}
```

---

## 五、Phase 2 重建方案：多维靶点筛选与优先级排序

### 5.1 子模块 1：Open Targets 靶点评分（保留，增强）

**当前状态**：✅ 可工作

**增强项**：
1. 添加 `get_target_drugs()` 调用（当前定义但未使用）
2. 添加数据类型详细评分类别（genetic_association, somatic_mutation, known_drug, rna_expression, animal_model, affected_pathway）
3. 添加 safety liabilities 数据获取
4. 过滤掉 association_score < 0.3 的低相关靶点

### 5.2 子模块 2：成药性评估（修复）

**当前状态**：⚠️ Pharos API 可能不通，有 Open Targets 备选

**修复项**：
1. 验证 Pharos API v1 的正确端点格式
2. 添加 DrugBank 或 ChEMBL 的成药性分类作为备选
3. 修复 ChEMBL mechanism 查询（当前返回 0 结果）

**ChEMBL 修复方案**：
```python
# 当前错误写法 (返回 0 结果):
# GET /api/data/mechanism?target_chembl_id=CHEMBL203

# 正确写法 (先查 target，再查 mechanism):
# 步骤 1: GET /api/data/target/search.json?q=EGFR&limit=5
# 步骤 2: 对每个 target_chembl_id:
#   GET /api/data/mechanism.json?target_chembl_id={id}
#   GET /api/data/drug.json?target_chembl_id={id}
#   GET /api/data/activity.json?target_chembl_id={id}&limit=100
```

### 5.3 子模块 3：差异表达分析（集成）

**当前状态**：❌ `differential_expression.py` 是孤立脚本，未集成到 pipeline

**修复方案**：
1. 将 `differential_expression.py` 集成到 `run_phase2.py`
2. 使用 GEO2R API 或 cBioPortal 替代 FTP 下载
3. 添加 `pyDESeq2` 或 `scipy` 到 requirements.txt
4. 实现火山图可视化

---

## 六、Phase 3 重建方案：靶点深度调研

### 6.1 子模块 1：靶点功能百科（新增）

**数据源**：UniProt + STRING + Gene Ontology

```python
def build_target_encyclopedia(gene_symbol: str) -> dict:
    """
    构建靶点百科全书，包含:
    1. UniProt: 蛋白序列、功能描述、结构域、亚细胞定位
    2. STRING: 蛋白互作网络 (top 20 互作伙伴)
    3. GO: 生物过程、分子功能、细胞组分
    4. AlphaFold: 蛋白结构 (如有)
    """
    return {
        "gene": gene_symbol,
        "uniprot": {  # UniProt REST API
            "accession": "P00533",
            "function": "Receptor tyrosine kinase...",
            "domains": [...],
            "subcellular_location": "Cell membrane",
            "sequence_length": 1210
        },
        "interactions": {  # STRING API
            "partners": [
                {"partner": "EGF", "score": 0.999, "evidence": "experimental"},
                {"partner": "ERBB2", "score": 0.998, "evidence": "database"},
            ]
        },
        "go_terms": {  # QuickGO API
            "biological_process": ["signal transduction", "cell proliferation"],
            "molecular_function": ["protein kinase activity", "ATP binding"],
            "cellular_component": ["plasma membrane", "endosome"]
        },
        "structure": {  # AlphaFold DB
            "pdb_url": "https://alphafold.ebi.ac.uk/entry/P00533",
            "confidence": "high"
        }
    }
```

### 6.2 子模块 2：临床试验竞品分析（修复）

**当前状态**：⚠️ 数据混入无关试验，ChEMBL 药物名缺失

**修复方案**：

```python
# 问题 1: 无关试验混入
# 原因: query.term="EGFR" 匹配了所有提到 EGFR 的试验
# 修复: 添加条件过滤
def filter_egfr_trials(trials: list, gene: str) -> list:
    """只保留真正以 EGFR 为靶点的试验"""
    filtered = []
    for trial in trials:
        interventions = trial.get("interventions", [])
        # 检查干预措施是否涉及 EGFR 靶向药物
        is_targeted = any(
            gene.lower() in str(intv).lower()
            for intv in interventions
        )
        # 检查是否在条件/疾病中与 EGFR 相关
        conditions = trial.get("conditions", [])
        is_relevant = any(
            any(kw in str(cond).lower() for kw in ["lung", "nsclc", "carcinoma", "cancer"])
            for cond in conditions
        )
        if is_targeted or (is_relevant and gene.lower() in str(trial).lower()):
            filtered.append(trial)
    return filtered

# 问题 2: ChEMBL 药物名缺失
# 修复: 对每个 ChEMBL ID 查询 drug endpoint
def get_drug_names(chembl_ids: list) -> dict:
    """批量获取 ChEMBL 药物名称"""
    names = {}
    for cid in chembl_ids:
        resp = chembl_client.get(f"/api/data/molecule/{cid}.json")
        if resp and resp.get("pref_name"):
            names[cid] = resp["pref_name"]
    return names
```

### 6.3 子模块 3：专利分析（替换数据源）

**当前状态**：❌ USPTO PEDS API 返回 503

**替代方案**：
```
方案 A (推荐): PatentsView API (patentsview.org/apis)
  - 美国专利商标局官方 API
  - 支持基因/蛋白相关专利检索
  - API: POST /api/v1/patent/query

方案 B (备选): Google Patents (通过 SerpAPI)
  - 需要 API key
  - 覆盖全球专利

方案 C (备选): Lens.org API
  - 免费学术+专利搜索引擎
  - 有 REST API
```

---

## 七、Phase 4 重建方案：商业计划与里程碑

### 7.1 里程碑规划器（数据驱动重构）

**当前问题**：完全硬编码，不考虑靶点具体情况。

**重构方案**：基于 Phase 1-3 数据动态调整

```python
def generate_data_driven_milestones(
    target: str,
    phase1: dict,  # 表达谱 + 预后数据
    phase2: dict,  # 筛选 + 成药性数据
    phase3: dict,  # 竞品 + 专利数据
) -> dict:
    """
    基于实际数据生成里程碑规划
    """
    # 基础时间线模板
    base = MODALITY_TIMELINES[phase2.get("modality", "default")]

    # 数据驱动调整因子
    adjustments = []

    # 调整 1: 根据竞品数量调整差异化策略时间
    n_competitors = len(phase3.get("competitors", []))
    if n_competitors > 10:
        adjustments.append("竞争激烈，增加 3 个月差异化策略制定")

    # 调整 2: 根据成药性分类调整发现阶段
    druggability = phase2.get("druggability_class", "Tdark")
    if druggability == "Tclin":
        adjustments.append("已临床验证靶点，可缩短发现阶段 6 个月")
    elif druggability == "Tdark":
        adjustments.append("未充分研究靶点，需增加 12 个月基础研究")

    # 调整 3: 根据预后数据调整临床开发优先级
    if phase1.get("survival", {}).get("hr", 0) > 2.0:
        adjustments.append("强预后信号，建议优先推进临床开发")

    # 调整 4: 根据专利密度调整 IP 策略
    n_patents = phase3.get("patent_landscape", {}).get("total_patents", 0)
    if n_patents > 1000:
        adjustments.append("专利密集领域，需投入 6 个月专利规避设计")

    return {
        "target": target,
        "base_modality": phase2.get("modality"),
        "adjustments": adjustments,
        "milestones": apply_adjustments(base, adjustments),
        "risk_factors": extract_risks(phase1, phase2, phase3),
        "data_sources": [p["source"] for p in [phase1, phase2, phase3]]
    }
```

### 7.2 商业计划书生成器（模板 + 数据填充）

**重构方案**：使用 Jinja2 模板 + 实际数据

```python
# 模板结构 (template/business_plan.md.j2)
"""
# {{ target_gene }} 靶点开发商业计划书

## 1. 执行摘要
{{ target_gene }} 是一个 {{ druggability_class }} 级别靶点，
在 {{ cancer_type }} 中高表达 ({{ expression_tpm }} TPM)，
与不良预后显著相关 (HR={{ hazard_ratio }}, P={{ pvalue }})。

## 2. 靶点生物学
### 2.1 功能概述
{{ uniprot_function }}

### 2.2 表达谱
{{ expression_summary }}

### 2.3 预后价值
{{ survival_summary }}

## 3. 市场分析
### 3.1 竞争格局
{{ competitor_table }}

### 3.2 临床管线
{{ clinical_pipeline_table }}

## 4. 开发策略
### 4.1 推荐模态
{{ recommended_modality }} — {{ rationale }}

### 4.2 里程碑规划
{{ milestone_table }}

## 5. 财务预测
{{ financial_projections }}

## 6. 风险评估
{{ risk_assessment }}

## 7. 参考文献
{{ references }}
"""
```

---

## 八、报告输出系统重建

### 8.1 多格式输出支持

```
当前支持:  JSON ✅  |  Markdown ✅  |  HTML (静态) ⚠️
目标支持:  JSON ✅  |  Markdown ✅  |  HTML (交互) ✅  |  PDF ✅  |  DOCX ✅
```

### 8.2 交互式 HTML 仪表板

**技术选型**：
- 图表: **ECharts** (百度开源，医学图表丰富，支持中文)
- 表格: **DataTables.js** (排序、筛选、分页、导出 CSV)
- 布局: **Bootstrap 5** (响应式、专业感)
- 交互: 原生 JavaScript (无框架依赖)

**页面结构**：
```html
<!-- index.html 主仪表板 -->
<body>
  <!-- 顶部: 靶点概览卡片 -->
  <div class="hero-card">
    <h1>EGFR 靶点情报报告</h1>
    <div class="kpi-row">
      <div class="kpi">GTEx 表达: 78.3 TPM</div>
      <div class="kpi">预后 HR: 1.85 (P=0.0003)</div>
      <div class="kpi">成药性: Tclin</div>
      <div class="kpi">临床试验: 100 个</div>
    </div>
  </div>

  <!-- Tab 导航 -->
  <nav class="tabs">
    <a href="#expression">表达谱</a>
    <a href="#survival">预后分析</a>
    <a href="#immune">免疫微环境</a>
    <a href="#screening">靶点筛选</a>
    <a href="#research">深度调研</a>
    <a href="#business">商业计划</a>
  </nav>

  <!-- Tab 内容 -->
  <div id="expression">
    <!-- Plotly 交互式图表 -->
    <div id="gtex-chart" class="chart"></div>
    <!-- DataTables 数据表格 -->
    <table id="expression-table" class="display"></table>
  </div>

  <!-- 导出按钮 -->
  <div class="export-bar">
    <button onclick="exportPDF()">导出 PDF</button>
    <button onclick="exportDOCX()">导出 DOCX</button>
    <button onclick="exportCSV()">导出 CSV</button>
    <button onclick="exportPPT()">导出 PPT 摘要</button>
  </div>
</body>
```

### 8.3 PDF 导出

**技术选型**：`weasyprint` (Python HTML→PDF 转换)

```python
from weasyprint import HTML

def export_pdf(html_path: str, output_path: str):
    """将 HTML 报告转换为 PDF"""
    HTML(filename=html_path).write_pdf(
        output_path,
        presentational_hints=True,
        stylesheets=["report_print.css"]  # 打印专用样式
    )
```

### 8.4 中文支持

**所有输出默认中文，英文可选**：

```python
# 报告标题映射
TITLES = {
    "zh": {
        "phase1": "靶点表达全景与预后挖掘报告",
        "phase2": "多维靶点筛选与优先级排序报告",
        "phase3": "靶点深度调研与赛道格局分析报告",
        "phase4": "商业计划书与里程碑规划",
    },
    "en": {
        "phase1": "Target Expression Panorama & Prognosis Report",
        # ...
    }
}
```

---

## 九、数据质量保障体系

### 9.1 API 验证门控

**每个 API 调用必须通过以下检查才能进入 pipeline**：

```python
class APIGate:
    """API 验证门控 - 在 pipeline 启动时运行"""

    def verify_api(self, name: str, test_fn: callable) -> bool:
        """
        验证 API 可用性:
        1. 连接性: 能否建立 HTTP 连接
        2. 响应性: 返回 200 状态码
        3. 数据完整性: 返回数据符合预期 schema
        4. 已知测试用例: 用已知输入验证输出正确性
        """
        try:
            result = test_fn()
            if result is None:
                self.report(name, "FAIL", "返回空数据")
                return False
            schema_errors = self.validate_schema(name, result)
            if schema_errors:
                self.report(name, "WARN", f"Schema 问题: {schema_errors}")
            self.report(name, "PASS", "API 验证通过")
            return True
        except Exception as e:
            self.report(name, "FAIL", str(e))
            return False

# 启动时运行
gate = APIGate()
gate.verify_api("GTEx", lambda: test_gtex_egfr())
gate.verify_api("cBioPortal", lambda: test_cbio_luad())
gate.verify_api("OpenTargets", lambda: test_ot_egfr())
gate.verify_api("ChEMBL", lambda: test_chembl_egfr())
gate.verify_api("ClinicalTrials", lambda: test_ct_egfr())
gate.verify_api("PubMed", lambda: test_pubmed_egfr())
```

### 9.2 黄金标准测试用例

**使用已知正确结果验证系统准确性**：

```python
GOLDEN_STANDARD = {
    "EGFR": {
        "gtex_skin_tpm": 78.3,  # GTEx Skin 表达值 (允许 ±10%)
        "ot_score_lung": 0.90,  # Open Targets 肺癌关联评分 (允许 ±0.05)
        "druggability": "Tclin",  # Pharos 分类
        "n_clinical_trials": ">50",  # 临床试验数量下限
        "survival_hr_luad": ">1.5",  # LUAD 预后 HR 下限
        "known_drugs": ["erlotinib", "gefitinib", "osimertinib"],  # 已知药物
    },
    "CD19": {
        "druggability": "Tclin",
        "known_drugs": ["tisagenlecleucel", "axicabtagene ciloleucel"],
        "n_clinical_trials": ">200",
    },
    "BCMA": {
        "druggability": "Tclin",
        "known_drugs": ["idecabtagene vicleucel", "belantamab mafodotin"],
        "n_clinical_trials": ">100",
    }
}

def validate_against_golden_standard(gene: str, results: dict) -> dict:
    """对比实际结果与黄金标准"""
    gs = GOLDEN_STANDARD.get(gene, {})
    validation = {}
    for key, expected in gs.items():
        actual = results.get(key)
        if isinstance(expected, str) and expected.startswith(">"):
            threshold = float(expected[1:])
            validation[key] = "PASS" if actual and actual > threshold else "FAIL"
        else:
            validation[key] = "PASS" if actual == expected else "FAIL"
    return validation
```

### 9.3 交叉验证机制

```python
def cross_validate_expression(gene: str) -> dict:
    """
    从多个数据源获取表达数据并交叉验证
    """
    results = {}

    # 源 1: GTEx (正常组织)
    gtex = query_gtex(gene)
    if gtex:
        results["gtex"] = gtex

    # 源 2: cBioPortal (肿瘤组织)
    cbio = query_cbioportal(gene)
    if cbio:
        results["cbioportal"] = cbio

    # 交叉验证
    if "gtex" in results and "cbioportal" in results:
        # 比较共同组织的表达趋势
        common_tissues = set(results["gtex"]["tissues"]) & set(results["cbioportal"]["tissues"])
        discrepancies = []
        for tissue in common_tissues:
            gtex_rank = results["gtex"]["rank"][tissue]
            cbio_rank = results["cbioportal"]["rank"][tissue]
            if abs(gtex_rank - cbio_rank) > 10:
                discrepancies.append(tissue)
        results["validation"] = {
            "consistent": len(discrepancies) == 0,
            "discrepancies": discrepancies
        }

    return results
```

---

## 十、实施路线图

### Phase 0: 基础设施重建（第 1 周）

| 任务 | 优先级 | 估时 |
|------|--------|------|
| 验证所有 API 端点可用性（GTEx, cBioPortal, OpenTargets, ChEMBL, ClinicalTrials, PubMed, UniProt, STRING） | P0 | 2 天 |
| 修复 `api_client.py`：添加 cBioPortal、UniProt、STRING 客户端工厂 | P0 | 1 天 |
| 修复 `data_validator.py`：添加 schema 校验、移除假交叉验证 | P0 | 0.5 天 |
| 添加黄金标准测试用例 | P0 | 0.5 天 |
| 更新 `requirements.txt`（添加 plotly、weasyprint、jinja2） | P1 | 0.5 天 |

### Phase 1 重建（第 2 周）

| 任务 | 优先级 | 估时 |
|------|--------|------|
| 重写 `tcga_analysis.py`：使用 cBioPortal API | P0 | 1 天 |
| 重写 `survival_analysis.py`：使用 cBioPortal 生存 API | P0 | 1 天 |
| 重写 `immune_correlation.py`：使用 TISIDB 或本地计算 | P0 | 1 天 |
| 替换 `hpa_validation.py`：使用 ProteomicsDB 或标注不可用 | P1 | 0.5 天 |
| 增强 `gtex_expression.py`：添加 tau index、交互式图表 | P2 | 0.5 天 |

### Phase 2-3 重建（第 3 周）

| 任务 | 优先级 | 估时 |
|------|--------|------|
| 修复 ChEMBL mechanism 查询 | P0 | 0.5 天 |
| 修复 ClinicalTrials.gov 过滤逻辑 | P0 | 0.5 天 |
| 集成 `differential_expression.py` 到 pipeline | P1 | 1 天 |
| 新增靶点百科全书模块（UniProt + STRING + GO） | P1 | 1 天 |
| 修复专利分析（替换 USPTO 数据源） | P2 | 1 天 |

### Phase 4 + 报告系统重建（第 4 周）

| 任务 | 优先级 | 估时 |
|------|--------|------|
| 重构里程碑规划器为数据驱动 | P1 | 1 天 |
| 重构商业计划书生成器（Jinja2 模板） | P1 | 1 天 |
| 构建交互式 HTML 仪表板 | P1 | 2 天 |
| 添加 PDF/DOCX 导出 | P2 | 1 天 |

### 质量保障（贯穿全程）

| 任务 | 频率 |
|------|------|
| 每个脚本修改后运行黄金标准测试 | 每次修改 |
| 端到端 pipeline 测试（EGFR/LUAD） | 每日 |
| 交叉验证结果人工审核 | 每阶段完成时 |

---

## 十一、可复用资源清单

### 从 OpenBioMed 复用

| 资源 | 用途 | 路径 |
|------|------|------|
| `web_request_tools.py` | DBRequester 基类、PubChem/UniProt/ChEMBL/STRING 请求器 | `E:\OpenBioMed\open_biomed\tools\web_request_tools.py` |
| `report_generator.py` | ReportGeneratorSBDD 模板 | `E:\OpenBioMed\open_biomed\core\llm_provider.py` |
| `molecule.py` | 分子属性计算 (QED, LogP, Lipinski) | `E:\OpenBioMed\open_biomed\data\molecule.py` |
| `target-drug-report` skill | 7 节报告模板 | `E:\OpenBioMed\skills\target-drug-report\` |
| `disease-drug-intelligence` skill | 疾病-药物管线分析 | `E:\OpenBioMed\skills\disease-drug-intelligence\` |

### 从 OpenClaw-Medical-Skills 复用

| 资源 | 用途 | 路径 |
|------|------|------|
| `tooluniverse-drug-research` | 9 路研究工作流、证据分级、完整性审计 | `E:\OpenClaw-Medical-Skills\skills\tooluniverse-drug-research\` |
| `clinical-reports` | CARE 指南、ICH-E3 报告模板 | `E:\OpenClaw-Medical-Skills\skills\clinical-reports\` |
| `clinical-decision-support` | GRADE 证据分级 | `E:\OpenClaw-Medical-Skills\skills\clinical-decision-support\` |
| `pubmed-search` | PubMed 检索最佳实践 | `E:\OpenClaw-Medical-Skills\skills\pubmed-search\` |
| `bio-reporting` | 自动化 QC 报告、图表导出 | `E:\OpenClaw-Medical-Skills\skills\bio-reporting\` |

---

## 十二、成功标准

### 端到端验收条件（EGFR/LUAD 测试用例）

| 检查项 | 标准 | 验证方法 |
|--------|------|----------|
| GTEx 表达数据 | 54 个组织，Skin > 70 TPM | 自动比对黄金标准 |
| cBioPortal 差异表达 | 有 log2FC + adj_pvalue | schema 校验 |
| 生存分析 | 有 HR + CI + p-value + KM 曲线 | schema 校验 |
| 免疫相关性 | 至少 8 种免疫细胞的相关系数 | schema 校验 |
| Open Targets 评分 | EGFR 在肺癌中 > 0.8 | 自动比对黄金标准 |
| ChEMBL 药物 | 至少 5 个有名称的药物 | 自动比对黄金标准 |
| ClinicalTrials | 至少 50 个 EGFR 相关试验 | 过滤后计数 |
| 靶点百科 | UniProt + STRING + GO 数据完整 | schema 校验 |
| HTML 仪表板 | 可在浏览器中打开，图表可交互 | 人工验证 |
| PDF 导出 | 可下载，排版正确 | 人工验证 |
| 中文输出 | 所有标题和摘要为中文 | 人工验证 |
