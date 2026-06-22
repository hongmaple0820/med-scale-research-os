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
    "evidence_gate": {
      "status": "verified",
      "decision_eligible": true,
      "checks": {
        "gtex_valid": true,
        "hpa_valid": true,
        "tumor_expression_valid": true,
        "survival_valid": true,
        "immune_correlation_valid": true
      }
    },
    "overall_confidence": "high",
    "issues": []
  },
  "summary": {
    "gene": "EGFR",
    "cancer_types": ["LUAD", "BRCA"],
    "analysis_status": "verified",
    "decision_eligible": true,
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
      "method": "keyword_match",
      "filter_level": "strict"
    },
    "tcga_replication": {
      "success": true,
      "accession": "TCGA-BRCA",
      "disease_samples": 500,
      "control_samples": 50,
      "significant_genes": [ ... ]
    },
    "source_validation": {
      "status": "verified",
      "decision_eligible": true,
      "independent_sources": ["GSE12345", "TCGA-BRCA"],
      "overlap_count": 10,
      "concordance_rate": 0.8,
      "validated_genes": [ ... ],
      "issues": []
    },
    "druggability": {
      "success": true,
      "targets": {
        "EGFR": {
          "success": true,
          "composite_score": 0.85,
          "source_scope": "single_source",
          "evidence_sources": ["OpenTargets"],
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
    "analysis_status": "verified",
    "decision_eligible": true,
    "data_sources": ["GSE12345", "TCGA-BRCA", "OpenTargets"],
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
    "stages_failed": [],
    "stages_skipped": []
  },
  "artifacts": {
    "pipeline_checkpoint": "output/pipeline_checkpoint.json"
  }
}
```

阻断时，后续阶段使用以下结构：

```json
{
  "success": false,
  "status": "skipped",
  "reason": "Skipped because stage2 did not pass its evidence gate."
}
```

`pipeline_checkpoint.json` 的顶层 `schema` 为
`medscale.pipeline_checkpoint.v1`，`status` 为 `running`、`blocked` 或
`completed`。

论文生成还会输出 `claim_ledger` 路径。claim ledger 中每条定量 claim 均包含
`claim_id`、`value` 和 `source_locator`；缺失 locator 会使 fact check 失败。

---

## Research OS Review Artifacts

The local-first `src.research_os` governance layer emits review-gated JSON artifacts. These files
are not stage `--json` stdout payloads; they live in the three-layer artifact store and are bound to
the append-only review ledger.

### Terminology Mapping Request

Top-level `schema`: `medscale.terminology_mapping_request.v1`

```json
{
  "schema": "medscale.terminology_mapping_request.v1",
  "source_artifact_id": "msa-...",
  "source_record_ids": ["MeSH:2026"],
  "requested_entity_domain": "disease",
  "query": "melanoma",
  "normalized_query": "melanoma",
  "status": "human_review_required",
  "selected_id": null,
  "candidates": [
    {
      "descriptor_ui": "D008545",
      "preferred_name": "Melanoma",
      "tree_numbers": ["C04.1"],
      "matched_as": "preferred_name"
    }
  ],
  "decision_fields": {
    "selected_id": null,
    "reviewer_rationale": null,
    "reject_all": null
  },
  "automatic_selection_performed": false
}
```

### Terminology Mapping Decision

Top-level `schema`: `medscale.terminology_mapping_decision.v1`

```json
{
  "schema": "medscale.terminology_mapping_decision.v1",
  "mapping_request_artifact_id": "msa-...",
  "source_artifact_id": "msa-...",
  "source_record_ids": ["MeSH:2026"],
  "requested_entity_domain": "disease",
  "query": "melanoma",
  "normalized_query": "melanoma",
  "decision": {
    "status": "selected",
    "selected_id": "D008545",
    "selected_candidate": {
      "descriptor_ui": "D008545",
      "preferred_name": "Melanoma"
    },
    "reject_all": false,
    "reviewer_rationale": "Human rationale."
  },
  "candidate_count": 1,
  "candidate_snapshot": [],
  "automatic_selection_performed": false
}
```

`decision.status` may also be `rejected`, in which case `selected_id` and `selected_candidate` are
`null` and `reject_all` is `true`. A decision artifact is still `review_required` until signed.

### PubMed Evidence Worksheet

Top-level `schema`: `medscale.pubmed_evidence_worksheet.v1`

```json
{
  "schema": "medscale.pubmed_evidence_worksheet.v1",
  "source_artifact_id": "msa-...",
  "source_record_ids": ["PMID:10952317"],
  "records": [
    {
      "pmid": "10952317",
      "doi": "10.1038/35020115",
      "title": "Article title.",
      "mesh_headings": [],
      "publication_types": [],
      "review_items": [
        {
          "locator": "pubmed:10952317:abstract:0",
          "locator_text_sha256": "sha256...",
          "source_text_length": 123,
          "claim_text": null,
          "stance": null,
          "evidence_assessment": {
            "study_design": null,
            "risk_of_bias": null,
            "certainty": null,
            "applicability": null
          },
          "reviewer_notes": null
        }
      ]
    }
  ],
  "claim_count": 0,
  "claims_created_automatically": false,
  "source_text_copied_into_worksheet": false
}
```

### Claim Record

Top-level `schema`: `medscale.claim_record.v1`

```json
{
  "schema": "medscale.claim_record.v1",
  "claim_id": "msclaim-...",
  "claim_text": "Human-authored claim.",
  "stance": "support",
  "source_artifact_id": "msa-...",
  "source_record_id": "PMID:10952317",
  "locator": "pubmed:10952317:abstract:0",
  "locator_text_sha256": "sha256...",
  "evidence_assessment": {
    "study_design": "journal_article",
    "risk_of_bias": "not_assessed",
    "certainty": "not_assessed",
    "applicability": "not_assessed"
  },
  "created_at": "2026-06-20T00:00:00+00:00"
}
```

Claim records require human-authored text and are review-gated before downstream use.

### GenUI Review Action Draft

Top-level `schema`: `medscale.genui_review_action_draft.v1`

```json
{
  "schema": "medscale.genui_review_action_draft.v1",
  "ok": true,
  "dry_run": true,
  "write_enabled": false,
  "persisted": true,
  "draft_artifact_id": "msa-genui-draft-...",
  "source_artifact_id": "msa-...",
  "artifact_schema": "medscale.terminology_mapping_request.v1",
  "review_status": "approved",
  "action": "select",
  "proposed_operation": {
    "entrypoint": "TerminologyMappingDecisionRecorder.select",
    "payload": {
      "mapping_request_artifact_id": "msa-...",
      "query": "melanoma",
      "reviewer_rationale": "Human rationale.",
      "selected_id": "D008545",
      "candidate_count": 1
    }
  },
  "warnings": [
    "Draft artifact persisted for audit; no approval, mapping decision, or claim artifact was written."
  ]
}
```

The dashboard may persist this draft as an audit artifact when `persist=true`. It must still keep
`dry_run=true` and `write_enabled=false`; a persisted draft is not a review approval, terminology
decision, PubMed claim, or ledger write.

### GenUI Review Action Confirmation

Top-level `schema`: `medscale.genui_review_action_confirmation.v1`

```json
{
  "schema": "medscale.genui_review_action_confirmation.v1",
  "ok": true,
  "dry_run": true,
  "write_enabled": false,
  "persisted": true,
  "confirmation_artifact_id": "msa-genui-confirm-...",
  "draft_artifact_id": "msa-genui-draft-...",
  "source_artifact_id": "msa-...",
  "action": "select",
  "reviewer": {
    "id": "reviewer@example.test",
    "role": "principal_investigator"
  },
  "confirmation_rationale": "Ready for separate execution review.",
  "acknowledgements": {
    "no_execution_performed": true,
    "requires_separate_execution_review": true,
    "requires_new_artifact_review": true
  },
  "proposed_operation": {
    "entrypoint": "TerminologyMappingDecisionRecorder.select",
    "payload": {}
  }
}
```

A confirmation envelope records reviewer intent for audit, not execution. It must remain
`dry_run=true` and `write_enabled=false`; it is not a review approval, terminology decision,
PubMed claim, or ledger write.

---

## Agent 解析指南

1. **检查 `success` 字段** — `false` 时读取 `error`、`status` 和 `issues`
2. **读取 `summary`** — 包含关键发现和推荐，适合决策
3. **读取 `stages.*`** — 获取详细分析数据
4. **读取 `validation`** — 检查数据质量和置信度
5. **检查 `decision_eligible`** — Stage 1/2 未通过时不得消费排名或生成论文
6. **读取 checkpoint** — `full` 模式下使用 `artifacts.pipeline_checkpoint` 恢复或审计
