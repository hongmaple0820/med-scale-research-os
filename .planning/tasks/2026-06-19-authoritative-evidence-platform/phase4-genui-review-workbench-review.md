# Review - GenUI Review Workbench

Date: 2026-06-20
Level: M

## Decision

Accept the continuation as a dashboard exposure slice.

## Findings

- The implementation converts review artifacts into structured cards and locked controls without
  crossing the human-review boundary.
- The workbench payload is available both at `summary.genui_review_workbench` and inside
  `summary.medical_research_os.genui_review_workbench`.
- The frontend renders an empty state when no review artifacts exist and renders artifact cards
  when manifests are present.
- The browser smoke confirmed the populated workbench panel, PubMed worksheet card, terminology
  mapping request card, reviewer controls, and matching API schema.

## Residual Risks

- The current controls are presentation-only; authenticated write actions still need a separate
  design.
- Artifact discovery is file-system based and intended for the local dashboard, not multi-user
  concurrent review.
- Real OpenTiny GenUI SDK integration remains deferred until LLM service configuration and medical
  reviewer write semantics are agreed.
