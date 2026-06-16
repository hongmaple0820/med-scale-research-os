---
name: schema-definitions
description: 每阶段输入输出 JSON Schema — 确保 AI 输出格式一致
---

# JSON Schema 定义

## 通用 Provenance 对象

所有 phase 输出中的数值型字段必须包含 provenance：

```json
{
  "source": "string (required) — 数据库名称",
  "api_url": "string (required) — API 端点",
  "timestamp": "string (required) — ISO8601 格式",
  "confidence": "enum: HIGH | MEDIUM | LOW | SPECULATIVE (required)"
}
```

## Phase 1: Expression Panorama

### 输入
```json
{
  "gene_symbol": "string (required, pattern: ^[A-Z0-9-]+$)",
  "disease": "string (required)",
  "tcga_study_id": "string (optional, e.g. paad_tcga)"
}
```

### 输出（关键字段）
```json
{
  "gene": "string",
  "disease": "string",
  "gtex_expression": {
    "tissues": [
      {"tissue": "string", "median_tpm": "number >= 0"}
    ],
    "tau_index": "number (0-1)",
    "top_tissues": ["string"],
    "provenance": "Provenance"
  },
  "tcga_differential": {
    "cancer_type": "string",
    "tumor_n": "integer",
    "normal_n": "integer",
    "log2fc": "number",
    "p_value": "number",
    "q_value": "number",
    "direction": "enum: up | down | ns",
    "provenance": "Provenance"
  },
  "survival": {
    "hr": "number",
    "hr_ci_lower": "number",
    "hr_ci_upper": "number",
    "p_value": "number",
    "provenance": "Provenance"
  },
  "immune_correlation": {
    "cell_types": [
      {
        "cell_type": "string",
        "correlation": "number (-1 to 1)",
        "p_value": "number",
        "q_value": "number"
      }
    ],
    "provenance": "Provenance"
  },
  "tme_profile": {
    "phenotype": "enum: hot | cold | excluded | immunosuppressive",
    "immune_score": "number",
    "stromal_score": "number",
    "provenance": "Provenance"
  }
}
```

## Phase 2: Target Screening

### 输出（关键字段）
```json
{
  "disease": "string",
  "targets": [
    {
      "gene": "string",
      "association_score": "number (0-1)",
      "datatype_scores": {
        "genetic_association": "number",
        "somatic_mutation": "number",
        "known_drug": "number",
        "literature": "number",
        "rna_expression": "number"
      },
      "genetic_constraint": {
        "pLI": "number",
        "LOEUF": "number",
        "provenance": "Provenance"
      },
      "druggability": {
        "classification": "enum: Tclin | Tchem | Tbio | Tdark",
        "provenance": "Provenance"
      }
    }
  ]
}
```

## Phase 3: Deep Research

### 输出（关键字段）
```json
{
  "gene": "string",
  "clinical_trials": {
    "total": "integer",
    "by_phase": {"phase1": "int", "phase2": "int", "phase3": "int"},
    "provenance": "Provenance"
  },
  "drugs": {
    "approved": [{"name": "string", "mechanism": "string"}],
    "provenance": "Provenance"
  },
  "evidence_profile": {
    "paths": [
      {"name": "string", "grade": "enum: T1 | T2 | T3 | T4", "summary": "string"}
    ]
  }
}
```

## Phase 4: Business Planning

### 输出（关键字段）
```json
{
  "gene": "string",
  "development_timeline": {
    "modality": "string",
    "phases": [{"name": "string", "duration_months": "integer", "cost_musd": "number"}],
    "total_months": "integer"
  },
  "risk_analysis": {
    "technical": ["string"],
    "commercial": ["string"],
    "regulatory": ["string"]
  }
}
```
