# JSON 输出 Schema 文档

本文档描述 `--json` 模式下各阶段的输出结构，供 agent 解析使用。

## 通用字段

所有阶段输出都包含以下顶层字段：

```json
{
  "success": true/false,    // 是否成功
  "stage": "stage1",        // 阶段标识
  "summary": { ... },       // 摘要
  "timestamp": "ISO8601"    // 时间戳
}
```

错误时的通用结构：

```json
{
  "success": false,
  "stage": "stage1",
  "error": "错误信息",
  "issues": ["问题1", "问题2"]  // 可选，输入验证失败时
}
```

---

## Stage1: 靶点表达全景与预后挖掘

```bash
python main.py stage1 --gene EGFR --cancers LUAD BRCA --json
```

```json
{
  "success": true,
  "stage": "stage1",
  "gene": "EGFR",
  "ensg_id": "ENSG00000146648",  // 自动解析或手动指定
  "cancer_types": ["LUAD", "BRCA"],
  "timestamp": "2026-06-03T10:00:00",
  "stages": {
    "tissue_expression": {
      "success": true,
      "gtex": {
        "success": true,
        "data": {
          "gene": "EGFR",
          "tissues": { "Brain": 12.5, "Lung": 8.3, ... },
          "unit": "TPM"
        },
        "valid": true,
        "validation_issues": []
      },
      "hpa": { ... },           // 需要 ENSG ID
      "cross_validation": { ... } // GTEx vs HPA 一致性
    },
    "tumor_expression": {
      "success": true,
      "cancer_results": {
        "LUAD": {
          "success": true,
          "data": {
            "gene": "EGFR",
            "project": "TCGA-LUAD",
            "samples": [ { "sample_id": "...", "expression_value": 12.5, "unit": "FPKM" } ],
            "sample_count": 500
          }
        }
      }
    },
    "survival_analysis": {
      "success": true,
      "cancer_results": {
        "LUAD": {
          "success": true,
          "data": {
            "km_analysis": { "high_group": {...}, "low_group": {...} },
            "logrank_test": { "statistic": 5.2, "p_value": 0.023 },
            "cox_regression": { "hr": 1.5, "ci_lower": 1.1, "ci_upper": 2.0, "p_value": 0.01 }
          }
        }
      }
    },
    "immune_correlation": {
      "success": true,
      "cancer_results": {
        "LUAD": {
          "success": true,
          "data": {
            "gene": "EGFR",
            "cancer_type": "LUAD",
            "sample_count": 200,
            "correlations": {
              "B_cell": { "correlation": 0.25, "p_value": 0.001, "significant": true, "strength": "weak", "direction": "positive" },
              "CD8_T_cell": { "correlation": -0.35, "p_value": 0.0001, "significant": true, "strength": "moderate", "direction": "negative" },
              ...
            },
            "summary": {
              "significant_count": 3,
              "significant_cells": ["B_cell", "CD8_T_cell", "Macrophage"],
              "positive_correlations": ["B_cell"],
              "negative_correlations": ["CD8_T_cell", "Macrophage"],
              "interpretation": "该基因表达与 CD8_T_cell, Macrophage 呈负相关；与 B_cell 呈正相关"
            }
          }
        }
      }
    }
  },
  "validation": {
    "provenance_valid": true,
    "cross_validation": { ... },
    "overall_confidence": "high",
    "issues": []
  },
  "summary": {
    "gene": "EGFR",
    "cancer_types": ["LUAD", "BRCA"],
    "analysis_status": "completed",
    "data_sources": ["GTEx", "TCGA-LUAD", "ImmuneDataManager"],
    "confidence_level": "high",
    "key_findings": [ "在正常组织中，Brain 表达最高 (12.5 TPM)" ],
    "key_outputs": [ "组织表达全景", "肿瘤表达差异", "生存分析", "免疫相关性" ]
  }
}
```

---

## Stage2: 多维靶点筛选与优先级排序

```bash
python main.py stage2 --disease "breast cancer" --json
```

