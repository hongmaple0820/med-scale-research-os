# 药物靶点智能研究平台

## 概述

本平台是一个严格的、高质量的药物靶点研究系统，专注于：
- **数据权威性**：直接调用权威API（GTEx、TCGA、HPA、GEO、OpenTargets、ClinicalTrials.gov等）
- **数据准确性**：多源交叉验证机制
- **数据溯源**：每个数据点都有完整的API来源记录
- **反幻觉**：禁止AI自行编造数据

## 架构

```
target-research-platform/
├── src/
│   ├── api_clients/              # 9个API客户端
│   │   ├── base_client.py        # 基类（缓存、速率限制、溯源）
│   │   ├── gtex_client.py        # GTEx正常组织表达
│   │   ├── tcga_client.py        # TCGA肿瘤表达+生存数据
│   │   ├── hpa_client.py         # HPA蛋白表达（IHC）
│   │   ├── timer_client.py       # TIMER免疫浸润（已废弃，用 ImmuneDataManager）
│   │   ├── immune_data_manager.py # TCGA免疫浸润预计算数据管理器
│   │   ├── pubmed_client.py      # PubMed文献检索
│   │   ├── opentargets_client.py # OpenTargets成药性评估
│   │   ├── geo_client.py         # GEO表达数据集
│   │   └── clinicaltrials_client.py # ClinicalTrials.gov临床试验
│   ├── validators/               # 数据验证器
│   │   ├── data_provenance.py    # 溯源追踪（反幻觉核心）
│   │   └── cross_validator.py    # 多源交叉验证
│   ├── output/                   # 输出模块
│   │   ├── chart_generator.py    # 可视化图表生成器
│   │   ├── data_exporter.py      # 数据导出器（CSV/TSV）
│   │   ├── report_generator.py   # 报告生成器（HTML/PDF/DOCX）
│   │   └── evidence_package.py   # 证据包生成器
│   └── analysis/
│       ├── stage1_expression/    # 阶段1：表达全景与预后挖掘
│       ├── stage2_screening/     # 阶段2：靶点筛选与优先级排序
│       ├── stage3_deep_research/ # 阶段3：靶点深度调研与赛道格局分析
│       └── stage4_business/      # 阶段4：商业计划书与里程碑规划
├── tests/                        # 单元测试+集成测试
├── scripts/                      # 辅助脚本
├── data/                         # 预计算免疫浸润数据
├── main.py                       # 命令行入口
└── requirements.txt
```

## 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
```

### 阶段1：靶点表达全景与预后挖掘

```bash
# 分析CDK4在乳腺癌和肺癌中的表达
python main.py stage1 --gene CDK4 --cancers BRCA LUAD

# 分析PD-L1（带Ensembl ID用于HPA查询）
python main.py stage1 --gene CD274 --cancers BRCA LUAD SKCM --ensg ENSG00000120217
```

**功能：**
- GTEx正常组织表达谱（54个组织）
- TCGA肿瘤组织表达数据
- 生存分析（Kaplan-Meier + Cox回归）
- 免疫细胞浸润相关性分析
- 仅当 GTEx、HPA、疾病匹配 TCGA、存活分析和免疫分析均有效时，输出 `decision_eligible: true`

### 阶段2：多维靶点筛选与优先级排序

```bash
# 筛选乳腺癌相关靶点
python main.py stage2 --disease "breast cancer"

# 排除已知靶点
python main.py stage2 --disease "lung cancer" --exclude-targets "EGFR,ALK,ROS1"
```

**功能：**
- GEO数据集搜索与质量评估
- 独立执行 GEO 与 TCGA 差异表达分析，并比较重叠基因和效应方向
- 位置推断分组、宽松阈值、TCGA 正常对照少于 5 个或跨来源重叠不足都会阻断排序
- 成药性评分使用真实 OpenTargets 返回值，并明确标记为单一来源；不会伪装成独立 Pharos/ChEMBL 查询
- 仅对双来源验证通过的候选基因进行综合排序

### 阶段3：靶点深度调研与赛道格局分析

```bash
# 深度调研CDK4靶点
python main.py stage3 --target CDK4 --disease "breast cancer"

# 带Ensembl ID的分析
python main.py stage3 --target EGFR --ensg ENSG00000146648 --disease "lung cancer"
```

**功能：**
- 靶点功能机制分析（UniProt、通路、PPI）
- 临床管线分析（ClinicalTrials.gov）
- 文献分析（PubMed）
- 竞争格局分析
- 可开发性评估

### 阶段4：商业计划书与里程碑规划

```bash
# 生成CDK4的商业计划书
python main.py stage4 --target CDK4 --disease "breast cancer"

