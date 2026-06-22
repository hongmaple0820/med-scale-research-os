# Medical AI Guide Intake and Evidence Audit

Date: 2026-06-19
Level: CRITICAL
Status: COMPLETE

## Input

Two user-provided text attachments forming one end-to-end medical AI implementation guide.

## Outcome

- Performed a deep adversarial evidence review.
- Produced 28 high-impact findings.
- Accepted terminology standardization, source-language preservation, claim-level provenance,
  evidence uncertainty, and medical/commercial isolation.
- Rejected pseudo-GRADE numeric scoring, unbenchmarked fixed retrieval weights, automatic
  innovation/investment recommendations, and knowledge-graph-as-truth behavior.
- Marked licensed or unverified services as pending admission.
- Added ADR-0006 and updated the frozen V2 architecture/spec/plan.

## Key Evidence Checks

- Live NCBI E-Utilities counts distinguish PubMed citations from PMC full text.
- PubMedBERT's primary paper does not establish the guide's universal 95.62% matching claim.
- Cochrane/GRADE guidance does not use the guide's 10/8/6 publication-type scoring table.
- Public API access and quotas are provider/version dependent and cannot be copied as constants.
- Chinese privacy, cross-border, ethics, and device classification claims require
  jurisdiction/use-case inputs and cannot be emitted as universal conclusions.

## Deliverables

- `docs/architecture/MEDICAL_AI_GUIDE_EVIDENCE_AUDIT_2026-06-19.md`
- `docs/architecture/adr/0006-terminology-retrieval-and-evidence-methodology.md`
- `.context/compound-engineering/todos/003-ready-p1-build-terminology-and-pubmed-claim-ledger.md`