```json
{
  "success": true,
  "stage": "stage2",
  "disease": "breast cancer",
  "known_targets": [],
  "timestamp": "2026-06-03T10:00:00",
  "stages": {
    "geo_search": {
      "success": true,
      "rnaseq_datasets": [
        { "accession": "GSE12345", "title": "...", "sample_count": 100, "dataset_type": "RNA-seq", "quality_score": 5 }
      ],
      "total_count": 50
    },
    "differential_expression": {
      "success": true,
      "accession": "GSE12345",
      "gene_count": 20000,
      "sample_count": 100,
      "disease_samples": 50,
      "control_samples": 50,
      "significant_genes": [
        { "gene": "EGFR", "log2fc": 2.5, "p_value": 0.0001, "adjusted_p_value": 0.005, "disease_mean": 12.0, "control_mean": 3.0 }
      ],
      "method": "keyword_match"
    },
    "druggability": {
      "success": true,
      "targets": {
        "EGFR": {
          "success": true,
          "composite_score": 0.85,
          "druggability_class": "Tchem",
          "interpretation": "...",
          "evidence": [...]
        }
      }
    },
    "ranking": {
      "success": true,
      "disease": "breast cancer",
      "total_targets": 10,
      "top_targets": [
        {
          "gene": "EGFR",
          "composite_score": 0.78,
          "de_score": 0.65,
          "druggability_score": 0.85,
          "druggability_class": "Tchem",
          "evidence_count": 5,
          "interpretation": "..."
        }
      ],
      "ranking_criteria": {
        "primary": "综合评分 (DE×0.6 + 成药性×0.4)",
        "de_weight": 0.6,
        "druggability_weight": 0.4
      }
    }
  },
  "validation": { "provenance_valid": true, "data_completeness": {...}, "issues": [] },
  "summary": {
    "disease": "breast cancer",
    "analysis_status": "completed",
    "data_sources": ["GEO", "OpenTargets"],
    "key_findings": [ "找到50个相关GEO数据集", "评估了10个靶点的成药性" ],
    "top_candidates": [
      { "gene": "EGFR", "score": 0.78, "de_score": 0.65, "druggability_score": 0.85, "class": "Tchem" }
    ]
  }
}
```

---

## Stage3: 靶点深度调研与赛道格局分析

```bash
python main.py stage3 --target EGFR --disease "lung cancer" --json
```

```json
{
  "success": true,
  "stage": "stage3",
  "target": "EGFR",
  "ensg_id": "ENSG00000146648",
  "disease": "lung cancer",
  "timestamp": "2026-06-03T10:00:00",
  "stages": {
    "target_function": {
      "success": true,
      "data": {
        "ensg_id": "ENSG00000146648",
        "gene_symbol": "EGFR",
        "druggability": { "unique_drugs": 100, "drugs": [...] }
      }
    },
    "clinical_pipeline": {
      "data": { "total_trials": 500, "active_trials": 200 }
    },
    "literature": {
      "data": { "total_count": 10000, "pmids": [...] }
    },
    "competitive_landscape": { ... },
    "assessment": { ... }
  },
  "summary": {
    "target": "EGFR",
    "disease": "lung cancer",
    "developability": {
      "score": 75,
      "level": "high",
      "interpretation": "高开发潜力"
    },
    "key_findings": [ "全球共有 500 个相关临床试验" ],
    "recommendations": [ "建议推进" ]
  }
}
```

---

## Stage4: 商业计划书与里程碑规划

```bash
python main.py stage4 --target EGFR --disease "lung cancer" --json
```

```json
{
  "success": true,
  "stage": "stage4",
  "target": "EGFR",
  "disease": "lung cancer",
  "modality": "small_molecule",
  "risk_level": "medium",
  "timestamp": "2026-06-03T10:00:00",
  "stages": {
    "milestones": {
      "success": true,
      "data": {
        "total_duration_months": 60,
        "total_cost_estimate": 150.0,
        "overall_success_rate": 0.12,
        "phases": [ ... ]
      }
    },
    "business_plan": {
      "success": true,
      "data": {
        "success": true,
        "sections": { ... }
      }
    },
    "markdown_report": {
      "success": true,
      "content": "# 商业计划书\n..."
    }
  },
  "summary": {
    "target": "EGFR",
    "disease": "lung cancer",
    "analysis_status": "completed",
    "milestones": {
      "total_duration": "60个月",
      "total_cost": "$150.0M",
      "success_rate": "12.0%"
    },
    "key_outputs": [ "里程碑规划", "商业计划书", "Markdown报告" ]
  }
}
```

---

## Full Pipeline: 完整分析

```bash
python main.py full --target EGFR --disease "lung cancer" --cancers LUAD --json
```

```json
{
  "success": true,
  "stage": "full",
  "target": "EGFR",
  "disease": "lung cancer",
  "stages": {
    "stage1": { ... },  // 同 Stage1 输出
    "stage2": { ... },  // 同 Stage2 输出
    "stage3": { ... },  // 同 Stage3 输出
    "stage4": { ... }   // 同 Stage4 输出
  },
  "summary": {
    "target": "EGFR",
    "disease": "lung cancer",
    "stages_completed": ["stage1", "stage2", "stage3", "stage4"],
    "stages_failed": []
  }
}
```

---

## Agent 解析指南

1. **检查 `success` 字段** — `false` 时读取 `error` 获取原因
2. **读取 `summary`** — 包含关键发现和推荐，适合决策
3. **读取 `stages.*`** — 获取详细分析数据
4. **读取 `validation`** — 检查数据质量和置信度
5. **跨阶段数据** — `full` 模式下 `stages.stage1.summary` 可传递给后续分析
