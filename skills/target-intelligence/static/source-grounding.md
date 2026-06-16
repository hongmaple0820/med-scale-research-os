---
name: source-grounding
description: 数据溯源规则 — 每个结论必须有可点击的原始数据链接
---

# 数据溯源规则

## 溯源链（每个结论必须有完整链条）

```
结论 → 分析结果 → 原始数据 → API 返回 → 数据库
```

示例：
```
结论: "KRAS 在胰腺癌中高表达"
→ 分析结果: log2FC=3.2, p=1.2e-15 (Mann-Whitney U)
→ 原始数据: cBioPortal API 返回 tumor_mean=8.5, normal_mean=1.2
→ API 端点: https://www.cbioportal.org/api/molecular-profiles/paad_tcga_mrna/values?entrezGeneId=3845
→ 数据库: TCGA Pancreatic Cancer (PAAD), n=178 tumor, n=4 normal
```

## 可点击链接（报告中每个数据段必须包含）

| 数据库 | 链接模板 |
|--------|----------|
| GTEx | `https://gtexportal.org/home/gene/{gene}` |
| cBioPortal | `https://www.cbioportal.org/gene/{gene}` |
| Open Targets | `https://www.targetvalidation.org/target/{ensembl_id}` |
| PubMed | `https://pubmed.ncbi.nlm.nih.gov/{pmid}` |
| ClinicalTrials.gov | `https://clinicaltrials.gov/ct2/show/{nct_id}` |
| ChEMBL | `https://www.ebi.ac.uk/chembl/target_report_card/{chembl_id}` |
| UniProt | `https://www.uniprot.org/uniprotkb/{accession}` |
| STRING | `https://string-db.org/network/{species_id}/{string_id}` |

## 报告中的溯源格式

每个数据段落末尾附带：

```
数据来源: {database} | 查询时间: {timestamp} | 置信度: {confidence}
原始链接: {clickable_url}
```

## 图表溯源

每张图表的标题或注释中必须包含：
- 数据来源（如 "Data: GTEx Portal v2"）
- 样本量（如 "n=17,382 samples"）
- 统计方法（如 "Mann-Whitney U, BH-corrected"）