# 指定药物形式和风险等级
python main.py stage4 --target EGFR --disease "lung cancer" --modality antibody --risk-level high
```

**功能：**
- 10阶段里程碑规划（靶点验证→上市申请）
- 药物形式系数调整（小分子/抗体/细胞治疗/基因治疗）
- 商业计划书生成（10个章节）
- 融资需求规划（种子轮→IPO）
- Markdown报告输出

### 完整Pipeline

```bash
# 一键运行全部4个阶段
python main.py full --target CDK4 --disease "breast cancer" --cancers BRCA LUAD
```

完整管线采用 fail-closed 语义：任一阶段未通过证据门禁时，后续阶段会标记为
`skipped`，并写入 `output/pipeline_checkpoint.json`。该 checkpoint 使用
`medscale.pipeline_checkpoint.v1` schema，记录当前阶段、阻断原因和各阶段状态。

论文草稿只会在 Stage 1/2 证据资格和 Stage 3/4 完整性均通过时生成。每次生成还会写入：

- `manuscripts/<target>_<disease>_claim_ledger.json`：定量 claim、值和上游 JSON locator。
- `manuscripts/<target>_<disease>_manuscript_fact_check.json`：PMID、图表、数字、目标/疾病/TCGA 队列污染检查。

## 数据验证机制

### 1. 溯源追踪

```python
# 每个数据点记录：
{
    "source": "GTEx",
    "endpoint": "/expression/geneExpression",
    "params": {"geneSymbol": "CDK4"},
    "timestamp": "2024-01-01T00:00:00",
    "request_hash": "abc123..."
}
```

### 2. 交叉验证

- GTEx vs HPA表达一致性
- GEO vs TCGA 差异表达独立复现
- 成药性证据按真实来源标记，不把聚合值重命名为独立数据库证据

### 3. 质量门控

| 检查项 | 阈值 | 说明 |
|--------|------|------|
| 样本量 | >= 50 | 生存分析最小样本 |
| 组织数 | >= 30 | GTEx组织覆盖 |
| p值 | < 0.05 | 统计显著性 |
| HR方向 | 一致 | TCGA vs GEO |
| GEO分组 | 非 positional | 必须由样本元数据支持 |
| TCGA正常对照 | >= 5 | 少于阈值阻断排名 |
| DE重叠基因 | >= 3 | GEO/TCGA共同显著基因 |
| DE方向一致率 | >= 60% | 跨来源效应方向 |

## 输出格式

### JSON结果

```json
{
    "target": "CDK4",
    "disease": "breast cancer",
    "stages": {
        "target_function": {...},
        "clinical_pipeline": {...},
        "literature": {...},
        "competitive_landscape": {...},
        "assessment": {...}
    },
    "validation": {
        "provenance_valid": true
    },
    "summary": {
        "key_findings": [...],
        "developability": {
            "score": 75,
            "level": "high"
        },
        "recommendations": [...]
    }
}
```

### Markdown报告

自动生成结构化报告，包含：
- 数据来源
- 关键发现
- 可开发性评估
- 临床管线概况
- 竞争格局
- 研发建议

## 支持的癌种

| 代码 | 癌种 |
|------|------|
| BRCA | 乳腺癌 |
| LUAD | 肺腺癌 |
| LUSC | 肺鳞癌 |
| PRAD | 前列腺癌 |
| COAD | 结肠癌 |
| SKCM | 皮肤黑色素瘤 |
| ... | 共33种 |

## API数据源

| 数据源 | 用途 | API类型 |
|--------|------|---------|
| GTEx | 正常组织表达 | REST |
| TCGA/GDC | 肿瘤表达和生存数据 | REST |
| HPA | 蛋白表达（IHC） | REST |
| TIMER | 免疫浸润（已废弃，用 ImmuneDataManager） | Web |
| PubMed | 文献检索 | E-utilities |
| OpenTargets | 靶点-疾病关联 | GraphQL |
| GEO | 表达数据集 | E-utilities |
| ClinicalTrials.gov | 临床试验 | REST |

## 测试

```bash
# 运行所有测试
python -m pytest tests/ -v

# 运行特定阶段测试
python -m pytest tests/test_stage3.py -v

# 单独运行依赖外部网络和实时数据库状态的连通性测试
python -m pytest tests/test_api_integration.py -m integration -v
```

默认测试排除 `integration` marker，以保持本地/CI 确定性。实时 API 连通性测试必须
单独运行并记录外部服务、字段漂移或网络阻断；不得把其失败改写为业务验证通过。
测试结果必须以当前实际运行记录为准，不要沿用历史固定通过数量。

## 可开发性评估体系

| 评分范围 | 等级 | 含义 |
|----------|------|------|
| >= 70 | high | 高开发潜力 |
| 50-70 | medium | 中等开发潜力 |
| 30-50 | low | 低开发潜力 |
| < 30 | very_low | 开发风险高 |

**评分维度：**
- 靶点验证程度（20分）
- 临床进展（20分）
- 已上市药物（30分）
- 竞争强度（20分）
- 市场机会（10分）

## 下一步开发

- [x] 阶段1：靶点表达全景与预后挖掘
- [x] 阶段2：多维靶点筛选与优先级排序
- [x] 阶段3：靶点深度调研与赛道格局分析
- [x] 阶段4：商业计划书与里程碑规划
- [x] 可视化模块（matplotlib/seaborn 图表生成器）
- [x] 端到端集成测试（4阶段 Pipeline 自动数据传递）
- [x] GEO 探针 ID 映射（微阵列数据自动基因符号转换）
- [x] Stage 4 动态成功率（基于前序阶段数据动态调整）
- [x] Stage 2 自适应权重（DE/成药性权重随信号强度动态切换）
- [ ] 证据包自动生成（图表+数据+报告一站式输出）

## 许可

内部使用
