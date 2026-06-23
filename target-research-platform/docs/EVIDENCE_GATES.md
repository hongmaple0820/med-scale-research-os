# Evidence Gates

MedSCALE stage outputs distinguish successful execution from decision-grade
evidence. A stage can run successfully and still be blocked for downstream
research decisions when the source coverage, normalization, replication, or
traceability is insufficient.

Stage 1, Stage 2, and Stage 3 write the gate result to:

```json
{
  "validation": {
    "decision_eligible": false,
    "evidence_gate": {
      "stage": "stage2_screening",
      "status": "blocked",
      "confidence": "none",
      "decision_eligible": false,
      "checks": {
        "cross_source_replication": false,
        "normalization_method_card": true
      },
      "issues": [
        "No verified independent GEO-vs-TCGA replication evidence is attached."
      ]
    }
  }
}
```

Use strict evidence mode for agent self-tests and user handoff runs:

```bash
python main.py full --target CDK4 --disease "breast cancer" --cancers BRCA --strict-evidence --json
```

In strict mode, the full pipeline stops at the first stage whose
`validation.evidence_gate.decision_eligible` is `false`. It does not generate
downstream conclusions from blocked evidence.

Before claiming patent landscape evidence, run:

```bash
npm run medscale -- target doctor --json
```

The `medical_retrieval` card must show `patent_api_key=present`. If it reports
`PATENT KEY MISSING`, configure `PATENTSVIEW_API_KEY` or `USPTO_API_KEY` and
rerun the doctor command.

Before tagging or publishing MedSCALE, run:

```bash
npm run medscale -- target release-check --json
```

The release gate blocks when explicit release blockers remain, including no
real medical model token usage or a dirty git worktree. If a release readiness
run made no model provider calls, record that explicitly instead of inventing
usage:

```bash
npm run medscale -- target token attest-no-usage --scope release-readiness --reason "No model provider call was executed during this release readiness run." --json
```

This attestation is not a token/cost usage record and must not be used to claim
model cost review. Missing patent credentials are treated as a release warning
when the PatentsView/openFDA clients and tests are packaged, because those
credentials are deployment-time configuration. A release with that warning must
not claim live patent landscape evidence until users configure
`PATENTSVIEW_API_KEY` or `USPTO_API_KEY`. Do not use `--skip-git` for an actual
release.

## Stage Requirements

- Stage 1 requires traceable GTEx normal-tissue expression, HPA protein
  expression, disease-matched TCGA tumor expression, survival analysis, and
  immune-correlation evidence for a decision-grade result.
- Stage 2 requires metadata-based GEO differential expression, independent
  TCGA/FireBrowse replication, strict thresholds, a normalization method card,
  and concordant significant-gene direction across sources.
- Stage 3 requires traceable literature, clinical, patent, and market evidence.
  Heuristic patent or market summaries without source records are blocked.

## Stage 2 Normalization Method Card

Stage 2 records `normalization_method_card` when it can describe source-specific
GEO and TCGA processing. The current integration strategy is late integration by
effect direction:

- GEO and TCGA raw expression matrices are not pooled across platforms.
- Differential expression is computed independently per source.
- Candidate genes become decision-grade only when significant genes overlap and
  log2 fold-change direction is concordant across independent sources.
